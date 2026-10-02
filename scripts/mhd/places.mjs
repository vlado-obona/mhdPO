// Zostaví mhd-app/data/places.json z data/osm-places/ (stiahnuté workflowom
// „Miesta a adresy (OpenStreetMap)“): pomenované miesta s kategóriou
// a adresy zoskupené po uliciach. Nič sa nedopĺňa ani neodhaduje — názvy aj
// súradnice sú presne z OSM, appka k nim len hľadá najbližšie zastávky.
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

// kategórie: [popis v appke, ikona]; poradie = index v places.json
const CATS = [
  ['námestie', '⛲'], ['kostol', '⛪'], ['synagóga', '🕍'], ['modlitebňa', '🛐'],
  ['nemocnica', '🏥'], ['zdravotné stredisko', '🩺'], ['lekáreň', '💊'],
  ['škola', '🏫'], ['vysoká škola', '🎓'], ['materská škola', '🧸'],
  ['úrad', '🏛️'], ['súd', '⚖️'], ['polícia', '👮'], ['pošta', '📮'], ['hasiči', '🚒'], ['knižnica', '📚'],
  ['divadlo', '🎭'], ['kino', '🎬'], ['kultúra', '🎨'], ['múzeum', '🖼️'],
  ['obchodné centrum', '🛍️'], ['potraviny', '🛒'], ['obchod', '🏪'], ['trhovisko', '🧺'],
  ['reštaurácia', '🍽️'], ['kaviareň', '☕'], ['ubytovanie', '🏨'],
  ['banka', '🏦'], ['čerpacia stanica', '⛽'],
  ['autobusová stanica', '🚌'], ['železničná stanica', '🚆'],
  ['park', '🌳'], ['šport', '🏟️'], ['kúpalisko', '🏊'], ['ihrisko', '🛝'],
  ['pamiatka', '🏰'], ['zaujímavosť', '📍'], ['cintorín', '🪦'],
  ['časť mesta', '🏘️'], ['obec', '🏡'], ['lokalita', '📌'],
  ['sociálne zariadenie', '🤝'], ['firma', '🏢'], ['budova', '🏢'], ['areál', '🏭'], ['príroda', '⛰️'],
];
const C = Object.fromEntries(CATS.map(([n], i) => [n, i]));

// tagy, ktoré nie sú cieľom cesty (lavičky, koše, parkoviská, automaty…)
const SKIP_AMENITY = /^(bench|parking|parking_space|parking_entrance|bicycle_parking|motorcycle_parking|waste_basket|waste_disposal|recycling|vending_machine|toilets|drinking_water|telephone|clock|charging_station|post_box|atm|shelter|grit_bin|hunting_stand|bicycle_rental|car_wash|compressed_air|water_point|fountain|bbq|lounger|smoking_area|ticket_validator|letter_box|feeding_place|loading_dock|parcel_locker|vacuum_cleaner)$/;

