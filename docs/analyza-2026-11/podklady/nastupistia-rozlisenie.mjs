// Čím sa dá odlíšiť správne nástupište od iného s rovnakým menom (kapitola 5.5 analýzy).
// Spustenie z koreňa repozitára:  node docs/analyza-2026-11/podklady/nastupistia-rozlisenie.mjs
// Číta len mhd-app/data/dataset.json (cez harness.mjs). Nič nezapisuje.
import { D, haversine } from './harness.mjs';
const S = D.stops, line = (r) => D.routes[r].s;
const angDiff = (a, b) => { const d = Math.abs(a - b) % 360; return d > 180 ? 360 - d : d; };
const pct = (n, d) => (100 * n / d).toFixed(1).replace('.', ',') + ' %';

// nástupištia, z ktorých niečo odchádza (D.stopDirs[i] = [[linka, smer, azimut odchodu], …]), zoskupené podľa mena
const byName = new Map();
S.forEach((s, i) => { if (!D.stopDirs[i] || !D.stopDirs[i].length) return; if (!byName.has(s.n)) byName.set(s.n, []); byName.get(s.n).push(i); });
const plat = [...byName.values()].flat();
const dist = (i, j) => haversine(S[i].la, S[i].lo, S[j].la, S[j].lo);
console.log(`nástupíšť s odchodmi ${plat.length}, mien zastávok ${byName.size} (všetkých bodov v dátach ${S.length})`);

const nearest = plat.map((i) => Math.min(Infinity, ...byName.get(S[i].n).filter((j) => j !== i).map((j) => dist(i, j))));
console.log('má ďalšie nástupište s rovnakým menom:', pct(nearest.filter(isFinite).length, plat.length),
  '| do 30 m', pct(nearest.filter((x) => x <= 30).length, plat.length), '| do 60 m', pct(nearest.filter((x) => x <= 60).length, plat.length),
  '| do 100 m', pct(nearest.filter((x) => x <= 100).length, plat.length));

// každý nástup = nástupište × linka × azimut odchodu
const R = 150, GPS = 60;
const c = { jedine: 0, cislo: 0, smer: 0, nerozlisi: 0 }; let n = 0, pyta = 0, celkomOpacne = 0; const tazke = new Set();
for (const i of plat) {
  const seen = new Set();
  for (const [r, , b] of D.stopDirs[i]) {
    const k = line(r) + '|' + b; if (seen.has(k)) continue; seen.add(k); n++;
    const sib = byName.get(S[i].n).filter((j) => j !== i && dist(i, j) <= R);
    if (!sib.length) { c.jedine++; continue; }
    const same = sib.filter((j) => D.stopDirs[j].some(([r2]) => line(r2) === line(r)));
    let t;
    if (!same.length) t = 'cislo';                                   // druhé nástupište túto linku nemá
    else if (same.every((j) => D.stopDirs[j].filter(([r2]) => line(r2) === line(r)).every(([, , b2]) => angDiff(b, b2) > 90))) { t = 'smer'; // linka tam ide opačne
      if (same.every((j) => D.stopDirs[j].filter(([r2]) => line(r2) === line(r)).every(([, , b2]) => angDiff(b, b2) >= 135))) celkomOpacne++; }
    else { t = 'nerozlisi'; tazke.add(S[i].n); }
    c[t]++;
    if (t !== 'nerozlisi' && Math.min(...sib.map((j) => dist(i, j))) < GPS) pyta++; // otázka má zmysel len pri čísle alebo smere
  }
}
console.log(`\nnástupov (nástupište × linka × smer): ${n}; druhé nástupište sa berie do ${R} m`);
console.log('  iné s rovnakým menom nie je do 150 m: ', c.jedine, pct(c.jedine, n));
console.log('  druhé nástupište linku nemá (číslo):  ', c.cislo, pct(c.cislo, n));
console.log('  linka ide z druhého opačným smerom:   ', c.smer, pct(c.smer, n), `(rozdiel smeru > 90°; z toho aspoň 135°: ${celkomOpacne}, ${pct(celkomOpacne, n)})`);
console.log('  z týchto údajov sa nedá rozlíšiť:     ', c.nerozlisi, pct(c.nerozlisi, n), `(${tazke.size} zastávok: ${[...tazke].join(', ')})`);
console.log(`  iné nástupište bližšie než ${GPS} m, takže poloha nestačí a appka sa pýta:`, pyta, pct(pyta, n));

