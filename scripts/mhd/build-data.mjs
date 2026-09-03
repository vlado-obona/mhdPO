#!/usr/bin/env node
// Skompiluje GTFS feed MHD Prešov (data/gtfs-presov/) do kompaktného
// datasetu pre plánovač (mhd-app/data/dataset.json).
//
// Formát datasetu (indexy namiesto ID, časy v sekundách od polnoci —
// môžu presiahnuť 24 h pri nočných spojoch):
//   meta      – provenience, platnosť feedu
//   stops     – [{n, la, lo}]                     (index = stopIdx)
//   routes    – [{s, l, c, tc}]                   (index = routeIdx)
//   services  – [{d, from, to, add, rem}]         (d = bitmask po–ne, bit0 = pondelok)
//   heads     – deduplikované headsigny
//   patterns  – [{r, stops:[stopIdx], trips:[{sv, h, t:[arr,dep,...]}]}]
//               trips zoradené podľa odchodu z prvej zastávky
//   transfers – [[a, b, secs], ...] pešie prestupy (obojsmerné, uložené raz)
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';

const SRC = 'data/gtfs-presov';
const OUT = 'mhd-app/data';
const WALK_SPEED = 1.25;      // m/s — konzervatívna rýchlosť chôdze
const MAX_TRANSFER_M = 400;   // max. vzdialenosť pešieho prestupu
const MIN_TRANSFER_S = 120;   // minimálna rezerva na prestup

function parseCsv(text) {
  // GTFS CSV: RFC4180 (úvodzovky, čiarky v poliach, CRLF, BOM)
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  const rows = [];
  let field = '', row = [], inQ = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQ) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }
        else inQ = false;
      } else field += c;
    } else if (c === '"') inQ = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n') { row.push(field); field = ''; rows.push(row); row = []; }
    else if (c !== '\r') field += c;
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row); }
  const header = rows.shift().map((h) => h.trim());
  return rows
    .filter((r) => r.length > 1 || (r.length === 1 && r[0] !== ''))
    .map((r) => Object.fromEntries(header.map((h, i) => [h, (r[i] ?? '').trim()])));
}

function load(name, required = true) {
  const p = join(SRC, name);
  if (!existsSync(p)) {
    if (required) throw new Error(`Chýba ${p}`);
    return [];
  }
  return parseCsv(readFileSync(p, 'utf8'));
}

function hms(t) {
  if (!t) return null;
  const [h, m, s] = t.split(':').map(Number);
  return h * 3600 + m * 60 + (s || 0);
}

