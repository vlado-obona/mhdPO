#!/usr/bin/env node
// Meranie pešej siete z OpenStreetMap pre návrh „navádzanie po chodníkoch“
// (docs/analyza-2026-11/CHODNIKY.md, krok 1). Appku ani dáta appky NEMENÍ – len vypíše
// čísla, podľa ktorých sa rozhodne medzi variantmi A/B/C.
//
// Vstup:  walk.json      – výstup Overpass ([out:json], cesty `out body` + uzly `out skel`
//                          + samostatné uzly priechodov/bariér `out body`)
//         dataset.json   – mhd-app/data/dataset.json (nástupištia, pešie prestupy)
//         addresses.json – data/osm-places/addresses.json (vzorka ciest adresa → zastávka)
// Výstup: <out>/results.json, <out>/walk-graph.json (kompaktná sieť orezaná na okolie
//         zastávok – len na odhad veľkosti), súhrn v markdowne na stdout.
// Použitie: node scripts/mhd/osm-walk-measure.mjs walk.json dataset.json addresses.json out/
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { gzipSync } from 'node:zlib';

const [wf, df, af, outDir = 'osm-walk-out'] = process.argv.slice(2);
if (!wf || !df || !af) { console.error('použitie: osm-walk-measure.mjs walk.json dataset.json addresses.json [out/]'); process.exit(2); }
mkdirSync(outDir, { recursive: true });
const T0 = Date.now();
const W = JSON.parse(readFileSync(wf, 'utf8'));
const D = JSON.parse(readFileSync(df, 'utf8'));
const ADDR = JSON.parse(readFileSync(af, 'utf8'));
const osmBase = W.osm3s?.timestamp_osm_base || '?';

// ── geometria (rovinná aproximácia okolo 49° s. š. – na vzdialenosti do pár km stačí) ──
const rad = Math.PI / 180, KX = 111320 * Math.cos(49 * rad), KY = 110540;
const dist = (a0, o0, a1, o1) => Math.hypot((o1 - o0) * KX, (a1 - a0) * KY);
function segDist(pa, po, aa, ao, ba, bo) { // bod p k úsečke a–b (m)
  const px = po * KX, py = pa * KY, ax = ao * KX, ay = aa * KY, bx = bo * KX, by = ba * KY;
  const dx = bx - ax, dy = by - ay, L2 = dx * dx + dy * dy;
  const t = L2 ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / L2)) : 0;
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}
function segCross(a, b, c, d) { // pretínajú sa úsečky a–b a c–d (body [la, lo])
  const o = (p, q, r) => Math.sign((q[1] - p[1]) * KX * (r[0] - p[0]) * KY - (q[0] - p[0]) * KY * (r[1] - p[1]) * KX);
  return o(a, b, c) * o(a, b, d) < 0 && o(c, d, a) * o(c, d, b) < 0;
}
const pct = (x, n) => (n ? `${(100 * x / n).toFixed(1)} %` : '–');
const q = (arr, p) => { if (!arr.length) return null; const s = [...arr].sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.floor(p * s.length))]; };
const r1 = (x) => (x == null ? null : Math.round(x * 10) / 10);
const r2 = (x) => (x == null ? null : Math.round(x * 100) / 100);

// ── prvky Overpass ──
const nodes = new Map(); // id -> {la, lo, tags?}
const ways = [];
for (const e of W.elements || []) {
  if (e.type === 'node') { const n = nodes.get(e.id); if (n) { if (e.tags) n.tags = e.tags; } else nodes.set(e.id, { la: e.lat, lo: e.lon, tags: e.tags }); }
  else if (e.type === 'way' && e.nodes && e.tags) ways.push(e);
}
const MAIN = /^(primary|primary_link|secondary|secondary_link|tertiary|tertiary_link|trunk|trunk_link)$/;
const FOOTISH = /^(footway|path|pedestrian|steps|corridor|cycleway|platform|bridleway)$/;
const NOWALK = /^(motorway|motorway_link|trunk|trunk_link|construction|proposed|raceway|bus_guideway|escape)$/;
// pešo nepoužiteľné: zákaz pre chodcov, súkromné, plochy (area=yes / area:highway = len obrys)
const blocked = (t) => /^(no|private|use_sidepath)$/.test(t.foot || '') || (/^(no|private)$/.test(t.access || '') && !/^(yes|designated|permissive|destination)$/.test(t.foot || ''));
const wayLen = (w) => { let L = 0; for (let i = 1; i < w.nodes.length; i++) { const a = nodes.get(w.nodes[i - 1]), b = nodes.get(w.nodes[i]); if (a && b) L += dist(a.la, a.lo, b.la, b.lo); } return L; };

