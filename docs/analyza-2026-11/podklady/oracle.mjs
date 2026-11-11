// R1 — NEZÁVISLÉ ORÁKULUM pre MHD Prešov (nevolá žiadny kód z raptor.js / app.js).
// Algoritmus: kolovo obmedzený Connection Scan (CSA) — pre každé kolo k (= počet nástupov)
// jeden prechod zoznamom elementárnych spojení (zastávka→nasledujúca zastávka) zoradeným podľa odchodu.
//   R[k][s]  = najskorší príchod JAZDOU na zastávku s pri <= k nástupoch
//   F[k][s]  = najskorší príchod PEŠO (jeden peší prestup po jazde z kola k)
//   B[k][s]  = odkedy sa dá na s nastúpiť pri <= k nástupoch (min cez pôvod, R + minChange, F)
// Semantika zhodná s datasetom appky: pešie prestupy D.transfers (obojsmerné, jeden skok, bez reťazenia),
// prestup na tej istej zastávke bez minimálneho času (minChange = 0), „zostaň sedieť“ D.links,
// prevádzkové dni -1/0/+1, horizont 20 h. Voliteľné uvoľnenia modelu cez opts.
import { readFileSync } from 'node:fs';

export const D = JSON.parse(readFileSync(new URL('../../../mhd-app/data/dataset.json', import.meta.url), 'utf8'));
export const DAY = 86400;
export const HORIZON = 20 * 3600;
export const N = D.stops.length;

// ── vlastný kalendár (bez Date) ────────────────────────────────────────
const ML = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
const leap = (y) => (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
const mlen = (y, m) => (m === 2 && leap(y) ? 29 : ML[m - 1]);
export function shiftDate(y, m, d, n) {
  d += n;
  for (;;) {
    if (d > mlen(y, m)) { d -= mlen(y, m); m++; if (m > 12) { m = 1; y++; } }
    else if (d < 1) { m--; if (m < 1) { m = 12; y--; } d += mlen(y, m); }
    else break;
  }
  return [y, m, d];
}
// Sakamoto: 0 = nedeľa → prepočet na 0 = pondelok
export function weekdayMon0(y, m, d) {
  const t = [0, 3, 2, 5, 0, 3, 5, 1, 4, 6, 2, 4];
  if (m < 3) y--;
  const w = (y + Math.floor(y / 4) - Math.floor(y / 100) + Math.floor(y / 400) + t[m - 1] + d) % 7;
  return (w + 6) % 7;
}
export function svcActive(s, num, wd) {
  if (s.rem.indexOf(num) !== -1) return false;
  if (s.add.indexOf(num) !== -1) return true;
  return s.from <= num && num <= s.to && ((s.d >> wd) & 1) === 1;
}
export function dateParts(dateStr, o = 0) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const [yy, mm, dd] = shiftDate(y, m, d, o);
  return { num: yy * 10000 + mm * 100 + dd, wd: weekdayMon0(yy, mm, dd) };
}