function category(g) {
  const a = g.amenity, sh = g.shop, t = g.tourism, l = g.leisure;
  if (g.place === 'square') return C['námestie'];
  if (g.highway === 'pedestrian') return /námest/i.test(g.name) ? C['námestie'] : null;
  if (a === 'place_of_worship' || a === 'monastery') {
    if (g.religion === 'jewish') return C['synagóga'];
    if (g.religion === 'christian' || !g.religion) return C['kostol'];
    return C['modlitebňa'];
  }
  if (a && SKIP_AMENITY.test(a)) return null;
  if (a === 'hospital' || g.healthcare === 'hospital') return C['nemocnica'];
  if (/^(clinic|doctors|dentist)$/.test(a) || g.healthcare) return a === 'pharmacy' || g.healthcare === 'pharmacy' ? C['lekáreň'] : C['zdravotné stredisko'];
  if (a === 'pharmacy') return C['lekáreň'];
  if (a === 'university' || a === 'college') return C['vysoká škola'];
  if (a === 'kindergarten' || a === 'childcare') return C['materská škola'];
  if (a === 'school') return C['škola'];
  if (a === 'townhall' || g.office === 'government') return C['úrad'];
  if (a === 'courthouse') return C['súd'];
  if (a === 'police') return C['polícia'];
  if (a === 'post_office') return C['pošta'];
  if (a === 'fire_station') return C['hasiči'];
  if (a === 'library') return C['knižnica'];
  if (a === 'theatre') return C['divadlo'];
  if (a === 'cinema') return C['kino'];
  if (/^(arts_centre|community_centre|concert_hall|events_venue|exhibition_centre|music_venue)$/.test(a)) return C['kultúra'];
  if (t === 'museum' || t === 'gallery') return C['múzeum'];
  if (sh === 'mall' || sh === 'department_store') return C['obchodné centrum'];
  if (/^(supermarket|convenience|hypermarket|greengrocer|bakery|butcher)$/.test(sh)) return C['potraviny'];
  if (a === 'marketplace') return C['trhovisko'];
  if (sh) return C['obchod'];
  if (/^(restaurant|fast_food|pub|bar|food_court|biergarten|nightclub)$/.test(a)) return C['reštaurácia'];
  if (/^(cafe|ice_cream)$/.test(a)) return C['kaviareň'];
  if (/^(hotel|guest_house|hostel|motel|apartment|chalet)$/.test(t)) return C['ubytovanie'];
  if (a === 'bank') return C['banka'];
  if (a === 'fuel') return C['čerpacia stanica'];
  if (a === 'bus_station') return C['autobusová stanica'];
  if (g.railway === 'station' || g.railway === 'halt') return C['železničná stanica'];
  if (/^(swimming_pool|water_park)$/.test(l) || a === 'swimming_pool') return C['kúpalisko'];
  if (l === 'playground') return C['ihrisko'];
  if (/^(park|garden|nature_reserve|dog_park)$/.test(l)) return C['park'];
  if (l || g.sport || g.club === 'sport') return C['šport'];
  if (g.historic) return C['pamiatka'];
  if (/^(attraction|viewpoint|zoo|theme_park|artwork|picnic_site)$/.test(t)) return C['zaujímavosť'];
  if (t === 'information') return null;
  if (a === 'grave_yard' || g.landuse === 'cemetery') return C['cintorín'];
  if (/^(suburb|quarter|neighbourhood|borough|city_block)$/.test(g.place)) return C['časť mesta'];
  if (/^(village|hamlet|town|city|isolated_dwelling)$/.test(g.place)) return C['obec'];
  if (/^(locality|farm|plot)$/.test(g.place)) return C['lokalita'];
  if (/^(social_facility|nursing_home|social_centre)$/.test(a)) return C['sociálne zariadenie'];
  if (g.office || g.craft) return C['firma'];
  if (t) return C['zaujímavosť'];
  if (/^(retail|commercial|industrial)$/.test(g.landuse) || g.power || g.aeroway) return C['areál'];
  if (g.natural || g.man_made || /^(recreation_ground|allotments)$/.test(g.landuse)) return C['príroda'];
  if (a) return C['budova'];
  if (g.building) return C['budova'];
  return null;
}