// ── „nedá sa rozlíšiť“: pomôže názov nasledujúcej zastávky tej istej linky? ──
const nextOf = new Map(); // "nástupište|linka" → množina mien nasledujúcich zastávok
for (const p of D.patterns) p.stops.forEach((si, k) => { if (k === p.stops.length - 1) return; const key = si + '|' + line(p.r); if (!nextOf.has(key)) nextOf.set(key, new Set()); nextOf.get(key).add(S[p.stops[k + 1]].n); });
let hard = 0, byNext = 0;
for (const i of plat) {
  const seen = new Set();
  for (const [r, , b] of D.stopDirs[i]) {
    const k = line(r) + '|' + b; if (seen.has(k)) continue; seen.add(k);
    const conf = byName.get(S[i].n).filter((j) => j !== i && dist(i, j) <= R && D.stopDirs[j].some(([r2, , b2]) => line(r2) === line(r) && angDiff(b, b2) <= 90));
    if (!conf.length) continue;
    hard++;
    const mine = nextOf.get(i + '|' + line(r)) || new Set();
    if (conf.every((j) => [...(nextOf.get(j + '|' + line(r)) || [])].every((n2) => !mine.has(n2)))) byNext++;
  }
}
console.log(`\n„nedá sa rozlíšiť“: ${hard} nástupov, z toho ${byNext} (${pct(byNext, hard)}) rozlíši názov nasledujúcej zastávky; vo zvyšných ${hard - byNext} ide linka z oboch nástupíšť na tú istú zastávku`);

// ── názov ulice pri nástupišti (offline mapa appky) ──
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('../../../', import.meta.url));
const MB = JSON.parse(readFileSync(root + 'mhd-app/data/mapbase.json', 'utf8'));
const KX = 111320 * Math.cos(49 * Math.PI / 180), KY = 110540;
const dec = (arr) => { const out = []; let a = 0, o = 0; for (let i = 0; i < arr.length; i += 2) { a += arr[i]; o += arr[i + 1]; out.push([a / 1e5, o / 1e5]); } return out; };
const named = MB.s.filter(([, nm]) => nm >= 0).map(([, nm, e]) => ({ name: MB.n[nm], pts: dec(e) }));
function segDist(px, py, ax, ay, bx, by) { const dx = bx - ax, dy = by - ay, L2 = dx * dx + dy * dy; let t = L2 ? ((px - ax) * dx + (py - ay) * dy) / L2 : 0; t = Math.max(0, Math.min(1, t)); return Math.hypot(px - ax - t * dx, py - ay - t * dy); }
function streetOf(i) { // najbližšia pomenovaná ulica do 25 m, ak druhá nie je takmer rovnako blízko (do +10 m)
  const s = S[i], m = new Map();
  for (const st of named) { let best = Infinity; for (let k = 1; k < st.pts.length; k++) { const d = segDist(0, 0, (st.pts[k - 1][1] - s.lo) * KX, (st.pts[k - 1][0] - s.la) * KY, (st.pts[k][1] - s.lo) * KX, (st.pts[k][0] - s.la) * KY); if (d < best) best = d; } if (best < (m.get(st.name) ?? Infinity)) m.set(st.name, best); }
  const a = [...m].sort((x, y) => x[1] - y[1]);
  return a[0] && a[0][1] <= 25 && !(a[1] && a[1][1] - a[0][1] < 10) ? a[0][0] : null;
}
const withStreet = plat.filter((i) => streetOf(i));
console.log(`\nnázov ulice sa dá uviesť pri ${withStreet.length} z ${plat.length} nástupíšť (${pct(withStreet.length, plat.length)}); z nich sa zastávka volá inak ako ulica: ${pct(withStreet.filter((i) => !S[i].n.replace(/ \*$/, '').toLowerCase().includes(streetOf(i).toLowerCase())).length, withStreet.length)}`);

