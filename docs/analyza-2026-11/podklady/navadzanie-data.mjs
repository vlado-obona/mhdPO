// Skutočné dáta pre obrazovky „navádzanie pešo“ v ukážke jednoduchého režimu (konštanta NAV v jednoduchy-rezim-ukazka.html).
// Spustenie z koreňa repozitára:  node docs/analyza-2026-11/podklady/navadzanie-data.mjs [výstup.json]
// Zdroj: plánovanie appky v1.7.3 (harness.mjs), mhd-app/data/dataset.json a offline mapa mhd-app/data/mapbase.json
// (ulice a plochy z OpenStreetMap, © prispievatelia OpenStreetMap, ODbL). Nič v appke nemení.
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { D, appSearch, group, point, describe, haversine, hms } from './harness.mjs';
const MB = JSON.parse(readFileSync(fileURLToPath(new URL('../../../mhd-app/data/mapbase.json', import.meta.url)), 'utf8'));
const S = D.stops, RT = (r) => D.routes[r].s;
const DATE = '2026-11-12';
const g = group('Sibírska');
const origin = point(g.lat + 0.0009, g.lon + 0.0006, 'Štart'); // bod asi 95 m od nástupišťa Sibírska

// lokálna projekcia v metroch (rovnaké konštanty ako scripts/mhd/mapbase.mjs)
const KX = 111320 * Math.cos(49 * Math.PI / 180), KY = 110540;
const toXY = (la, lo, o) => [(lo - o[1]) * KX, (la - o[0]) * KY];
function bearing(la1, lo1, la2, lo2) {
  const r = Math.PI / 180, dLon = (lo2 - lo1) * r, y = Math.sin(dLon) * Math.cos(la2 * r);
  const x = Math.cos(la1 * r) * Math.sin(la2 * r) - Math.sin(la1 * r) * Math.cos(la2 * r) * Math.cos(dLon);
  return (Math.atan2(y, x) * 180 / Math.PI + 360) % 360;
}
const dec = (arr) => { const out = []; let a = 0, o = 0; for (let i = 0; i < arr.length; i += 2) { a += arr[i]; o += arr[i + 1]; out.push([a / 1e5, o / 1e5]); } return out; };
const streets = MB.s.map(([c, n, e]) => ({ c, name: n >= 0 ? MB.n[n] : null, pts: dec(e) }));
const ways = MB.w.map(([c, n, e]) => ({ c, name: n >= 0 ? MB.n[n] : null, pts: dec(e) }));
const areas = MB.a.map(([c, ...rs]) => ({ c, rings: rs.map(dec) }));
function segDist(px, py, ax, ay, bx, by) { const dx = bx - ax, dy = by - ay, L2 = dx * dx + dy * dy; let t = L2 ? ((px - ax) * dx + (py - ay) * dy) / L2 : 0; t = Math.max(0, Math.min(1, t)); return Math.hypot(px - ax - t * dx, py - ay - t * dy); }
function polyDist(la, lo, pts) { const o = [la, lo]; let best = Infinity; for (let i = 1; i < pts.length; i++) { const [ax, ay] = toXY(pts[i - 1][0], pts[i - 1][1], o), [bx, by] = toXY(pts[i][0], pts[i][1], o); const d = segDist(0, 0, ax, ay, bx, by); if (d < best) best = d; } return best; }

