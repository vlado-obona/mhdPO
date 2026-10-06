#!/usr/bin/env node
// Väzby „zostaň sedieť“ pre feed 1382_1384 (CP október 2026 je v GTFS ako služby
// 1384_*) → data/gtfs-patches/1382_1384-vazby-2026-10.json
//
// Feed 1384 už obsahuje zmeny CP od 1. 10. 2026 (oprava 1382-dpmp-2026-10-01 sa
// preň nepoužije), ale nadväzujúce spoje (autobus pokračuje ako iná linka) má
// rozdelené a bez block_id. Väzby preberáme z doloženej opravy pre feed 1382:
//   - každú zo 48 väzieb (oznam DPMP + poznámky v PDF liniek 32 a 32A) prenesieme
//     na spoj 1384 s rovnakou linkou, prvou zastávkou, odchodom a typom dňa,
//   - PDF linky 32A („Okružná — ďalej pokračuje ako linka 32“) platí pre všetky
//     spoje 32A → aj pre prázdninové dni (1384_PR),
//   - každá väzba sa overí: rovnaká služba, koniec ≈ začiatok (≤ 60 m, 0–180 s).
// Keď sa niečo nedá jednoznačne priradiť, skript skončí chybou (nič sa nevymýšľa).
import { readFileSync, writeFileSync } from 'node:fs';

const GT = 'data/gtfs-presov';
const SRC = 'data/gtfs-patches/1382-dpmp-2026-10-01.json';
const OUT = 'data/gtfs-patches/1382_1384-vazby-2026-10.json';
const FEED = '1382_1384';

function csv(path) {
  const txt = readFileSync(path, 'utf8').replace(/^﻿/, '');
  const [h, ...rows] = txt.trim().split(/\r?\n/);
  const H = h.split(',');
  return rows.map((l) => {
    const v = []; let c = '', q = false;
    for (const ch of l) { if (ch === '"') { q = !q; continue; } if (ch === ',' && !q) { v.push(c); c = ''; continue; } c += ch; }
    v.push(c);
    return Object.fromEntries(H.map((k, i) => [k, v[i] ?? '']));
  });
}
const sec = (t) => { const [h, m, s] = t.split(':').map(Number); return h * 3600 + m * 60 + (s || 0); };
const hm = (s) => `${Math.floor(s / 3600)}:${String(Math.floor(s / 60) % 60).padStart(2, '0')}`;