function haversine(la1, lo1, la2, lo2) {
  const R = 6371000, r = Math.PI / 180;
  const dLa = (la2 - la1) * r, dLo = (lo2 - lo1) * r;
  const a = Math.sin(dLa / 2) ** 2 +
    Math.cos(la1 * r) * Math.cos(la2 * r) * Math.sin(dLo / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

// ── načítanie ────────────────────────────────────────────────────────
const agency = load('agency.txt');
const gStops = load('stops.txt');
const gRoutes = load('routes.txt');
const gTrips = load('trips.txt');
const gStopTimes = load('stop_times.txt');
const gCal = load('calendar.txt', false);
const gCalDates = load('calendar_dates.txt', false);
const gFreq = load('frequencies.txt', false);
const gTransfers = load('transfers.txt', false);
const gFeedInfo = load('feed_info.txt', false);

// ── zastávky (len fyzické: location_type 0/prázdne) ─────────────────
const stopIdx = new Map();
const stops = [];
for (const s of gStops) {
  if (s.location_type && s.location_type !== '0') continue;
  const la = Number(s.stop_lat), lo = Number(s.stop_lon);
  if (!isFinite(la) || !isFinite(lo)) continue;
  stopIdx.set(s.stop_id, stops.length);
  // "  *" v názve = zastávka na znamenie; normalizuj medzery
  stops.push({ n: s.stop_name.replace(/\s+/g, ' ').trim(), la: +la.toFixed(6), lo: +lo.toFixed(6) });
}

// ── linky ────────────────────────────────────────────────────────────
const routeIdx = new Map();
const routes = [];
for (const r of gRoutes) {
  routeIdx.set(r.route_id, routes.length);
  routes.push({
    s: r.route_short_name || r.route_id,
    l: r.route_long_name || '',
    c: r.route_color || '',
    tc: r.route_text_color || '',
  });
}

// ── kalendár ─────────────────────────────────────────────────────────
const serviceIdx = new Map();
const services = [];
function svcFor(id) {
  if (!serviceIdx.has(id)) {
    serviceIdx.set(id, services.length);
    services.push({ d: 0, from: 0, to: 0, add: [], rem: [] });
  }
  return serviceIdx.get(id);
}
const DAYS = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];
for (const c of gCal) {
  const i = svcFor(c.service_id);
  let d = 0;
  DAYS.forEach((day, b) => { if (c[day] === '1') d |= 1 << b; });
  services[i].d = d;
  services[i].from = Number(c.start_date);
  services[i].to = Number(c.end_date);
}
for (const cd of gCalDates) {
  const i = svcFor(cd.service_id);
  (cd.exception_type === '1' ? services[i].add : services[i].rem).push(Number(cd.date));
}

// ── stop_times podľa tripov ─────────────────────────────────────────
const timesByTrip = new Map();
for (const st of gStopTimes) {
  const si = stopIdx.get(st.stop_id);
  if (si === undefined) continue;
  const arr = hms(st.arrival_time) ?? hms(st.departure_time);
  const dep = hms(st.departure_time) ?? arr;
  if (arr === null) continue; // bez času (interpolované) — MHD feedy ich nemávajú
  let list = timesByTrip.get(st.trip_id);
  if (!list) timesByTrip.set(st.trip_id, (list = []));
  list.push({ seq: Number(st.stop_sequence), si, arr, dep });
}

// frequencies.txt → rozbaliť na jednotlivé spoje
const freqByTrip = new Map();
for (const f of gFreq) {
  let list = freqByTrip.get(f.trip_id);
  if (!list) freqByTrip.set(f.trip_id, (list = []));
  list.push({ start: hms(f.start_time), end: hms(f.end_time), hw: Number(f.headway_secs) });
}

// ── patterns + trips ─────────────────────────────────────────────────
const headIdx = new Map();
const heads = [];
function headFor(h) {
  if (!h) return -1;
  if (!headIdx.has(h)) { headIdx.set(h, heads.length); heads.push(h); }
  return headIdx.get(h);
}

const patIdx = new Map();
const patterns = [];
let tripCount = 0, anomalies = 0;

for (const t of gTrips) {
  const ri = routeIdx.get(t.route_id);
  const times = timesByTrip.get(t.trip_id);
  if (ri === undefined || !times || times.length < 2) continue;
  times.sort((a, b) => a.seq - b.seq);
  // monotónnosť časov — nekonzistentný trip radšej vyradiť ako skresliť výsledky
  let ok = true, prev = -1;
  for (const x of times) {
    if (x.arr < prev) { ok = false; break; }
    if (x.dep < x.arr) x.dep = x.arr;
    prev = x.dep;
  }
  if (!ok) { anomalies++; continue; }

  const stopSeq = times.map((x) => x.si);
  const key = ri + '|' + stopSeq.join(',');
  if (!patIdx.has(key)) {
    patIdx.set(key, patterns.length);
    patterns.push({ r: ri, stops: stopSeq, trips: [] });
  }
  const p = patterns[patIdx.get(key)];
  const sv = svcFor(t.service_id);
  const h = headFor(t.trip_headsign);
  const base = [];
  for (const x of times) base.push(x.arr, x.dep);

  const freqs = freqByTrip.get(t.trip_id);
  if (freqs) {
    for (const f of freqs) {
      for (let s = f.start; s < f.end; s += f.hw) {
        const off = s - base[1];
        p.trips.push({ sv, h, t: base.map((v) => v + off) });
        tripCount++;
      }
    }
  } else {
    p.trips.push({ sv, h, t: base });
    tripCount++;
  }
}
for (const p of patterns) p.trips.sort((a, b) => a.t[1] - b.t[1]);

// ── pešie prestupy ───────────────────────────────────────────────────
const transfers = [];
const seen = new Set();
// explicitné z transfers.txt majú prednosť
for (const tr of gTransfers) {
  const a = stopIdx.get(tr.from_stop_id), b = stopIdx.get(tr.to_stop_id);
  if (a === undefined || b === undefined || a === b) continue;
  if (tr.transfer_type === '3') continue; // prestup nemožný
  const secs = Math.max(Number(tr.min_transfer_time) || 0, MIN_TRANSFER_S);
  const k = a < b ? a + '_' + b : b + '_' + a;
  if (seen.has(k)) continue;
  seen.add(k);
  transfers.push([a, b, secs]);
}
// dopočítané podľa vzdialenosti
for (let a = 0; a < stops.length; a++) {
  for (let b = a + 1; b < stops.length; b++) {
    const k = a + '_' + b;
    if (seen.has(k)) continue;
    const dLat = Math.abs(stops[a].la - stops[b].la);
    if (dLat > 0.005) continue; // rýchly filter ~550 m
    const d = haversine(stops[a].la, stops[a].lo, stops[b].la, stops[b].lo);
    if (d > MAX_TRANSFER_M) continue;
    seen.add(k);
    transfers.push([a, b, Math.max(MIN_TRANSFER_S, Math.round(d / WALK_SPEED) + 60)]);
  }
}

// ── meta + zápis ─────────────────────────────────────────────────────
let source = '';
try { source = readFileSync(join(SRC, 'SOURCE.txt'), 'utf8').trim(); } catch {}
let from = Infinity, to = 0;
for (const s of services) {
  if (s.from) from = Math.min(from, s.from);
  if (s.to) to = Math.max(to, s.to);
  for (const d of s.add) { from = Math.min(from, d); to = Math.max(to, d); }
}
const dataset = {
  meta: {
    generated: new Date().toISOString(),
    agency: agency[0]?.agency_name || 'Dopravný podnik mesta Prešov, a.s.',
    feedVersion: gFeedInfo[0]?.feed_version || '',
    feedPublisher: gFeedInfo[0]?.feed_publisher_name || '',
    validFrom: isFinite(from) ? from : 0,
    validTo: to,
    source,
  },
  stops, routes, services, heads, patterns, transfers,
};
mkdirSync(OUT, { recursive: true });
const json = JSON.stringify(dataset);
const hash = createHash('sha256').update(json).digest('hex').slice(0, 12);
writeFileSync(join(OUT, 'dataset.json'), json);
writeFileSync(join(OUT, 'version.json'), JSON.stringify({ v: hash, generated: dataset.meta.generated }));

console.log(`zastávky: ${stops.length}, linky: ${routes.length}, patterns: ${patterns.length}, spoje: ${tripCount}, prestupy: ${transfers.length}`);
console.log(`platnosť feedu: ${dataset.meta.validFrom}–${dataset.meta.validTo}, verzia: ${hash}`);
if (anomalies) console.warn(`⚠ vyradené nekonzistentné tripy: ${anomalies}`);
console.log(`dataset.json: ${(json.length / 1048576).toFixed(2)} MB`);