// ── 1) súpis: km podľa triedy, chodníky pri cestách, priechody ──
const byClass = {}; let kmAll = 0, kmBlocked = 0, kmArea = 0, kmPedArea = 0, kmNamed = 0, kmMainSw = 0;
const sidewalkTag = { tagged: 0, both: 0, left: 0, right: 0, no: 0, separate: 0, untaggedKm: 0, taggedKm: 0 };
let kmSidewalkWays = 0, kmCrossingWays = 0, kmSteps = 0, kmLit = 0, kmSurface = 0;
const walkWays = [];
for (const w of ways) {
  const t = w.tags, h = t.highway || (t['area:highway'] ? 'area:' + t['area:highway'] : '?');
  const L = wayLen(w) / 1000;
  kmAll += L;
  if (t['area:highway']) { kmArea += L; continue; } // len obrys plochy cesty – nie je to pešia čiara
  if (!t.highway || NOWALK.test(t.highway)) continue;
  byClass[h] = (byClass[h] || 0) + L;
  if (blocked(t)) { kmBlocked += L; continue; }
  if (t.area === 'yes') kmPedArea += L; // pešia zóna/námestie ako plocha: chodí sa aspoň po obvode
  if (t.name) kmNamed += L;
  if (t.footway === 'sidewalk') kmSidewalkWays += L;
  if (t.footway === 'crossing') kmCrossingWays += L;
  if (t.highway === 'steps') kmSteps += L;
  if (t.lit === 'yes') kmLit += L;
  if (t.surface) kmSurface += L;
  if (MAIN.test(t.highway) || /^(residential|unclassified|living_street)$/.test(t.highway)) {
    const sw = t.sidewalk || (t['sidewalk:both'] ? 'both' : t['sidewalk:left'] || t['sidewalk:right'] ? 'lr' : null);
    if (sw) { sidewalkTag.tagged++; sidewalkTag.taggedKm += L; if (sw in sidewalkTag) sidewalkTag[sw]++; if (MAIN.test(t.highway)) kmMainSw += L; } else sidewalkTag.untaggedKm += L;
  }
  walkWays.push(w);
}
const crossNodes = [...nodes.entries()].filter(([, n]) => n.tags && (n.tags.highway === 'crossing' || n.tags.crossing || n.tags.railway === 'crossing'));
const crossingKinds = {};
for (const [, n] of crossNodes) { const k = n.tags.crossing || n.tags['crossing:markings'] || n.tags.highway || n.tags.railway; crossingKinds[k] = (crossingKinds[k] || 0) + 1; }
const barriers = [...nodes.values()].filter((n) => n.tags && n.tags.barrier).length;

// ── 2) graf (všetky uzly ciest; hrana = susedné uzly jednej cesty) ──
const idx = new Map(); const LA = [], LO = [], OSMID = [];
const ni = (id) => { let i = idx.get(id); if (i == null) { const n = nodes.get(id); if (!n) return -1; i = LA.length; idx.set(id, i); LA.push(n.la); LO.push(n.lo); OSMID.push(id); } return i; };
const EA = [], EB = [], EL = [], EC = []; // hrany: uzly, dĺžka, trieda (0 chodník, 1 obytná/obslužná, 2 hlavná, 3 schody)
const cls = (t) => (t.highway === 'steps' ? 3 : MAIN.test(t.highway) ? 2 : FOOTISH.test(t.highway) || t.highway === 'living_street' ? 0 : 1);
const useCount = new Map();
for (const w of walkWays) for (const id of w.nodes) useCount.set(id, (useCount.get(id) || 0) + 1);
for (const w of walkWays) {
  const c = cls(w.tags);
  for (let k = 1; k < w.nodes.length; k++) {
    const a = ni(w.nodes[k - 1]), b = ni(w.nodes[k]);
    if (a < 0 || b < 0 || a === b) continue;
    EA.push(a); EB.push(b); EL.push(dist(LA[a], LO[a], LA[b], LO[b])); EC.push(c);
  }
}
const N = LA.length, E = EA.length;
const start = new Int32Array(N + 1);
for (let e = 0; e < E; e++) { start[EA[e] + 1]++; start[EB[e] + 1]++; }
for (let i = 0; i < N; i++) start[i + 1] += start[i];
const adj = new Int32Array(2 * E), adjE = new Int32Array(2 * E), fill = start.slice(0, N);
for (let e = 0; e < E; e++) { adj[fill[EA[e]]] = EB[e]; adjE[fill[EA[e]]++] = e; adj[fill[EB[e]]] = EA[e]; adjE[fill[EB[e]]++] = e; }

