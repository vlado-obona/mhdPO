// Zostaví offline podklad mapy mhd-app/data/mapbase.json z data/osm-places/
// (ulice, plochy, vodné toky z OpenStreetMap). Appka ním nahrádza online
// dlaždice — mapa tak nerobí žiadne sieťové požiadavky a funguje offline.
//
// Formát (súradnice ×1e5 ako celé čísla, prvý bod absolútne, ďalšie ako rozdiel):
//   { n: [názvy ulíc/tokov], s: [[trieda, názov|-1, [lat,lon,dlat,dlon,…]]],
//     w: [[trieda, názov|-1, [...]]], a: [[trieda, [vonkajší kruh], [diera], …]] }
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const STREET = {
  motorway: 'm', motorway_link: 'm', trunk: 'm', trunk_link: 'm',
  primary: 'p', primary_link: 'p', secondary: 's', secondary_link: 's',
  tertiary: 't', tertiary_link: 't', unclassified: 't',
  residential: 'r', living_street: 'r', service: 'v', services: 'v',
  pedestrian: 'w', footway: 'f', path: 'f', steps: 'f', cycleway: 'f', track: 'f', bridleway: 'f',
};

function areaClass(g) {
  if (g.natural === 'water' || g.waterway === 'riverbank') return 'water';
  if (g.landuse === 'cemetery' || g.amenity === 'grave_yard') return 'cemetery';
  if (g.leisure === 'park' || g.leisure === 'garden') return 'park';
  if (g.leisure === 'pitch' || g.leisure === 'playground') return 'pitch';
  if (g.landuse === 'forest' || g.natural === 'wood' || g.natural === 'scrub') return 'forest';
  if (/^(grass|meadow|recreation_ground|village_green|allotments|orchard)$/.test(g.landuse) || /^(grassland|heath)$/.test(g.natural)) return 'grass';
  return null;
}

// Douglas–Peucker v metroch (lokálna projekcia), tolerancia tol m
const KX = 111320 * Math.cos(49 * Math.PI / 180), KY = 110540;
function simplify(pts, tol) {
  if (pts.length <= 2) return pts;
  const keep = new Uint8Array(pts.length); keep[0] = keep[pts.length - 1] = 1;
  const stack = [[0, pts.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop();
    const ax = pts[a][1] * KX, ay = pts[a][0] * KY, bx = pts[b][1] * KX, by = pts[b][0] * KY;
    const dx = bx - ax, dy = by - ay, L2 = dx * dx + dy * dy;
    let md = -1, mi = -1;
    for (let i = a + 1; i < b; i++) {
      const px = pts[i][1] * KX, py = pts[i][0] * KY;
      let t = L2 ? ((px - ax) * dx + (py - ay) * dy) / L2 : 0; t = Math.max(0, Math.min(1, t));
      const d = Math.hypot(px - ax - t * dx, py - ay - t * dy);
      if (d > md) { md = d; mi = i; }
    }
    if (md > tol) { keep[mi] = 1; stack.push([a, mi], [mi, b]); }
  }
  return pts.filter((_, i) => keep[i]);
}
function enc(pts) {
  const out = []; let pa = 0, po = 0;
  for (const [la, lo] of pts) {
    const a = Math.round(la * 1e5), o = Math.round(lo * 1e5);
    out.push(a - pa, o - po); pa = a; po = o;
  }
  return out;
}
function areaM2(r) {
  let s = 0;
  for (let i = 0, j = r.length - 1; i < r.length; j = i++) s += (r[j][1] * KX) * (r[i][0] * KY) - (r[i][1] * KX) * (r[j][0] * KY);
  return Math.abs(s / 2);
}
function inside(pt, ring) {
  let c = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [yi, xi] = ring[i], [yj, xj] = ring[j];
    if ((yi > pt[0]) !== (yj > pt[0]) && pt[1] < (xj - xi) * (pt[0] - yi) / (yj - yi) + xi) c = !c;
  }
  return c;
}
// spojí úseky multipolygónu do uzavretých kruhov
function rings(parts) {
  const key = (p) => `${p[0]},${p[1]}`;
  const todo = parts.map((p) => p.slice());
  const out = [];
  while (todo.length) {
    let r = todo.shift();
    let guard = 0;
    while (key(r[0]) !== key(r[r.length - 1]) && guard++ < 10000) {
      const end = key(r[r.length - 1]);
      const i = todo.findIndex((p) => key(p[0]) === end || key(p[p.length - 1]) === end);
      if (i < 0) break;
      let p = todo.splice(i, 1)[0];
      if (key(p[0]) !== end) p = p.slice().reverse();
      r = r.concat(p.slice(1));
    }
    if (r.length >= 4) out.push(r);
  }
  return out;
}

export function buildMapbase(dir = 'data/osm-places') {
  const sf = join(dir, 'streets.json'), af = join(dir, 'areas.json');
  if (!existsSync(sf)) return null;
  const names = [], nameIdx = new Map();
  const ni = (n) => { if (!n) return -1; if (!nameIdx.has(n)) { nameIdx.set(n, names.length); names.push(n); } return nameIdx.get(n); };
  const s = [], w = [], a = [];
  const stat = { streets: 0, ways: 0, areas: 0, droppedSmall: 0, points: 0 };

  for (const x of JSON.parse(readFileSync(sf, 'utf8'))) {
    const c = STREET[x.h];
    if (!c || !x.p || x.p.length < 2) continue;
    const p = simplify(x.p, c === 'f' || c === 'v' ? 2 : 1.5);
    s.push([c, ni(x.n), enc(p)]); stat.streets++; stat.points += p.length;
  }
  if (existsSync(af)) {
    for (const x of JSON.parse(readFileSync(af, 'utf8'))) {
      const g = x.g || {};
      if (/^(river|stream|canal)$/.test(g.waterway) && x.p) {
        const p = simplify(x.p, 2);
        w.push([g.waterway === 'river' ? 'R' : 'S', ni(g.name), enc(p)]); stat.ways++; stat.points += p.length;
        continue;
      }
      const c = areaClass(g);
      if (!c) continue;
      let outers = [], inners = [];
      if (x.p) outers = [x.p];
      else if (x.m) {
        outers = rings(x.m.filter((m) => m.r !== 'inner').map((m) => m.p));
        inners = rings(x.m.filter((m) => m.r === 'inner').map((m) => m.p));
      }
      for (const o of outers) {
        if (o.length < 4) continue;
        if (areaM2(o) < (c === 'pitch' ? 80 : 300)) { stat.droppedSmall++; continue; }
        const ro = simplify(o, c === 'forest' || c === 'grass' ? 4 : 2.5);
        if (ro.length < 4) continue;
        const holes = inners.filter((h) => inside(h[0], o) && areaM2(h) >= 300).map((h) => simplify(h, 3)).filter((h) => h.length >= 4);
        a.push([c, enc(ro), ...holes.map(enc)]); stat.areas++;
        stat.points += ro.length + holes.reduce((t, h) => t + h.length, 0);
      }
    }
  }
  // väčšie plochy prvé (menšie sa kreslia navrch), lesy/lúky pod parkami
  const ORDER = { forest: 0, grass: 1, cemetery: 2, park: 3, pitch: 4, water: 5 };
  a.sort((x, y) => ORDER[x[0]] - ORDER[y[0]]);
  return { mapbase: { n: names, s, w, a }, stat };
}
