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
import { Raptor, planJourneys } from '../../mhd-app/raptor.js';

const D = JSON.parse(readFileSync('mhd-app/data/dataset.json', 'utf8'));
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

// testovacie dni v rámci platnosti datasetu (prvý piatok / streda od začiatku)
function firstWeekday(fromNum, jsDay) {
  const y = Math.floor(fromNum / 1e4), m = Math.floor(fromNum / 100) % 100, d = fromNum % 100;
  for (let k = 0; k < 7; k++) {
    const dt = new Date(Date.UTC(y, m - 1, d + k));
    if (dt.getUTCDay() === jsDay) return dt.toISOString().slice(0, 10);
  }
}
const TEST_DATE = firstWeekday(D.meta.validFrom, 5); // piatok — pracovný deň
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
  // okružné linky a dvojice, kde je cieľ na dochôdzkovú vzdialenosť,
  // router korektne rieši pešo — jazdu nemá zmysel rekonštruovať
  if (from === to || raptor.foot[from].some(([t]) => t === to)) continue;
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
  const pIdx = D.patterns.indexOf(p);
  const leg = js.map((j) => j.legs.find((l) => l.type === 'ride' && l.pattern === pIdx && l.dep === dep && l.from === from)).find(Boolean);
  if (leg) {
    const pos = p.stops.indexOf(leg.to);
    if (leg.arr === trip.t[2 * pos] && leg.dep === trip.t[1]) exact++;
    else fail(`nesúlad časov legu na linke ${D.routes[p.r].s}: ${D.stops[from].n} ${fmt(dep)} → ${D.stops[to].n}; leg ${D.routes[leg.route].s} → ${D.stops[leg.to].n} ${fmt(leg.arr)} (CP ${pos >= 0 ? fmt(trip.t[2 * pos]) : "mimo patternu"})`);
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
  // planJourneys zahŕňa aj optimalizáciu čakania (tightenJourney) —
  // validujeme teda výsledok tak, ako ho dostane používateľ
  const js = planJourneys(raptor, new Map([[a, 0]]), new Map([[b, 0]]), di, 8 * 3600, 4);
  if (!js.length) continue;
  transferTested++;
  let valid = true;
  for (const j of js) {
    let prevArr = -1, prevTo = a;
    for (const l of j.legs) {
      if (l.dep < prevArr) { valid = false; fail(`leg začína pred príchodom predošlého (${fmt(l.dep)} < ${fmt(prevArr)})`); }
      if (l.type === 'ride' && l.arr < l.dep) { valid = false; fail('príchod pred odchodom'); }
      if (l.from !== prevTo) { valid = false; fail(`nenadväzujúce legy: ${D.stops[prevTo].n} ≠ ${D.stops[l.from].n}`); }
      // každý ride musí zodpovedať reálnemu spoju svojho patternu v CP
      if (l.type === 'ride' && l.pattern != null) {
        const p = D.patterns[l.pattern];
        const shift = l.day * 86400;
        const real = p.trips.some((t) =>
          t.t[2 * l.boardPos + 1] + shift === l.dep && t.t[2 * l.alightPos] + shift === l.arr &&
          raptor.serviceActive(t.sv, l.day === 0 ? di.num : (l.day < 0 ? di.prev.num : di.next.num), l.day === 0 ? di.weekday : (l.day < 0 ? di.prev.weekday : di.next.weekday)));
        if (!real) { valid = false; fail(`leg linky ${D.routes[p.r].s} nezodpovedá žiadnemu spoju v CP`); }
      }
      prevArr = l.arr; prevTo = l.to;
    }
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
// (večerné spoje 19:45–20:15 sa zmenou CP od 1.10.2026 nemenili)
const wedDi = dateInfoFor(firstWeekday(D.meta.validFrom, 3));
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

// ── 4b: zmeny CP od 1.10.2026 (oprava 1382 alebo feed 1384 + väzby) ──
const octIds = ['dpmp-2026-10-01', 'dpmp-2026-10-vazby'];
for (const di of (D.meta.patches || []).some((p) => octIds.includes(p.id))
  ? ['2026-10-02', '2026-10-09', '2026-10-27'].filter((d) => Number(d.replaceAll('-', '')) <= D.meta.validTo).map(dateInfoFor) : []) {
  const deps = (line, stop, d) => {
    const set = new Set();
    for (const p of D.patterns) {
      if (D.routes[p.r].s !== line) continue;
      p.stops.forEach((si, k) => {
        if (D.stops[si].n !== stop || k === p.stops.length - 1) return;
        for (const t of p.trips) if (raptor.serviceActive(t.sv, d.num, d.weekday)) set.add(t.t[2 * k + 1]);
      });
    }
    return set;
  };
  const hm = (s) => { const [h, m] = s.split(':').map(Number); return h * 3600 + m * 60; };
  // [linka, zastávka, má byť, nemá byť] — oznam DPMP „Zmeny … 23 spojov MHD - od 1. októbra 2026“
  const expect = [
    ['17', 'Sídlisko III', ['5:32'], []], ['17', 'Širpo', ['14:01'], []],
    ['28', 'Divadlo J. Záborského', ['6:38'], []], ['28', 'Ľubotice *', ['6:53'], []],
    ['32', 'Sibírska', ['7:56'], []], ['32', 'Trojica', ['7:10', '12:42'], []],
    ['32', 'Okružná *', ['12:57', '13:37', '14:57', '15:37', '15:57', '16:37'], []],
    ['32A', 'Sibírska', ['12:46', '13:26', '14:46', '15:26', '15:46', '16:26', '16:46'], []],
    ['34', 'Sídlisko III', ['14:25', '15:55'], []], ['34', 'Pod Šalgovíkom', ['15:03', '16:33'], []],
    ['39', 'Sídlisko III', ['7:45'], []],
    ['21', 'Trojica', ['7:56'], ['7:50']], ['33', 'Delňa', ['18:05'], ['18:40']],
    ['29', 'Sídlisko III', ['7:03', '7:18', '8:03'], ['7:15', '7:43', '8:15']],
    ['29', 'Fakultná nemocnica', ['7:21', '8:21'], ['7:33', '8:33']],
  ];
  let bad = 0;
  for (const [line, stop, yes, no] of expect) {
    const s = deps(line, stop, di);
    for (const t of yes) if (!s.has(hm(t))) { bad++; fail(`CP 1.10.: linka ${line} ${stop} chýba ${t}`); }
    for (const t of no) if (s.has(hm(t))) { bad++; fail(`CP 1.10.: linka ${line} ${stop} ešte má ${t}`); }
  }
  const t14 = [...D.patterns].some((p) => D.routes[p.r].s === '14' && D.stops[p.stops[0]].n === 'Záborské'
    && D.stops[p.stops.at(-1)].n === 'Trojica' && p.trips.some((t) => t.t[1] === hm('7:00') && raptor.serviceActive(t.sv, di.num, di.weekday)));
  if (!t14) { bad++; fail('CP 1.10.: linka 14 o 7:00 zo Záborského nekončí na Trojici'); }
  if (!bad) ok(`zmeny CP od 1.10.2026 (${di.num}): všetkých ${expect.reduce((a, e) => a + e[2].length + e[3].length, 0) + 1} kontrol sedí`);

  // „zostaň sedieť“: nadväzujúce spoje z oznamu sa plánujú ako jeden autobus
  const grp = (n) => new Map(D.stops.map((s, i) => [s, i]).filter(([s]) => s.n === n).map(([, i]) => [i, 0]));
  const seat = [
    ['Dulova Ves', 'Ľubotice *', '6:15', ['44', '28']],
    ['Bzenov', 'Záborské', '16:55', ['18', '14']],
    ['Surdok', 'Ľubotice *', '6:55', ['41', '13']],
    ['Karpatská', 'Poliklinika', '14:45', ['32A', '32']],
  ];
  for (const [a, b, t, lines] of seat) {
    const js = planJourneys(raptor, grp(a), grp(b), di, hm(t), 4);
    const hit = js.find((j) => j.legs.some((l) => l.type === 'stay')
      && j.legs.filter((l) => l.type === 'ride').map((l) => D.routes[l.route].s).join('>') === lines.join('>'));
    if (!hit) { bad++; fail(`zostaň sedieť ${a} → ${b} (${lines.join('→')}) sa nenašlo`); continue; }
    if (hit.transfers !== 0) { bad++; fail(`zostaň sedieť ${a} → ${b}: počíta sa ako ${hit.transfers} prestup`); }
  }
  if (!bad) ok(`zostaň sedieť (44→28, 18→14, 41→13, 32A→32) ${di.num}: ${seat.length}/${seat.length}, bez prestupu`);
}

// ── 4c: „Bez prestupu“ a cieľ s okolitými zastávkami ────────────────
{
  const hav = (a, b, c, d) => { const r = Math.PI / 180, x = (d - b) * r * Math.cos((a + c) / 2 * r), y = (c - a) * r; return Math.hypot(x, y) * 6371000; };
  const near = (la, lo, r, cap, skip = new Set()) => new Map(D.stops.map((x, i) => [i, hav(la, lo, x.la, x.lo)])
    .filter(([i, d]) => d <= r && !skip.has(i)).sort((a, b) => a[1] - b[1]).slice(0, cap).map(([i, d]) => [i, Math.round(d * 1.2 / 1.25)]));
  const group = (n) => new Map(D.stops.map((s, i) => [s, i]).filter(([s]) => s.n === n).map(([, i]) => [i, 0]));
  let bad = 0;
  // 1) náhodné páry: priame spojenia sú naozaj bez prestupu a nie sú horšie ako
  //    najlepšie priame spojenie z bežného hľadania
  let pairs = 0, withDirect = 0;
  const names = [...new Set(D.stops.map((s) => s.n))].sort();
  for (let k = 0; k < 40; k++) {
    const a = names[(k * 37) % names.length], b = names[(k * 53 + 11) % names.length];
    if (a === b) continue;
    pairs++;
    const dj = planJourneys(raptor, group(a), group(b), di, 7 * 3600, 4, { direct: true });
    if (dj.some((j) => j.transfers !== 0)) { bad++; fail(`bez prestupu ${a} → ${b}: vrátilo spojenie s prestupom`); }
    if (dj.length) withDirect++;
    // bežné hľadanie posúva čas a nájde aj spoje na druhý deň — porovnať len v okne
    // RAPTORu (príchod do 20 h od zadaného času)
    const nj = planJourneys(raptor, group(a), group(b), di, 7 * 3600, 4).filter((j) => j.transfers === 0 && j.arrTime <= 27 * 3600);
    if (nj.length && (!dj.length || dj[0].arrTime > nj[0].arrTime)) { bad++; fail(`bez prestupu ${a} → ${b}: priame spojenie ${nj[0].arrTime} chýba`); }
  }
  // 2) „zostaň sedieť“ je bez prestupu aj v režime bez prestupu
  const octDay = dateInfoFor('2026-10-09');
  const seat = planJourneys(raptor, group('Dulova Ves'), group('Ľubotice *'), octDay, 6 * 3600 + 15 * 60, 4, { direct: true });
  if ((D.meta.patches || []).some((p) => p.id === 'dpmp-2026-10-vazby') && !seat.some((j) => j.legs.some((l) => l.type === 'stay'))) {
    bad++; fail('bez prestupu: spoj 44 → 28 („zostaň sedieť“) chýba');
  }
  // 3) Ľ. Podjavorinskej 21 → ZŠ Ľubotice: linka 37 z Lesníckej na Vranovskú (430 m od
  //    školy) — cieľ-zastávka zahŕňa okolité zastávky s chôdzou, nástup na bližšej Lesníckej
  if (D.meta.validTo >= 20261014) {
    const from = near(48.9815, 21.26427, 700, 8);
    const zs = group('ZŠ Ľubotice');
    const z = D.stops[[...zs.keys()][0]];
    const to = new Map([...zs, ...near(z.la, z.lo, 700, 12, new Set(zs.keys()))]);
    const day = dateInfoFor('2026-10-14');
    for (const direct of [false, true]) {
      const js = planJourneys(raptor, from, to, day, 6 * 3600, 4, { direct });
      const j37 = js.find((j) => j.legs[0]?.type === 'ride' && D.routes[j.legs[0].route].s === '37');
      if (!j37) { bad++; fail(`Podjavorinskej → ZŠ Ľubotice (${direct ? 'bez prestupu' : 'bežne'}): chýba linka 37`); continue; }
      if (D.stops[j37.legs[0].from].n !== 'Lesnícka' || j37.transfers !== 0 || !(j37.finalWalk > 0)) {
        bad++; fail(`Podjavorinskej → ZŠ Ľubotice: linka 37 má nastúpiť na Lesníckej a dôjsť pešo (${D.stops[j37.legs[0].from].n}, ${j37.transfers}, ${j37.finalWalk})`);
      }
    }
  }
  if (!bad) ok(`bez prestupu: ${pairs} párov (${withDirect} s priamym spojením), zostaň sedieť, Podjavorinskej → ZŠ Ľubotice linkou 37`);
}

// ── 4d: „zostaň sedieť“ len v nadväzujúcom spoji ────────────────────
// Po úseku „zostaň sedieť“ musí ísť práve spoj, ktorým autobus pokračuje —
// nie iná linka z tej istej zastávky (to je prestup) ani chôdza.
if ((D.links || []).length) {
  const day = dateInfoFor(D.meta.validFrom <= 20261014 && D.meta.validTo >= 20261014 ? '2026-10-14' : TEST_DATE);
  const tripsOf = (l) => D.patterns[l.pattern].trips.filter((t) => t.t[2 * l.boardPos + 1] + l.day * 86400 === l.dep && t.t[2 * l.alightPos] + l.day * 86400 === l.arr);
  const group = (n) => new Map(D.stops.map((s, i) => [s, i]).filter(([s]) => s.n === n).map(([, i]) => [i, 0]));
  const names = [...new Set(D.stops.map((s) => s.n))].sort();
  const starts = [...new Set(D.links.map(([pi]) => D.stops[D.patterns[pi].stops[0]].n))];
  let stays = 0, bad = 0;
  for (const a of starts) for (let k = 0; k < names.length; k += 5) {
    if (names[k] === a) continue;
    for (const direct of [false, true]) {
      for (const j of planJourneys(raptor, group(a), group(names[k]), day, 6 * 3600, 2, { direct })) {
        j.legs.forEach((l, i) => {
          if (l.type !== 'stay') return;
          stays++;
          const nx = j.legs[i + 1];
          const okNext = nx?.type === 'ride' && tripsOf(j.legs[i - 1]).some((A) => tripsOf(nx).includes(raptor.cont.get(A)?.trip));
          if (!okNext || j.transfers < 0) {
            bad++;
            if (bad <= 5) fail(`zostaň sedieť ${a} → ${names[k]}: po ${D.routes[j.legs[i - 1].route].s} ide ${nx ? (nx.type === 'ride' ? `linka ${D.routes[nx.route].s}` : nx.type) : 'koniec'} (prestupy ${j.transfers})`);
          }
        });
      }
    }
  }
  if (!bad) ok(`zostaň sedieť: ${stays}× vždy v nadväzujúcom spoji (${starts.length} východísk)`);
}

// ── 4e: priame spoje (bez prestupu) — úplnosť proti hrubej sile ─────
// Pre každý spoj (aj neskorší z tej istej linky) a nadväzujúce spoje: najskorší
// príchod do cieľa pri nástupe s najmenšou chôdzou; jazda, ku ktorej cieľu sa
// dá od odchodu dôjsť pešo skôr, sa nepočíta. directJourneys musí každý taký
// spoj pokryť (neskorší alebo rovnaký odchod, skorší alebo rovnaký príchod).
{
  const day = dateInfoFor(D.meta.validFrom <= 20261014 && D.meta.validTo >= 20261014 ? '2026-10-14' : TEST_DATE);
  const days = [{ o: -1, ...day.prev }, { o: 0, num: day.num, weekday: day.weekday }, { o: 1, ...day.next }];
  const group = (n) => new Map(D.stops.map((s, i) => [s, i]).filter(([s]) => s.n === n).map(([, i]) => [i, 0]));
  const names = [...new Set(D.stops.map((s) => s.n))].sort();
  const H = 20 * 3600;
  function oracle(fs, ts, t0) {
    const reach = new Map(), ex = new Map(), out = [];
    for (const [s, w] of fs) if (!(reach.get(s) <= t0 + w)) reach.set(s, t0 + w);
    for (const [s, w] of fs) for (const [s2, f] of raptor.foot[s]) if (!(reach.get(s2) <= t0 + w + f)) reach.set(s2, t0 + w + f);
    for (const [s, w] of ts) {
      if (!(ex.get(s)?.secs <= w)) ex.set(s, { secs: w, to: s, foot: 0 });
      for (const [s2, f] of raptor.foot[s]) if (!(ex.get(s2)?.secs <= w + f)) ex.set(s2, { secs: w + f, to: s, foot: f });
    }
    const pats = new Set();
    for (const s of reach.keys()) for (const [pi] of raptor.patternsAtStop[s]) pats.add(pi);
    for (const pi of pats) {
      const p = D.patterns[pi];
      for (const dd of days) for (const trip of p.trips) {
        if (!raptor.serviceActive(trip.sv, dd.num, dd.weekday)) continue;
        const sh = dd.o * 86400;
        let tb = null;
        const alight = (q, a, s) => {
          const e = ex.get(s);
          if (e == null || a > t0 + H) return;
          let bb = -1, bw = Infinity;
          for (let x = 0; x < q && x < p.stops.length - 1; x++) {
            const rt = reach.get(p.stops[x]), dep = trip.t[2 * x + 1] + sh;
            if (rt != null && dep >= rt && dep <= t0 + H && rt - t0 <= bw) { bw = rt - t0; bb = x; }
          }
          if (bb < 0) return;
          const leave = trip.t[2 * bb + 1] + sh - bw, off = leave - t0;
          if (off + (reach.get(s) ?? Infinity) <= a || off + (reach.get(e.to) ?? Infinity) <= a + e.foot) return;
          const c = { leave, arr: a + e.secs, w: bw + e.secs };
          if (!tb || c.arr < tb.arr || (c.arr === tb.arr && c.w < tb.w)) tb = c;
        };
        for (let q = 1; q < p.stops.length; q++) alight(q, trip.t[2 * q] + sh, p.stops[q]);
        for (let ct = trip, hop = 0; hop < 3; hop++) {
          const c = raptor.cont.get(ct);
          if (!c) break;
          const cp = D.patterns[c.pi];
          for (let q = 1; q < cp.stops.length; q++) alight(p.stops.length, c.trip.t[2 * q] + sh, cp.stops[q]);
          ct = c.trip;
        }
        if (tb) out.push(tb);
      }
    }
    return out;
  }
  let n = 0, miss = 0;
  for (let k = 0; k < 120; k++) {
    const a = names[(k * 37 + 5) % names.length], b = names[(k * 53 + 29) % names.length];
    if (a === b) continue;
    const fs = group(a), ts = group(b);
    for (const h of [5.25, 12, 21.5]) {
      const t0 = Math.round(h * 3600);
      n++;
      const js = raptor.directJourneys(fs, ts, day, t0);
      const lv = (j) => { const r = j.legs.find((l) => l.type === 'ride'); return r.dep - (j.legs[0].type === 'walk' ? j.legs[0].secs + fs.get(j.legs[0].from) : fs.get(r.from)); };
      const o = oracle(fs, ts, t0).find((o) => !js.some((j) => lv(j) >= o.leave && j.arrTime <= o.arr));
      if (o) { miss++; if (miss <= 3) fail(`priame spoje ${a} → ${b} ${h} h: chýba odchod ${fmt(o.leave)} s príchodom ${fmt(o.arr)}`); }
      if (js.some((j) => j.transfers !== 0)) { miss++; fail(`priame spoje ${a} → ${b}: spojenie s prestupom`); }
    }
  }
  // konkrétne prípady: z jednej zastávky pokračuje viac liniek; neskorší spoj
  // linky 32 pokračuje ako 45, skorší nie
  if ((D.meta.patches || []).some((p) => p.id === 'dpmp-2026-10-vazby') && D.meta.validTo >= 20261014) {
    const want = [
      ['HOBBY PARK *', 'Medulienka *', 6 * 3600 + 30 * 60, 7 * 3600 + 2 * 60, true],
      ['HOBBY PARK *', 'Pivovar *', 6 * 3600, 7 * 3600, false],
      ['Karpatská', 'Pivovar *', 5 * 3600 + 10 * 60, 7 * 3600, false],
    ];
    const seated = (js, arr) => js.some((j) => j.transfers === 0 && j.arrTime <= arr && j.legs.some((l) => l.type === 'stay'));
    for (const [a, b, t0, arr, alsoRaptor] of want) {
      if (!seated(planJourneys(raptor, group(a), group(b), day, t0, 4, { direct: true }), arr)) {
        miss++; fail(`bez prestupu ${a} → ${b} ${fmt(t0)}: chýba „zostaň sedieť“ s príchodom do ${fmt(arr)}`);
      }
      // RAPTOR: dve linky pokračujú z tej istej zastávky — obe sa musia dať
      if (alsoRaptor && !seated(raptor.query(group(a), group(b), day, t0), arr)) {
        miss++; fail(`RAPTOR ${a} → ${b} ${fmt(t0)}: chýba „zostaň sedieť“ s príchodom do ${fmt(arr)}`);
      }
    }
  }
  if (!miss) ok(`priame spoje: ${n} hľadaní zhodných s hrubou silou, HOBBY PARK/Karpatská → Medulienka/Pivovar so „zostaň sedieť“`);
}

// ── 4f: cieľ s okolitými zastávkami — autobus priamo na zastávku, nič kruhom ──
// Okolité zastávky (do 700 m, ako destStopsFor v appke) majú prirážku = chôdza:
// autobus priamo na zastávku nesmie vypadnúť kvôli o pár sekúnd skoršiemu
// príchodu s dlhou chôdzou; žiadne spojenie nesmie ísť kruhom (zastávka 2×).
{
  const hav = (a, b, c, d) => { const r = Math.PI / 180, x = (d - b) * r * Math.cos((a + c) / 2 * r), y = (c - a) * r; return Math.hypot(x, y) * 6371000; };
  const group = (n) => new Map(D.stops.map((s, i) => [s, i]).filter(([s]) => s.n === n).map(([, i]) => [i, 0]));
  const dest = (n) => {
    const m = group(n), own = [...m.keys()].map((i) => D.stops[i]), extra = new Map();
    const c = [];
    D.stops.forEach((st, i) => { if (m.has(i)) return; let d = Infinity; for (const o of own) d = Math.min(d, hav(o.la, o.lo, st.la, st.lo)); if (d <= 700) c.push([i, d]); });
    c.sort((a, b) => a[1] - b[1]);
    for (const [i, d] of c.slice(0, 12)) { const w = Math.round(d * 1.2 / 1.25); m.set(i, w); extra.set(i, w); }
    return { m, extra };
  };
  // kruh = úsek končí na zastávke, kde už spojenie bolo (napr. jedna zastávka a pešo späť)
  const circular = (j) => {
    const legs = j.legs.filter((l) => l.type !== 'stay');
    const seen = new Set([legs[0].from]);
    for (const l of legs) { if (seen.has(l.to)) return true; seen.add(l.to); }
    return false;
  };
  let bad = 0;
  if (D.meta.validFrom <= 20261008 && D.meta.validTo >= 20261030) {
    const door = [
      ['Pri lipe *', 'Detská nemocnica', '2026-10-30', 8 * 3600 + 15 * 60, '12', 9 * 3600 + 52 * 60],
      ['Kamenná *', 'Korabinského *', '2026-10-08', 16 * 3600 + 55 * 60, '13', 17 * 3600 + 52 * 60],
      ['Centrum', 'Tulčícka *', '2026-10-23', 6 * 3600 + 29 * 60, '23', 7 * 3600],
    ];
    for (const [a, b, ds, t0, line, arr] of door) {
      const { m, extra } = dest(b);
      const js = planJourneys(raptor, group(a), m, dateInfoFor(ds), t0, 4, { toExtra: extra });
      const hit = js.some((j) => { const r = j.legs.filter((l) => l.type === 'ride').at(-1); return D.routes[r.route].s === line && D.stops[r.to].n === b && j.arrTime <= arr; });
      if (!hit) { bad++; fail(`${a} → ${b} ${ds} ${fmt(t0)}: chýba linka ${line} priamo na zastávku (do ${fmt(arr)})`); }
    }
  }
  // kruhové spojenia: krátke vzdialenosti, bežne aj bez prestupu
  const names = [...new Set(D.stops.map((s) => s.n))].sort();
  const first = (n) => D.stops[[...group(n).keys()][0]];
  let n = 0;
  const day = dateInfoFor(TEST_DATE);
  for (let k = 0; k < names.length && n < 150; k++) {
    const a = names[k], A = first(a);
    const b = names.find((x) => x !== a && hav(A.la, A.lo, first(x).la, first(x).lo) < 1200 && hav(A.la, A.lo, first(x).la, first(x).lo) > 300);
    if (!b) continue;
    const { m, extra } = dest(b);
    for (const t0 of [7 * 3600, 12 * 3600 + 15 * 60]) {
      n++;
      for (const direct of [false, true]) {
        for (const j of planJourneys(raptor, group(a), m, day, t0, 4, { direct, toExtra: extra })) {
          if (circular(j)) { bad++; if (bad <= 5) fail(`kruhové spojenie ${a} → ${b} ${fmt(t0)}${direct ? ' (bez prestupu)' : ''}: ${j.legs.map((l) => `${l.type} ${D.stops[l.from].n}→${D.stops[l.to].n}`).join(' | ')}`); }
        }
      }
    }
  }
  if (!bad) ok(`cieľ s okolitými zastávkami: autobus priamo na zastávku (Detská nemocnica, Korabinského, Tulčícka), ${n} krátkych hľadaní bez kruhových spojení`);
}

// ── 4g: spojenie horšie ako chôdza nesmie vytlačiť lepšie spojenie ─────
// (odmietne sa už pri výbere cieľa; inak krátke cesty ukázali len neskorý
// autobus alebo nič, hoci rozumné spojenie s prestupom existuje)
if (D.meta.validFrom <= 20261004 && D.meta.validTo >= 20261029) {
  const hav = (a, b, c, d) => { const r = Math.PI / 180, x = (d - b) * r * Math.cos((a + c) / 2 * r), y = (c - a) * r; return Math.hypot(x, y) * 6371000; };
  const group = (n) => new Map(D.stops.map((s, i) => [s, i]).filter(([s]) => s.n === n).map(([, i]) => [i, 0]));
  const pt = (la, lo) => new Map(D.stops.map((x, i) => [i, hav(la, lo, x.la, x.lo)]).filter(([, d]) => d <= 700).sort((a, b) => a[1] - b[1]).slice(0, 8).map(([i, d]) => [i, Math.round(d * 1.2 / 1.25)]));
  const dest = (n) => {
    const m = group(n), own = [...m.keys()].map((i) => D.stops[i]), extra = new Map(), c = [];
    D.stops.forEach((st, i) => { if (m.has(i)) return; let d = Infinity; for (const o of own) d = Math.min(d, hav(o.la, o.lo, st.la, st.lo)); if (d <= 700) c.push([i, d]); });
    c.sort((a, b) => a[1] - b[1]);
    for (const [i, d] of c.slice(0, 12)) { const w = Math.round(d * 1.2 / 1.25); m.set(i, w); extra.set(i, w); }
    return { m, extra };
  };
  const cases = [
    [group('Potočná'), 'Nižná Šebastová', '2026-10-14', 16 * 3600 + 13 * 60, 16 * 3600 + 39 * 60],
    [group('Gemor *'), 'Pod Wilec.hôrkou *', '2026-10-17', 14 * 3600 + 24 * 60, 15 * 3600 + 4 * 60],
    [pt(49.01616, 21.31191), 'Gbolovky *', '2026-10-29', 12 * 3600 + 19 * 60, 13 * 3600 + 16 * 60],
    [pt(49.01169, 21.22207), 'ZŠ Prostějovská', '2026-10-04', 21 * 3600 + 6 * 60, 21 * 3600 + 15 * 60],
  ];
  let bad = 0;
  for (const [from, b, ds, t0, arr] of cases) {
    const { m, extra } = dest(b);
    const js = planJourneys(raptor, from, m, dateInfoFor(ds), t0, 4, { toExtra: extra });
    if (!js.some((j) => j.arrTime <= arr)) { bad++; fail(`→ ${b} ${ds} ${fmt(t0)}: chýba spojenie s príchodom do ${fmt(arr)} (je ${js.map((j) => fmt(j.arrTime)).join(', ') || 'nič'})`); }
  }
  if (!bad) ok(`spojenie horšie ako chôdza nevytlačí lepšie (Potočná, Gemor, Gbolovky, ZŠ Prostějovská)`);
}

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