// súvislé celky (union-find) a ich dĺžka
const par = new Int32Array(N).map((_, i) => i);
const find = (x) => { while (par[x] !== x) { par[x] = par[par[x]]; x = par[x]; } return x; };
for (let e = 0; e < E; e++) { const a = find(EA[e]), b = find(EB[e]); if (a !== b) par[a] = b; }
const compKm = new Map();
for (let e = 0; e < E; e++) { const r = find(EA[e]); compKm.set(r, (compKm.get(r) || 0) + EL[e] / 1000); }
const comps = [...compKm.entries()].sort((x, y) => y[1] - x[1]);
const bigRoot = comps.length ? comps[0][0] : -1, kmGraph = comps.reduce((s, c) => s + c[1], 0);

// ── priestorový index (mriežka 50 m) uzlov a hrán ──
const CELL = 50, cx = (lo) => Math.floor(lo * KX / CELL), cy = (la) => Math.floor(la * KY / CELL), ck = (x, y) => x * 1e6 + y;
const nodeGrid = new Map(), edgeGrid = new Map();
for (let i = 0; i < N; i++) { const k = ck(cx(LO[i]), cy(LA[i])); let a = nodeGrid.get(k); if (!a) nodeGrid.set(k, (a = [])); a.push(i); }
for (let e = 0; e < E; e++) {
  const x0 = cx(Math.min(LO[EA[e]], LO[EB[e]])), x1 = cx(Math.max(LO[EA[e]], LO[EB[e]])), y0 = cy(Math.min(LA[EA[e]], LA[EB[e]])), y1 = cy(Math.max(LA[EA[e]], LA[EB[e]]));
  for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) { const k = ck(x, y); let a = edgeGrid.get(k); if (!a) edgeGrid.set(k, (a = [])); a.push(e); }
}
function nearestEdge(la, lo, maxM) {
  const X = cx(lo), Y = cy(la), R = Math.ceil(maxM / CELL); let best = null, bd = maxM;
  for (let x = X - R; x <= X + R; x++) for (let y = Y - R; y <= Y + R; y++) for (const e of edgeGrid.get(ck(x, y)) || []) {
    const d = segDist(la, lo, LA[EA[e]], LO[EA[e]], LA[EB[e]], LO[EB[e]]); if (d < bd) { bd = d; best = e; }
  }
  return best == null ? null : { e: best, d: bd };
}
function nearestNode(la, lo, maxM) {
  const X = cx(lo), Y = cy(la), R = Math.ceil(maxM / CELL); let best = -1, bd = maxM;
  for (let x = X - R; x <= X + R; x++) for (let y = Y - R; y <= Y + R; y++) for (const i of nodeGrid.get(ck(x, y)) || []) {
    const d = dist(la, lo, LA[i], LO[i]); if (d < bd) { bd = d; best = i; }
  }
  return best < 0 ? null : { i: best, d: bd };
}

// ── 3) nástupištia pri sieti ──
const stops = D.stops;
const stopNear = stops.map((s) => nearestEdge(s.la, s.lo, 200));
const within = (m) => stopNear.filter((x) => x && x.d <= m).length;
const inBig = stopNear.filter((x) => x && x.d <= 25 && find(EA[x.e]) === bigRoot).length;
const stopD = stopNear.filter(Boolean).map((x) => x.d);

