#!/usr/bin/env node
// Presný rozdiel PDF (linkový CP DPMP) ↔ GTFS pre vybrané linky.
// Spoj z PDF s odchodom T je „vysvetlený“ spojom GTFS, ak ten prechádza
// niektorou zastávkou k zo zoznamu PDF v čase T + posun(k) (pravidlo DPMP),
// alebo — pri spojoch „zo zastávky X“ — odchádza zo svojej prvej zastávky
// presne v čase T. Výstup: data/dpmp-lcp/diff.json + čitateľný výpis.
import { readFileSync, writeFileSync } from 'node:fs';

const LINES = (process.argv[2] || '14,17,21,28,29,32,32A,33,34,39,44,13,18,41').split(',');
const GT = 'data/gtfs-presov';
const LCP = JSON.parse(readFileSync('data/dpmp-lcp/lcp.json', 'utf8'));

function csv(path) {
  const [h, ...rows] = readFileSync(path, 'utf8').replace(/^﻿/, '').trim().split(/\r?\n/);
  const H = h.split(',');
  return rows.map((l) => {
    const v = []; let c = '', q = false;
    for (const ch of l) { if (ch === '"') { q = !q; continue; } if (ch === ',' && !q) { v.push(c); c = ''; continue; } c += ch; }
    v.push(c);
    return Object.fromEntries(H.map((k, i) => [k, v[i]]));
  });
}
const tmin = (s) => { const [h, m, x] = s.split(':').map(Number); return h * 60 + m + (x || 0) / 60; };
const norm = (s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\*/g, '');
const toks = (s) => norm(s).split(/[^a-z0-9]+/).filter(Boolean);
function nameMatch(a, b) {
  const A = toks(a), B = toks(b);
  if (A.join('') === B.join('')) return true;
  const eq = (x, y) => x === y || y.startsWith(x) || x.startsWith(y);
  let i = 0, j = 0, hit = 0;
  while (i < A.length && j < B.length) {
    if (eq(A[i], B[j])) { hit++; i++; j++; } else if (A[i].length <= 1) i++; else if (B[j].length <= 1) j++; else return false;
  }
  return hit > 0 && A.slice(i).concat(B.slice(j)).every((t) => t.length <= 1);
}
const fmt = (m) => `${Math.floor(m / 60)}:${String(Math.round(m % 60)).padStart(2, '0')}`;

const stops = new Map(csv(`${GT}/stops.txt`).map((s) => [s.stop_id, s]));
const routes = csv(`${GT}/routes.txt`);
const trips = csv(`${GT}/trips.txt`);
const ST = new Map();
for (const r of csv(`${GT}/stop_times.txt`)) { let a = ST.get(r.trip_id); if (!a) ST.set(r.trip_id, (a = [])); a.push(r); }
for (const a of ST.values()) a.sort((x, y) => Number(x.stop_sequence) - Number(y.stop_sequence));

const out = [];
for (const line of LINES) {
  const route = routes.find((r) => r.route_short_name === line);
  const blocks = LCP.filter((b) => b.line === line);
  if (!route || !blocks.length) { console.log(`linka ${line}: chýba (GTFS ${!!route}, PDF ${blocks.length})`); continue; }
  const rtrips = trips.filter((t) => t.route_id === route.route_id).map((t) => ({
    id: t.trip_id, svc: t.service_id.split('_').pop(), dir: t.direction_id, head: t.trip_headsign,
    seq: ST.get(t.trip_id).map((x) => ({ id: x.stop_id, name: stops.get(x.stop_id).stop_name, arr: tmin(x.arrival_time), dep: tmin(x.departure_time) })),
  }));
  for (const b of blocks) {
    // priradenie zastávok spoja k PDF (len tie, ktoré sa dajú; monotónne)
    const mapped = rtrips.map((t) => {
      const m = []; let k = 0;
      t.seq.forEach((s, j) => {
        for (let i = k; i < b.stops.length; i++) if (nameMatch(s.name, b.stops[i].name)) { m.push({ j, i }); k = i + 1; return; }
      });
      return { t, m };
    }).filter((x) => x.m.length >= 2);
    const explains = (x, T) => x.m.some(({ j, i }) => Math.abs(x.t.seq[j].dep - (T + b.stops[i].off)) < 0.01)
      || Math.abs(x.t.seq[0].dep - T) < 0.01; // „zo zastávky X“: uvedený čas = odchod z X
    const res = { line, smer: b.smer, page: b.page, valid_from: b.valid_from, legend: b.legend, cols: {} };
    for (const [col, svcs] of [['school', ['PD']], ['weekend', ['SO', 'NE']]]) {
      const pool = mapped.filter((x) => svcs.includes(x.t.svc));
      const used = new Set();
      const entries = b.deps[col].map((d) => {
        const T = d.h * 60 + d.m;
        const hits = pool.filter((x) => !used.has(x.t.id + x.t.svc) && explains(x, T));
        // pri víkende môže jeden záznam PDF zodpovedať spoju v SO aj v NE
        const take = col === 'weekend' ? [hits.find((x) => x.t.svc === 'SO'), hits.find((x) => x.t.svc === 'NE')].filter(Boolean) : hits.slice(0, 1);
        take.forEach((x) => used.add(x.t.id + x.t.svc));
        return { t: fmt(T), flags: d.flags, trips: take.map((x) => `${x.t.svc}:${x.t.id}`) };
      });
      const extra = pool.filter((x) => !used.has(x.t.id + x.t.svc)).map((x) => {
        const f = x.m[0];
        return { trip: x.t.id, svc: x.t.svc, first: x.t.seq[0].name, dep: fmt(x.t.seq[0].dep), atPdf: `${b.stops[f.i].name}@${fmt(x.t.seq[f.j].dep)} → T=${fmt(x.t.seq[f.j].dep - b.stops[f.i].off)}`, last: x.t.seq[x.t.seq.length - 1].name };
      });
      res.cols[col] = { entries, unmatched: entries.filter((e) => !e.trips.length), extra };
    }
    out.push(res);
    const u = res.cols.school.unmatched, e = res.cols.school.extra;
    const uw = res.cols.weekend.unmatched, ew = res.cols.weekend.extra;
    console.log(`\n== ${line} smer ${b.smer} [${b.valid_from || '?'}]  legenda: ${Object.entries(b.legend).map(([k, v]) => `${k}=${v}`).join('; ')}`);
    console.log(`   školský: ${res.cols.school.entries.length - u.length}/${res.cols.school.entries.length} vysvetlených`);
    if (u.length) console.log(`   ▸ v PDF, nie v GTFS: ${u.map((x) => x.t + x.flags).join(' ')}`);
    if (e.length) console.log(`   ▸ v GTFS (PD), nie v PDF: ${e.map((x) => `${x.dep} ${x.first}→${x.last} [${x.atPdf}]`).join(' | ')}`);
    console.log(`   víkend: ${res.cols.weekend.entries.length - uw.length}/${res.cols.weekend.entries.length}${uw.length ? ` ▸ PDF navyše: ${uw.map((x) => x.t + x.flags).join(' ')}` : ''}${ew.length ? ` ▸ GTFS navyše: ${ew.map((x) => `${x.svc} ${x.dep} ${x.first}`).join(' | ')}` : ''}`);
  }
}
writeFileSync('data/dpmp-lcp/diff.json', JSON.stringify(out, null, 1));