// ── pešie prestupy ────────────────────────────────────────────────────
export function haversine(la1, lo1, la2, lo2) {
  const R = 6371000, r = Math.PI / 180;
  const a = Math.sin((la2 - la1) * r / 2) ** 2 + Math.cos(la1 * r) * Math.cos(la2 * r) * Math.sin((lo2 - lo1) * r / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}
function adjFromPairs(pairs) { // pairs: Map "a_b" -> secs (a<b)
  const adj = Array.from({ length: N }, () => []);
  for (const [k, s] of pairs) { const [a, b] = k.split('_').map(Number); adj[a].push(b, s); adj[b].push(a, s); }
  return adj;
}
const basePairs = new Map();
for (const [a, b, s] of D.transfers) basePairs.set(a < b ? a + '_' + b : b + '_' + a, s);
/** pešie prestupy presne ako v datasete appky */
export const FOOT = adjFromPairs(basePairs);
/** uvoľnený model: priame pešie prestupy do `radius` m (vzorec ako build-data.mjs: max(120, d/1.25 + 60)) */
export function footRadius(radius) {
  const pairs = new Map(basePairs);
  for (let a = 0; a < N; a++) for (let b = a + 1; b < N; b++) {
    const k = a + '_' + b;
    if (pairs.has(k)) continue;
    const d = haversine(D.stops[a].la, D.stops[a].lo, D.stops[b].la, D.stops[b].lo);
    if (d <= radius) pairs.set(k, Math.max(120, Math.round(d / 1.25) + 60));
  }
  return adjFromPairs(pairs);
}
/** uvoľnený model: tranzitívny uzáver peších prestupov datasetu (najkratšia cesta v pešom grafe, strop `cap` s) */
export function footTransitive(cap = 900) {
  const adj = Array.from({ length: N }, () => []);
  for (let src = 0; src < N; src++) {
    const dist = new Float64Array(N).fill(Infinity); dist[src] = 0;
    const done = new Uint8Array(N);
    for (;;) {
      let u = -1, bd = Infinity;
      for (let i = 0; i < N; i++) if (!done[i] && dist[i] < bd) { bd = dist[i]; u = i; }
      if (u < 0 || bd > cap) break;
      done[u] = 1;
      const a = FOOT[u];
      for (let j = 0; j < a.length; j += 2) if (dist[u] + a[j + 1] < dist[a[j]]) dist[a[j]] = dist[u] + a[j + 1];
    }
    for (let i = 0; i < N; i++) if (i !== src && dist[i] <= cap) adj[src].push(i, dist[i]);
  }
  return adj;
}

// ── príprava dňa: aktívne spoje (deň -1, 0, +1) a zoradené elementárne spojenia ──
const dayCache = new Map();
export function buildDay(dateStr) {
  if (dayCache.has(dateStr)) return dayCache.get(dateStr);
  const tPi = [], tTi = [], tO = [];
  const tripId = new Map();
  const activeCount = {};
  for (const o of [-1, 0, 1]) {
    const { num, wd } = dateParts(dateStr, o);
    const act = D.services.map((s) => svcActive(s, num, wd));
    let c = 0;
    D.patterns.forEach((p, pi) => p.trips.forEach((tr, ti) => {
      if (!act[tr.sv]) return;
      tripId.set(o + '|' + pi + '|' + ti, tPi.length);
      tPi.push(pi); tTi.push(ti); tO.push(o); c++;
    }));
    activeCount[o] = c;
  }
  const nT = tPi.length;
  const list = [];
  for (let id = 0; id < nT; id++) {
    const p = D.patterns[tPi[id]], t = p.trips[tTi[id]].t, sh = tO[id] * DAY;
    for (let pos = 0; pos + 1 < p.stops.length; pos++) list.push([t[2 * pos + 1] + sh, id, pos, t[2 * pos + 2] + sh]);
  }
  list.sort((a, b) => a[0] - b[0] || a[1] - b[1] || a[2] - b[2]);
  const n = list.length;
  const cDep = new Int32Array(n), cArr = new Int32Array(n), cTrip = new Int32Array(n), cPos = new Int32Array(n);
  const cFrom = new Int32Array(n), cTo = new Int32Array(n);
  const firstConn = new Int32Array(nT).fill(-1), lastConn = new Int32Array(nT).fill(-1);
  for (let i = 0; i < n; i++) {
    const [dep, id, pos, arr] = list[i];
    const p = D.patterns[tPi[id]];
    cDep[i] = dep; cArr[i] = arr; cTrip[i] = id; cPos[i] = pos; cFrom[i] = p.stops[pos]; cTo[i] = p.stops[pos + 1];
    if (pos === 0) firstConn[id] = i;
    if (pos === p.stops.length - 2) lastConn[id] = i;
  }
  const cont = new Int32Array(nT).fill(-1);
  let linkOrphans = 0;
  for (const [pi, ti, pi2, ti2] of D.links || []) for (const o of [-1, 0, 1]) {
    const a = tripId.get(o + '|' + pi + '|' + ti), b = tripId.get(o + '|' + pi2 + '|' + ti2);
    if (a !== undefined && b !== undefined) cont[a] = b;
    else if ((a === undefined) !== (b === undefined)) linkOrphans++;
  }
  const day = { dateStr, n, nT, tPi, tTi, tO, tripId, cDep, cArr, cTrip, cPos, cFrom, cTo, firstConn, lastConn, cont, activeCount, linkOrphans };
  dayCache.set(dateStr, day);
  return day;
}

function relaxFoot(rr, foot) {
  const rf = new Float64Array(N).fill(Infinity), ff = new Int32Array(N).fill(-1);
  for (let s = 0; s < N; s++) {
    const a = rr[s];
    if (a === Infinity) continue;
    const adj = foot[s];
    for (let j = 0; j < adj.length; j += 2) {
      const t = a + adj[j + 1];
      if (t < rf[adj[j]]) { rf[adj[j]] = t; ff[adj[j]] = s; }
    }
  }
  return [rf, ff];
}

/**
 * @param day       buildDay(dateStr)
 * @param fromStops Map(stop -> chôdza s)
 * @param toStops   Map(stop -> chôdza s), voliteľne .extra = Map(stop -> prirážka s) ako appka
 * @param opts.K           max. počet kôl (nástupov; pri stayRound = jázd)            [4]
 * @param opts.stayRound   „zostaň sedieť“ minie kolo ako v appke (true) / je zadarmo (false) [false]
 * @param opts.foot        zoznam peších prestupov (FOOT | footRadius | footTransitive)
 * @param opts.minChange   minimálny čas na prestup na TEJ ISTEJ zastávke (s)           [0]
 * @param opts.destFootAll povoliť jazda → peší prestup → okolitá cieľová zastávka → pešo [false]
 * @returns { K, tru[k], sco[k], dest[k], destS[k], journey(k, 'tru'|'sco') } — k = 1..K kumulatívne (<= k)
 */
export function oracle(day, fromStops, toStops, depTime, opts = {}) {
  const K = opts.K ?? 4, stayRound = !!opts.stayRound, foot = opts.foot ?? FOOT, minChange = opts.minChange ?? 0;
  const destFootAll = !!opts.destFootAll;
  const limit = depTime + HORIZON;
  const { n, nT, cDep, cArr, cTrip, cPos, cFrom, cTo, firstConn, lastConn, cont } = day;
  let lo = 0, hi = n;
  while (lo < hi) { const mid = (lo + hi) >> 1; if (cDep[mid] < depTime) lo = mid + 1; else hi = mid; }
  const start = lo;
  let end = start;
  { let a = start, b = n; while (a < b) { const mid = (a + b) >> 1; if (cDep[mid] <= limit) a = mid + 1; else b = mid; } end = a; }

  const R = [], F = [], FF = [], B = [], PC = [], BC = [], SF = [];
  const r0 = new Float64Array(N).fill(Infinity);
  for (const [s, w] of fromStops) if (depTime + w < r0[s]) r0[s] = depTime + w;
  const [f0, ff0] = relaxFoot(r0, foot);
  const b0 = new Float64Array(N);
  for (let s = 0; s < N; s++) b0[s] = Math.min(r0[s], f0[s]);
  R.push(r0); F.push(f0); FF.push(ff0); B.push(b0); PC.push(null); BC.push(null); SF.push(null);
  let pending = []; // stayRound: [nadväzujúci spoj, predošlý spoj] z minulého kola

  for (let k = 1; k <= K; k++) {
    const bp = B[k - 1];
    const rr = new Float64Array(N).fill(Infinity), pc = new Int32Array(N).fill(-1);
    const bc = new Int32Array(nT).fill(-1), sf = new Int32Array(nT).fill(-1);
    if (stayRound) for (const [t2, tr] of pending) sf[t2] = tr;
    const nextPending = [];
    let again;
    do {
      again = false;
      for (let i = start; i < end; i++) {
        const tr = cTrip[i];
        if (bc[tr] === -1 && sf[tr] === -1) {
          if (bp[cFrom[i]] <= cDep[i]) bc[tr] = i; else continue;
        }
        const a = cArr[i];
        if (a > limit) continue;
        const to = cTo[i];
        if (a < rr[to]) { rr[to] = a; pc[to] = i; }
        if (i === lastConn[tr] && cont[tr] !== -1) {
          const t2 = cont[tr];
          if (stayRound) nextPending.push([t2, tr]);
          else if (sf[t2] === -1) { sf[t2] = tr; if (firstConn[t2] !== -1 && firstConn[t2] < i) again = true; }
        }
      }
    } while (again);
    pending = nextPending;
    const [rf, ff] = relaxFoot(rr, foot);
    const b = new Float64Array(N);
    for (let s = 0; s < N; s++) b[s] = Math.min(bp[s], rr[s] + minChange, rf[s]);
    R.push(rr); F.push(rf); FF.push(ff); B.push(b); PC.push(pc); BC.push(bc); SF.push(sf);
  }

  // cieľ: skutočný príchod (tru) a príchod s prirážkou appky (sco)
  const extra = toStops.extra;
  const tru = new Array(K + 1).fill(Infinity), sco = new Array(K + 1).fill(Infinity);
  const dest = new Array(K + 1).fill(null), destS = new Array(K + 1).fill(null);
  for (let k = 1; k <= K; k++) {
    for (const [T, w] of toStops) {
      const x = extra?.get(T) || 0;
      const a = R[k][T];
      if (a < Infinity) {
        if (a + w < tru[k]) { tru[k] = a + w; dest[k] = { stop: T, mode: 'ride', walk: w }; }
        if (a + w + x < sco[k]) { sco[k] = a + w + x; destS[k] = { stop: T, mode: 'ride', walk: w }; }
      }
      if (!x || destFootAll) {
        const f = F[k][T];
        if (f < Infinity) {
          if (f + w < tru[k]) { tru[k] = f + w; dest[k] = { stop: T, mode: 'foot', walk: w }; }
          if (f + w + x < sco[k]) { sco[k] = f + w + x; destS[k] = { stop: T, mode: 'foot', walk: w }; }
        }
      }
    }
  }

  // ── rekonštrukcia cesty ───────────────────────────────────────────
  function rideLeg(tr, bPos, aPos) {
    const p = D.patterns[day.tPi[tr]], t = p.trips[day.tTi[tr]].t, sh = day.tO[tr] * DAY;
    return { type: 'ride', pattern: day.tPi[tr], tripIdx: day.tTi[tr], day: day.tO[tr], route: p.r, from: p.stops[bPos], to: p.stops[aPos], dep: t[2 * bPos + 1] + sh, arr: t[2 * aPos] + sh, boardPos: bPos, alightPos: aPos };
  }
  function arriveRide(k, s, legs) {
    const i = PC[k][s];
    let tr = cTrip[i], aPos = cPos[i] + 1, kk = k;
    for (let guard = 0; guard < 20; guard++) {
      const b = BC[kk][tr];
      if (b !== -1 && cPos[b] < aPos) {
        // bežný nástup pred miestom výstupu
        legs.unshift(rideLeg(tr, cPos[b], aPos));
        return boardAt(kk - 1, cFrom[b], cDep[b], legs);
      }
      const prev = SF[kk][tr];
      if (prev === -1) throw new Error('oracle: stratený rodič jazdy');
      legs.unshift(rideLeg(tr, 0, aPos));
      legs.unshift({ type: 'stay' });
      tr = prev; aPos = D.patterns[day.tPi[tr]].stops.length - 1;
      if (stayRound) kk--;
    }
    throw new Error('oracle: cyklus v zostaň sedieť');
  }
  function boardAt(j, u, tdep, legs) {
    if (R[0][u] <= tdep) return legs; // východisko
    if (F[0][u] <= tdep) { const v = FF[0][u]; legs.unshift({ type: 'walk', from: v, to: u, secs: F[0][u] - R[0][v], dep: R[0][v], arr: F[0][u] }); return legs; }
    for (let q = 1; q <= j; q++) {
      if (R[q][u] + minChange <= tdep) return arriveRide(q, u, legs);
      if (F[q][u] <= tdep) { const v = FF[q][u]; legs.unshift({ type: 'walk', from: v, to: u, secs: F[q][u] - R[q][v], dep: R[q][v], arr: F[q][u] }); return arriveRide(q, v, legs); }
    }
    throw new Error('oracle: nástup bez rodiča');
  }
  function journey(k, which = 'tru') {
    const dd = which === 'tru' ? dest[k] : destS[k];
    if (!dd) return null;
    const legs = [];
    if (dd.mode === 'foot') {
      const v = FF[k][dd.stop];
      legs.unshift({ type: 'walk', from: v, to: dd.stop, secs: F[k][dd.stop] - R[k][v], dep: R[k][v], arr: F[k][dd.stop] });
      arriveRide(k, v, legs);
    } else arriveRide(k, dd.stop, legs);
    const rides = legs.filter((l) => l.type === 'ride'), stays = legs.filter((l) => l.type === 'stay').length;
    const first = legs[0];
    const startStop = first.from;
    const w0 = fromStops.get(startStop) ?? 0;
    const leave = rides[0].dep - (first.type === 'walk' ? first.secs : 0) - w0;
    const walkLegs = legs.reduce((a, l) => a + (l.type === 'walk' ? l.secs : 0), 0);
    return {
      arrTime: (dd.mode === 'ride' ? R[k][dd.stop] : F[k][dd.stop]) + dd.walk,
      score: (dd.mode === 'ride' ? R[k][dd.stop] : F[k][dd.stop]) + dd.walk + (extra?.get(dd.stop) || 0),
      finalWalk: dd.walk, lastStop: dd.stop, leave, rides: rides.length, stays, transfers: rides.length - 1 - stays,
      totalWalk: w0 + walkLegs + dd.walk, legs,
    };
  }
  return { K, tru, sco, dest, destS, journey, R, F, B };
}

export const hms = (s) => (s === Infinity || s == null ? '—' : `${Math.floor(s / 3600)}:${String(Math.floor((s % 3600) / 60)).padStart(2, '0')}${s % 60 ? ':' + String(Math.round(s % 60)).padStart(2, '0') : ''}`);
export function describeO(j) {
  if (!j) return '—';
  const legs = j.legs.map((l) => l.type === 'ride' ? `${D.routes[l.route].s} ${D.stops[l.from].n} ${hms(l.dep)}→${D.stops[l.to].n} ${hms(l.arr)}`
    : l.type === 'stay' ? 'zostaň sedieť' : `pešo ${D.stops[l.from].n}→${D.stops[l.to].n} ${Math.round(l.secs / 60)}′`);
  return `odchod ${hms(j.leave)} príchod ${hms(j.arrTime)} prestupy ${j.transfers} chôdza ${Math.round(j.totalWalk / 60)}′ [${legs.join(' | ')}]${j.finalWalk ? ` + pešo do cieľa ${Math.round(j.finalWalk / 60)}′ z ${D.stops[j.lastStop].n}` : ''}`;
}

// ── nezávislý validátor spojení appky (M6) ────────────────────────────
const footSecs = (a, b) => basePairs.get(a < b ? a + '_' + b : b + '_' + a);
const linkSet = new Set((D.links || []).map((l) => l.join('|')));
/** vráti zoznam porušení (prázdny = spojenie je platné) */
export function validateJourney(j, dateStr, depTime, fromStops, toStops) {
  const v = [];
  const legs = j.legs;
  if (!legs || !legs.length) return ['bez úsekov'];
  const matched = legs.map(() => null);
  legs.forEach((l, i) => {
    if (l.type === 'ride') {
      const p = D.patterns[l.pattern];
      if (!p) { v.push(`úsek ${i}: neznámy pattern`); return; }
      if (p.r !== l.route) v.push(`úsek ${i}: linka nesedí s patternom`);
      if (p.stops[l.boardPos] !== l.from || p.stops[l.alightPos] !== l.to) v.push(`úsek ${i}: nástup/výstup nesedí s patternom`);
      if (!(l.boardPos < l.alightPos)) v.push(`úsek ${i}: boardPos >= alightPos`);
      const sl = p.stops.slice(l.boardPos, l.alightPos + 1);
      if (sl.length !== l.stops.length || sl.some((s, q) => s !== l.stops[q])) v.push(`úsek ${i}: zoznam zastávok nesedí`);
      if (l.times.length !== 2 * sl.length) v.push(`úsek ${i}: dĺžka times`);
      if (l.dep !== l.times[1] || l.arr !== l.times[l.times.length - 2]) v.push(`úsek ${i}: dep/arr nesedí s times`);
      const { num, wd } = dateParts(dateStr, l.day);
      const sh = l.day * DAY;
      const ok = [];
      p.trips.forEach((tr, ti) => {
        if (!svcActive(D.services[tr.sv], num, wd)) return;
        for (let pos = l.boardPos, q = 0; pos <= l.alightPos; pos++, q += 2) if (tr.t[2 * pos] + sh !== l.times[q] || tr.t[2 * pos + 1] + sh !== l.times[q + 1]) return;
        ok.push(ti);
      });
      if (!ok.length) v.push(`úsek ${i}: v datasete nie je aktívny spoj s týmito časmi (pattern ${l.pattern}, deň ${l.day})`);
      matched[i] = ok;
    } else if (l.type === 'walk') {
      const s = footSecs(l.from, l.to);
      if (s === undefined) v.push(`úsek ${i}: peší prestup ${l.from}→${l.to} nie je v datasete`);
      else if (s !== l.secs) v.push(`úsek ${i}: peší prestup má ${l.secs}s, dataset ${s}s`);
      if (Math.abs((l.arr - l.dep) - l.secs) > 1e-6) v.push(`úsek ${i}: walk arr-dep != secs`);
      if (i > 0 && legs[i - 1].type === 'walk') v.push(`úsek ${i}: dva pešie úseky za sebou`);
    } else if (l.type === 'stay') {
      const a = legs[i - 1], b = legs[i + 1];
      if (!a || !b || a.type !== 'ride' || b.type !== 'ride') { v.push(`úsek ${i}: stay bez jázd okolo`); return; }
      if (a.alightPos !== D.patterns[a.pattern].stops.length - 1) v.push(`úsek ${i}: stay nie z konečnej`);
      if (b.boardPos !== 0) v.push(`úsek ${i}: stay nie od začiatku nadväzujúceho spoja`);
      if (a.day !== b.day) v.push(`úsek ${i}: stay medzi rôznymi dňami`);
    } else v.push(`úsek ${i}: neznámy typ ${l.type}`);
  });
  // „zostaň sedieť“ musí byť skutočná väzba v D.links
  legs.forEach((l, i) => {
    if (l.type !== 'stay') return;
    const a = legs[i - 1], b = legs[i + 1];
    if (!matched[i - 1] || !matched[i + 1]) return;
    if (!matched[i - 1].some((ta) => matched[i + 1].some((tb) => linkSet.has([a.pattern, ta, b.pattern, tb].join('|'))))) v.push(`úsek ${i}: väzba „zostaň sedieť“ nie je v D.links`);
  });
  // nadväznosť a stihnuteľnosť
  for (let i = 0; i + 1 < legs.length; i++) {
    const a = legs[i], b = legs[i + 1];
    if (a.type === 'stay' || b.type === 'stay') { if (b.type === 'stay' && a.arr > legs[i + 2]?.dep) v.push(`úsek ${i}: po stay odchod skôr ako príchod`); continue; }
    if (a.to !== b.from) v.push(`úseky ${i}/${i + 1}: nenadväzujú (${a.to} ≠ ${b.from})`);
    if (a.arr > b.dep) v.push(`úseky ${i}/${i + 1}: príchod ${a.arr} > odchod ${b.dep}`);
  }
  const first = legs[0], last = legs[legs.length - 1];
  if (!fromStops.has(first.from)) v.push('začiatok nie je vo východiskových zastávkach');
  else if (first.dep < depTime + fromStops.get(first.from)) v.push(`odchod ${first.dep} pred zadaným časom ${depTime} (+chôdza)`);
  if (!toStops.has(last.to)) v.push('koniec nie je v cieľových zastávkach');
  else {
    const w = toStops.get(last.to);
    if (j.finalWalk !== w) v.push(`finalWalk ${j.finalWalk} ≠ ${w}`);
    if (j.arrTime !== last.arr + w) v.push(`arrTime ${j.arrTime} ≠ posledný úsek ${last.arr} + chôdza ${w}`);
    if (last.type === 'walk' && toStops.extra?.has(last.to)) v.push('končí pešo na okolitej zastávke (appka to sama zakazuje)');
  }
  if (j.depTime !== first.dep) v.push('depTime ≠ odchod prvého úseku');
  const rides = legs.filter((l) => l.type === 'ride').length, stays = legs.filter((l) => l.type === 'stay').length;
  if (j.transfers !== rides - 1 - stays) v.push(`transfers ${j.transfers} ≠ jazdy-1-stay ${rides - 1 - stays}`);
  // pozn.: príchod neskôr ako zadaný čas + 20 h nie je porušenie — planJourneys opakuje query s neskorším časom
  return v;
}