// ── 4) hľadanie trasy (Dijkstra s hranicou) ──
const distArr = new Float64Array(N).fill(Infinity), seen = [];
const heapI = [], heapD = [];
function push(i, d) { heapI.push(i); heapD.push(d); let k = heapI.length - 1; while (k) { const p = (k - 1) >> 1; if (heapD[p] <= heapD[k]) break; [heapI[p], heapI[k]] = [heapI[k], heapI[p]]; [heapD[p], heapD[k]] = [heapD[k], heapD[p]]; k = p; } }
function pop() { const i = heapI[0], d = heapD[0], li = heapI.pop(), ld = heapD.pop(); if (heapI.length) { heapI[0] = li; heapD[0] = ld; let k = 0; for (;;) { const l = 2 * k + 1, r = l + 1; let m = k; if (l < heapI.length && heapD[l] < heapD[m]) m = l; if (r < heapI.length && heapD[r] < heapD[m]) m = r; if (m === k) break; [heapI[m], heapI[k]] = [heapI[k], heapI[m]]; [heapD[m], heapD[k]] = [heapD[k], heapD[m]]; k = m; } } return [i, d]; }
const STEP_PEN = 1.0; // schody bez pokuty (len meranie dĺžky); varianty pokút sa riešia až pri implementácii
function route(a, b, limit) { // najkratšia dĺžka po sieti z uzla a do uzla b, alebo Infinity
  for (const i of seen) distArr[i] = Infinity; seen.length = 0; heapI.length = 0; heapD.length = 0;
  distArr[a] = 0; seen.push(a); push(a, 0);
  while (heapI.length) {
    const [i, d] = pop();
    if (d > distArr[i]) continue;
    if (i === b) return d;
    if (d > limit) return Infinity;
    for (let k = start[i]; k < start[i + 1]; k++) {
      const j = adj[k], e = adjE[k], nd = d + EL[e] * (EC[e] === 3 ? STEP_PEN : 1);
      if (nd < distArr[j]) { if (distArr[j] === Infinity) seen.push(j); distArr[j] = nd; push(j, nd); }
    }
  }
  return Infinity;
}
const SNAP = 60; // m – poloha → najbližší uzol siete
function trip(la0, lo0, la1, lo1) {
  const A = nearestNode(la0, lo0, SNAP), B = nearestNode(la1, lo1, SNAP);
  const air = dist(la0, lo0, la1, lo1);
  if (!A || !B) return { air, net: Infinity, why: 'snap' };
  const net = route(A.i, B.i, 4 * air + 800) + A.d + B.d;
  return { air, net, why: net === Infinity ? 'nopath' : '' };
}
function stats(list) {
  const ok = list.filter((x) => x.net < Infinity && x.air > 30), det = ok.map((x) => x.net / x.air);
  return { n: list.length, found: list.filter((x) => x.net < Infinity).length, snapFail: list.filter((x) => x.why === 'snap').length, noPath: list.filter((x) => x.why === 'nopath').length,
    detourMed: r2(q(det, 0.5)), detourP90: r2(q(det, 0.9)), over15: det.filter((x) => x > 1.5).length, over2: det.filter((x) => x > 2).length, nDet: det.length };
}
// a) adresa → najbližšie nástupište do 700 m (vzorka: každá 13. adresa)
const tA = Date.now(); const addrTrips = [];
for (let k = 0; k < ADDR.length; k += 13) {
  const [la, lo] = ADDR[k]; let bs = null, bd = 700;
  for (const s of stops) { const d = dist(la, lo, s.la, s.lo); if (d < bd) { bd = d; bs = s; } }
  if (bs) addrTrips.push(trip(la, lo, bs.la, bs.lo));
}
const msAddr = (Date.now() - tA) / Math.max(1, addrTrips.length);
// b) pešie prestupy z datasetu (do 400 m)
const xferTrips = D.transfers.filter(([a, b]) => a !== b).map(([a, b]) => trip(stops[a].la, stops[a].lo, stops[b].la, stops[b].lo));
// c) vzdušná čiara cez hlavnú cestu (spodná hranica: len hlavné cesty v dátach) – adresa → zastávka
const mainSegs = []; for (const w of walkWays) if (MAIN.test(w.tags.highway)) for (let k = 1; k < w.nodes.length; k++) { const a = nodes.get(w.nodes[k - 1]), b = nodes.get(w.nodes[k]); if (a && b) mainSegs.push([[a.la, a.lo], [b.la, b.lo]]); }
let crossAir = 0, nAir = 0;
for (let k = 0; k < ADDR.length; k += 13) {
  const [la, lo] = ADDR[k]; let bs = null, bd = 700;
  for (const s of stops) { const d = dist(la, lo, s.la, s.lo); if (d < bd) { bd = d; bs = s; } }
  if (!bs) continue; nAir++;
  const p = [la, lo], s = [bs.la, bs.lo];
  if (mainSegs.some(([a, b]) => Math.max(a[0], b[0]) >= Math.min(p[0], s[0]) && Math.min(a[0], b[0]) <= Math.max(p[0], s[0]) && Math.max(a[1], b[1]) >= Math.min(p[1], s[1]) && Math.min(a[1], b[1]) <= Math.max(p[1], s[1]) && segCross(p, s, a, b))) crossAir++;
}
// priechody pri hlavných cestách: uzol priechodu, ktorý leží na hlavnej ceste
const onMain = new Set(); for (const w of walkWays) if (MAIN.test(w.tags.highway)) for (const id of w.nodes) onMain.add(id);
const crossOnMain = crossNodes.filter(([id]) => onMain.has(id)).length;
const kmMain = Object.entries(byClass).filter(([h]) => MAIN.test(h)).reduce((s, [, v]) => s + v, 0);

