// Aplikuje opravy GTFS z data/gtfs-patches/*.json (zmeny CP vyhlásené DPMP,
// ktoré ešte nie sú v publikovanom GTFS feede). Oprava sa použije len na feed,
// pre ktorý bola vytvorená (baseFeedVersion) — keď vyjde nový feed, ignoruje sa.
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';

export function applyPatches(t, dir = 'data/gtfs-patches') {
  const applied = [];
  if (!existsSync(dir)) return applied;
  const version = t.feedInfo[0]?.feed_version || '';
  for (const f of readdirSync(dir).filter((x) => x.endsWith('.json')).sort()) {
    const p = JSON.parse(readFileSync(join(dir, f), 'utf8'));
    if (p.baseFeedVersion !== version) {
      console.warn(`⚠ oprava ${f} je pre feed ${p.baseFeedVersion}, načítaný je ${version || '?'} — preskočená`);
      continue;
    }
    const remove = new Set(p.removeTrips || []);
    for (const nt of p.addTrips || []) remove.add(nt.trip_id);
    const known = new Set(t.trips.map((x) => x.trip_id));
    for (const id of p.removeTrips || []) if (!known.has(id)) throw new Error(`${f}: spoj ${id} nie je vo feede`);
    t.trips = t.trips.filter((x) => !remove.has(x.trip_id));
    t.stopTimes = t.stopTimes.filter((x) => !remove.has(x.trip_id));
    const stopIds = new Set(t.stops.map((s) => s.stop_id));
    for (const nt of p.addTrips || []) {
      t.trips.push({
        route_id: nt.route_id, service_id: nt.service_id, trip_id: nt.trip_id,
        trip_headsign: nt.trip_headsign || '', direction_id: nt.direction_id ?? '', shape_id: nt.shape_id || '',
      });
      nt.stop_times.forEach(([stop_id, arrival_time, departure_time], i) => {
        if (!stopIds.has(stop_id)) throw new Error(`${f}: zastávka ${stop_id} nie je vo feede`);
        t.stopTimes.push({ trip_id: nt.trip_id, arrival_time, departure_time, stop_id, stop_sequence: String(i + 1) });
      });
    }
    // dni pred platnosťou opravy by mali starý CP s novými spojmi — vyradiť
    const cut = p.calendar?.removeBefore;
    if (cut) {
      t.calendarDates = t.calendarDates.filter((c) => c.date >= cut);
      for (const c of t.calendar) if (c.start_date < cut) c.start_date = cut;
    }
    for (const [service_id, dates] of Object.entries(p.calendar?.addDates || {})) {
      const have = new Set(t.calendarDates.filter((c) => c.service_id === service_id && c.exception_type === '1').map((c) => c.date));
      for (const date of dates) if (!have.has(date)) t.calendarDates.push({ service_id, date, exception_type: '1' });
    }
    if (p.validTo) for (const c of t.calendar) if (c.end_date < p.validTo) c.end_date = p.validTo;
    // spoj pokračuje ako iná linka („zostaň sedieť“) — GTFS ich má rozdelené
    const have = new Set(t.trips.map((x) => x.trip_id));
    for (const l of p.links || []) {
      if (!have.has(l.from) || !have.has(l.to)) throw new Error(`${f}: väzba ${l.from} → ${l.to} na neexistujúci spoj`);
      t.links.push([l.from, l.to]);
    }
    applied.push({ id: p.id, title: p.title, validFrom: p.validFrom, validTo: p.validTo, trips: (p.addTrips || []).length, removed: (p.removeTrips || []).length, links: (p.links || []).length });
  }
  return applied;
}