const named = streets.filter((s) => s.name);
const clean = (n) => n.replace(/ \*$/, '');
function dirsOf(i) { const m = new Map(); for (const [r, , b] of D.stopDirs[i]) { const x = m.get(b) || { b, lines: new Set() }; x.lines.add(RT(r)); m.set(b, x); } return [...m.values()].map((x) => ({ b: x.b, lines: [...x.lines] })); }
const linesOf = (i) => [...new Set(D.stopDirs[i].map(([r]) => RT(r)))].sort((a, b) => (parseInt(a) || 999) - (parseInt(b) || 999) || a.localeCompare(b));
// ulica pri nástupišti: najbližšia pomenovaná do 25 m, ak druhá najbližšia nie je takmer rovnako blízko
function nearestStreet(i) { const s = S[i]; const m = new Map(); for (const st of named) { const d = polyDist(s.la, s.lo, st.pts); if (d < (m.get(st.name) ?? Infinity)) m.set(st.name, d); } const a = [...m].sort((x, y) => x[1] - y[1]); return a[0] && a[0][1] <= 25 && !(a[1] && a[1][1] - a[0][1] < 10) ? a[0][0] : null; }
const angDiff = (a, b) => { const d = Math.abs(a - b) % 360; return d > 180 ? 360 - d : d; };
function sibs(i, leg) { // ďalšie nástupištia s rovnakým menom
  const sd = D.stopDirs[i].find(([r, h]) => r === leg.route && h === leg.head); const myB = sd ? sd[2] : null;
  return S.map((_, j) => j).filter((j) => j !== i && S[j].n === S[i].n && D.stopDirs[j].length).map((j) => {
    const ds = dirsOf(j); const hasLine = ds.some((d) => d.lines.includes(RT(leg.route)));
    const sameDir = ds.some((d) => myB != null && angDiff(d.b, myB) <= 90);
    return { idx: j, dist: Math.round(haversine(S[i].la, S[i].lo, S[j].la, S[j].lo)), brg: Math.round(bearing(S[i].la, S[i].lo, S[j].la, S[j].lo)), lines: linesOf(j), hasLine, sameDir, lineBearings: ds.filter((d) => d.lines.includes(RT(leg.route))).map((d) => d.b) };
  }).sort((a, b) => a.dist - b.dist);
}
// Čím sa dá správne nástupište odlíšiť od ostatných s rovnakým menom do 150 m (rovnaká logika ako nastupistia-rozlisenie.mjs):
// none = žiadne iné nie je, line = iné nástupištia túto linku nemajú, dir = linka z nich ide opačným smerom (> 90°), ask = z týchto údajov sa nedá
function cueFor(i, leg) {
  const sd = D.stopDirs[i].find(([r, h]) => r === leg.route && h === leg.head); const myB = sd ? sd[2] : null;
  const d = (j) => haversine(S[i].la, S[i].lo, S[j].la, S[j].lo);
  const sib = S.map((_, j) => j).filter((j) => j !== i && S[j].n === S[i].n && D.stopDirs[j].length && d(j) <= 150).sort((a, b) => d(a) - d(b));
  if (!sib.length) return { type: 'none' };
  const same = sib.filter((j) => D.stopDirs[j].some(([r2]) => RT(r2) === RT(leg.route)));
  const type = !same.length ? 'line' : same.every((j) => D.stopDirs[j].filter(([r2]) => RT(r2) === RT(leg.route)).every(([, , b2]) => myB != null && angDiff(myB, b2) > 90)) ? 'dir' : 'ask';
  const ref = (same.length ? same : sib)[0]; // nástupište, s ktorým si ho človek najskôr pomýli
  const p = toXY(S[ref].la, S[ref].lo, [S[i].la, S[i].lo]).map((v) => Math.round(v));
  return { type, dist: Math.round(d(sib[0])), ref: { idx: ref, dist: Math.round(d(ref)), x: p[0], y: p[1] } };
}
// stopDirs je vzdušný azimut k nasledujúcej zastávke. Pre šípku „tadiaľto pôjde autobus“ ho zrovnáme s osou najbližšej ulice
// (do 25 m od nástupišťa); ak sa od nej líši o viac než 75°, necháme pôvodný.
const ROAD = new Set(['m', 'p', 's', 't', 'r']);
function snapBus(i, raw) {
  const s = S[i], o = [s.la, s.lo]; let best = null;
  for (const st of streets) { if (!ROAD.has(st.c)) continue; for (let k = 1; k < st.pts.length; k++) {
    const [ax, ay] = toXY(st.pts[k - 1][0], st.pts[k - 1][1], o), [bx, by] = toXY(st.pts[k][0], st.pts[k][1], o);
    const dd = segDist(0, 0, ax, ay, bx, by); if (Math.hypot(bx - ax, by - ay) >= 8 && (!best || dd < best.d)) best = { d: dd, axis: (Math.atan2(bx - ax, by - ay) * 180 / Math.PI + 360) % 360 }; } }
  if (!best || best.d > 25) return raw;
  const c = [best.axis, (best.axis + 180) % 360].sort((a, b) => angDiff(a, raw) - angDiff(b, raw))[0];
  return angDiff(c, raw) <= 75 ? Math.round(c) : raw;
}
// cesty (nie chodníky ani príjazdy) a vodné toky, ktoré pretína vzdušná čiara štart → cieľ: [[názov, vzdialenosť priesečníka od cieľa v m], …],
// vodný tok má pred názvom „~“. Ulicu samotnej zastávky a okolie 12 m od cieľa vynechávame (zo súradníc sa nedá spoľahlivo určiť,
// na ktorej strane ulice nástupište je), rovnako priesečníky do 3 m od konca úseku (križovatka – nejasné, či ju človek naozaj prejde).
function crossed(fromLat, fromLon, o, skipName) {
  const [ax, ay] = toXY(fromLat, fromLon, o); const out = new Map();
  const inter = (x1, y1, x2, y2, x3, y3, x4, y4) => { const den = (x1 - x2) * (y3 - y4) - (y1 - y2) * (x3 - x4); if (!den) return null; const t = ((x1 - x3) * (y3 - y4) - (y1 - y3) * (x3 - x4)) / den, u = -((x1 - x2) * (y1 - y3) - (y1 - y2) * (x1 - x3)) / den; return t >= 0 && t <= 1 && u >= 0 && u <= 1 ? [x1 + t * (x2 - x1), y1 + t * (y2 - y1)] : null; };
  const put = (nm, d) => { if (!out.has(nm) || d > out.get(nm)) out.set(nm, d); }; // najvzdialenejší priesečník = prvý na ceste
  for (const st of streets) { if (!ROAD.has(st.c)) continue; const xy = st.pts.map((q) => toXY(q[0], q[1], o)); for (let k = 1; k < xy.length; k++) {
    const p = inter(ax, ay, 0, 0, xy[k - 1][0], xy[k - 1][1], xy[k][0], xy[k][1]); if (!p || Math.hypot(p[0], p[1]) < 12 || (st.name && st.name === skipName)) continue;
    if (Math.hypot(p[0] - xy[0][0], p[1] - xy[0][1]) < 3 || Math.hypot(p[0] - xy[xy.length - 1][0], p[1] - xy[xy.length - 1][1]) < 3) continue;
    put(st.name || '', Math.round(Math.hypot(p[0], p[1]))); } }
  for (const w of ways) { const xy = w.pts.map((q) => toXY(q[0], q[1], o)); for (let k = 1; k < xy.length; k++) { // potok alebo rieka v ceste → treba most alebo lávku
    const p = inter(ax, ay, 0, 0, xy[k - 1][0], xy[k - 1][1], xy[k][0], xy[k][1]); if (p) put('~' + (w.name || ''), Math.round(Math.hypot(p[0], p[1]))); } }
  return [...out].sort((x, y) => y[1] - x[1]);
}
function simplifyXY(pts, tol) { if (pts.length <= 2) return pts; const keep = new Uint8Array(pts.length); keep[0] = keep[pts.length - 1] = 1; const st = [[0, pts.length - 1]];
  while (st.length) { const [a, b] = st.pop(); const [ax, ay] = pts[a], [bx, by] = pts[b]; const dx = bx - ax, dy = by - ay, L2 = dx * dx + dy * dy; let md = -1, mi = -1;
    for (let k = a + 1; k < b; k++) { let t = L2 ? ((pts[k][0] - ax) * dx + (pts[k][1] - ay) * dy) / L2 : 0; t = Math.max(0, Math.min(1, t)); const d = Math.hypot(pts[k][0] - ax - t * dx, pts[k][1] - ay - t * dy); if (d > md) { md = d; mi = k; } }
    if (md > tol) { keep[mi] = 1; st.push([a, mi], [mi, b]); } } return pts.filter((_, k) => keep[k]); }