// ── 5) veľkosť: kompaktná sieť orezaná na okolie zastávok (1,5 km), tvar zjednodušený na 2 m ──
const NEAR = 1500;
const stopGrid = new Map(); const SC = 500;
for (const s of stops) { const k = Math.floor(s.lo * KX / SC) * 1e6 + Math.floor(s.la * KY / SC); let a = stopGrid.get(k); if (!a) stopGrid.set(k, (a = [])); a.push(s); }
const nearStop = (la, lo) => { const X = Math.floor(lo * KX / SC), Y = Math.floor(la * KY / SC); for (let x = X - 3; x <= X + 3; x++) for (let y = Y - 3; y <= Y + 3; y++) for (const s of stopGrid.get(x * 1e6 + y) || []) if (dist(la, lo, s.la, s.lo) <= NEAR) return true; return false; };
function dp(pts, tol) { // Douglas–Peucker
  if (pts.length < 3) return pts; let md = 0, mi = 0; const [a, b] = [pts[0], pts[pts.length - 1]];
  for (let i = 1; i < pts.length - 1; i++) { const d = segDist(pts[i][0], pts[i][1], a[0], a[1], b[0], b[1]); if (d > md) { md = d; mi = i; } }
  return md <= tol ? [a, b] : [...dp(pts.slice(0, mi + 1), tol).slice(0, -1), ...dp(pts.slice(mi), tol)];
}
function compact(filterNear) {
  // uzly grafu = križovatky (cesta ich zdieľa) a konce ciest; medzi nimi tvar
  const jn = new Map(), J = []; const jOf = (id) => { let i = jn.get(id); if (i == null) { i = J.length; jn.set(id, i); const n = nodes.get(id); J.push([Math.round(n.la * 1e5), Math.round(n.lo * 1e5)]); } return i; };
  const out = []; let km = 0;
  for (const w of walkWays) {
    const c = cls(w.tags); let seg = [w.nodes[0]];
    const flush = () => { if (seg.length < 2) return; const pts = seg.map((id) => nodes.get(id)).filter(Boolean).map((n) => [n.la, n.lo]); if (pts.length < 2) return;
      const mid = pts[pts.length >> 1]; if (filterNear && !nearStop(mid[0], mid[1])) return;
      for (let i = 1; i < pts.length; i++) km += dist(pts[i - 1][0], pts[i - 1][1], pts[i][0], pts[i][1]) / 1000;
      const sh = dp(pts, 2).slice(1, -1); const a = jOf(seg[0]), b = jOf(seg[seg.length - 1]);
      let pl = Math.round(pts[0][0] * 1e5), po = Math.round(pts[0][1] * 1e5); const d = [];
      for (const [la, lo] of sh) { const x = Math.round(la * 1e5), y = Math.round(lo * 1e5); d.push(x - pl, y - po); pl = x; po = y; }
      out.push([a, b, c, ...(d.length ? [d] : [])]); };
    for (let k = 1; k < w.nodes.length; k++) { seg.push(w.nodes[k]); if (k === w.nodes.length - 1 || (useCount.get(w.nodes[k]) || 0) > 1) { flush(); seg = [w.nodes[k]]; } }
  }
  // uzly delta-kódované
  let pa = 0, po = 0; const jd = []; for (const [la, lo] of J) { jd.push(la - pa, lo - po); pa = la; po = lo; }
  const json = JSON.stringify({ v: 1, src: '© prispievatelia OpenStreetMap, ODbL 1.0', osm: osmBase, n: jd, e: out });
  return { json, bytes: Buffer.byteLength(json), gz: gzipSync(json, { level: 9 }).length, km, junctions: J.length, edges: out.length };
}
const full = compact(false), cut = compact(true);
writeFileSync(`${outDir}/walk-graph.json`, cut.json);

