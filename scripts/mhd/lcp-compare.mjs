#!/usr/bin/env node
// Porovná linkový CP z PDF (data/dpmp-lcp/lcp.json, výstup lcp-parse.py)
// so spojmi v GTFS (data/gtfs-presov). Pre každý smer linky:
//   - priradí zastávky PDF k zastávkam GTFS podľa názvu (tolerantne k skratkám),
//   - pre každý spoj GTFS vypočíta „odchod z východzej zastávky linky“
//     = odchod z prvej zastávky spoja − posun tej zastávky v PDF,
//   - porovná s odchodmi v PDF (školský deň ↔ PD, víkend ↔ SO ∪ NE).
// Výstup: data/dpmp-lcp/compare.json + súhrn na stdout.
import { readFileSync, writeFileSync } from 'node:fs';

const GT = process.argv[2] || 'data/gtfs-presov';
const LCP = JSON.parse(readFileSync('data/dpmp-lcp/lcp.json', 'utf8'));

function csv(path) {
  const txt = readFileSync(path, 'utf8').replace(/^﻿/, '');
  const rows = [];
  let row = [], cur = '', q = false;
  for (let i = 0; i < txt.length; i++) {
    const c = txt[i];
    if (q) {
      if (c === '"' && txt[i + 1] === '"') { cur += '"'; i++; }
      else if (c === '"') q = false;
      else cur += c;
    } else if (c === '"') q = true;
    else if (c === ',') { row.push(cur); cur = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && txt[i + 1] === '\n') i++;
      row.push(cur); cur = '';
      if (row.length > 1 || row[0] !== '') rows.push(row);
      row = [];
    } else cur += c;
  }
  if (cur || row.length) { row.push(cur); rows.push(row); }
  const [h, ...rest] = rows;
  return rest.map((r) => Object.fromEntries(h.map((k, i) => [k, r[i]])));
}

const tsec = (s) => { const [h, m, x] = s.split(':').map(Number); return h * 3600 + m * 60 + (x || 0); };
const norm = (s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\*/g, '');
const toks = (s) => norm(s).split(/[^a-z0-9]+/).filter(Boolean);

// zhoda názvov s toleranciou skratiek („Rázc. Kúty“ ~ „Rázcestie Kúty“,
// „Divadlo J.Záborského“ ~ „Divadlo Jonáša Záborského“)
function nameMatch(a, b) {
  const A = toks(a), B = toks(b);
  if (A.join('') === B.join('')) return 3;
  if (!A.length || !B.length) return 0;
  const tokEq = (x, y) => x === y || y.startsWith(x) || x.startsWith(y); // aj iniciály: „L.“ ~ „Laca“
  // zarovnanie tokenov s možnosťou vynechať krátke iniciály
  let i = 0, j = 0, hit = 0;
  while (i < A.length && j < B.length) {
    if (tokEq(A[i], B[j])) { hit++; i++; j++; }
    else if (A[i].length <= 1) i++;
    else if (B[j].length <= 1) j++;
    else return 0;
  }
  const rest = A.slice(i).concat(B.slice(j)).filter((t) => t.length > 1);
  return rest.length === 0 && hit > 0 ? 2 : 0;
}

const stops = new Map(csv(`${GT}/stops.txt`).map((s) => [s.stop_id, s]));
const routes = csv(`${GT}/routes.txt`);
const trips = csv(`${GT}/trips.txt`);
const st = new Map();
for (const r of csv(`${GT}/stop_times.txt`)) {
  let a = st.get(r.trip_id);
  if (!a) st.set(r.trip_id, (a = []));
  a.push(r);
}
for (const a of st.values()) a.sort((x, y) => Number(x.stop_sequence) - Number(y.stop_sequence));
const svcType = (sid) => sid.split('_').pop(); // 1382_PD → PD

const fmt = (m) => `${Math.floor(m / 60)}:${String(((m % 60) + 60) % 60).padStart(2, '0')}`;
const report = [];