// ── orientačný bod, ktorý spozná aj dieťa, do 60 m (body z OpenStreetMap v data/osm-places/pois.json) ──
const pf = root + 'data/osm-places/pois.json';
if (existsSync(pf)) {
  const good = (g) => { // len veľké a označené miesta; drobné prevádzky sa nepočítajú
    const a = g.amenity, sh = g.shop, t = g.tourism, l = g.leisure, b = g.building;
    if (g.public_transport || g.highway === 'bus_stop') return false;
    if (g.place) return g.place === 'square';
    return /^(place_of_worship|monastery|hospital|pharmacy|school|university|college|kindergarten|post_office|bank|fuel|townhall|police|fire_station|library|theatre|cinema|bus_station|marketplace|grave_yard|swimming_pool)$/.test(a || '')
      || /^(church|cathedral|chapel|hospital|school|university|train_station)$/.test(b || '') || g.healthcare === 'hospital' || g.healthcare === 'pharmacy'
      || t === 'museum' || t === 'gallery' || g.railway === 'station' || g.railway === 'halt' || g.landuse === 'cemetery'
      || /^(mall|department_store|supermarket|hypermarket)$/.test(sh || '') || ((sh === 'convenience' || a === 'fast_food') && !!g.brand)
      || /^(park|stadium|water_park|swimming_pool)$/.test(l || '');
  };
  const lm = JSON.parse(readFileSync(pf, 'utf8')).filter((e) => e.la != null && ((e.g || {})['name:sk'] || (e.g || {}).name || '').trim() && good(e.g || {}));
  const near = plat.filter((i) => lm.some((e) => haversine(S[i].la, S[i].lo, e.la, e.lo) <= 60));
  console.log(`orientačný bod do 60 m má ${near.length} z ${plat.length} nástupíšť (${pct(near.length, plat.length)})`);
}

// ── predpoklad otázky „Postav sa tvárou k ceste. Kam ukazuje šípka?“ ──
// Jazdí sa vpravo, takže nástupište má ležať vpravo od osi ulice v smere odchodu autobusu; kto pri ňom stojí tvárou k ceste,
// tomu autobus odchádza doprava. Koľko nástupíšť v dátach to spĺňa? (ulica do 25 m, smer odchodu do 75° od jej osi, aspoň 1 m od osi)
{
  const ROAD = new Set(['m', 'p', 's', 't', 'r']);
  const roads = MB.s.filter(([c]) => ROAD.has(c)).map(([, , e]) => dec(e));
  let vpravo = 0, vlavo = 0, bez = 0; const seen = new Set();
  for (const i of plat) for (const [, , b] of D.stopDirs[i]) {
    const key = i + '|' + b; if (seen.has(key)) continue; seen.add(key);
    const s = S[i]; let best = null;
    for (const pts of roads) for (let k = 1; k < pts.length; k++) {
      const ax = (pts[k - 1][1] - s.lo) * KX, ay = (pts[k - 1][0] - s.la) * KY, bx = (pts[k][1] - s.lo) * KX, by = (pts[k][0] - s.la) * KY;
      const dx = bx - ax, dy = by - ay, L2 = dx * dx + dy * dy; if (L2 < 64) continue;
      let t = (-ax * dx - ay * dy) / L2; t = Math.max(0, Math.min(1, t));
      const px = ax + t * dx, py = ay + t * dy, dd = Math.hypot(px, py);
      if (!best || dd < best.d) best = { d: dd, px, py, axis: (Math.atan2(dx, dy) * 180 / Math.PI + 360) % 360 };
    }
    if (!best || best.d > 25 || best.d < 1) { bez++; continue; }
    const dir = [best.axis, (best.axis + 180) % 360].sort((x, y) => angDiff(x, b) - angDiff(y, b))[0];
    if (angDiff(dir, b) > 75) { bez++; continue; }
    const ux = Math.sin(dir * Math.PI / 180), uy = Math.cos(dir * Math.PI / 180);
    if (ux * -best.py - uy * -best.px < 0) vpravo++; else vlavo++;
  }
  console.log(`\nnástupište leží vpravo od osi ulice v smere odchodu: ${vpravo} z ${vpravo + vlavo} merateľných (${pct(vpravo, vpravo + vlavo)}); nemerateľných ${bez}`);
}