// ── 6) výkon ──
const tP = Date.now(); JSON.parse(cut.json); const msParse = Date.now() - tP;

// ── výsledky ──
const sA = stats(addrTrips), sX = stats(xferTrips);
const res = {
  osmBase, generated: new Date().toISOString(), seconds: (Date.now() - T0) / 1000,
  km: { all: r1(kmAll), byClass: Object.fromEntries(Object.entries(byClass).sort((a, b) => b[1] - a[1]).map(([k, v]) => [k, r1(v)])), blocked: r1(kmBlocked), areaOutlines: r1(kmArea),
    named: r1(kmNamed), pedestrianAreas: r1(kmPedArea), mainWithSidewalkTag: r1(kmMainSw),
    sidewalkWays: r1(kmSidewalkWays), crossingWays: r1(kmCrossingWays), steps: r1(kmSteps), lit: r1(kmLit), surface: r1(kmSurface), mainRoads: r1(kmMain), graph: r1(kmGraph) },
  sidewalkTags: { ...sidewalkTag, taggedKm: r1(sidewalkTag.taggedKm), untaggedKm: r1(sidewalkTag.untaggedKm) },
  crossings: { nodes: crossNodes.length, onMainRoads: crossOnMain, perKmMain: r1(crossOnMain / Math.max(1, kmMain)), kinds: crossingKinds, barriers },
  graph: { nodes: N, edges: E, components: comps.length, biggestKm: r1(comps[0]?.[1] || 0), biggestShare: pct(comps[0]?.[1] || 0, kmGraph), under05km: comps.filter((c) => c[1] < 0.5).length },
  stops: { n: stops.length, within10: within(10), within25: within(25), within50: within(50), in25Biggest: inBig, medianM: r1(q(stopD, 0.5)), p90M: r1(q(stopD, 0.9)) },
  addrToStop: { ...sA, msPerRoute: r1(msAddr) }, transfers: sX,
  straightLineCrossesMainRoad: { n: nAir, crosses: crossAir, share: pct(crossAir, nAir) },
  size: { full: { km: r1(full.km), bytes: full.bytes, gzip: full.gz, junctions: full.junctions, edges: full.edges }, near1500: { km: r1(cut.km), bytes: cut.bytes, gzip: cut.gz, junctions: cut.junctions, edges: cut.edges, parseMs: msParse } },
};
const T = { stops: res.stops.in25Biggest / Math.max(1, stops.length) >= 0.9, addr: sA.found / Math.max(1, sA.n) >= 0.95 };
res.thresholds = { stopsIn25Biggest90: T.stops, addrRouteFound95: T.addr, verdict: T.stops && T.addr ? 'A (navádzanie po chodníkoch) je dátami podložené' : 'A zatiaľ nie – zvážiť B alebo opravy v OSM' };
writeFileSync(`${outDir}/results.json`, JSON.stringify(res, null, 1));