function haversine(la1, lo1, la2, lo2) {
  const R = 6371000, r = Math.PI / 180;
  const a = Math.sin((la2 - la1) * r / 2) ** 2 + Math.cos(la1 * r) * Math.cos(la2 * r) * Math.sin((lo2 - lo1) * r / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

// najbližšia zastávka (m); miesta ďalej ako MAX_FROM_STOP od siete MHD vynechať
const MAX_FROM_STOP = 1500;

export function buildPlaces(stops, dir = 'data/osm-places') {
  const pf = join(dir, 'pois.json'), af = join(dir, 'addresses.json'), sf = join(dir, 'streets.json');
  if (!existsSync(pf)) return null;
  const near = (la, lo) => {
    let bd = Infinity;
    for (const s of stops) { const d = haversine(la, lo, s.la, s.lo); if (d < bd) bd = d; }
    return bd;
  };
  const src = existsSync(join(dir, 'SOURCE.txt')) ? readFileSync(join(dir, 'SOURCE.txt'), 'utf8') : '';
  const stat = { pois: 0, kept: 0, noCat: 0, far: 0, dup: 0, addr: 0, streets: 0 };

  // ── miesta ──
  const raw = JSON.parse(readFileSync(pf, 'utf8'));
  stat.pois = raw.length;
  const cand = [];
  for (const e of raw) {
    const g = e.g || {};
    const name = (g['name:sk'] || g.name || '').trim();
    if (!name || e.la == null) continue;
    const c = category({ ...g, name });
    if (c == null) { stat.noCat++; continue; }
    if (near(e.la, e.lo) > MAX_FROM_STOP) { stat.far++; continue; }
    const alts = [g.alt_name, g.short_name, g.official_name, g.old_name, g.name !== name ? g.name : null, g.brand !== name ? g.brand : null]
      .filter(Boolean).join('; ');
    cand.push({ name, c, la: e.la, lo: e.lo, alt: alts, rank: e.t === 'n' ? 1 : 0 });
  }
  // duplicity: to isté meno a kategória do 200 m (napr. bod + budova) → jedno
  cand.sort((a, b) => a.name.localeCompare(b.name, 'sk') || a.rank - b.rank);
  const kept = [];
  for (const p of cand) {
    const dup = kept.find((k) => k.name === p.name && (k.c === p.c || k.c === C['budova'] || p.c === C['budova']) && haversine(k.la, k.lo, p.la, p.lo) < 200);
    if (dup) { stat.dup++; if (dup.c === C['budova'] && p.c !== C['budova']) dup.c = p.c; continue; }
    kept.push(p);
  }
  stat.kept = kept.length;

  // ── ulice a adresy ──
  // Rovnaký názov ulice býva v Prešove aj v okolitých obciach (Hlavná,
  // Školská…) — cesty a adresy jedného mena sa preto zhlukujú podľa polohy
  // (do 400 m od seba = tá istá ulica) a každý zhluk je samostatná ulica.
  const byName = new Map();
  const get = (n) => { let x = byName.get(n); if (!x) byName.set(n, (x = [])); return x; };
  if (existsSync(af)) {
    for (const [la, lo, street, hn, city] of JSON.parse(readFileSync(af, 'utf8'))) {
      if (!street || !hn || near(la, lo) > MAX_FROM_STOP) continue;
      get(street).push({ pts: [[la, lo]], hn, city });
      stat.addr++;
    }
  }
  if (existsSync(sf)) {
    for (const w of JSON.parse(readFileSync(sf, 'utf8'))) if (w.n && w.p?.length) get(w.n).push({ pts: w.p, way: true });
  }
  const bbox = (e) => {
    let a = 90, b = 180, c = -90, d = -180;
    for (const [la, lo] of e.pts) { a = Math.min(a, la); c = Math.max(c, la); b = Math.min(b, lo); d = Math.max(d, lo); }
    return [a - 0.004, b - 0.006, c + 0.004, d + 0.006]; // ~400 m okraj
  };
  const close = (x, y) => {
    const [a, b, c, d] = x.bb;
    if (y.bb[0] > c || y.bb[2] < a || y.bb[1] > d || y.bb[3] < b) return false;
    for (const p of x.pts) for (const q of y.pts) if (haversine(p[0], p[1], q[0], q[1]) < 400) return true;
    return false;
  };
  const mid = (ways) => { // bod v polovici dĺžky najdlhšej OSM cesty zhluku
    let best = null, bl = -1;
    for (const p of ways) {
      let L = 0;
      for (let i = 1; i < p.length; i++) L += haversine(p[i - 1][0], p[i - 1][1], p[i][0], p[i][1]);
      if (L > bl) { bl = L; best = p; }
    }
    let half = bl / 2;
    for (let i = 1; i < best.length; i++) {
      const d = haversine(best[i - 1][0], best[i - 1][1], best[i][0], best[i][1]);
      if (d >= half) return best[i - 1];
      half -= d;
    }
    return best[0];
  };
  const a = [];
  for (const [name, els] of byName) {
    els.forEach((e) => { e.bb = bbox(e); });
    const par = els.map((_, i) => i);
    const find = (i) => (par[i] === i ? i : (par[i] = find(par[i])));
    for (let i = 0; i < els.length; i++) for (let j = i + 1; j < els.length; j++) {
      if (find(i) !== find(j) && close(els[i], els[j])) par[find(i)] = find(j);
    }
    const clusters = new Map();
    els.forEach((e, i) => { const r = find(i); if (!clusters.has(r)) clusters.set(r, []); clusters.get(r).push(e); });
    const out = [];
    for (const cl of clusters.values()) {
      const ways = cl.filter((e) => e.way).map((e) => e.pts);
      const adr = cl.filter((e) => !e.way);
      let pt;
      if (ways.length) pt = mid(ways);
      else {
        const cla = adr.reduce((x, e) => x + e.pts[0][0], 0) / adr.length, clo = adr.reduce((x, e) => x + e.pts[0][1], 0) / adr.length;
        pt = adr.map((e) => e.pts[0]).reduce((b, p) => (haversine(cla, clo, p[0], p[1]) < haversine(cla, clo, b[0], b[1]) ? p : b));
      }
      if (near(pt[0], pt[1]) > MAX_FROM_STOP) continue;
      const nums = new Map();
      for (const e of adr) if (!nums.has(e.hn)) nums.set(e.hn, e.pts[0]);
      const cities = {};
      for (const e of adr) if (e.city) cities[e.city] = (cities[e.city] || 0) + 1;
      const city = Object.entries(cities).sort((x, y) => y[1] - x[1])[0]?.[0] || '';
      out.push({ pt, city, nums: [...nums].map(([hn, [la, lo]]) => [hn, la, lo]).sort((x, y) => x[0].localeCompare(y[0], 'sk', { numeric: true })) });
    }
    // viac ulíc s rovnakým menom: doplniť obec (mimo Prešova), aby sa dali rozlíšiť
    for (const o of out) {
      const label = out.length > 1 && o.city && o.city !== 'Prešov' ? `${name} (${o.city})` : name;
      a.push([label, o.pt[0], o.pt[1], o.nums]);
    }
  }
  a.sort((x, y) => x[0].localeCompare(y[0], 'sk'));
  stat.streets = a.length;

  const p = kept.map((k) => (k.alt ? [k.name, k.c, k.la, k.lo, k.alt] : [k.name, k.c, k.la, k.lo]));
  return {
    places: { src: '© prispievatelia OpenStreetMap, ODbL 1.0', osm: (src.match(/stav OSM: (\S+)/) || [])[1] || '', cats: CATS, p, a },
    stat,
  };
}