const feed = csv(`${GT}/feed_info.txt`)[0];
if (feed.feed_version !== FEED) throw new Error(`väzby sú pre feed ${FEED}, nie ${feed.feed_version}`);
const stops = new Map(csv(`${GT}/stops.txt`).map((s) => [s.stop_id, s]));
const ST = new Map();
for (const r of csv(`${GT}/stop_times.txt`)) {
  let a = ST.get(r.trip_id);
  if (!a) ST.set(r.trip_id, (a = []));
  a.push(r);
}
for (const a of ST.values()) a.sort((x, y) => Number(x.stop_sequence) - Number(y.stop_sequence));
const trips = new Map();
for (const t of csv(`${GT}/trips.txt`)) {
  const st = ST.get(t.trip_id);
  if (st) trips.set(t.trip_id, { route: t.route_id, svc: t.service_id, st: st.map((r) => [r.stop_id, r.arrival_time, r.departure_time]) });
}
const old = JSON.parse(readFileSync(SRC, 'utf8'));
const oldTrip = (id) => {
  const nt = (old.addTrips || []).find((x) => x.trip_id === id);
  if (nt) return { route: nt.route_id, svc: nt.service_id, st: nt.stop_times };
  const t = trips.get(id);
  if (!t) throw new Error(`spoj ${id} z pôvodnej opravy nie je ani vo feede, ani v oprave`);
  return t;
};
const ll = (sid) => [Number(stops.get(sid).stop_lat), Number(stops.get(sid).stop_lon)];
function dist(a, b) {
  const [la1, lo1] = ll(a), [la2, lo2] = ll(b), r = Math.PI / 180;
  const x = (lo2 - lo1) * r * Math.cos(((la1 + la2) / 2) * r), y = (la2 - la1) * r;
  return Math.hypot(x, y) * 6371000;
}
const name = (sid) => stops.get(sid).stop_name;
// spoj 1384 zodpovedajúci spoju 1382 (linka, prvá a posledná zastávka, odchod, typ dňa)
function match(o) {
  const svc = o.svc.replace(/^1382_/, '1384_');
  const [s0, , d0] = o.st[0], sN = o.st.at(-1)[0];
  const c = [...trips].filter(([, t]) => t.route === o.route && t.svc === svc && t.st[0][2] === d0
    && name(t.st[0][0]) === name(s0) && name(t.st.at(-1)[0]) === name(sN));
  if (c.length !== 1) throw new Error(`linka ${o.route} ${hm(sec(d0))} ${name(s0)} (${svc}): ${c.length} kandidátov v 1384`);
  return c[0][0];
}
const links = [];
const seen = new Set();
function link(from, to, why) {
  const A = trips.get(from), B = trips.get(to);
  const [aStop, aArr] = A.st.at(-1), [bStop, , bDep] = B.st[0];
  const gap = sec(bDep) - sec(aArr), d = dist(aStop, bStop);
  if (A.svc !== B.svc || gap < 0 || gap > 180 || d > 60) throw new Error(`väzba ${from} → ${to}: nesedí (${A.svc}/${B.svc}, ${gap} s, ${Math.round(d)} m)`);
  const key = `${from}>${to}`;
  if (seen.has(key)) return 0;
  seen.add(key);
  links.push({ from, to, note: why });
  return 1;
}
// 1) všetky doložené väzby z opravy pre feed 1382
let n1 = 0;
for (const l of old.links) n1 += link(match(oldTrip(l.from)), match(oldTrip(l.to)), l.note);
if (n1 !== old.links.length) throw new Error(`prenesených ${n1} z ${old.links.length} väzieb`);
// 2) PDF 32A: každý spoj 32A pokračuje ako 32 — aj prázdninové dni (1384_PR)
let n2 = 0;
for (const [id, A] of trips) {
  if (A.route !== '32A' || !A.svc.startsWith('1384_')) continue;
  const [aStop, aArr] = A.st.at(-1);
  const c = [...trips].filter(([, B]) => B.route === '32' && B.svc === A.svc
    && sec(B.st[0][2]) - sec(aArr) >= 0 && sec(B.st[0][2]) - sec(aArr) <= 180 && dist(aStop, B.st[0][0]) <= 60);
  if (c.length > 1) throw new Error(`32A ${id}: viac pokračovaní`);
  if (c.length === 1) n2 += link(id, c[0][0], 'PDF linky 32A: „Okružná — ďalej pokračuje ako linka 32“');
}
const bySvc = {};
for (const l of links) { const s = trips.get(l.from).svc; bySvc[s] = (bySvc[s] || 0) + 1; }
const patch = {
  id: 'dpmp-2026-10-vazby',
  baseFeedVersion: FEED,
  title: 'Nadväzujúce spoje („zostaň sedieť“) podľa DPMP',
  validFrom: 20261001,
  validTo: 20261031,
  sources: [
    'data/gtfs-patches/1382-dpmp-2026-10-01.json — väzby z oznamu DPMP od 1. 10. 2026 a z PDF liniek 32 a 32A',
  ],
  notes: [
    'Feed 1382_1384 už obsahuje CP od 1. 10. 2026 (aj prázdninové dni 29.–30. 10.); dopĺňajú sa len väzby, ktoré GTFS nemá.',
  ],
  links,
  summary: [`väzby: ${links.length} (z opravy 1382: ${n1}, nové 32A→32 v ďalších dňoch: ${links.length - n1}); podľa služby ${JSON.stringify(bySvc)}`],
};
writeFileSync(OUT, JSON.stringify(patch, null, 1) + '\n');
console.log(`${OUT}: ${patch.summary[0]}`);