const mb = (b) => `${(b / 1048576).toFixed(2)} MB`;
const L = [];
L.push(`### Pešia sieť z OpenStreetMap – meranie (stav OSM ${osmBase})`, '');
L.push(`- **Dĺžka:** všetko ${res.km.all} km; v pešom grafe ${res.km.graph} km (bez zákazov pre chodcov ${res.km.blocked} km a obrysov plôch ciest ${res.km.areaOutlines} km); s menom ${res.km.named} km (${pct(res.km.named, res.km.graph)}); pešie plochy (obvod) ${res.km.pedestrianAreas} km.`);
L.push(`- **Podľa triedy (km):** ${Object.entries(res.km.byClass).slice(0, 12).map(([k, v]) => `${k} ${v}`).join(', ')}.`);
L.push(`- **Chodníky:** zakreslené ako samostatná čiara (footway=sidewalk) ${res.km.sidewalkWays} km; cesty so značkou sidewalk=* ${res.sidewalkTags.tagged} úsekov / ${res.sidewalkTags.taggedKm} km, bez značky ${res.sidewalkTags.untaggedKm} km (hlavné a obytné cesty); hlavné cesty so značkou ${res.km.mainWithSidewalkTag} z ${res.km.mainRoads} km (${pct(res.km.mainWithSidewalkTag, res.km.mainRoads)}). Schody ${res.km.steps} km, osvetlenie zapísané pri ${res.km.lit} km, povrch pri ${res.km.surface} km.`);
L.push(`- **Priechody:** ${res.crossings.nodes} bodov (z toho na hlavných cestách ${res.crossings.onMainRoads}, t. j. ${res.crossings.perKmMain} na km hlavnej cesty); čiar priechodov ${res.km.crossingWays} km; druhy: ${Object.entries(crossingKinds).sort((a, b) => b[1] - a[1]).slice(0, 8).map(([k, v]) => `${k} ${v}`).join(', ')}. Bariéry (brány, závory): ${barriers}.`);
L.push(`- **Súvislosť:** ${res.graph.components} celkov, najväčší ${res.graph.biggestKm} km (${res.graph.biggestShare} siete), celkov pod 0,5 km: ${res.graph.under05km}.`);
L.push(`- **Nástupištia (${stops.length}):** do 10 m od siete ${pct(res.stops.within10, stops.length)}, do 25 m ${pct(res.stops.within25, stops.length)}, do 50 m ${pct(res.stops.within50, stops.length)}; do 25 m a v najväčšom celku **${pct(inBig, stops.length)}** (prah návrhu 90 %). Medián ${res.stops.medianM} m, 90. percentil ${res.stops.p90M} m.`);
L.push(`- **Adresa → najbližšie nástupište do 700 m** (vzorka ${sA.n}): trasa nájdená **${pct(sA.found, sA.n)}** (prah návrhu 95 %), bez siete do 60 m ${sA.snapFail}, bez spojenia ${sA.noPath}; obchádzka medián ${sA.detourMed}×, 90. percentil ${sA.detourP90}×, nad 1,5× ${pct(sA.over15, sA.nDet)}, nad 2× ${pct(sA.over2, sA.nDet)}; ${res.addrToStop.msPerRoute} ms na trasu (počítač GitHubu).`);
L.push(`- **Pešie prestupy z datasetu** (${sX.n}): trasa nájdená ${pct(sX.found, sX.n)}; obchádzka medián ${sX.detourMed}×, 90. percentil ${sX.detourP90}×, nad 2× ${pct(sX.over2, sX.nDet)}.`);
L.push(`- **Vzdušná čiara cez hlavnú cestu** (adresa → zastávka): ${res.straightLineCrossesMainRoad.share} z ${nAir}.`);
L.push(`- **Veľkosť súboru** (križovatky + tvar zjednodušený na 2 m): celé územie ${res.size.full.km} km = ${mb(full.bytes)} (gzip ${mb(full.gz)}); len do 1,5 km od zastávok ${res.size.near1500.km} km = **${mb(cut.bytes)} (gzip ${mb(cut.gz)})**, ${cut.junctions} uzlov, ${cut.edges} úsekov; JSON.parse ${msParse} ms.`);
L.push('', `**Prahy návrhu:** nástupištia v sieti ≥ 90 % → ${T.stops ? 'áno' : 'nie'}; trasa adresa → zastávka ≥ 95 % → ${T.addr ? 'áno' : 'nie'}. **Výsledok:** ${res.thresholds.verdict}.`);
L.push('', `Údaje © prispievatelia OpenStreetMap, ODbL 1.0. Meranie trvalo ${res.seconds.toFixed(0)} s. Appka ani dáta appky sa nemenili.`);
console.log(L.join('\n'));