for (const b of LCP) {
  const route = routes.find((r) => r.route_short_name === b.line);
  if (!route) { report.push({ line: b.line, smer: b.smer, error: 'linka nie je v GTFS' }); continue; }
  const rtrips = trips.filter((t) => t.route_id === route.route_id).map((t) => {
    const s = st.get(t.trip_id);
    return { ...t, seq: s.map((x) => ({ id: x.stop_id, name: stops.get(x.stop_id).stop_name, arr: tsec(x.arrival_time), dep: tsec(x.departure_time) })) };
  });
  // priradenie zastávok spoja k indexom PDF (monotónne rastúce)
  const mapTrip = (t) => {
    const idx = [];
    let k = 0;
    for (const s of t.seq) {
      let found = -1;
      for (let i = k; i < b.stops.length; i++) if (nameMatch(s.name, b.stops[i].name)) { found = i; break; }
      if (found < 0) return null;
      idx.push(found); k = found + 1;
    }
    return idx;
  };
  const cand = rtrips.map((t) => ({ t, idx: mapTrip(t) })).filter((x) => x.idx);
  const useful = { school: [], weekend: [] };
  const offsetsOk = { same: 0, diff: 0, examples: [] };
  for (const { t, idx } of cand) {
    const ty = svcType(t.service_id);
    const k0 = idx[0];
    const first = t.seq[0];
    const virt = Math.round(first.dep / 60) - b.stops[k0].off; // odchod z východzej zastávky linky
    const actual = Math.round(first.dep / 60);
    const rec = { trip: t.trip_id, virt, actual, from: b.stops[k0].name, to: b.stops[idx[idx.length - 1]].name, k0, kEnd: idx[idx.length - 1], n: t.seq.length, svc: ty };
    // kontrola profilu jazdy: GTFS časy vs. posuny z PDF
    let same = true;
    t.seq.forEach((s, j) => {
      const want = (virt + b.stops[idx[j]].off) * 60;
      if (Math.abs(s.dep - want) > 0 && Math.abs(s.arr - want) > 0) same = false;
    });
    if (same) offsetsOk.same++; else {
      offsetsOk.diff++;
      if (offsetsOk.examples.length < 3) offsetsOk.examples.push({ trip: t.trip_id, start: fmt(virt), gtfs: t.seq.map((s) => Math.round((s.dep / 60 - virt))).join(','), pdf: idx.map((i) => b.stops[i].off - b.stops[k0].off + (b.stops[k0].off)).join(',') });
    }
    if (ty === 'PD') useful.school.push(rec);
    else useful.weekend.push(rec);
  }
  const cmp = (lcp, gt, key) => {
    const L = lcp.map((d) => ({ min: d.h * 60 + d.m, flags: d.flags }));
    const G = gt.map((g) => ({ ...g, min: g[key] }));
    const used = new Set();
    const onlyL = [], matched = [];
    for (const l of L) {
      const gi = G.findIndex((g, i) => !used.has(i) && g.min === l.min);
      if (gi >= 0) { used.add(gi); matched.push({ ...l, trip: G[gi].trip, from: G[gi].from, to: G[gi].to }); }
      else onlyL.push(l);
    }
    const onlyG = G.filter((_, i) => !used.has(i));
    return { matched, onlyL, onlyG };
  };
  const res = {
    page: b.page, line: b.line, smer: b.smer, valid_from: b.valid_from, legend: b.legend,
    gtfs_trips: cand.length, unmatched_gtfs_patterns: rtrips.length - cand.length,
    offsets: offsetsOk,
    school_virt: cmp(b.deps.school, useful.school, 'virt'),
    school_actual: cmp(b.deps.school, useful.school, 'actual'),
  };
  // víkend: SO a NE spolu (PDF ich má v jednom stĺpci; poznámky „v sobotu“ riešime ručne)
  const wk = useful.weekend;
  const sat = wk.filter((x) => x.svc === 'SO'), sun = wk.filter((x) => x.svc === 'NE');
  res.weekend_sat = cmp(b.deps.weekend, sat, 'virt');
  res.weekend_sun = cmp(b.deps.weekend, sun, 'virt');
  report.push(res);
}

writeFileSync('data/dpmp-lcp/compare.json', JSON.stringify(report, null, 1));
const brief = (c) => `${c.matched.length}✓ ${c.onlyL.length ? `PDF navyše: ${c.onlyL.map((x) => fmt(x.min) + x.flags).join(' ')}` : ''}${c.onlyG.length ? ` GTFS navyše: ${c.onlyG.map((x) => fmt(x.min)).join(' ')}` : ''}`;
for (const r of report) {
  if (r.error) { console.log(`${r.line} ${r.smer}: ${r.error}`); continue; }
  const cv = r.school_virt, ca = r.school_actual;
  const better = (cv.onlyL.length + cv.onlyG.length) <= (ca.onlyL.length + ca.onlyG.length) ? 'virt' : 'actual';
  const c = r[`school_${better}`];
  console.log(`p${r.page} ${r.line.padStart(3)} → ${r.smer.slice(0, 22).padEnd(22)} [${r.valid_from || '?'}] GTFS ${r.gtfs_trips} (nepriradených ${r.unmatched_gtfs_patterns}) profil ${r.offsets.same}/${r.offsets.same + r.offsets.diff}`);
  console.log(`     školský(${better}): ${brief(c)}`);
}