function localMap(o, R) { // o = [lat, lon] cieľa pešieho úseku = počiatok súradníc (x východ, y sever, metre)
  const within = (p, r) => haversine(p[0], p[1], o[0], o[1]) <= r;
  const xy = (p) => toXY(p[0], p[1], o).map((v) => Math.round(v));
  const cut = (pts, r) => { const runs = []; let cur = []; for (let k = 0; k < pts.length; k++) { const inn = within(pts[k], r) || (k > 0 && within(pts[k - 1], r)) || (k < pts.length - 1 && within(pts[k + 1], r)); if (inn) cur.push(xy(pts[k])); else if (cur.length) { runs.push(cur); cur = []; } } if (cur.length) runs.push(cur); return runs.filter((x) => x.length > 1); };
  const st = []; for (const s of streets) for (const run of cut(s.pts, R)) st.push([s.name || '', s.c, simplifyXY(run, 1.5).flat()]);
  const wl = []; for (const w of ways) for (const run of cut(w.pts, R)) wl.push([w.name || '', simplifyXY(run, 2).flat()]);
  const ar = []; for (const a of areas) { const ring = a.rings[0]; if (!ring.some((p) => within(p, R))) continue; ar.push([a.c, simplifyXY(ring.map(xy), 2).flat()]); }
  return { s: st, w: wl, a: ar };
}
function walkTo(leg, fromLat, fromLon, kind) { // pešo na nástupište, z ktorého ide jazda leg
  const i = leg.from, s = S[i], next = leg.stops[leg.stops.indexOf(i) + 1];
  const sd = D.stopDirs[i].find(([r, h]) => r === leg.route && h === leg.head);
  const dist = haversine(fromLat, fromLon, s.la, s.lo);
  const a = toXY(fromLat, fromLon, [s.la, s.lo]).map((v) => Math.round(v));
  const busRaw = sd ? sd[2] : Math.round(bearing(s.la, s.lo, S[next].la, S[next].lo)), street = nearestStreet(i), cue = cueFor(i, leg);
  const across = cue.type === 'dir' && haversine(fromLat, fromLon, S[cue.ref.idx].la, S[cue.ref.idx].lo) < 5; // štartuje z nástupišťa opačného smeru
  return { kind, stop: clean(s.n), idx: i, request: / \*$/.test(s.n), street, dist: Math.round(dist), brg: Math.round(bearing(fromLat, fromLon, s.la, s.lo)), secs: Math.round(dist * 1.2 / 0.9),
    line: RT(leg.route), sign: D.heads[leg.head], dep: hms(leg.dep), bus: snapBus(i, busRaw), busRaw, next: clean(S[next].n), lines: linesOf(i),
    cue, across, cross: crossed(fromLat, fromLon, [s.la, s.lo], street),
    sibs: sibs(i, leg).map((x) => { const p = toXY(S[x.idx].la, S[x.idx].lo, [s.la, s.lo]).map((v) => Math.round(v)); return { ...x, x: p[0], y: p[1] }; }),
    a, o: [s.la, s.lo] };
}
function walkDest(fromIdx, toLat, toLon, name) { // pešo z výstupnej zastávky do cieľa
  const f = S[fromIdx]; const dist = haversine(f.la, f.lo, toLat, toLon); const a = toXY(f.la, f.lo, [toLat, toLon]).map((v) => Math.round(v));
  return { kind: 'dest', name, dist: Math.round(dist), brg: Math.round(bearing(f.la, f.lo, toLat, toLon)), secs: Math.round(dist * 1.2 / 0.9), cross: crossed(f.la, f.lo, [toLat, toLon], null), a, o: [toLat, toLon] };
}
const rides = (j) => j.legs.filter((l) => l.type === 'ride');
function find(dest, sig) { // spoj z ukážky (linka@odchod) medzi kartami, ktoré appka naozaj ponúkne
  for (const t of ['07:10', '07:26']) for (const direct of [false, true]) {
    const r = appSearch(origin, group(dest), DATE, t, { direct });
    const j = r.journeys.find((j) => { const s = rides(j).map((l) => RT(l.route) + '@' + hms(l.dep)); return s.length === sig.length && s.every((x, i) => x === sig[i]); });
    if (j) return { j, text: describe(j, r.fromStops), how: `${t}${direct ? ' priame' : ''}` };
  }
  throw new Error('nenájdené ' + dest + ' ' + sig);
}
const OPTS = { skola: ['Trojica', [['8@7:25'], ['32@7:41']]], lekar: ['Fakultná nemocnica', [['12@7:28'], ['10@7:37']]], babka: ['Solivar', [['8@7:25', '46@7:40'], ['32@7:41', '1@7:57']]], obchod: ['Eperia', [['32A@7:31'], ['38@7:18']]] };
const walks = {}, maps = {}, plan = {}; let n = 0; const seen = new Map();
const key = (w) => JSON.stringify([w.kind, w.idx ?? w.name, w.a, w.line ?? '', w.dep ?? '']);
function add(w) { const k = key(w); if (seen.has(k)) return seen.get(k); const id = 'w' + (n++); const R = Math.max(150, w.dist + 50); const mk = JSON.stringify([w.o, R]); let mid = Object.keys(maps).find((m) => maps[m]._k === mk); if (!mid) { mid = 'm' + Object.keys(maps).length; maps[mid] = { _k: mk, ...localMap(w.o, R) }; } const { o, ...rest } = w; walks[id] = { ...rest, map: mid }; seen.set(k, id); return id; }
for (const [tile, [dest, sigs]] of Object.entries(OPTS)) {
  plan[tile] = [];
  for (const sig of sigs) {
    const { j, text, how } = find(dest, sig); const rs = rides(j); const p = { text, how, nav: [], fin: null };
    rs.forEach((leg, k) => {
      if (k === 0) p.nav.push(add(walkTo(leg, origin.lat, origin.lon, 'stop')));
      else { const prev = rs[k - 1]; p.nav.push(prev.to === leg.from ? null : add(walkTo(leg, S[prev.to].la, S[prev.to].lo, 'change'))); }
    });
    const last = j.legs[j.legs.length - 1];
    if (last.type === 'walk') { const t = S[last.to]; p.fin = add(walkDest(last.from, t.la, t.lo, clean(t.n))); }
    plan[tile].push(p);
  }
}
for (const m of Object.values(maps)) delete m._k;
const json = JSON.stringify({ walks, maps });
if (process.argv[2]) writeFileSync(process.argv[2], json);
console.log(`peších úsekov ${Object.keys(walks).length}, mapiek ${Object.keys(maps).length}, ${json.length} znakov${process.argv[2] ? ' → ' + process.argv[2] : ''}`);
for (const [t, ps] of Object.entries(plan)) for (const p of ps) console.log(t, `(hľadané o ${p.how})`, '|', p.text, '| navádzanie', p.nav.join(', '), p.fin ? '+ do cieľa ' + p.fin : '');
for (const [id, w] of Object.entries(walks)) console.log(id, w.kind, w.stop || w.name, `${w.dist} m, azimut ${w.brg}°`, `pretína: ${w.cross.map(([nm, dd]) => `${nm || '(bez mena)'} ${dd} m od cieľa`).join(', ') || 'nič'}${w.across ? ' + ulicu zastávky (protiľahlé nástupište)' : ''}`, w.kind === 'dest' ? '' : `| linka ${w.line} o ${w.dep}, autobus odchádza ${w.bus}° (vzdušne k ďalšej zastávke ${w.busRaw}°) na ${w.next}, ulica ${w.street}, rozlíšenie: ${w.cue.type}${w.cue.ref ? ` (iné nástupište ${w.cue.ref.dist} m)` : ''}`);
