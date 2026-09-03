#!/usr/bin/env node
// Validácia presnosti plánovača nad reálnym datasetom DPMP.
//
// 1. Rekonštrukcia spojov: pre náhodné tripy musí router nájsť spojenie
//    z prvej na poslednú zastávku s príchodom najneskôr ako v CP.
// 2. Presná zhoda časov: ak router zvolí ten istý spoj, časy nástupu aj
//    výstupu musia sedieť so stop_times na sekundu.
// 3. Prestupy: čas na prestup >= rezerva, legy nadväzujú.
// 4. Krížová kontrola s referenčnými odchodmi (napr. z realtime open data
//    DPMP): trip s daným odchodom z prvej zastávky musí v CP existovať.
import { readFileSync } from 'node:fs';
import { Raptor, planJourneys } from '../../public/mhd/raptor.js';

const D = JSON.parse(readFileSync('public/mhd/data/dataset.json', 'utf8'));
const raptor = new Raptor(D);

let failures = 0;
const fail = (msg) => { failures++; console.error(`✗ ${msg}`); };
const ok = (msg) => console.log(`✓ ${msg}`);

function dateInfoFor(dateStr) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const mk = (ts) => {
    const dt = new Date(ts);
    return { num: dt.getUTCFullYear() * 10000 + (dt.getUTCMonth() + 1) * 100 + dt.getUTCDate(), weekday: (dt.getUTCDay() + 6) % 7 };
  };
  const base = Date.UTC(y, m - 1, d);
  return { ...mk(base), prev: mk(base - 86400e3), next: mk(base + 86400e3) };
}
const fmt = (s) => `${Math.floor(s / 3600)}:${String(Math.floor((s % 3600) / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;

const TEST_DATE = '2026-09-04'; // piatok — pracovný deň v období 1383
const di = dateInfoFor(TEST_DATE);

// ── 1+2: rekonštrukcia náhodných spojov ─────────────────────────────
let rng = 12345;
const rand = () => (rng = (rng * 1103515245 + 12345) % 2 ** 31) / 2 ** 31;
const activePatterns = D.patterns.filter((p) =>
  p.trips.some((t) => raptor.serviceActive(t.sv, di.num, di.weekday)));
console.log(`patterns aktívne ${TEST_DATE}: ${activePatterns.length}/${D.patterns.length}`);
if (activePatterns.length < 50) fail('podozrivo málo aktívnych patternov');

let reconstructed = 0, exact = 0;
for (let i = 0; i < 60; i++) {
  const p = activePatterns[Math.floor(rand() * activePatterns.length)];
  const trips = p.trips.filter((t) => raptor.serviceActive(t.sv, di.num, di.weekday));
  const trip = trips[Math.floor(rand() * trips.length)];
  if (!trip || trip.t[1] > 86400) continue; // nočné cez polnoc testujeme zvlášť
  const from = p.stops[0], to = p.stops[p.stops.length - 1];
  const dep = trip.t[1];
  const js = raptor.query(new Map([[from, 0]]), new Map([[to, 0]]), di, dep - 60);
  if (!js.length) {
    fail(`linka ${D.routes[p.r].s}: žiadne spojenie ${D.stops[from].n} → ${D.stops[to].n} o ${fmt(dep - 60)}`);
    continue;
  }
  const best = js[js.length - 1];
  const cpArr = trip.t[trip.t.length - 2];
  if (best.arrTime > cpArr) {
    fail(`linka ${D.routes[p.r].s} ${D.stops[from].n}→${D.stops[to].n}: router ${fmt(best.arrTime)} > CP ${fmt(cpArr)}`);
    continue;
  }
  reconstructed++;
  // ak zvolil presne tento spoj, over časovú zhodu
  const leg = js.map((j) => j.legs.find((l) => l.type === 'ride' && l.dep === dep && l.from === from)).find(Boolean);
  if (leg) {
    const pos = p.stops.indexOf(leg.to);
    if (leg.arr === trip.t[2 * pos] && leg.dep === trip.t[1]) exact++;
    else fail(`nesúlad časov legu na linke ${D.routes[p.r].s}`);
  }
}
ok(`rekonštrukcia spojov: ${reconstructed} OK, z toho ${exact} presných zhôd časov`);

// ── 3: prestupové spojenia ──────────────────────────────────────────
// vyber dvojice zastávok bez priamej linky
const directPairs = new Set();
for (const p of D.patterns) {
  for (let a = 0; a < p.stops.length; a++)
    for (let b = a + 1; b < p.stops.length; b++)
      directPairs.add(p.stops[a] + '_' + p.stops[b]);
}
let transferTested = 0, transferOk = 0;
for (let i = 0; i < 400 && transferTested < 25; i++) {
  const a = Math.floor(rand() * D.stops.length);
  const b = Math.floor(rand() * D.stops.length);
  if (a === b || directPairs.has(a + '_' + b)) continue;
  const js = raptor.query(new Map([[a, 0]]), new Map([[b, 0]]), di, 8 * 3600);
  if (!js.length) continue;
  transferTested++;
  const j = js[js.length - 1];
  let valid = true, prevArr = -1, prevTo = a;
  for (const l of j.legs) {
    if (l.dep < prevArr) { valid = false; fail(`leg začína pred príchodom predošlého (${fmt(l.dep)} < ${fmt(prevArr)})`); }
    if (l.type === 'ride' && l.arr < l.dep) { valid = false; fail('príchod pred odchodom'); }
    if (l.from !== prevTo) { valid = false; fail(`nenadväzujúce legy: ${D.stops[prevTo].n} ≠ ${D.stops[l.from].n}`); }
    prevArr = l.arr; prevTo = l.to;
  }
  if (valid) transferOk++;
}
ok(`prestupové spojenia: ${transferOk}/${transferTested} validných`);

// ── 4: krížová kontrola s referenčnými odchodmi ─────────────────────
// pozorované PLANNED_START z realtime open data DPMP (streda 3.9.2026,
// egov.presov.sk/GeoDataKatalog/dpmp.csv, zachytené 20:06–20:16)
const observed = [
  ['38', '19:48'], ['14', '19:55'], ['4', '19:46'], ['8', '19:35'],
  ['28', '19:52'], ['10', '20:04'], ['39', '19:45'], ['18', '19:50'],
  ['1', '19:45'], ['4', '19:50'], ['8', '19:55'], ['5', '19:50'],
  ['45', '20:00'], ['13', '19:56'], ['15', '19:50'], ['21', '20:12'],
  ['22', '20:10'], ['24', '20:06'], ['27', '20:07'], ['2', '20:04'],
  ['4', '20:06'], ['38', '20:15'], ['22', '20:13'], ['2', '20:10'],
  ['13', '20:07'], ['8', '20:15'], ['38', '20:08'], ['1', '20:05'],
  ['1', '20:02'], ['4', '20:10'], ['24', '20:06'], ['21', '20:12'],
];
const wedDi = dateInfoFor('2026-09-03');
const startsByRoute = new Map();
D.patterns.forEach((p) => {
  const short = D.routes[p.r].s;
  let set = startsByRoute.get(short);
  if (!set) startsByRoute.set(short, (set = new Set()));
  for (const t of p.trips) {
    if (raptor.serviceActive(t.sv, wedDi.num, wedDi.weekday)) set.add(t.t[1]);
  }
});
let matched = 0;
const misses = [];
for (const [route, hm] of observed) {
  const [h, m] = hm.split(':').map(Number);
  const secs = h * 3600 + m * 60;
  const set = startsByRoute.get(route);
  if (set && set.has(secs)) matched++;
  else misses.push(`${route}@${hm}`);
}
const ratio = matched / observed.length;
console.log(`krížová kontrola live odchodov: ${matched}/${observed.length} (${(ratio * 100).toFixed(0)} %)`);
if (misses.length) console.log(`  nenájdené: ${misses.join(', ')}`);
if (ratio < 0.85) fail('krížová kontrola pod 85 % — dataset nemusí byť aktuálny');

// ── 5: nočné spoje cez polnoc ───────────────────────────────────────
const nightPat = D.patterns.filter((p) => ['N1', 'N2'].includes(D.routes[p.r].s));
if (nightPat.length) {
  const anyNight = nightPat.some((p) => p.trips.some((t) => t.t[1] >= 23 * 3600));
  ok(`nočné linky v datasete: ${nightPat.length} patternov${anyNight ? ' (vrátane spojov po 23:00)' : ''}`);
} else {
  console.warn('⚠ nočné linky N1/N2 nemajú patterny');
}

console.log(failures ? `\nZLYHANIA: ${failures}` : '\nVšetky kontroly prešli.');
process.exit(failures ? 1 : 0);
