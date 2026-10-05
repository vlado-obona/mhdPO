// MHD Prešov — plánovač spojení nad oficiálnymi GTFS dátami DPMP.
import { Raptor, planJourneys } from './raptor.js';

// Verzia aplikácie — zobrazuje sa v názve; build-release.mjs a workflowy
// ju kontrolujú, takže nová verzia = zmeniť tu + zavolať build s tým istým číslom.
const APP_VERSION = '1.6.2';

const $ = (id) => document.getElementById(id);
const statusEl = $('status');
const WALK_SPEED = 1.25; // m/s
const WALK_DETOUR = 1.2;  // skutočná pešia trasa je dlhšia ako vzdušná čiara
const POINT_RADIUS = 700; // m — okruh hľadania zastávok od bodu na mape

let D = null;        // dataset
let raptor = null;
let groups = [];     // [{name, norm, stops:[idx], lat, lon}]
let sel = { from: null, to: null };
let map = null, markersLayer = null, journeyLayer = null;

// ── pomocníci ────────────────────────────────────────────────────────
const norm = (s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

function haversine(la1, lo1, la2, lo2) {
  const R = 6371000, r = Math.PI / 180;
  const a = Math.sin((la2 - la1) * r / 2) ** 2 +
    Math.cos(la1 * r) * Math.cos(la2 * r) * Math.sin((lo2 - lo1) * r / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

function bearingTo(la1, lo1, la2, lo2) {
  const r = Math.PI / 180;
  const dLon = (lo2 - lo1) * r;
  const y = Math.sin(dLon) * Math.cos(la2 * r);
  const x = Math.cos(la1 * r) * Math.sin(la2 * r) -
    Math.sin(la1 * r) * Math.cos(la2 * r) * Math.cos(dLon);
  return (Math.atan2(y, x) * 180 / Math.PI + 360) % 360;
}

function offsetPoint(la, lo, brg, meters) {
  const r = Math.PI / 180;
  return [
    la + Math.cos(brg * r) * meters / 111320,
    lo + Math.sin(brg * r) * meters / (111320 * Math.cos(la * r)),
  ];
}

function fmtTime(secs) {
  secs = Math.round(secs);
  const h = Math.floor(secs / 3600) % 24, m = Math.floor((secs % 3600) / 60);
  return `${h}:${String(m).padStart(2, '0')}`;
}
function fmtDur(secs) {
  const m = Math.round(secs / 60);
  return m >= 60 ? `${Math.floor(m / 60)} h ${m % 60} min` : `${m} min`;
}
function fmtDist(m) {
  return m < 1000 ? `${Math.round(m / 10) * 10} m` : `${(m / 1000).toFixed(1)} km`;
}
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

// sekundy od polnoci v Europe/Bratislava
function nowSecsSk() {
  const p = new Intl.DateTimeFormat('sv-SE', {
    timeZone: 'Europe/Bratislava', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
  }).formatToParts(new Date());
  const g = (t) => Number(p.find((x) => x.type === t).value);
  return (g('hour') % 24) * 3600 + g('minute') * 60 + g('second');
}

// aktuálny dátum/čas v Europe/Bratislava (presné aj mimo SR)
function nowInSk() {
  const p = new Intl.DateTimeFormat('sv-SE', {
    timeZone: 'Europe/Bratislava', year: 'numeric', month: '2-digit',
    day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false,
  }).formatToParts(new Date());
  const g = (t) => p.find((x) => x.type === t).value;
  return { date: `${g('year')}-${g('month')}-${g('day')}`, time: `${g('hour')}:${g('minute')}` };
}

function dateInfoFor(dateStr) { // 'YYYY-MM-DD'
  const [y, m, d] = dateStr.split('-').map(Number);
  const mk = (ts) => {
    const dt = new Date(ts);
    return {
      num: dt.getUTCFullYear() * 10000 + (dt.getUTCMonth() + 1) * 100 + dt.getUTCDate(),
      weekday: (dt.getUTCDay() + 6) % 7, // 0 = pondelok
    };
  };
  const base = Date.UTC(y, m - 1, d);
  return { ...mk(base), prev: mk(base - 86400e3), next: mk(base + 86400e3) };
}

function setStatus(msg, err = false) {
  statusEl.textContent = msg;
  statusEl.classList.toggle('err', err);
}

// ── načítanie dát ────────────────────────────────────────────────────
async function loadData() {
  setStatus('Načítavam cestovné poriadky…');
  let v = '';
  try { v = (await (await fetch('data/version.json', { cache: 'no-cache' })).json()).v; } catch {}
  const res = await fetch(`data/dataset.json${v ? `?v=${v}` : ''}`);
  if (!res.ok) throw new Error('Dataset sa nepodarilo načítať');
  D = await res.json();
  raptor = new Raptor(D);

  const byName = new Map();
  D.stops.forEach((s, i) => {
    let g = byName.get(s.n);
    if (!g) byName.set(s.n, (g = { name: s.n, norm: norm(s.n), stops: [], lat: 0, lon: 0 }));
    g.stops.push(i);
  });
  groups = [...byName.values()];
  for (const g of groups) {
    g.lat = g.stops.reduce((a, i) => a + D.stops[i].la, 0) / g.stops.length;
    g.lon = g.stops.reduce((a, i) => a + D.stops[i].lo, 0) / g.stops.length;
  }
  groups.sort((a, b) => a.name.localeCompare(b.name, 'sk'));

  const vf = D.meta.validFrom, vt = D.meta.validTo;
  const f = (n) => `${n % 100}.${Math.floor(n / 100) % 100}.${Math.floor(n / 10000)}`;
  $('dataInfo').textContent = `CP platné ${f(vf)} – ${f(vt)}`;
  $('agencyName').textContent = D.meta.agency;
  setStatus('');
}

// ── miesta a adresy (OpenStreetMap) ─────────────────────────────────
// data/places.json zostavuje build-data.mjs z data/osm-places/ (námestia,
// kostoly, obchody, úrady, školy… a adresy). Načíta sa pri prvom písaní.
let places = null, placesLoading = null;
function loadPlaces() {
  if (!placesLoading) {
    placesLoading = fetch(`data/places.json${D?.meta?.placesV ? `?v=${D.meta.placesV}` : ''}`)
      .then((r) => (r.ok ? r.json() : null)).catch(() => null)
      .then((P) => { places = P ? prepPlaces(P) : null; return places; });
  }
  return placesLoading;
}
function prepPlaces(P) {
  const items = P.p.map(([name, c, la, lo, alt]) => ({
    name, c, la, lo, norm: norm(name), alt: alt ? norm(alt) : '', cat: norm(P.cats[c][0]),
  }));
  const streets = P.a.map(([name, la, lo, nums]) => ({ name, la, lo, nums, norm: norm(name) }));
  return { cats: P.cats, items, streets };
}
// najbližšia zastávka k miestu (podľa vzdušnej čiary)
function nearestStop(la, lo) {
  let best = null, bd = Infinity;
  for (const st of D.stops) {
    const d = haversine(la, lo, st.la, st.lo);
    if (d < bd) { bd = d; best = st; }
  }
  return { name: best.n, d: bd };
}
const wordsOf = (n) => n.split(/[\s,.\-–/()„“"]+/).filter(Boolean);
// skóre zhody: 0 = názov začína dotazom, 1 = všetky slová dotazu sú začiatky
// slov názvu, 2 = názov obsahuje dotaz, 3 = zhoda cez kategóriu (napr. „kostol“)
function matchScore(it, q, toks) {
  if (it.norm.startsWith(q)) return 0;
  const w = wordsOf(it.norm).concat(wordsOf(it.alt));
  if (toks.every((t) => w.some((x) => x.startsWith(t)))) return 1;
  if (it.norm.includes(q) || (it.alt && it.alt.includes(q))) return 2;
  const wc = w.concat(wordsOf(it.cat));
  if (toks.every((t) => wc.some((x) => x.startsWith(t)))) return 3;
  return -1;
}
const NUM_RE = /^\d+[a-z]?(\/\d+[a-z]?)?$/;
function searchPlaces(qRaw, limit) {
  if (!places) return [];
  const q = norm(qRaw.trim()).replace(/\s+/g, ' ');
  if (q.length < 2) return [];
  const toks = q.split(' ');
  const out = [];
  // adresa „ulica číslo“ — číslo môže byť súpisné/orientačné (2894/47) aj len jedno z nich
  const last = toks[toks.length - 1];
  if (toks.length > 1 && NUM_RE.test(last)) {
    const sq = toks.slice(0, -1).join(' ');
    for (const s of places.streets) {
      if (!(s.norm.startsWith(sq) || wordsOf(s.norm).some((x) => x.startsWith(sq)))) continue;
      for (const [hn, la, lo] of s.nums) {
        const h = norm(hn);
        if (h === last || h.split('/').includes(last)) {
          const m = s.name.match(/^(.*) \((.*)\)$/); // „Hlavná (Fintice)“ → „Hlavná 47 (Fintice)“
          out.push({ kind: 'addr', name: m ? `${m[1]} ${hn} (${m[2]})` : `${s.name} ${hn}`, la, lo, score: s.norm.startsWith(sq) ? 0 : 1 });
        }
      }
    }
  }
  for (const s of places.streets) {
    const sc = s.norm.startsWith(q) ? 0 : wordsOf(s.norm).some((x) => x.startsWith(q)) ? 1 : -1;
    if (sc >= 0) out.push({ kind: 'street', name: s.name, la: s.la, lo: s.lo, score: sc + 0.5 });
  }
  for (const it of places.items) {
    const sc = matchScore(it, q, toks);
    if (sc >= 0) out.push({ kind: 'place', name: it.name, la: it.la, lo: it.lo, c: it.c, score: sc });
  }
  out.sort((a, b) => a.score - b.score || a.name.length - b.name.length || a.name.localeCompare(b.name, 'sk'));
  return out.slice(0, limit);
}
function placeMeta(r) {
  if (r.kind === 'addr') return ['🏠', 'adresa'];
  if (r.kind === 'street') return ['🛣️', 'ulica · pre presnosť dopíš číslo domu'];
  const [label, icon] = places.cats[r.c];
  return [icon, label];
}

// ── autocomplete ─────────────────────────────────────────────────────
// zastávky + miesta/adresy; miesto sa plánuje ako bod (pešo na najbližšie zastávky)
function attachSuggest(input, box, onPick) {
  let items = [], active = -1;
  const render = () => {
    box.innerHTML = '';
    items.forEach((it, i) => {
      const b = document.createElement('button');
      b.type = 'button';
      if (it.kind === 'group') {
        b.innerHTML = `🚏 ${esc(it.g.name)} <span class="hint">zastávka · ${it.g.stops.length}× nástupište</span>`;
      } else {
        const [icon, label] = placeMeta(it);
        const ns = nearestStop(it.la, it.lo);
        b.innerHTML = `${icon} ${esc(it.name)} <span class="hint">${esc(label)} · ${fmtDist(ns.d)} od zastávky ${esc(ns.name)}</span>`;
      }
      if (i === active) b.classList.add('active');
      b.addEventListener('mousedown', (e) => { e.preventDefault(); pick(it); });
      box.appendChild(b);
    });
    box.hidden = items.length === 0;
  };
  const pick = (it) => {
    box.hidden = true;
    if (it.kind === 'group') {
      const g = it.g;
      input.value = g.name;
      onPick({ kind: 'group', name: g.name, stops: g.stops, lat: g.lat, lon: g.lon });
    } else {
      input.value = it.name;
      onPick({ kind: 'point', lat: it.la, lon: it.lo, label: it.name });
    }
  };
  const update = () => {
    const raw = input.value.trim();
    const q = norm(raw);
    if (q.length < 1) { items = []; box.hidden = true; return; }
    const starts = groups.filter((g) => g.norm.startsWith(q));
    const contains = groups.filter((g) => !g.norm.startsWith(q) && g.norm.includes(q));
    const st = [...starts, ...contains].map((g) => ({ kind: 'group', g }));
    const pl = searchPlaces(raw, 10);
    // zastávky, ktorých názov začína dotazom, idú prvé; potom miesta
    items = [...st.slice(0, starts.length ? 6 : 4), ...pl].slice(0, 14);
    active = -1;
    render();
  };
  input.addEventListener('input', () => {
    onPick(null);
    update();
    if (!places) loadPlaces().then(() => { if (places && document.activeElement === input) update(); });
  });
  input.addEventListener('focus', () => { loadPlaces(); });
  input.addEventListener('keydown', (e) => {
    if (box.hidden) return;
    if (e.key === 'ArrowDown') { active = Math.min(active + 1, items.length - 1); render(); e.preventDefault(); }
    else if (e.key === 'ArrowUp') { active = Math.max(active - 1, 0); render(); e.preventDefault(); }
    else if (e.key === 'Enter') { if (items[active] || items[0]) pick(items[active] || items[0]); e.preventDefault(); }
    else if (e.key === 'Escape') box.hidden = true;
  });
  input.addEventListener('blur', () => setTimeout(() => { box.hidden = true; }, 150));
}

// ── mapa ─────────────────────────────────────────────────────────────
let basemapLines = null;
function loadBasemap() {
  if (!basemapLines) {
    basemapLines = fetch('data/basemap.json').then((r) => r.ok ? r.json() : null).catch(() => null);
  }
  return basemapLines;
}

// ── offline mapa ─────────────────────────────────────────────────────
// Podklad sa kreslí z dát v appke (OpenStreetMap: ulice, voda, parky, lesy
// + sieť liniek MHD) — žiadne online dlaždice, mapa nerobí sieťové
// požiadavky a funguje bez internetu. Popisy (zastávky, miesta, ulice) sa
// prepočítavajú pri každom posune/priblížení a neprekrývajú sa.
let mapbaseP = null;
function loadMapbase() {
  if (!mapbaseP) {
    mapbaseP = fetch(`data/mapbase.json${D?.meta?.mapbaseV ? `?v=${D.meta.mapbaseV}` : ''}`)
      .then((r) => (r.ok ? r.json() : null)).catch(() => null)
      .then((M) => (M ? prepMapbase(M) : null));
  }
  return mapbaseP;
}
const decLine = (f) => {
  const out = [];
  for (let i = 0, a = 0, o = 0; i < f.length; i += 2) { a += f[i]; o += f[i + 1]; out.push([a / 1e5, o / 1e5]); }
  return out;
};
function lineLen(p) {
  let s = 0;
  for (let i = 1; i < p.length; i++) s += haversine(p[i - 1][0], p[i - 1][1], p[i][0], p[i][1]);
  return s;
}
function prepMapbase(M) {
  const nm = (i) => (i >= 0 ? M.n[i] : '');
  const streets = M.s.map(([c, n, f]) => ({ c, n: nm(n), p: decLine(f) }));
  const waters = M.w.map(([c, n, f]) => ({ c, n: nm(n), p: decLine(f) }));
  const areas = M.a.map(([c, ...rs]) => ({ c, r: rs.map(decLine) }));
  // popis ulice: v polovici jej najdlhšieho úseku
  const best = new Map();
  for (const s of [...streets, ...waters]) {
    if (!s.n || s.c === 'f' || s.c === 'v') continue;
    const L0 = lineLen(s.p);
    const b = best.get(s.n);
    if (!b || L0 > b.L) best.set(s.n, { L: L0, s });
  }
  const streetLabels = [];
  for (const [n, { L: L0, s }] of best) {
    let half = L0 / 2, i = 1;
    for (; i < s.p.length - 1; i++) {
      const d = haversine(s.p[i - 1][0], s.p[i - 1][1], s.p[i][0], s.p[i][1]);
      if (d >= half) break;
      half -= d;
    }
    const a = s.p[i - 1], b = s.p[i];
    streetLabels.push({ n, c: s.c, L: L0, a, b, la: (a[0] + b[0]) / 2, lo: (a[1] + b[1]) / 2 });
  }
  return { streets, waters, areas, streetLabels };
}

const MB_AREA = { forest: '#c5ddb0', grass: '#d6ebc2', park: '#c4e8bc', pitch: '#b3e0cc', cemetery: '#bfd6c0', water: '#a9d3e3' };
// trieda ulice: [farba, šírka pri priblížení 16, od priblíženia]
const MB_ST = {
  m: ['#eda55e', 7, 11], p: ['#f5cd70', 6, 11], s: ['#f8df98', 5.5, 12], t: ['#fff', 5, 12],
  r: ['#fff', 3.6, 13], w: ['#e9e3f0', 4, 14], v: ['#fff', 2.2, 15], f: ['#d9826b', 1.2, 16],
};
const MB_ORDER = ['f', 'v', 'w', 'r', 't', 's', 'p', 'm'];

function addBaseLayers(m) {
  m.getContainer().style.background = 'var(--map-bg)'; // v tmavom režime sa mení
  m.attributionControl.setPrefix(false);
  m.attributionControl.addAttribution('© <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">prispievatelia OpenStreetMap</a>');
  m.createPane('basemap').style.zIndex = 150;
  const lp = m.createPane('maplabels');
  lp.style.zIndex = 450; lp.style.pointerEvents = 'none';
  const renderer = L.canvas({ pane: 'basemap', padding: 0.3 });
  const labelLayer = L.layerGroup().addTo(m);
  Promise.all([loadMapbase(), loadBasemap()]).then(([M, lines]) => {
    const busLines = () => lines && L.layerGroup(lines.map((l) =>
      L.polyline(l, { pane: 'basemap', renderer, color: '#0b7a3b', weight: 2, opacity: 0.35, interactive: false })));
    if (!M) { // bez podkladu aspoň sieť liniek (ako doteraz)
      if (lines) busLines().addTo(m);
      return;
    }
    const opt = { pane: 'basemap', renderer, interactive: false };
    L.layerGroup(M.areas.map((a) =>
      L.polygon(a.r, { ...opt, stroke: false, fillColor: MB_AREA[a.c], fillOpacity: 1 }))).addTo(m);
    const waters = M.waters.map((w) => [w.c, L.polyline(w.p, { ...opt, color: MB_AREA.water, lineCap: 'round' })]);
    L.layerGroup(waters.map(([, l]) => l)).addTo(m);
    const cas = {}, fill = {};
    for (const c of MB_ORDER) cas[c] = L.layerGroup();
    for (const c of MB_ORDER) fill[c] = L.layerGroup();
    for (const s of M.streets) {
      const [col] = MB_ST[s.c];
      if (s.c !== 'f') cas[s.c].addLayer(L.polyline(s.p, { ...opt, color: '#c8c0b0', lineCap: 'round', lineJoin: 'round' }));
      fill[s.c].addLayer(L.polyline(s.p, { ...opt, color: col, lineCap: 'round', lineJoin: 'round', dashArray: s.c === 'f' ? '3 3' : null }));
    }
    const bus = busLines();
    const restyle = () => {
      const z = m.getZoom(), k = Math.min(1.6, Math.max(0.45, 2 ** (z - 16)));
      for (const [c, l] of waters) l.setStyle({ weight: Math.max(1, (c === 'R' ? 7 : 2.5) * k) });
      for (const c of MB_ORDER) {
        const [, w, minZ] = MB_ST[c];
        const on = z >= minZ;
        const wt = Math.max(1, w * k);
        for (const [g, extra] of [[cas[c], 1.6], [fill[c], 0]]) {
          if (on && !m.hasLayer(g)) g.addTo(m);
          if (!on && m.hasLayer(g)) m.removeLayer(g);
          if (on) g.eachLayer((l) => l.setStyle({ weight: c === 'f' ? wt : wt + extra }));
        }
      }
      // poradie: plochy → obrysy ciest → výplne → linky MHD
      for (const c of MB_ORDER) if (m.hasLayer(cas[c])) cas[c].eachLayer((l) => l.bringToFront());
      for (const c of MB_ORDER) if (m.hasLayer(fill[c])) fill[c].eachLayer((l) => l.bringToFront());
      if (bus) { if (!m.hasLayer(bus)) bus.addTo(m); bus.eachLayer((l) => { l.setStyle({ weight: z >= 16 ? 2.5 : 2 }); l.bringToFront(); }); }
    };
    restyle();
    m.on('zoomend', restyle);
    const relabel = () => drawMapLabels(m, M, labelLayer);
    m.on('moveend', relabel);
    relabel();
    loadPlaces().then(relabel);
  });
}

// popisy: dôležitejšie prvé, prekrývajúce sa (aj so zastávkami a šípkami) vynechať
function drawMapLabels(m, M, layer) {
  layer.clearLayers();
  const z = m.getZoom();
  if (z < 13) return;
  const bounds = m.getBounds().pad(0.05);
  const size = m.getSize();
  const placed = [];
  const hit = (r) => placed.some((q) => r.x < q.x + q.w && q.x < r.x + r.w && r.y < q.y + q.h && q.y < r.y + r.h);
  const tw = (t, px) => t.length * px * 0.56 + 6;
  const put = (la, lo, w, h, html, dx = 0, dy = 0, center = true) => {
    const pt = m.latLngToContainerPoint([la, lo]);
    const r = center ? { x: pt.x - w / 2 + dx, y: pt.y - h / 2 + dy, w, h } : { x: pt.x + dx, y: pt.y + dy, w, h };
    if (r.x < 0 || r.y < 0 || r.x + r.w > size.x || r.y + r.h > size.y || hit(r)) return false; // celý popis musí byť vidno
    placed.push(r);
    L.marker([la, lo], {
      pane: 'maplabels', interactive: false, keyboard: false,
      icon: L.divIcon({ className: 'map-lbl', iconSize: [0, 0], html: `<div style="transform:translate(${center ? `calc(-50% + ${dx}px),calc(-50% + ${dy}px)` : `${dx}px,${dy}px`})">${html}</div>` }),
    }).addTo(layer);
    return true;
  };
  // zastávky a ich smerové šípky sú prekážky — popis ich nesmie zakryť
  const vis = [];
  D.stops.forEach((s, i) => { if (bounds.contains([s.la, s.lo])) vis.push(i); });
  for (const i of (z >= 15 ? vis : [])) { // pri malom priblížení by zastávky vytlačili všetky popisy
    const pt = m.latLngToContainerPoint([D.stops[i].la, D.stops[i].lo]);
    placed.push({ x: pt.x - 9, y: pt.y - 9, w: 18, h: 18 });
    const b = stopBearing(i);
    if (b != null) {
      const q = m.latLngToContainerPoint(offsetPoint(D.stops[i].la, D.stops[i].lo, b, 20));
      placed.push({ x: q.x - 9, y: q.y - 9, w: 18, h: 18 });
    }
  }
  // 1) názvy zastávok (raz na skupinu nástupíšť)
  if (z >= 16) {
    const seen = new Set();
    // pri viacerých nástupištiach toho istého mena popísať to bližšie k stredu mapy
    const c = m.getCenter();
    const byCenter = vis.slice().sort((a, b) =>
      haversine(c.lat, c.lng, D.stops[a].la, D.stops[a].lo) - haversine(c.lat, c.lng, D.stops[b].la, D.stops[b].lo));
    for (const i of byCenter) {
      const s = D.stops[i];
      if (seen.has(s.n)) continue;
      const w = tw(s.n, 11), html = `<span class="ml-stop">${esc(s.n)}</span>`;
      // vpravo, vľavo, nad, pod zastávkou — prvé voľné miesto
      for (const [dx, dy] of [[11, -7], [-w - 11, -7], [-w / 2, -25], [-w / 2, 11]]) {
        if (put(s.la, s.lo, w, 14, html, dx, dy, false)) { seen.add(s.n); break; }
      }
    }
  }
  // 2) časti mesta, dôležité miesta
  if (places) {
    const PRI = { 'časť mesta': 0, 'námestie': 1, 'železničná stanica': 1, 'autobusová stanica': 1, 'obchodné centrum': 2, 'nemocnica': 2,
      'kostol': 3, 'vysoká škola': 4, 'divadlo': 4, 'kúpalisko': 4, 'park': 5, 'múzeum': 6, 'úrad': 6, 'škola': 7, 'potraviny': 7 };
    const MINZ = { 'časť mesta': 13, 'železničná stanica': 14, 'autobusová stanica': 14, 'obchodné centrum': 14, 'nemocnica': 14,
      'námestie': 15, 'kostol': 15, 'kúpalisko': 15, 'vysoká škola': 16, 'divadlo': 16, 'park': 16, 'múzeum': 17, 'úrad': 17, 'škola': 17, 'potraviny': 17 };
    const cand = [];
    for (const it of places.items) {
      const [cat, icon] = places.cats[it.c];
      if (!(cat in PRI) || z < MINZ[cat] || !bounds.contains([it.la, it.lo])) continue;
      if (cat === 'časť mesta' && (z >= 16 || /^Prešov \d/.test(it.name))) continue;
      cand.push([PRI[cat], cat, icon, it]);
    }
    cand.sort((a, b) => a[0] - b[0]);
    for (const [, cat, icon, it] of cand) {
      if (cat === 'časť mesta') put(it.la, it.lo, tw(it.name, 13) * 1.2, 16, `<span class="ml-area">${esc(it.name)}</span>`);
      else put(it.la, it.lo, Math.max(24, tw(it.name, 11)), 30, `<span class="ml-poi"><b>${icon}</b>${esc(it.name)}</span>`);
    }
  }
  // 3) názvy ulíc a tokov pozdĺž cesty
  if (z >= 15) {
    const major = (c) => 'mpsRS'.includes(c);
    const sl = M.streetLabels.filter((l) => (z >= 16 || major(l.c)) && bounds.contains([l.la, l.lo]))
      .sort((a, b) => (major(b.c) - major(a.c)) || b.L - a.L);
    for (const l of sl) {
      const a = m.latLngToContainerPoint(l.a), b = m.latLngToContainerPoint(l.b);
      const W = tw(l.n, 11);
      if (l.L * (2 ** (z - 16)) / 1.57 < W * 1.1) continue; // ulica je na popis pri tomto priblížení krátka (1,57 m/px pri z16)
      let ang = Math.atan2(b.y - a.y, b.x - a.x) * 180 / Math.PI;
      if (ang > 90) ang -= 180;
      if (ang < -90) ang += 180;
      const r = ang * Math.PI / 180;
      const w = Math.abs(W * Math.cos(r)) + 12 * Math.abs(Math.sin(r)), h = Math.abs(W * Math.sin(r)) + 12 * Math.abs(Math.cos(r));
      put(l.la, l.lo, w, h, `<span class="ml-street${'RS'.includes(l.c) ? ' ml-water' : ''}" style="transform:rotate(${ang.toFixed(1)}deg)">${esc(l.n)}</span>`);
    }
  }
}

// prevládajúci smer odchodu z nástupišťa (kruhový priemer azimutov spojov)
function stopBearing(si) {
  const dirs = (D.stopDirs && D.stopDirs[si]) || [];
  if (!dirs.length) return null;
  const r = Math.PI / 180;
  let x = 0, y = 0;
  for (const [, , b] of dirs) { x += Math.cos(b * r); y += Math.sin(b * r); }
  return Math.hypot(x, y) > 0.3 ? (Math.atan2(y, x) / r + 360) % 360 : dirs[0][2];
}

function initMap() {
  if (map) return;
  map = L.map('map', { renderer: L.canvas(), zoomControl: true });
  map.setView([48.998, 21.24], 13);
  addBaseLayers(map);
  markersLayer = L.layerGroup().addTo(map);
  journeyLayer = L.layerGroup().addTo(map);
  // pri malom priblížení by sa šípky smeru prekrývali so zastávkami — skryť
  const lowZoom = () => map.getContainer().classList.toggle('z-low', map.getZoom() < 15);
  map.on('zoomend', lowZoom);
  lowZoom();

  // každé nástupište zvlášť (sú na správnej strane cesty) + smerová
  // šípka podľa azimutu odchodu autobusov
  const groupByName = new Map(groups.map((g) => [g.name, g]));
  D.stops.forEach((st, si) => {
    const dirs = (D.stopDirs && D.stopDirs[si]) || [];
    // šípka v smere odchodu autobusov, rovnobežne s cestou — všetky spoje
    // z nástupišťa idú tým istým smerom (kruhový priemer azimutov)
    const brg = stopBearing(si);
    if (brg != null) {
      L.marker(offsetPoint(st.la, st.lo, brg, 20), {
        icon: L.divIcon({
          className: 'stop-dir',
          html: `<span style="transform:rotate(${brg - 90}deg)">➤</span>`,
          iconSize: [18, 18], iconAnchor: [9, 9],
        }),
        interactive: false, keyboard: false,
      }).addTo(markersLayer);
    }
    const mk = L.circleMarker([st.la, st.lo], {
      radius: 6, color: '#0b7a3b', weight: 2, fillColor: '#fff', fillOpacity: .9,
    }).addTo(markersLayer);
    mk.bindPopup(() => {
      const g = groupByName.get(st.n);
      const div = document.createElement('div');
      div.className = 'stop-popup';
      const dirHtml = dirs.length
        ? `<div class="dirs">${dirs.map(([r, h, brg]) =>
            `<div><span class="dir-arrow" style="transform:rotate(${brg - 90}deg)">➤</span>${badge(r)} smer ${h >= 0 ? D.heads[h] : '?'}</div>`).join('')}</div>`
        : '<div class="dirs muted">výstupné nástupište</div>';
      div.innerHTML = `<b>${st.n}</b>${dirHtml}<div class="btns"></div>`;
      const btns = div.querySelector('.btns');
      const mkBtn = (label, cls, cb) => {
        const b = document.createElement('button');
        b.textContent = label; b.className = cls;
        b.addEventListener('click', () => { cb(); map.closePopup(); });
        btns.appendChild(b);
      };
      mkBtn('🚩 Štart', 'b-start', () => setSel('from', { kind: 'group', name: g.name, stops: g.stops, lat: g.lat, lon: g.lon }));
      mkBtn('🏁 Cieľ', 'b-end', () => setSel('to', { kind: 'group', name: g.name, stops: g.stops, lat: g.lat, lon: g.lon }));
      mkBtn('🧭', 'b-nav', () => startNav(st.la, st.lo, st.n));
      mkBtn('🗺️', 'b-gmaps', () => openExternal(gmapsUrl(st.la, st.lo)));
      return div;
    });
  });
  // ťuknutie mimo zastávky = vlastný bod (najbližšie zastávky pešo)
  map.on('click', (e) => {
    const { lat, lng } = e.latlng;
    const div = document.createElement('div');
    div.className = 'stop-popup';
    div.innerHTML = `<b>Vybrané miesto</b><div class="btns"></div>`;
    const btns = div.querySelector('.btns');
    const point = { kind: 'point', lat, lon: lng, label: `Bod ${lat.toFixed(4)}, ${lng.toFixed(4)}` };
    const mkBtn = (label, cls, which) => {
      const b = document.createElement('button');
      b.textContent = label; b.className = cls;
      b.addEventListener('click', () => { setSel(which, point); map.closePopup(); });
      btns.appendChild(b);
    };
    mkBtn('Štart', 'b-start', 'from');
    mkBtn('Cieľ', 'b-end', 'to');
    L.popup().setLatLng(e.latlng).setContent(div).openOn(map);
  });
}

function setSel(which, val) {
  sel[which] = val;
  const input = which === 'from' ? $('fromInput') : $('toInput');
  if (val) input.value = val.kind === 'group' ? val.name : val.label;
}

// ── zostavenie množín zastávok pre query ────────────────────────────
function stopSetFor(s, radius = POINT_RADIUS) {
  const m = new Map();
  if (!s) return m;
  if (s.kind === 'group') {
    for (const i of s.stops) m.set(i, 0);
    // blízke zastávky s iným názvom netreba — rieši ich prestupová relaxácia
  } else {
    const cand = [];
    D.stops.forEach((st, i) => {
      const d = haversine(s.lat, s.lon, st.la, st.lo);
      if (d <= radius) cand.push([i, d]);
    });
    cand.sort((a, b) => a[1] - b[1]);
    for (const [i, d] of cand.slice(0, 8)) m.set(i, Math.round(d * WALK_DETOUR / WALK_SPEED));
  }
  return m;
}

// ── vyhľadanie a vykreslenie ────────────────────────────────────────
function search() {
  if (!D) return;
  if (!sel.from) { setStatus('Vyber východiskovú zastávku.', true); $('fromInput').focus(); return; }
  if (!sel.to) { setStatus('Vyber cieľovú zastávku.', true); $('toInput').focus(); return; }
  let fromStops = stopSetFor(sel.from);
  if (!fromStops.size) fromStops = stopSetFor(sel.from, 1500);
  let toStops = stopSetFor(sel.to);
  if (!toStops.size) toStops = stopSetFor(sel.to, 1500);
  if (!fromStops.size) { setStatus('V okolí zvoleného bodu nie je žiadna zastávka MHD.', true); return; }
  if (!toStops.size) { setStatus('V okolí cieľového bodu nie je žiadna zastávka MHD.', true); return; }

  const dateStr = $('dateInput').value;
  const timeStr = $('timeInput').value || '00:00';
  const di = dateInfoFor(dateStr);
  const ymd = (n) => `${n % 100}. ${Math.floor(n / 100) % 100}. ${Math.floor(n / 10000)}`;
  if (D.meta.validTo && di.num > D.meta.validTo) {
    setStatus(`Cestovné poriadky v tejto verzii appky platia len do ${ymd(D.meta.validTo)} — na neskorší dátum stiahni novšiu verziu.`, true);
    return;
  }
  if (D.meta.validFrom && di.num < D.meta.validFrom) {
    setStatus(`Cestovné poriadky v tejto verzii appky platia od ${ymd(D.meta.validFrom)}.`, true);
    return;
  }
  const [hh, mm] = timeStr.split(':').map(Number);
  const depTime = hh * 3600 + mm * 60;

  setStatus('Hľadám spojenia…');
  setTimeout(() => {
    const t0 = performance.now();
    const journeys = planJourneys(raptor, fromStops, toStops, di, depTime, 4);
    const ms = Math.round(performance.now() - t0);
    renderResults(journeys);
    setStatus(journeys.length ? `Nájdené za ${ms} ms.` : 'Žiadne spojenie sa nenašlo. Skús iný čas alebo zastávky.', !journeys.length);
  }, 20);
}

function badge(routeIdx) {
  const r = D.routes[routeIdx];
  const bg = r.c ? `#${r.c}` : 'var(--green)';
  const fg = r.tc ? `#${r.tc}` : '#fff';
  return `<span class="badge" style="background:${bg};color:${fg}">${r.s}</span>`;
}

function renderResults(journeys) {
  lastJourney = null;
  const wrap = $('results');
  wrap.innerHTML = '';
  wrap.hidden = false;
  if (journeyLayer) journeyLayer.clearLayers();

  journeys.forEach((j, ji) => {
    const card = document.createElement('article');
    card.className = 'journey' + (ji === 0 ? ' open' : '');
    const lines = j.legs.filter((l) => l.type === 'ride').map((l) => badge(l.route)).join('');
    const walkTotal = j.legs.filter((l) => l.type === 'walk').reduce((a, l) => a + l.secs, 0) + j.finalWalk;
    card.innerHTML = `
      <div class="j-head">
        <div>
          <div class="j-times">${fmtTime(j.depTime)} → ${fmtTime(j.arrTime)}</div>
          <div class="j-meta">${fmtDur(j.arrTime - j.depTime)} · ${j.transfers === 0 ? 'bez prestupu' : j.transfers === 1 ? '1 prestup' : `${j.transfers} prestupy`}${walkTotal > 90 ? ` · ${fmtDur(walkTotal)} pešo` : ''}</div>
        </div>
        <div class="j-lines">${lines}</div>
      </div>
      <div class="j-body"></div>`;
    const body = card.querySelector('.j-body');

    let prevArr = null;
    for (const l of j.legs) {
      const div = document.createElement('div');
      div.className = 'leg';
      if (l.type === 'walk') {
        div.innerHTML = `
          <div class="t">${fmtTime(l.dep)}</div>
          <div><span class="badge walk">pešo</span> ${fmtDur(l.secs)} — na zastávku <b>${D.stops[l.to].n}</b></div>`;
      } else if (l.type === 'stay') {
        const nx = j.legs[j.legs.indexOf(l) + 1];
        div.innerHTML = `
          <div class="t">${fmtTime(l.dep)}</div>
          <div><span class="badge walk">🔄</span> <b>zostaň sedieť</b> — autobus pokračuje ako linka ${nx ? badge(nx.route) : ''}</div>`;
      } else {
        const r = D.routes[l.route];
        const head = l.head >= 0 ? D.heads[l.head] : (r.l || '');
        const inner = l.stops.slice(1, -1);
        const wait = prevArr != null && j.legs[j.legs.indexOf(l) - 1]?.type !== 'stay' ? l.dep - prevArr : 0;
        div.innerHTML = `
          <div class="t">${fmtTime(l.dep)}<br><span class="muted">${fmtTime(l.arr)}</span></div>
          <div>
            ${badge(l.route)} <span class="muted">smer ${head}${wait >= 120 ? ` · ⏳ čakanie ${fmtDur(wait)}` : ''}</span><br>
            <b>${D.stops[l.from].n}</b> <button class="nav-to" title="Navigovať na nástupište" data-si="${l.from}">🧭</button> → <b>${D.stops[l.to].n}</b><br>
            ${inner.length ? `<button class="stops-toggle">${inner.length} medziľahlé zastávky ▾</button><ul hidden></ul>` : `<span class="muted">bez medziľahlých zastávok</span>`}
          </div>`;
        const navBtn = div.querySelector('.nav-to');
        if (navBtn) navBtn.addEventListener('click', () => {
          const st = D.stops[+navBtn.dataset.si];
          startNav(st.la, st.lo, st.n);
        });
        const tog = div.querySelector('.stops-toggle');
        if (tog) {
          const ul = div.querySelector('ul');
          tog.addEventListener('click', () => {
            if (ul.hidden) {
              ul.innerHTML = inner.map((si, i2) => `<li>${fmtTime(l.times[2 * (i2 + 1)])} ${D.stops[si].n}</li>`).join('');
            }
            ul.hidden = !ul.hidden;
          });
        }
      }
      prevArr = l.arr;
      body.appendChild(div);
    }
    if (j.finalWalk > 0) {
      const div = document.createElement('div');
      div.className = 'leg';
      div.innerHTML = `
        <div class="t">${fmtTime(j.arrTime - j.finalWalk)}</div>
        <div><span class="badge walk">pešo</span> ${fmtDur(j.finalWalk)} do cieľa${sel.to?.kind === 'point' && !sel.to.label.startsWith('Bod ') ? ` <b>${esc(sel.to.label)}</b>` : ''}</div>`;
      body.appendChild(div);
    }

    card.querySelector('.j-head').addEventListener('click', () => {
      card.classList.toggle('open');
      if (card.classList.contains('open')) drawJourney(j);
    });
    wrap.appendChild(card);
  });
  if (journeys[0]) drawJourney(journeys[0]);
  wrap.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

let lastJourney = null;

// vymaže celé vyhľadávanie — štart, cieľ, výsledky aj trasu na mape
function clearSearch() {
  sel.from = null;
  sel.to = null;
  $('fromInput').value = '';
  $('toInput').value = '';
  $('fromSuggest').hidden = true;
  $('toSuggest').hidden = true;
  const wrap = $('results');
  wrap.innerHTML = '';
  wrap.hidden = true;
  lastJourney = null;
  if (journeyLayer) journeyLayer.clearLayers();
  stopNav();
  const n = nowInSk();
  $('dateInput').value = n.date;
  $('timeInput').value = n.time;
  setStatus('');
  $('fromInput').focus();
}

function drawJourney(j) {
  lastJourney = j;
  if (!map) return;
  journeyLayer.clearLayers();
  const all = [];
  const flag = (latlng, emoji, cls) => L.marker(latlng, {
    icon: L.divIcon({ className: `flag-icon ${cls}`, html: emoji, iconSize: [28, 28], iconAnchor: [5, 24] }),
    interactive: false,
  }).addTo(journeyLayer);
  const coord = (si) => [D.stops[si].la, D.stops[si].lo];

  const rides = j.legs.filter((l) => l.type === 'ride');
  for (const l of j.legs) {
    if (l.type === 'walk') {
      L.polyline([coord(l.from), coord(l.to)], {
        color: '#8a8f8a', weight: 3, dashArray: '4 7', opacity: .9,
      }).addTo(journeyLayer);
      continue;
    }
    if (l.type !== 'ride') continue;
    const pts = l.stops.map(coord);
    all.push(...pts);
    L.polyline(pts, { color: '#0b7a3b', weight: 5, opacity: .85 }).addTo(journeyLayer);
    L.circleMarker(pts[0], { radius: 6, color: '#0b7a3b', fillColor: '#fff', fillOpacity: 1, weight: 3 }).addTo(journeyLayer);
    L.circleMarker(pts[pts.length - 1], { radius: 6, color: '#b3541e', fillColor: '#fff', fillOpacity: 1, weight: 3 }).addTo(journeyLayer);
  }
  // vlajky: štart 🚩, cieľ 🏁, prestupy 🚌
  if (rides.length) {
    flag(coord(j.legs[0].from), '🚩', 'flag-start');
    flag(coord(rides[rides.length - 1].to), '🏁', 'flag-end');
    for (let i = 1; i < rides.length; i++) {
      const before = j.legs[j.legs.indexOf(rides[i]) - 1];
      if (before?.type !== 'stay') flag(coord(rides[i].from), '🚌', 'flag-transfer');
    }
  }
  if (all.length && !$('mapWrap').hidden) map.fitBounds(L.latLngBounds(all).pad(0.2));
}

// ── geolokácia ───────────────────────────────────────────────────────
// V natívnej appke (Capacitor) ide poloha cez natívny plugin — webová
// navigator.geolocation vo WebView nemá ako vypýtať oprávnenie.
async function getPosition() {
  const geo = window.Capacitor?.Plugins?.Geolocation;
  if (geo) {
    const perm = await geo.requestPermissions().catch(() => null);
    if (perm && perm.location === 'denied') throw new Error('bez povolenia');
    const pos = await geo.getCurrentPosition({ enableHighAccuracy: true, timeout: 12000 });
    return { lat: pos.coords.latitude, lon: pos.coords.longitude };
  }
  if (!navigator.geolocation) throw new Error('nedostupná');
  return new Promise((resolve, reject) => navigator.geolocation.getCurrentPosition(
    (p) => resolve({ lat: p.coords.latitude, lon: p.coords.longitude }),
    reject,
    { enableHighAccuracy: true, timeout: 12000 },
  ));
}

// ── aktuálna poloha na mape (modrá bodka + auto-centrovanie) ────────
let posMarker = null, posWatchHandle = null;

function showPosition(la, lo) {
  if (!map) return;
  if (!posMarker) {
    posMarker = L.circleMarker([la, lo], {
      radius: 7, color: '#fff', weight: 2.5, fillColor: '#1a73e8', fillOpacity: 1,
    }).addTo(map);
  } else {
    posMarker.setLatLng([la, lo]);
  }
}

async function autoCenterMap() {
  try {
    const { lat, lon } = await getPosition();
    showPosition(lat, lon);
    // centrovať len keď nie je vykreslená trasa — tú nechceme odsunúť
    if (!lastJourney && map) map.setView([lat, lon], 15);
  } catch {}
  // kým je mapa otvorená, bodka polohy sa priebežne aktualizuje
  if (!posWatchHandle) {
    try {
      posWatchHandle = await watchPos((p) => {
        showPosition(p.coords.latitude, p.coords.longitude);
      });
    } catch {}
  }
}

function stopPosWatch() {
  if (posWatchHandle) { posWatchHandle.clear(); posWatchHandle = null; }
}

async function useGeo() {
  setStatus('Zisťujem polohu…');
  try {
    const { lat, lon } = await getPosition();
    setSel('from', { kind: 'point', lat, lon, label: 'Moja poloha' });
    setStatus('');
    if (map && !$('mapWrap').hidden) map.setView([lat, lon], 15);
  } catch {
    setStatus('Polohu sa nepodarilo zistiť (skontroluj povolenie polohy pre appku).', true);
  }
}

// ── navigačná šípka k zastávke (kompas + GPS, vzdialenosť a odhad) ──
let nav = null;

// pešie navádzanie v Google Maps (otvorí appku / web s trasou k bodu);
// navigate = rovno spustiť navigáciu (inak len náhľad trasy)
function gmapsUrl(lat, lon, navigate = false) {
  return `https://www.google.com/maps/dir/?api=1&destination=${lat},${lon}&travelmode=walking${navigate ? '&dir_action=navigate' : ''}`;
}
function openExternal(url) {
  const a = document.createElement('a');
  a.href = url; a.target = '_blank'; a.rel = 'noopener';
  document.body.appendChild(a); a.click(); a.remove();
}

async function watchPos(cb, onErr) {
  const fail = onErr || (() => { $('navDist').textContent = 'poloha nedostupná — povoľ polohu'; });
  const geo = window.Capacitor?.Plugins?.Geolocation;
  if (geo) {
    await geo.requestPermissions().catch(() => {});
    const id = await geo.watchPosition({ enableHighAccuracy: true }, (pos, err) => {
      if (pos) cb(pos); else if (err) fail(err);
    });
    return { clear: () => geo.clearWatch({ id }) };
  }
  if (!navigator.geolocation) throw new Error('nedostupná');
  const id = navigator.geolocation.watchPosition(cb, fail,
    { enableHighAccuracy: true, maximumAge: 2000 });
  return { clear: () => navigator.geolocation.clearWatch(id) };
}

// ── kompas (zdieľa ho navigačná lišta aj režim cesty) ───────────────
let compassHeading = null, compassOn = false;

function onHeading(e) {
  const h = (e.webkitCompassHeading != null) ? e.webkitCompassHeading
    : (e.alpha != null ? 360 - e.alpha : null);
  if (h == null) return;
  compassHeading = h;
  if (nav) renderNavArrow();
  if (trip) renderTripNav();
}

// musí sa zavolať v používateľskom geste — iOS inak povolenie nevypýta
function compassStart() {
  if (compassOn) return;
  compassOn = true;
  const DOE = window.DeviceOrientationEvent;
  if (DOE && typeof DOE.requestPermission === 'function') {
    DOE.requestPermission().then((s) => {
      if (s === 'granted' && compassOn) window.addEventListener('deviceorientation', onHeading);
    }).catch(() => {});
  } else if (DOE) {
    window.addEventListener('deviceorientationabsolute', onHeading);
    window.addEventListener('deviceorientation', onHeading);
  }
}

function compassStop() {
  if (!compassOn || nav || trip) return;
  compassOn = false;
  compassHeading = null;
  window.removeEventListener('deviceorientation', onHeading);
  window.removeEventListener('deviceorientationabsolute', onHeading);
}

async function startNav(lat, lon, label) {
  stopNav();
  nav = { lat, lon, label, cur: null, watch: null };
  $('navTarget').textContent = label;
  $('navDist').textContent = 'zisťujem polohu…';
  $('navBar').hidden = false;
  compassStart();
  try {
    nav.watch = await watchPos((p) => {
      if (!nav) return;
      nav.cur = { la: p.coords.latitude, lo: p.coords.longitude };
      renderNavArrow();
    });
  } catch {
    $('navDist').textContent = 'geolokácia nie je dostupná';
  }
}

function renderNavArrow() {
  if (!nav || !nav.cur) return;
  const d = haversine(nav.cur.la, nav.cur.lo, nav.lat, nav.lon);
  const brg = bearingTo(nav.cur.la, nav.cur.lo, nav.lat, nav.lon);
  const rot = compassHeading == null ? brg : (brg - compassHeading + 360) % 360;
  $('navArrow').style.transform = `rotate(${rot}deg)`;
  const mins = Math.max(1, Math.round(d * WALK_DETOUR / WALK_SPEED / 60));
  $('navDist').textContent = d < 25
    ? 'si na mieste 🎯'
    : `${fmtDist(d)} · ~${mins} min pešo${compassHeading == null ? ' · šípka voči severu' : ''}`;
}

function stopNav() {
  if (!nav) return;
  if (nav.watch) nav.watch.clear();
  nav = null;
  $('navBar').hidden = true;
  compassStop();
}

// ── rýchle ciele (veľké tlačidlá; 2 zadarmo, s Plus až 6) ───────────
// Cieľ sa ukladá názvom zastávky (indexy sa po aktualizácii CP menia)
// a súradnicami ako záloha pre prípad, že zastávku premenujú.
const FAV_KEY = 'mhd-presov.favs.v1';
const FAV_ICONS = ['🏠', '🏫', '💼', '🏥', '🛒', '⭐', '❤️', '⚽'];
const FAV_FREE = 2, FAV_MAX = 6;
let favs = [
  { icon: '🏠', label: 'Domov', target: null },
  { icon: '🏫', label: 'Škola', target: null },
];
let favStorageOk = true;
let favEdit = null;

function loadFavs() {
  try {
    const v = JSON.parse(localStorage.getItem(FAV_KEY) || 'null');
    if (Array.isArray(v) && v.length >= FAV_FREE && v.length <= FAV_MAX) {
      favs = v.map((f, i) => ({ icon: '⭐', label: `Cieľ ${i + 1}`, target: null, ...favs[i], ...f }));
    }
  } catch { favStorageOk = false; }
}
function saveFavs() {
  try { localStorage.setItem(FAV_KEY, JSON.stringify(favs)); favStorageOk = true; }
  catch { favStorageOk = false; }
  if (typeof updateWidget === 'function') { renderWidgetCfg(); updateWidget(true); }
}

function resolveTarget(t) {
  if (!t) return null;
  if (t.kind === 'group') {
    const g = groups.find((x) => x.name === t.name);
    if (g) return { kind: 'group', name: g.name, stops: g.stops, lat: g.lat, lon: g.lon };
    return { kind: 'point', lat: t.lat, lon: t.lon, label: t.name };
  }
  return { kind: 'point', lat: t.lat, lon: t.lon, label: t.label || 'uložené miesto' };
}
const targetLabel = (t) => !t ? '' : t.kind === 'group' ? t.name : (t.label || 'uložené miesto');

// tlačidlá sa kreslia nanovo (počet závisí od Plus); bez Plus vidno len prvé dve,
// ďalšie ostávajú uložené a vrátia sa po obnovení nákupu
const favVisible = () => (plus ? favs.length : Math.min(favs.length, FAV_FREE));
function renderFavs() {
  const box = $('favs');
  const focusedIdx = document.activeElement?.dataset?.fav;
  box.innerHTML = '';
  for (let i = 0; i < favVisible(); i++) {
    const f = favs[i];
    const b = document.createElement('button');
    b.type = 'button';
    b.className = `fav fav-c${i}` + (f.target ? '' : ' unset');
    b.dataset.fav = String(i);
    b.innerHTML = '<span class="fav-ico"></span><span class="fav-lbl"></span><span class="fav-sub"></span>';
    b.querySelector('.fav-ico').textContent = f.icon;
    b.querySelector('.fav-lbl').textContent = f.label;
    b.querySelector('.fav-sub').textContent = f.target ? targetLabel(f.target) : 'podrž a nastav cieľ';
    b.setAttribute('aria-label', f.target
      ? `${f.label}: navigovať do ${targetLabel(f.target)}. Podržaním upravíš.`
      : `${f.label}: cieľ nie je nastavený, ťukni a nastav ho`);
    attachLongPress(b, () => startTrip(i), () => openFavDlg(i));
    box.appendChild(b);
  }
  if (favVisible() < FAV_MAX) {
    const add = document.createElement('button');
    add.type = 'button';
    add.className = 'fav-add';
    add.dataset.fav = 'add';
    add.innerHTML = plus ? '➕ Pridať ďalší cieľ' : '➕ Ďalší cieľ <span>⭐ Plus</span>';
    add.addEventListener('click', () => {
      if (!plus) { openPlusDlg(); return; }
      favs.push({ icon: FAV_ICONS[favs.length % FAV_ICONS.length], label: `Cieľ ${favs.length + 1}`, target: null });
      saveFavs();
      renderFavs();
      openFavDlg(favs.length - 1);
    });
    box.appendChild(add);
  }
  if (focusedIdx != null) box.querySelector(`[data-fav="${focusedIdx}"]`)?.focus({ preventScroll: true });
}

// ťuknutie = akcia, podržanie (650 ms) = nastavenie; z klávesnice
// nastavenie cez kláves Menu alebo Shift+F10
function attachLongPress(el, onTap, onLong) {
  let timer = null, fired = false, sx = 0, sy = 0;
  const cancel = () => { clearTimeout(timer); timer = null; el.classList.remove('pressing'); };
  el.addEventListener('pointerdown', (e) => {
    if (e.button > 0) return;
    fired = false; sx = e.clientX; sy = e.clientY;
    el.classList.add('pressing');
    timer = setTimeout(() => { timer = null; fired = true; el.classList.remove('pressing'); buzz([40]); onLong(); }, 650);
  });
  el.addEventListener('pointermove', (e) => {
    if (timer && Math.hypot(e.clientX - sx, e.clientY - sy) > 12) cancel();
  });
  ['pointerleave', 'pointercancel'].forEach((ev) => el.addEventListener(ev, cancel));
  // po podržaní nesmie prísť „klik“ (dopadol by na pozadie otvoreného dialógu)
  el.addEventListener('pointerup', () => { cancel(); if (fired) setTimeout(() => { fired = false; }, 500); });
  el.addEventListener('touchend', (e) => { if (fired) e.preventDefault(); });
  el.addEventListener('contextmenu', (e) => e.preventDefault());
  el.addEventListener('keydown', (e) => {
    if (e.key === 'ContextMenu' || (e.shiftKey && e.key === 'F10')) { e.preventDefault(); onLong(); }
  });
  el.addEventListener('click', (e) => {
    if (fired) { e.preventDefault(); fired = false; return; }
    onTap();
  });
}

// prekrytia (dialóg, režim cesty, upozornenie): fokus dnu, pozadie inert,
// Späť/Escape zatvorí vždy len to najvrchnejšie
let focusBack = [];
let popSilently = 0; // history.back() po zatvorení dialógu tlačidlom — nie je to „Späť“ používateľa
function setInertBehind() {
  const dlg = !$('favDlg').hidden, tk = !$('tktDlg').hidden, gm = !$('gmDlg').hidden, tr = !$('trip').hidden, al = !$('tripAlert').hidden;
  const pl = !$('plusDlg').hidden;
  for (const el of document.querySelectorAll('body > header, body > main, body > footer, #navBar')) el.inert = dlg || tk || gm || tr || al || pl;
  $('plusDlg').inert = al;
  $('trip').inert = al || tk || gm;
  $('favDlg').inert = al || tr;
  $('tktDlg').inert = al;
  $('gmDlg').inert = al;
}
function layerOpened(focusEl) {
  focusBack.push(document.activeElement);
  setInertBehind();
  setTimeout(() => focusEl?.focus({ preventScroll: true }), 30);
}
let layerClosedAt = 0;
function layerClosed() {
  layerClosedAt = Date.now();
  setInertBehind();
  const el = focusBack.pop();
  if (el && el.isConnected && !el.closest('[inert]')) el.focus({ preventScroll: true });
}

function openFavDlg(i) {
  const f = favs[i];
  favEdit = { i, icon: f.icon, target: f.target ? { ...f.target } : null };
  $('favName').value = f.label;
  $('favStop').value = f.target ? (f.target.kind === 'group' ? f.target.name : `📍 ${targetLabel(f.target)}`) : '';
  $('favSuggest').hidden = true;
  renderFavIcons();
  $('favMsg').textContent = favStorageOk ? '' : 'Pozor: tento prehliadač nedovolí uložiť nastavenie natrvalo.';
  $('favMsg').classList.toggle('err', !favStorageOk);
  $('favDel').hidden = !f.target && i < FAV_FREE;
  $('favDel').textContent = i < FAV_FREE ? 'Vymazať' : 'Odstrániť tlačidlo';
  $('favFromTo').hidden = !sel.to;
  $('favDlg').hidden = false;
  try { history.pushState({ fav: 1 }, ''); } catch {}
  layerOpened($('favName'));
}
// fromHistory: zatvára ho tlačidlo Späť (záznam v histórii už nie je)
function closeFavDlg(fromHistory = false) {
  if ($('favDlg').hidden) return;
  $('favDlg').hidden = true;
  favEdit = null;
  layerClosed();
  if (!fromHistory) { try { if (history.state && history.state.fav) { popSilently++; history.back(); } } catch {} }
}

function renderFavIcons() {
  const box = $('favIcons');
  box.innerHTML = '';
  for (const ic of FAV_ICONS) {
    const b = document.createElement('button');
    b.type = 'button'; b.textContent = ic;
    b.className = ic === favEdit.icon ? 'on' : '';
    b.setAttribute('aria-label', `ikona ${ic}`);
    b.addEventListener('click', () => { favEdit.icon = ic; renderFavIcons(); });
    box.appendChild(b);
  }
}

function setFavTargetFrom(v) {
  if (!favEdit) return;
  if (!v) { favEdit.target = null; return; }
  favEdit.target = v.kind === 'group'
    ? { kind: 'group', name: v.name, lat: v.lat, lon: v.lon }
    : { kind: 'point', lat: v.lat, lon: v.lon, label: v.label };
  $('favStop').value = v.kind === 'group' ? v.name : `📍 ${v.label}`;
  $('favMsg').textContent = '';
}

function saveFavDlg() {
  if (!favEdit) return;
  if (!favEdit.target) {
    $('favMsg').textContent = 'Vyber cieľovú zastávku zo zoznamu (alebo použi svoju polohu).';
    $('favMsg').classList.add('err');
    $('favStop').focus();
    return;
  }
  const label = $('favName').value.trim().slice(0, 18) || favs[favEdit.i].label;
  favs[favEdit.i] = { icon: favEdit.icon, label, target: favEdit.target };
  saveFavs();
  renderFavs();
  closeFavDlg();
}

// ── Odkiaľ Kam Plus ─────────────────────────────────────────────────
// Jednorazový nákup cez Google Play Billing (plugin NativePurchases).
// Jadro appky (vyhľadávanie, navigácia, upozornenie na výstup) je zadarmo;
// Plus odomyká pohodlie navyše. Stav sa overuje priamo v Google Play pri
// každom spustení — appka nič neposiela na žiadny vlastný server. Na webe
// a v iOS (zatiaľ bez App Store) sa Plus kúpiť nedá.
const PLUS_ID = 'odkialkam_plus';
const PLUS_KEY = 'mhd-presov.plus.v1';
const PREFS_KEY = 'mhd-presov.prefs.v1';
let plus = false;
let plusProduct = null;
let prefs = { dark: false };
const purchasesApi = () => window.Capacitor?.Plugins?.NativePurchases;
const canBuyPlus = () => !!window.Capacitor?.isNativePlatform?.() && window.Capacitor.getPlatform() === 'android' && !!purchasesApi();
const isPlusPurchase = (p) => p && p.productIdentifier === PLUS_ID && (p.purchaseState === 'PURCHASED' || p.purchaseState === '1');

function savePrefs() { try { localStorage.setItem(PREFS_KEY, JSON.stringify(prefs)); } catch {} }
function setPlus(v) {
  plus = !!v;
  try { localStorage.setItem(PLUS_KEY, JSON.stringify({ owned: plus })); } catch {}
  applyPlus();
}
function applyPlus() {
  if (plus && prefs.dark) document.documentElement.dataset.theme = 'dark';
  else delete document.documentElement.dataset.theme;
  renderFavs();
  renderPlusDlg();
  renderWidgetCfg();
  updateWidget(true);
}
function renderPlusDlg() {
  if (!$('plusDlg')) return;
  $('plusOwned').hidden = !plus;
  $('plusDark').checked = !!prefs.dark;
  const buy = $('plusBuy'), restore = $('plusRestore');
  buy.hidden = plus;
  restore.hidden = plus || !canBuyPlus();
  if (!canBuyPlus()) {
    buy.disabled = true;
    buy.textContent = 'Kúpiť Plus';
    if (!plus) $('plusMsg').textContent = 'Plus sa dá kúpiť v Android aplikácii Odkiaľ Kam z Google Play.';
  } else {
    buy.disabled = false;
    buy.textContent = plusProduct?.priceString ? `Kúpiť Plus · ${plusProduct.priceString}` : 'Kúpiť Plus';
  }
}
// overenie nákupu v Google Play (funguje aj bez internetu z vyrovnávacej pamäte Play)
async function refreshPlus() {
  const P = purchasesApi();
  if (!canBuyPlus()) return;
  try {
    const { isBillingSupported } = await P.isBillingSupported();
    if (!isBillingSupported) return;
    const { purchases } = await P.getPurchases({ productType: 'inapp' });
    setPlus((purchases || []).some(isPlusPurchase));
  } catch { /* Play nedostupný — ostáva posledný známy stav */ }
  try {
    const { products } = await P.getProducts({ productIdentifiers: [PLUS_ID], productType: 'inapp' });
    plusProduct = (products || []).find((p) => p.identifier === PLUS_ID) || null;
    renderPlusDlg();
  } catch {}
}
async function buyPlus() {
  const P = purchasesApi();
  if (!canBuyPlus()) return;
  const msg = $('plusMsg');
  msg.classList.remove('err');
  msg.textContent = 'Otváram Google Play…';
  $('plusBuy').disabled = true;
  try {
    const t = await P.purchaseProduct({ productIdentifier: PLUS_ID, productType: 'inapp' });
    if (isPlusPurchase(t) || t?.purchaseState == null) await refreshPlus();
    if (plus) { msg.textContent = 'Hotovo — Plus je aktivovaný. Ďakujeme!'; buzz([30, 60, 30]); }
    else if (t?.purchaseState === 'PENDING' || t?.purchaseState === '2') msg.textContent = 'Platba čaká na dokončenie. Plus sa zapne, keď ju Google Play potvrdí.';
    else msg.textContent = '';
  } catch (e) {
    const s = String(e?.message || e || '');
    // zrušenie používateľom nie je chyba
    msg.textContent = /cancel/i.test(s) ? '' : 'Nákup sa nepodaril. Skús to znova neskôr.';
    msg.classList.toggle('err', !/cancel/i.test(s));
  } finally {
    renderPlusDlg();
  }
}
async function restorePlus() {
  const P = purchasesApi();
  if (!canBuyPlus()) return;
  const msg = $('plusMsg');
  msg.classList.remove('err');
  msg.textContent = 'Overujem nákup v Google Play…';
  try { await P.restorePurchases(); } catch {}
  await refreshPlus();
  msg.textContent = plus ? 'Plus je obnovený.' : 'Pre tento Google účet sme nákup Plus nenašli.';
}
function openPlusDlg() {
  $('plusMsg').textContent = '';
  $('plusMsg').classList.remove('err');
  renderPlusDlg();
  $('plusDlg').hidden = false;
  try { history.pushState({ plus: 1 }, ''); } catch {}
  layerOpened(plus ? $('plusDark') : $('plusBuy').disabled ? $('plusClose') : $('plusBuy'));
  refreshPlus();
}
function closePlusDlg(fromHistory = false) {
  if ($('plusDlg').hidden) return;
  $('plusDlg').hidden = true;
  layerClosed();
  if (!fromHistory) { try { if (history.state && history.state.plus) { popSilently++; history.back(); } } catch {} }
}
function initPlus() {
  try { plus = JSON.parse(localStorage.getItem(PLUS_KEY) || 'null')?.owned === true; } catch {}
  try { prefs = { ...prefs, ...JSON.parse(localStorage.getItem(PREFS_KEY) || '{}') }; } catch {}
  // mimo Androidu sa Plus neoveruje ani nepredáva — uložený stav by tam nebol overený
  if (!canBuyPlus()) plus = false;
  $('plusBuy').addEventListener('click', buyPlus);
  $('plusRestore').addEventListener('click', restorePlus);
  $('plusClose').addEventListener('click', () => closePlusDlg());
  $('plusLink').addEventListener('click', openPlusDlg);
  $('plusDark').addEventListener('change', (e) => { prefs.dark = e.target.checked; savePrefs(); applyPlus(); });
  applyPlus();
  refreshPlus();
}

// ── widget „Najbližší autobus“ (Odkiaľ Kam Plus, Android) ────────────
// Appka vopred vypočíta najbližšie spoje zo zvolenej zastávky do jedného
// z rýchlych cieľov (na ~26 h) a pošle ich natívnemu widgetu cez most
// WidgetBridge. Widget nič nesťahuje — prepočet beží pri otvorení appky.
const WIDGET_KEY = 'mhd-presov.widget.v1';
const WIDGET_POS_KEY = 'mhd-presov.widgetpos.v1';
const WIDGET_HORIZON = 26 * 3600; // s
const WIDGET_MAX = 300; // pri častých linkách ~ celý deň
// mode 'gps' = spoje z poslednej zistenej polohy (pri otvorení appky alebo ↻ vo widgete),
// náhradná pevná zastávka `from` sa použije, keď poloha nie je alebo je stará;
// mode 'fixed' = vždy z pevnej zastávky
let widgetCfg = { mode: 'gps', from: null, fav: 0 };
let widgetPos = null; // { lat, lon, t }
let widgetBusy = false, widgetLast = 0;
const widgetApi = () => window.Capacitor?.Plugins?.WidgetBridge;

function loadWidgetCfg() {
  try { widgetCfg = { ...widgetCfg, ...JSON.parse(localStorage.getItem(WIDGET_KEY) || '{}') }; } catch {}
  try { widgetPos = JSON.parse(localStorage.getItem(WIDGET_POS_KEY) || 'null'); } catch {}
}
function saveWidgetPos(p) {
  widgetPos = p;
  try { localStorage.setItem(WIDGET_POS_KEY, JSON.stringify(p)); } catch {}
}
// poloha bez otázky na povolenie — len ak ho už appka má (pri otvorení appky)
async function quietPosition() {
  try {
    const geo = window.Capacitor?.Plugins?.Geolocation;
    if (geo) {
      const perm = await geo.checkPermissions();
      if (perm.location !== 'granted' && perm.coarseLocation !== 'granted') return null;
      const pos = await geo.getCurrentPosition({ enableHighAccuracy: false, timeout: 8000, maximumAge: 120000 });
      return { lat: pos.coords.latitude, lon: pos.coords.longitude, t: Date.now() };
    }
    if (!navigator.permissions || !navigator.geolocation) return null;
    const st = await navigator.permissions.query({ name: 'geolocation' });
    if (st.state !== 'granted') return null;
    return await new Promise((res) => navigator.geolocation.getCurrentPosition(
      (p) => res({ lat: p.coords.latitude, lon: p.coords.longitude, t: Date.now() }), () => res(null),
      { timeout: 8000, maximumAge: 120000 }));
  } catch { return null; }
}
function saveWidgetCfg() { try { localStorage.setItem(WIDGET_KEY, JSON.stringify(widgetCfg)); } catch {} }

// epoch (ms) pre čas cestovného poriadku: dátum prevádzkového dňa + sekundy od polnoci v SR
function skOffsetMin(utcMs) {
  const p = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/Bratislava', hourCycle: 'h23', year: 'numeric', month: '2-digit',
    day: '2-digit', hour: '2-digit', minute: '2-digit',
  }).formatToParts(new Date(utcMs));
  const g = (k) => Number(p.find((x) => x.type === k).value);
  return (Date.UTC(g('year'), g('month') - 1, g('day'), g('hour'), g('minute')) - Math.floor(utcMs / 60000) * 60000) / 60000;
}
function skEpoch(dateStr, secs) {
  const naive = Date.parse(`${dateStr}T00:00:00Z`) + secs * 1000;
  return naive - skOffsetMin(naive) * 60000;
}
const addDays = (dateStr, n) => new Date(Date.parse(`${dateStr}T00:00:00Z`) + n * 86400e3).toISOString().slice(0, 10);

// najbližšie spoje z `from` do `to` od teraz na WIDGET_HORIZON; po kúskoch, aby appka nezamŕzala
async function widgetJourneys(from, to) {
  let fromStops = stopSetFor(from);
  if (!fromStops.size) fromStops = stopSetFor(from, 1500);
  let toStops = stopSetFor(to);
  if (!toStops.size) toStops = stopSetFor(to, 1500);
  if (!fromStops.size || !toStops.size) return [];
  const now = Date.now(), end = now + WIDGET_HORIZON * 1000;
  const today = nowInSk().date;
  const out = new Map();
  for (let k = 0; k < 2 && out.size < WIDGET_MAX; k++) {
    const day = addDays(today, k);
    const di = dateInfoFor(day);
    if (D.meta.validTo && di.num > D.meta.validTo) break;
    if (D.meta.validFrom && di.num < D.meta.validFrom) continue;
    let cursor = k === 0 ? Math.max(0, nowSecsSk() - 120) : 0;
    for (let guard = 0; guard < 250 && out.size < WIDGET_MAX; guard++) {
      const js = planJourneys(raptor, fromStops, toStops, di, cursor, 4);
      if (!js.length) break;
      let maxDep = cursor;
      for (const j of js) {
        const ride = j.legs.find((l) => l.type === 'ride');
        maxDep = Math.max(maxDep, j.depTime);
        if (!ride) continue;
        const d = skEpoch(day, ride.dep);
        if (d < now - 60000 || d > end) continue;
        const r = D.routes[ride.route];
        const prev = out.get(d);
        const e = { w: skEpoch(day, j.depTime), d, a: skEpoch(day, j.arrTime), l: r.s, c: r.c || '0b7a3b', tc: r.tc || 'ffffff', s: D.stops[ride.from].n };
        if (!prev || e.a < prev.a) out.set(d, e);
      }
      if (skEpoch(day, maxDep) > end) break;
      cursor = maxDep + 60;
      await new Promise((res) => setTimeout(res, 0));
    }
  }
  // len rozumné spoje: z dvoch s rovnakým príchodom ten neskorší odchod
  const list = [...out.values()].sort((x, y) => x.d - y.d);
  return list.filter((e, i) => !list.slice(i + 1).some((f) => f.a <= e.a));
}

// pos: čerstvo zistená poloha (↻ vo widgete); inak sa skúsi zistiť potichu
async function updateWidget(force = false, pos = null) {
  const W = widgetApi();
  if (!W || !D || widgetBusy) return;
  if (!force && Date.now() - widgetLast < (widgetCfg.mode === 'gps' ? 5 : 20) * 60 * 1000) return;
  widgetBusy = true;
  try {
    const fav = favs[widgetCfg.fav] || favs[0];
    const out = { v: 2, plus, mode: widgetCfg.mode, title: fav ? `${fav.icon} ${fav.label}` : 'Odkiaľ Kam' };
    if (plus && fav?.target) {
      const dest = resolveTarget(fav.target);
      if (widgetCfg.mode === 'gps') {
        const p = pos || (await quietPosition());
        if (p) saveWidgetPos(p);
        if (widgetPos) {
          const near = nearestStop(widgetPos.lat, widgetPos.lon);
          out.gps = { t: widgetPos.t, near: near.d < 1500 ? near.name : '' };
          out.j = await widgetJourneys({ kind: 'point', lat: widgetPos.lat, lon: widgetPos.lon, label: 'poloha' }, dest);
        }
      }
      if (widgetCfg.from) {
        out.fixed = targetLabel(widgetCfg.from);
        out.jf = await widgetJourneys(resolveTarget(widgetCfg.from), dest);
      }
    }
    await W.update({ data: JSON.stringify(out) });
    widgetLast = Date.now();
  } catch { /* widget nie je dostupný (web, iOS) */ } finally { widgetBusy = false; }
}

// ↻ vo widgete: appka sa otvorí, zistí polohu, prepočíta spoje a sama sa skryje
async function refreshWidgetFromHere() {
  setStatus('📍 Zisťujem polohu pre widget…');
  let p = null;
  try { const q = await getPosition(); p = { lat: q.lat, lon: q.lon, t: Date.now() }; } catch {}
  widgetBusy = false;
  await updateWidget(true, p);
  setStatus(p ? 'Widget obnovený podľa tvojej polohy.' : 'Polohu sa nepodarilo zistiť — widget ukazuje náhradnú zastávku.', !p);
  const CapApp = window.Capacitor?.Plugins?.App;
  const busy = trip || !$('plusDlg').hidden || !$('favDlg').hidden || !$('tktDlg').hidden;
  if (p && !busy) setTimeout(() => CapApp?.minimizeApp?.().catch(() => {}), 700);
}

function renderWidgetCfg() {
  const box = $('plusWidget');
  if (!box) return;
  box.hidden = !(plus && widgetApi());
  $('wModeGps').checked = widgetCfg.mode !== 'fixed';
  $('wModeFixed').checked = widgetCfg.mode === 'fixed';
  $('wFromLbl').textContent = widgetCfg.mode === 'fixed'
    ? 'Zastávka, odkiaľ ideš'
    : 'Náhradná zastávka (keď poloha nie je k dispozícii) — nepovinné';
  const sel = $('wFav');
  sel.innerHTML = '';
  favs.forEach((f, i) => {
    const o = document.createElement('option');
    o.value = String(i);
    o.textContent = `${f.icon} ${f.label}${f.target ? '' : ' (nenastavený)'}`;
    sel.appendChild(o);
  });
  sel.value = String(Math.min(widgetCfg.fav, favs.length - 1));
  $('wFrom').value = widgetCfg.from ? targetLabel(widgetCfg.from) : '';
}
let widgetFromPick = null;
function saveWidgetFromDlg() {
  const msg = $('plusMsg');
  msg.classList.remove('err');
  const fi = Number($('wFav').value) || 0;
  widgetCfg.mode = $('wModeFixed').checked ? 'fixed' : 'gps';
  if (widgetFromPick) widgetCfg.from = widgetFromPick;
  if (!$('wFrom').value.trim()) widgetCfg.from = null;
  if (widgetCfg.mode === 'fixed' && !widgetCfg.from) { msg.textContent = 'Vyber zastávku, odkiaľ ideš (zo zoznamu).'; msg.classList.add('err'); $('wFrom').focus(); return; }
  if (!favs[fi]?.target) { msg.textContent = 'Vybraný rýchly cieľ ešte nemá nastavenú zastávku — podrž jeho tlačidlo a nastav ho.'; msg.classList.add('err'); return; }
  widgetCfg.fav = fi;
  saveWidgetCfg();
  msg.textContent = 'Widget uložený. Pridaj ho na plochu: podrž prst na voľnom mieste plochy → Miniaplikácie → Odkiaľ Kam.';
  renderWidgetCfg();
  if (widgetCfg.mode === 'gps') {
    // prvá poloha hneď (používateľ práve ťukol — otázka na povolenie je na mieste)
    getPosition().then((q) => updateWidget(true, { lat: q.lat, lon: q.lon, t: Date.now() }))
      .catch(() => { updateWidget(true); msg.textContent += ' Bez povolenia polohy použije widget náhradnú zastávku.'; });
  } else updateWidget(true);
}
function initWidget() {
  loadWidgetCfg();
  attachSuggest($('wFrom'), $('wFromSuggest'), (v) => {
    widgetFromPick = !v ? null : v.kind === 'group'
      ? { kind: 'group', name: v.name, lat: v.lat, lon: v.lon }
      : { kind: 'point', lat: v.lat, lon: v.lon, label: v.label };
  });
  $('wSave').addEventListener('click', saveWidgetFromDlg);
  for (const id of ['wModeGps', 'wModeFixed']) $(id).addEventListener('change', () => {
    $('wFromLbl').textContent = $('wModeFixed').checked ? 'Zastávka, odkiaľ ideš' : 'Náhradná zastávka (keď poloha nie je k dispozícii) — nepovinné';
  });
  // ťuknutie na widget: odkialkam://widget = navigácia do cieľa, odkialkam://plus = okno Plus
  const CapApp = window.Capacitor?.Plugins?.App;
  const onUrl = (url) => {
    if (!url || !url.startsWith('odkialkam://')) return;
    if (url.startsWith('odkialkam://plus')) { if ($('plusDlg').hidden) openPlusDlg(); return; }
    if (url.startsWith('odkialkam://widget-refresh')) { if (plus) refreshWidgetFromHere(); else if ($('plusDlg').hidden) openPlusDlg(); return; }
    const i = widgetCfg.fav;
    if (plus && favs[i]?.target) startTrip(i);
    else if ($('plusDlg').hidden) openPlusDlg();
  };
  if (CapApp) {
    CapApp.addListener('appUrlOpen', ({ url }) => onUrl(url)).catch?.(() => {});
    CapApp.getLaunchUrl?.().then((r) => onUrl(r?.url)).catch(() => {});
  }
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') updateWidget(); });
  setTimeout(() => updateWidget(true), 1500);
}

// ── lístok DPMP ──────────────────────────────────────────────────────
// Údaje z oficiálnych stránok DPMP (data/dpmp-info: sms-listok, aplikacie,
// cyril, ceny-listkov, navod-na-zakupenie-listka-kartou; stav k 1. 10. 2026).
const platformIs = (p) => window.Capacitor?.getPlatform?.() === p
  || (p === 'ios' ? /iPhone|iPad|iPod/.test(navigator.userAgent) : /Android/.test(navigator.userAgent));
// SMS na 1144: I. pásmo = „akékoľvek písmeno“, celosieťový = „2“
const smsHref = (body) => `sms:1144${platformIs('ios') ? '&' : '?'}body=${encodeURIComponent(body)}`;
const TKT_APPS = [
  { n: 'UBIAN', play: 'https://play.google.com/store/apps/details?id=eu.ubian', ios: 'https://itunes.apple.com/us/app/apple-store/id1216229926' },
  { n: 'MHD Prešov APP', play: 'https://play.google.com/store/apps/details?id=com.nolimit.sk.mhdpresov', ios: 'https://itunes.apple.com/us/app/apple-store/id1070714404' },
  { n: 'iMHD Prešov', play: 'https://play.google.com/store/apps/details?id=com.backbone', ios: 'https://apps.apple.com/sk/app/imhd-sk/id595180826' },
];
const TKT_CYRIL = { n: 'Cyril', play: 'https://play.google.com/store/apps/details?id=sk.cyril', ios: 'https://apps.apple.com/sk/app/cyril/id6779543827' };

function appLinks(apps) {
  const links = [];
  for (const a of apps) {
    if (platformIs('android')) links.push([a.n, a.play]);
    else if (platformIs('ios')) links.push([a.n, a.ios]);
    else links.push([`${a.n} · Google Play`, a.play], [`${a.n} · App Store`, a.ios]);
  }
  return links.map(([n, h]) => `<a class="tkt-app" href="${h}" target="_blank" rel="noopener">${esc(n)} ›</a>`).join('');
}

// aký lístok na danú cestu: pásmo (GTFS zone_id) a dĺžka jazdy
function ticketAdvice(j) {
  const rides = j ? j.legs.filter((l) => l.type === 'ride') : [];
  if (!rides.length) return null;
  let z2 = null;
  for (const l of rides) { const si = l.stops.find((x) => D.stops[x].z === 2); if (si != null) { z2 = D.stops[si].n; break; } }
  return { zone2: z2, mins: Math.round((rides[rides.length - 1].arr - rides[0].dep) / 60) };
}

function openTktDlg(j) {
  $('tktSms1').href = smsHref('A');
  $('tktSms2').href = smsHref('2');
  $('tktApps').innerHTML = appLinks(TKT_APPS);
  $('tktCyril').innerHTML = appLinks([TKT_CYRIL]);
  const adv = ticketAdvice(j);
  $('tktSms1').classList.toggle('rec', !!adv && !adv.zone2);
  $('tktSms2').classList.toggle('rec', !!adv && !!adv.zone2);
  if (adv) {
    let h = adv.zone2
      ? `Na túto cestu potrebuješ <b>celosieťový</b> lístok — trasa ide aj do II. tarifného pásma (${esc(adv.zone2)}). Pri platbe kartou zvoľ na validátore celosieťový lístok <b>pri každom nástupe aj prestupe</b>.`
      : 'Na túto cestu stačí lístok pre <b>I. tarifné pásmo</b>.';
    if (adv.mins > 60) h += ` Jazda trvá ${adv.mins} min — jeden 60-min. SMS lístok nestačí na celú cestu.`;
    $('tktRec').innerHTML = h;
  }
  $('tktRec').hidden = !adv;
  $('tktDlg').hidden = false;
  $('tktDlg').scrollTop = 0;
  $('tktDlg').querySelector('.dlg-box').scrollTop = 0;
  try { history.pushState({ tkt: 1 }, ''); } catch {}
  layerOpened($('tktClose'));
}
function closeTktDlg(fromHistory = false) {
  if ($('tktDlg').hidden) return;
  $('tktDlg').hidden = true;
  layerClosed();
  if (!fromHistory) { try { if (history.state && history.state.tkt) { popSilently++; history.back(); } } catch {} }
}

// ── zvuk, vibrácie, displej ─────────────────────────────────────────
let audioCtx = null, wakeLock = null, speechTimer = null, ttsLang;

// musí sa zavolať v používateľskom geste, inak iOS zvuk ani reč neskôr nepustí
function unlockAudio() {
  try {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (AC) {
      if (!audioCtx) audioCtx = new AC();
      if (audioCtx.state !== 'running') audioCtx.resume().catch(() => {});
      const s = audioCtx.createBufferSource();
      s.buffer = audioCtx.createBuffer(1, 1, 22050);
      s.connect(audioCtx.destination);
      s.start(0);
    }
  } catch {}
  try {
    const ss = window.speechSynthesis;
    if (ss && !window.Capacitor?.Plugins?.TextToSpeech) {
      ss.getVoices();
      const u = new SpeechSynthesisUtterance(' ');
      u.volume = 0;
      ss.speak(u);
    }
  } catch {}
}

async function beepAlarm() {
  if (!audioCtx) return;
  // „playback“ až pri poplachu: zaznie aj pri tichom režime iPhonu, ale
  // používateľovi nestopne hudbu hneď pri štarte cesty
  try { if (navigator.audioSession) navigator.audioSession.type = 'playback'; } catch {}
  try {
    // iOS po hovore/Siri nechá kontext v stave „interrupted“
    if (audioCtx.state !== 'running') await audioCtx.resume().catch(() => {});
    const t0 = audioCtx.currentTime + 0.05;
    [0, 0.25, 0.5, 1.0, 1.25, 1.5].forEach((dt, k) => {
      const o = audioCtx.createOscillator(), g = audioCtx.createGain();
      o.type = 'square';
      o.frequency.value = k % 2 ? 1320 : 880;
      g.gain.setValueAtTime(0.0001, t0 + dt);
      g.gain.exponentialRampToValueAtTime(0.5, t0 + dt + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + dt + 0.2);
      o.connect(g).connect(audioCtx.destination);
      o.start(t0 + dt); o.stop(t0 + dt + 0.22);
    });
  } catch {}
}

// hovorí len slovensky/česky — iný hlas by text skomolil. V Android WebView
// speechSynthesis neexistuje, preto natívny TextToSpeech plugin.
async function nativeTtsLang(TTS) {
  if (ttsLang === undefined) {
    ttsLang = null;
    for (const lang of ['sk-SK', 'cs-CZ']) {
      try { if ((await TTS.isLanguageSupported({ lang })).supported) { ttsLang = lang; break; } } catch {}
    }
  }
  return ttsLang;
}
async function speak(text) {
  const TTS = window.Capacitor?.Plugins?.TextToSpeech;
  if (TTS) {
    const lang = await nativeTtsLang(TTS);
    if (lang) TTS.speak({ text, lang, rate: 1, pitch: 1, volume: 1, category: 'playback' }).catch(() => {});
    return;
  }
  try {
    const s = window.speechSynthesis;
    if (!s) return;
    const v = s.getVoices().find((x) => /^sk/i.test(x.lang)) || s.getVoices().find((x) => /^cs/i.test(x.lang));
    if (!v) return;
    s.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.voice = v; u.lang = v.lang; u.rate = 1; u.volume = 1;
    s.speak(u);
  } catch {}
}
function stopSpeech() {
  clearTimeout(speechTimer);
  speechTimer = null;
  window.Capacitor?.Plugins?.TextToSpeech?.stop().catch(() => {});
  try { window.speechSynthesis?.cancel(); } catch {}
}

function buzz(pattern) {
  const H = window.Capacitor?.Plugins?.Haptics;
  if (H) {
    let t = 0;
    pattern.forEach((ms, k) => {
      if (k % 2 === 0) setTimeout(() => H.vibrate({ duration: ms }).catch(() => {}), t);
      t += ms;
    });
    return;
  }
  try { navigator.vibrate?.(pattern); } catch {}
}

async function keepAwake(on) {
  const KA = window.Capacitor?.Plugins?.KeepAwake;
  if (KA) {
    try { await (on ? KA.keepAwake() : KA.allowSleep()); } catch {}
    return;
  }
  try {
    if (on && 'wakeLock' in navigator && !wakeLock) {
      wakeLock = await navigator.wakeLock.request('screen');
      wakeLock.addEventListener('release', () => { wakeLock = null; });
    } else if (!on && wakeLock) {
      await wakeLock.release(); wakeLock = null;
    }
  } catch {}
}

// ── režim cesty: k zastávke → jazda → upozornenie pred výstupom ─────
// Časy sú z cestovného poriadku; meškanie appka nevie (DPMP nezverejňuje
// realtime v GTFS), preto sa poloha v autobuse určuje z GPS a meškanie
// sa odhaduje z polohy autobusu oproti cestovnému poriadku.
const TRIP_NOTIF_BASE = 7300;
const NOTIF_CHANNEL = 'mhd-vystup';
const GOOD_ACC = 150;      // m — horšia presnosť sa na postup jazdy nepoužije
const GPS_STALE = 45000;   // ms — dlhšie bez dobrej polohy = odhad podľa CP
// programové posuny mapy (Leaflet animovaný zoom spúšťa „zoomstart“ až v ďalšom snímku)
let trip = null, tripMap = null, tripLayer = null, tripUserLayer = null, tripMapAutoUntil = 0;
const tripMapAuto = () => { tripMapAutoUntil = Date.now() + 900; };

const tripNowSecs = () => trip.t0Secs + (Date.now() - trip.t0Epoch) / 1000;
const tripEpoch = (secs) => trip.t0Epoch + (secs - trip.t0Secs) * 1000;
const goodFix = (t) => (t.good && Date.now() - t.good.t < GPS_STALE ? t.good : null);
const pageHidden = () => document.visibilityState === 'hidden';

function posFromGeo(p) {
  return {
    la: p.coords.latitude, lo: p.coords.longitude,
    acc: p.coords.accuracy ?? 30, speed: p.coords.speed, t: Date.now(),
  };
}

async function getPositionFull() {
  const geo = window.Capacitor?.Plugins?.Geolocation;
  if (geo) {
    const perm = await geo.requestPermissions().catch(() => null);
    if (perm && perm.location === 'denied') throw new Error('bez povolenia');
    return posFromGeo(await geo.getCurrentPosition({ enableHighAccuracy: true, timeout: 15000 }));
  }
  if (!navigator.geolocation) throw new Error('nedostupná');
  return new Promise((resolve, reject) => navigator.geolocation.getCurrentPosition(
    (p) => resolve(posFromGeo(p)), reject, { enableHighAccuracy: true, timeout: 15000, maximumAge: 10000 }));
}

// Poloha vzhľadom na trasu jazdy: priemet na lomenú čiaru cez zastávky.
// p = pozícia v „zastávkach“ (1.5 = v polovici medzi 2. a 3.), d = vzdialenosť
// od trasy v metroch. Okno [from, to] bráni skokom pri trasách, ktoré sa
// k sebe vracajú.
function routeProgress(stopIdx, la, lo, from = 0, to = stopIdx.length - 1) {
  const r = Math.PI / 180, kx = 111320 * Math.cos(la * r), ky = 110540;
  let best = { d: Infinity, p: 0 };
  from = Math.max(0, from); to = Math.min(stopIdx.length - 1, to);
  if (to <= from) {
    const s = D.stops[stopIdx[from]];
    return { d: haversine(la, lo, s.la, s.lo), p: from };
  }
  for (let k = from; k < to; k++) {
    const A = D.stops[stopIdx[k]], B = D.stops[stopIdx[k + 1]];
    const ax = (A.lo - lo) * kx, ay = (A.la - la) * ky;
    const dx = (B.lo - A.lo) * kx, dy = (B.la - A.la) * ky;
    const L2 = dx * dx + dy * dy;
    const t = L2 > 0 ? Math.max(0, Math.min(1, -(ax * dx + ay * dy) / L2)) : 0;
    const d = Math.hypot(ax + t * dx, ay + t * dy);
    if (d < best.d) best = { d, p: k + t };
  }
  return best;
}

// čas podľa CP, kedy má byť autobus v polohe p (v „zastávkach“)
function schedAt(r, p) {
  const n = r.stops.length;
  const k = Math.max(0, Math.min(n - 1, Math.floor(p)));
  if (k >= n - 1) return r.times[2 * (n - 1)];
  const dep = r.times[2 * k + 1], arr = r.times[2 * (k + 1)];
  return dep + (p - k) * (arr - dep);
}

// cieľ typu zastávka: najbližšie z jej nástupíšť (ťažisko skupiny môže byť
// aj 200 m od každého z nich)
function destPoint(t, la, lo) {
  if (t.dest.kind !== 'group' || !t.dest.stops?.length || la == null) return { la: t.dest.lat, lo: t.dest.lon };
  let best = null, bd = Infinity;
  for (const si of t.dest.stops) {
    const s = D.stops[si];
    const d = haversine(la, lo, s.la, s.lo);
    if (d < bd) { bd = d; best = s; }
  }
  return { la: best.la, lo: best.lo };
}
function destDistance(t, la, lo) {
  const p = destPoint(t, la, lo);
  return haversine(la, lo, p.la, p.lo);
}

// výber spojenia: najskorší príchod, ale pri rozdiele do 2 min radšej
// menej prestupov a menej chôdze
function rankJourneys(js) {
  if (!js.length) return js;
  const best = Math.min(...js.map((j) => j.arrTime));
  const walkOf = (j) => j.legs.filter((l) => l.type === 'walk').reduce((a, l) => a + l.secs, 0) + j.finalWalk;
  const close = js.filter((j) => j.arrTime <= best + 120)
    .sort((a, b) => a.transfers - b.transfers || walkOf(a) - walkOf(b) || a.arrTime - b.arrTime);
  const rest = js.filter((j) => !close.includes(j)).sort((a, b) => a.arrTime - b.arrTime);
  return [close[0], ...close.slice(1).concat(rest).sort((a, b) => a.arrTime - b.arrTime)];
}

async function startTrip(i) {
  const f = favs[i];
  if (!f.target) { openFavDlg(i); return; }
  if (!D) return;
  // v geste používateľa: odomknúť zvuk a kompas (iOS to inak nedovolí)
  unlockAudio();
  stopNav();
  stopPosWatch();
  if (trip) endTrip(true);
  cancelAllTripNotifs();
  const t = trip = {
    fav: f, dest: resolveTarget(f.target), phase: 'locating', pos: null, good: null, ref: null,
    journeys: [], jIdx: 0, j: null, rides: [], ri: 0, prog: 0, delay: 0,
    alerted: new Set(), seated: new Set(), alertTimer: null, follow: true, speedAvg: 0, openedAt: Date.now(),
    missNote: null, missSince: null, replanned: new Set(), notifAt: new Map(),
    t0Epoch: Date.now(), t0Secs: nowSecsSk(),
  };
  compassStart();
  openTripUi();
  keepAwake(true);
  renderTrip();
  try {
    t.pos = await getPositionFull();
    if (t.pos.acc <= GOOD_ACC) t.good = t.pos;
  } catch {
    if (trip !== t) return;
    t.phase = 'error';
    t.error = 'Polohu sa nepodarilo zistiť. Povoľ polohu pre appku a ťukni „Prepočítať“.';
    renderTrip();
    return;
  }
  if (trip !== t) return;
  planFromHere();
  startTripWatch(t);
  // oprávnenie na notifikácie až po polohe — Android nedovolí dve žiadosti naraz
  prepareNotifications(t);
}

async function startTripWatch(t) {
  if (t.watch || t.watchStarting) return;
  t.watchStarting = true;
  try {
    const h = await watchPos((p) => { if (trip === t) onTripPos(p); }, () => {
      if (trip === t) { t.gpsErr = true; renderTripLive(); }
    });
    if (trip === t && !t.watch) t.watch = h; else h.clear();
  } catch {}
  t.watchStarting = false;
  if (trip === t && !t.timer) t.timer = setInterval(() => { evaluateTrip(); maintainNotifs(); renderTripLive(); }, 1000);
}

function planFromHere(reason) {
  const t = trip;
  if (!t || !t.pos) return;
  cancelTripNotifs();
  t.t0Epoch = Date.now();
  t.t0Secs = nowSecsSk();
  t.missNote = null;
  t.missSince = null;
  t.error = null;
  t.info = reason || null;
  const today = nowInSk();
  const di = dateInfoFor(today.date);
  if (D.meta.validTo && di.num > D.meta.validTo) {
    const f = (n) => `${n % 100}. ${Math.floor(n / 100) % 100}. ${Math.floor(n / 10000)}`;
    t.phase = 'error';
    t.error = `Cestovné poriadky v tejto verzii appky platia len do ${f(D.meta.validTo)}. Stiahni novšiu verziu.`;
    renderTrip();
    return;
  }
  const origin = { kind: 'point', lat: t.pos.la, lon: t.pos.lo, label: 'Moja poloha' };
  const destDist = destDistance(t, t.pos.la, t.pos.lo);
  let fromStops = stopSetFor(origin);
  if (!fromStops.size) fromStops = stopSetFor(origin, 1500);
  let toStops = stopSetFor(t.dest);
  if (!toStops.size) toStops = stopSetFor(t.dest, 1500);
  const js = fromStops.size && toStops.size
    ? rankJourneys(planJourneys(raptor, fromStops, toStops, di, Math.floor(t.t0Secs), 4))
    : [];
  t.journeys = js;
  t.jIdx = 0;
  const walkSecs = destDist * WALK_DETOUR / WALK_SPEED;
  const walkFaster = js.length ? t.t0Secs + walkSecs <= js[0].arrTime : destDist < 2500;
  if (destDist < 300 || (walkFaster && destDist < 2500)) {
    t.j = null; t.rides = []; t.phase = 'final';
    t.walkOnly = true;
    t.info = js.length
      ? `Pešo budeš v cieli skôr (~${fmtDur(walkSecs)}) ako s MHD.`
      : `Cieľ je ${fmtDist(destDist)} pešo (~${fmtDur(walkSecs)}).`;
  } else if (js.length) {
    useJourney(0);
  } else {
    t.phase = 'error';
    t.error = !fromStops.size
      ? 'V okolí 1,5 km nie je žiadna zastávka MHD Prešov.'
      : !toStops.size
        ? 'Pri cieli (do 1,5 km) nie je žiadna zastávka MHD Prešov.'
        : 'Na dnes sa už nenašlo žiadne spojenie do cieľa. Skús neskôr alebo iný cieľ.';
  }
  drawTripJourney();
  renderTrip();
}

function useJourney(k) {
  const t = trip;
  cancelTripNotifs();
  t.jIdx = k;
  t.j = t.journeys[k];
  t.rides = t.j.legs.filter((l) => l.type === 'ride');
  // jazda k, po ktorej sa sedí ďalej (autobus pokračuje ako iná linka)
  t.seated = new Set();
  t.j.legs.forEach((l, i) => { if (l.type === 'stay') t.seated.add(t.rides.indexOf(t.j.legs[i - 1])); });
  t.ri = 0; t.prog = 0; t.delay = 0; t.walkOnly = false;
  t.alerted = new Set();
  t.missNote = null; t.missSince = null;
  t.phase = 'toStop';
  t.follow = true;
  scheduleTripNotifs();
}

function onTripPos(p) {
  const t = trip;
  if (!t) return;
  const pos = posFromGeo(p);
  t.pos = pos;
  t.gpsErr = false;
  if (pos.acc <= GOOD_ACC) {
    // rýchlosť z GPS; keď chýba (null), je neplatná (iOS −1) alebo podozrivá
    // nula (Android bez hasSpeed), tak z posunu oproti bodu spred ≥ 2 s
    const ref = t.ref;
    const dt = ref ? (pos.t - ref.t) / 1000 : 0;
    const moved = dt >= 2 ? haversine(ref.la, ref.lo, pos.la, pos.lo) / dt : null;
    let sp = pos.speed;
    if (sp == null || Number.isNaN(sp) || sp < 0) sp = moved;
    else if (sp === 0 && moved != null && moved > 3) sp = moved;
    if (sp != null) t.speedAvg = t.speedAvg * 0.5 + sp * 0.5;
    if (!ref || dt >= 3) t.ref = pos;
    t.good = pos;
  }
  if (t.phase === 'locating') return;
  updateTripUser();
  evaluateTrip();
  renderTripLive();
}

function evaluateTrip() {
  const t = trip;
  if (!t || !['toStop', 'wait', 'ride', 'final'].includes(t.phase)) return;
  const now = tripNowSecs();
  const g = goodFix(t);

  if (t.phase === 'final') {
    if (g && destDistance(t, g.la, g.lo) < 40) arrived();
    return;
  }
  const r = t.rides[t.ri];
  const n = r.stops.length;

  if (t.phase === 'toStop' || t.phase === 'wait') {
    const st = D.stops[r.from];
    const d = g ? haversine(g.la, g.lo, st.la, st.lo) : Infinity;
    if (g && t.phase === 'toStop' && d < 45) t.phase = 'wait';
    // nástup: okolo času odchodu sa vzďaľuje od nástupišťa po trase linky
    // rýchlejšie ako chodec (meškajúci autobus sa počíta tiež)
    let onRoute = false;
    if (g && now >= r.dep - 150 && d > 70) {
      const pr = routeProgress(r.stops, g.la, g.lo, 0, Math.min(n - 1, 3));
      onRoute = pr.d < 120 && pr.p > 0.02;
      if (onRoute && (t.speedAvg > 2.5 || pr.p >= 0.9)) { boardRide(pr.p); return; }
      // po návrate do appky (napr. z Google Maps) môže už sedieť v autobuse ďalej
      // na trase: je na trase linky, autobus tam podľa CP mohol byť (meškanie
      // najviac 15 min) a pohybuje sa po trase rýchlejšie ako chodec — človek,
      // ktorému spoj ušiel a stojí na neskoršej zastávke, nástup nedostane
      if (!onRoute && now >= r.dep - 60) {
        const far = routeProgress(r.stops, g.la, g.lo, 0, n - 1);
        const sch = schedAt(r, far.p);
        if (far.d < 120 && far.p >= 1 && sch <= now + 180 && sch >= now - 900) {
          onRoute = true; // „spoj ušiel“ až po dlhšom čakaní (autobus môže stáť na zastávke)
          const pv = t.farProbe;
          const fast = pv && g.t - pv.t >= 3000 && g.t - pv.t <= 60000 && far.p > pv.p
            && haversine(pv.la, pv.lo, g.la, g.lo) / ((g.t - pv.t) / 1000) >= 3;
          if (fast || t.speedAvg > 2.5) { t.farProbe = null; boardRide(far.p); return; }
          if (!pv || g.t - pv.t > 60000) t.farProbe = { p: far.p, la: g.la, lo: g.lo, t: g.t };
        }
      }
    }
    // zmeškaný spoj — rozhodnúť až keď to platí dlhšie (jeden skok GPS nestačí)
    const key = `${t.ri}@${r.dep}`;
    if (now > r.dep + 60 && !t.replanned.has(key) && g) {
      if (d < 90) {
        t.missSince = null;
        t.missNote = now < r.dep + 360
          ? 'Autobus ešte neprišiel? Môže meškať — počkaj. Ak ti ušiel, ťukni „Prepočítať“.'
          : 'Autobus mešká viac ako 5 min alebo ti ušiel — ak nepríde, ťukni „Prepočítať“.';
      } else {
        t.missSince = t.missSince || Date.now();
        // popri trase linky (napr. autobus stojí v zápche) čakať dlhšie
        if (Date.now() - t.missSince >= (onRoute ? 45000 : 20000)) {
          t.replanned.add(key);
          planFromHere('Spoj ti pravdepodobne ušiel — našiel som ďalšie spojenie.');
          buzz([200, 100, 200]);
        }
      }
    } else if (!(now > r.dep + 60)) t.missSince = null;
    return;
  }

  // jazda
  if (g) {
    const base = Math.floor(t.prog);
    const pr = routeProgress(r.stops, g.la, g.lo, base - 1, base + 4);
    if (pr.d < 200) {
      t.prog = Math.max(t.prog, pr.p);
      // meškanie autobusu oproti CP (pre odhad pri výpadku GPS a notifikácie)
      if (t.prog > 0.3) t.delay = Math.max(-60, now - schedAt(r, t.prog));
    }
  } else {
    // bez GPS: odhad podľa CP posunutého o naposledy zistené meškanie,
    // najviac po predposlednú zastávku (vystúpenie len so zálohou času)
    const est = now - Math.max(0, t.delay);
    let k = 0;
    while (k + 1 < n - 1 && r.times[2 * (k + 1)] <= est) k++;
    t.prog = Math.max(t.prog, k);
  }
  const ex = D.stops[r.to];
  const dExit = g ? haversine(g.la, g.lo, ex.la, ex.lo) : Infinity;
  const done = t.prog >= n - 1 - 0.08 || dExit < 35 || (!g && now - Math.max(0, t.delay) > r.arr + 180);
  if (!t.alerted.has(t.ri) && !t.seated.has(t.ri) && t.prog >= n - 2 - 0.12) exitAlert(done);
  if (done) alight(true);
}

function boardRide(p = 0) {
  const t = trip;
  t.phase = 'ride';
  t.prog = Math.max(0, p);
  t.delay = 0;
  t.missNote = null;
  t.missSince = null;
  t.info = null;
  t.follow = true;
  buzz([60]);
  renderTrip();
  evaluateTrip();
}

// keepAlert: upozornenie a výstup v tom istom kroku (GPS skočil až k výstupu)
// — výrazné upozornenie „TERAZ“ nechať na obrazovke
function alight(keepAlert = false) {
  const t = trip;
  cancelTripNotif(t.ri);
  t.alerted.add(t.ri);
  if (t.ri < t.rides.length - 1) {
    const stay = t.seated.has(t.ri);
    t.ri += 1; t.prog = 0; t.follow = true;
    t.missNote = null; t.missSince = null;
    // ten istý autobus pokračuje ako iná linka — meškanie ostáva
    if (stay) { t.phase = 'ride'; buzz([60]); } else { t.delay = 0; t.phase = 'toStop'; }
    renderTrip();
    evaluateTrip();
  } else if (t.dest.kind === 'point' && t.j.finalWalk > 30) {
    t.phase = 'final'; t.follow = true;
    renderTrip();
  } else {
    arrived(keepAlert);
  }
}

function arrived(keepAlert = false) {
  const t = trip;
  t.phase = 'done';
  cancelTripNotifs();
  try { localStorage.removeItem(TRIP_KEY); } catch {}
  if (!keepAlert) dismissAlert();
  keepAwake(false);
  buzz([120, 80, 120]);
  renderTrip();
}

// výrazné upozornenie: celá obrazovka + pípanie + vibrácie + hlas
function exitAlert(atStop = false) {
  const t = trip;
  const k = t.ri;
  t.alerted.add(k);
  const r = t.rides[k];
  const exitName = D.stops[r.to].n;
  const next = t.rides[k + 1];
  const when = atStop ? 'TERAZ' : 'na ďalšej zastávke';
  let title, sub, say;
  if (next) {
    const nr = D.routes[next.route];
    const head = next.head >= 0 ? D.heads[next.head] : (nr.l || '');
    const walkTo = next.from !== r.to ? ` Prejdi na zastávku ${D.stops[next.from].n}.` : '';
    title = `PRESTUP ${when}`;
    sub = `Vystúp: ${exitName}. Pokračuj linkou ${nr.s} smer ${head} o ${fmtTime(next.dep)}.${walkTo}`;
    say = atStop
      ? `Pozor! Teraz vystúpte na zastávke ${exitName} a prestúpte na linku ${nr.s}.`
      : `Pozor! Na ďalšej zastávke ${exitName} vystupujete a prestupujete na linku ${nr.s}.`;
  } else {
    title = `VYSTUPUJ ${when}`;
    sub = `Vystúp: ${exitName}${t.dest.kind === 'point' && t.j.finalWalk > 30 ? ` · potom pešo ~${fmtDur(t.j.finalWalk)} do cieľa` : ''}.`;
    say = atStop ? `Pozor! Teraz vystúpte na zastávke ${exitName}.` : `Pozor! Na ďalšej zastávke ${exitName} vystupujete.`;
  }
  $('taTitle').textContent = title;
  $('taSub').textContent = sub;
  if ($('tripAlert').hidden) {
    $('tripAlert').hidden = false;
    layerOpened($('taOk'));
  }
  // aplikácia v pozadí: overlay nikto nevidí → systémová notifikácia hneď
  if (pageHidden()) notifyNow(k, title, `${exitName}${next ? ' — prestup' : ''}`);
  else cancelTripNotif(k);
  let rounds = 0;
  const ring = () => {
    if (!trip || trip !== t || $('tripAlert').hidden) return;
    beepAlarm();
    buzz([500, 200, 500, 200, 900]);
    if (rounds === 0) {
      clearTimeout(speechTimer);
      speechTimer = setTimeout(() => { if (trip === t && !$('tripAlert').hidden) speak(say); }, 1800);
    }
    if (++rounds < 4) t.alertTimer = setTimeout(ring, 7000);
  };
  ring();
}

function dismissAlert() {
  if (!$('tripAlert').hidden) { $('tripAlert').hidden = true; layerClosed(); }
  if (trip && trip.alertTimer) { clearTimeout(trip.alertTimer); trip.alertTimer = null; }
  stopSpeech();
  try { if (navigator.audioSession) navigator.audioSession.type = 'auto'; } catch {}
}

// ── záložné upozornenie cez systémovú notifikáciu ──────────────────
// Príde aj pri zhasnutom displeji / appke v pozadí — podľa CP posunutého
// o zistené meškanie. Kým je appka na obrazovke, upozorňuje GPS, preto sa
// notifikácia priebežne odsúva, aby neprišla skôr ako autobus.
async function prepareNotifications(t) {
  const LN = window.Capacitor?.Plugins?.LocalNotifications;
  if (!LN) return;
  try {
    const p = await LN.requestPermissions();
    t.notifOk = p.display === 'granted';
    await LN.createChannel?.({
      id: NOTIF_CHANNEL, name: 'Upozornenie na výstup', importance: 5,
      vibration: true, visibility: 1, description: 'Upozornenie pred výstupom alebo prestupom',
    }).catch(() => {});
    await checkExact(t);
  } catch {}
  if (trip === t && t.j) scheduleTripNotifs();
}

// Android 12+: bez povolenia „Budíky a pripomienky“ príde systémová notifikácia
// (pri zamknutom displeji) len približne — ponúknuť povolenie tlačidlom
async function checkExact(t) {
  const LN = window.Capacitor?.Plugins?.LocalNotifications;
  if (!LN?.checkExactNotificationSetting || !t.notifOk) return;
  const r = await LN.checkExactNotificationSetting().catch(() => null);
  t.exactOk = !r || r.exact_alarm === 'granted';
  if (trip === t) renderTrip();
}

// kedy podľa CP (+ meškanie) príde autobus jazdy k na predposlednú zastávku
function notifDue(t, k) {
  const r = t.rides[k];
  const n = r.stops.length;
  const base = n >= 2 ? r.times[2 * (n - 2)] : r.dep;
  return tripEpoch(base + (k === t.ri && t.phase === 'ride' ? Math.max(0, t.delay) : 0));
}

function notifPayload(t, k, at, title, body) {
  const r = t.rides[k];
  const last = k === t.rides.length - 1;
  return {
    id: TRIP_NOTIF_BASE + k,
    title: title || (last ? '🔔 Vystupuj na ďalšej zastávke' : '🔔 Prestup na ďalšej zastávke'),
    body: body || `${D.stops[r.to].n} (podľa cestovného poriadku o ${fmtTime(r.arr)})`,
    channelId: NOTIF_CHANNEL,
    schedule: { at: new Date(at), allowWhileIdle: true },
  };
}

async function scheduleTripNotifs() {
  const LN = window.Capacitor?.Plugins?.LocalNotifications;
  const t = trip;
  if (!LN || !t || !t.j || !t.notifOk) return;
  await cancelTripNotifs();
  const list = [];
  t.rides.forEach((r, k) => {
    if (k < t.ri || t.alerted.has(k) || t.seated.has(k)) return;
    let at = notifDue(t, k);
    if (at < Date.now() + 5000) return;
    // na obrazovke upozorní GPS — notifikácia je len poistka na neskôr
    if (!pageHidden()) at = Math.max(at, Date.now() + 120000);
    list.push(notifPayload(t, k, at));
    t.notifAt.set(k, at);
  });
  if (!list.length) return;
  rememberTrip(t);
  try { await LN.schedule({ notifications: list }); } catch {}
}

// každú sekundu: kým je appka viditeľná, blížiacu sa notifikáciu odsunúť;
// po prechode do pozadia ich preplánovať na presný čas (CP + meškanie)
let notifBusy = false;
async function maintainNotifs() {
  const LN = window.Capacitor?.Plugins?.LocalNotifications;
  const t = trip;
  if (!LN || !t || !t.notifOk || notifBusy || !t.notifAt.size || pageHidden()) return;
  const soon = [...t.notifAt].filter(([k, at]) => !t.alerted.has(k) && at - Date.now() < 60000);
  if (!soon.length) return;
  notifBusy = true;
  try {
    for (const [k] of soon) {
      const at = Math.max(notifDue(t, k), Date.now() + 120000);
      await LN.cancel({ notifications: [{ id: TRIP_NOTIF_BASE + k }] }).catch(() => {});
      await LN.schedule({ notifications: [notifPayload(t, k, at)] }).catch(() => {});
      t.notifAt.set(k, at);
    }
  } finally { notifBusy = false; }
}

async function notifyNow(k, title, body) {
  const LN = window.Capacitor?.Plugins?.LocalNotifications;
  const t = trip;
  if (!LN || !t || !t.notifOk) return;
  t.notifAt.delete(k);
  try {
    await LN.cancel({ notifications: [{ id: TRIP_NOTIF_BASE + k }] }).catch(() => {});
    await LN.schedule({ notifications: [notifPayload(t, k, Date.now() + 1000, `🔔 ${title}`, body)] });
  } catch {}
}

async function cancelTripNotif(k) {
  const LN = window.Capacitor?.Plugins?.LocalNotifications;
  if (!LN || !trip || !trip.notifAt.has(k)) return;
  trip.notifAt.delete(k);
  try { await LN.cancel({ notifications: [{ id: TRIP_NOTIF_BASE + k }] }); } catch {}
}

// všetky notifikácie režimu cesty (aj z cesty, ktorú systém ukončil s appkou)
const TRIP_KEY = 'mhd-presov.trip.v1';
function cancelAllTripNotifs() {
  try { localStorage.removeItem(TRIP_KEY); } catch {}
  const LN = window.Capacitor?.Plugins?.LocalNotifications;
  if (!LN) return;
  LN.cancel({ notifications: Array.from({ length: 10 }, (_, k) => ({ id: TRIP_NOTIF_BASE + k })) }).catch(() => {});
}
// pri štarte appky: notifikácie cesty, ktorá ešte môže prebiehať (systém appku
// ukončil za Google Maps), nechať — zrušiť len po jej predpokladanom konci
function cleanupStaleTripNotifs() {
  let until = 0;
  try { until = JSON.parse(localStorage.getItem(TRIP_KEY) || 'null')?.until || 0; } catch {}
  if (Date.now() > until) cancelAllTripNotifs();
}
function rememberTrip(t) {
  if (!t.j) return;
  const last = t.rides[t.rides.length - 1];
  const until = tripEpoch(last.arr + Math.max(0, t.delay || 0)) + 30 * 60000;
  try { localStorage.setItem(TRIP_KEY, JSON.stringify({ until })); } catch {}
}

async function cancelTripNotifs(t = trip) {
  const LN = window.Capacitor?.Plugins?.LocalNotifications;
  if (!LN || !t || !t.notifAt.size) return;
  const ids = [...t.notifAt.keys()].map((k) => ({ id: TRIP_NOTIF_BASE + k }));
  t.notifAt.clear();
  try { await LN.cancel({ notifications: ids }); } catch {}
}

// appka ide do pozadia / späť na obrazovku
function onTripHidden() {
  if (trip && trip.j) scheduleTripNotifs();
}
function onTripVisible() {
  if (!trip) return;
  if (trip.exactOk === false) checkExact(trip);
  keepAwake(true);
  evaluateTrip();
  if (trip && trip.j && !['done', 'error'].includes(trip.phase)) scheduleTripNotifs();
  renderTripLive();
}

// ── UI režimu cesty ─────────────────────────────────────────────────
// iPhone bez natívnej appky (Safari / ikona na ploche): zamknutý displej
// zastaví JavaScript a notifikácie web nemá → upozornenie by neprišlo
const iosWeb = /iPhone|iPad|iPod/.test(navigator.userAgent) && !window.Capacitor?.isNativePlatform?.();

function openTripUi() {
  const wasHidden = $('trip').hidden;
  $('trip').hidden = false;
  if (wasHidden) layerOpened($('tripClose'));
  if (iosWeb) {
    $('tripNote').innerHTML = '<b>iPhone:</b> nechaj appku otvorenú a displej zapnutý — pri zamknutom displeji upozornenie na výstup nepríde. '
      + '(Nastavenia → Displej a jas → Automatické zamknutie: Nikdy, počas cesty.)';
  }
  document.body.classList.add('trip-open');
  try { history.pushState({ trip: 1 }, ''); } catch {}
  if (!tripMap) {
    // dvojklik nezoomuje — ťuknutie na mapu spúšťa navigáciu v Google Maps
    tripMap = L.map('tripMap', { renderer: L.canvas(), zoomControl: false, doubleClickZoom: false });
    tripMap.on('click', tripGmaps);
    tripMap.setView([48.998, 21.24], 14);
    addBaseLayers(tripMap);
    tripLayer = L.layerGroup().addTo(tripMap);
    tripUserLayer = L.layerGroup().addTo(tripMap);
    const stopFollow = () => {
      if (trip && Date.now() > tripMapAutoUntil) { trip.follow = false; $('tripRecenter').hidden = false; }
    };
    tripMap.on('dragstart', stopFollow);
    tripMap.on('zoomstart', stopFollow);
    tripMap.on('movestart zoomstart', () => { tripMapMoving = true; });
    tripMap.on('moveend zoomend', () => { tripMapMoving = false; tripMapMovedAt = Date.now(); });
  }
  tripLayer.clearLayers();
  tripUserLayer.clearLayers();
  $('tripRecenter').hidden = true;
  setTimeout(() => tripMap.invalidateSize(), 60);
}

function endTrip(silent) {
  if (!trip) return;
  const t = trip;
  cancelTripNotifs(t);
  try { localStorage.removeItem(TRIP_KEY); } catch {}
  if (t.watch) t.watch.clear();
  if (t.timer) clearInterval(t.timer);
  dismissAlert();
  trip = null;
  keepAwake(false);
  compassStop();
  $('trip').hidden = true;
  document.body.classList.remove('trip-open');
  layerClosed();
  // modrá bodka na hlavnej mape sa počas cesty neaktualizovala
  if (map && !$('mapWrap').hidden) autoCenterMap();
  if (!silent) { try { if (history.state && history.state.trip) history.back(); } catch {} }
}

function tripTarget() {
  const t = trip;
  if (!t) return null;
  if (t.phase === 'final' || t.phase === 'done') {
    const p = destPoint(t, t.pos?.la, t.pos?.lo);
    return { la: p.la, lo: p.lo, name: targetLabel(t.dest) };
  }
  if (t.phase === 'toStop' || t.phase === 'wait') {
    const st = D.stops[t.rides[t.ri].from];
    return { la: st.la, lo: st.lo, name: st.n };
  }
  if (t.phase === 'ride') {
    const st = D.stops[t.rides[t.ri].to];
    return { la: st.la, lo: st.lo, name: st.n };
  }
  return null;
}

function drawTripJourney() {
  if (!tripMap || !trip) return;
  tripLayer.clearLayers();
  const t = trip;
  const pts = [];
  const coord = (si) => [D.stops[si].la, D.stops[si].lo];
  const flag = (ll, html, cls) => L.marker(ll, {
    icon: L.divIcon({ className: `flag-icon ${cls || ''}`, html, iconSize: [28, 28], iconAnchor: [5, 24] }),
    interactive: false,
  }).addTo(tripLayer);
  if (t.pos) pts.push([t.pos.la, t.pos.lo]);
  if (t.j) {
    let prev = null;
    // úvodný peší úsek kreslí updateTripUser priamo od polohy k nástupišťu
    const firstRide = t.j.legs.findIndex((l) => l.type === 'ride');
    t.j.legs.forEach((l, li) => {
      if (li < firstRide || l.type === 'stay') return;
      if (l.type === 'walk') {
        L.polyline([coord(l.from), coord(l.to)], { color: '#6b716b', weight: 4, dashArray: '4 8' }).addTo(tripLayer);
        prev = coord(l.to);
        return;
      }
      const ll = l.stops.map(coord);
      const r = D.routes[l.route];
      L.polyline(ll, { color: r.c ? `#${r.c}` : '#0b7a3b', weight: 6, opacity: .85 }).addTo(tripLayer);
      l.stops.forEach((si, k) => {
        if (k === 0 || k === l.stops.length - 1) return;
        L.circleMarker(coord(si), { radius: 3, color: '#fff', weight: 1, fillColor: '#334', fillOpacity: 1, interactive: false }).addTo(tripLayer);
      });
      pts.push(...ll);
      prev = ll[ll.length - 1];
    });
    if (t.dest.kind === 'point' && t.j.finalWalk > 0 && prev) {
      L.polyline([prev, [t.dest.lat, t.dest.lon]], { color: '#6b716b', weight: 4, dashArray: '4 8' }).addTo(tripLayer);
    }
    t.rides.forEach((r, k) => {
      if (!t.seated.has(k - 1)) flag(coord(r.from), k === 0 ? '🚏' : '🔁', 'flag-transfer');
    });
  }
  pts.push([t.dest.lat, t.dest.lon]);
  flag([t.dest.lat, t.dest.lon], '🏁', 'flag-end');
  tripMapAuto();
  if (pts.length > 1) tripMap.fitBounds(L.latLngBounds(pts).pad(0.15));
  else tripMap.setView(pts[0], 16);
  updateTripUser();
}

function updateTripUser() {
  if (!tripMap || !trip || !trip.pos) return;
  const t = trip;
  tripUserLayer.clearLayers();
  const ll = [t.pos.la, t.pos.lo];
  if (t.pos.acc > 15) L.circle(ll, { radius: t.pos.acc, color: '#1a73e8', weight: 1, fillOpacity: .08, interactive: false }).addTo(tripUserLayer);
  L.circleMarker(ll, { radius: 9, color: '#fff', weight: 3, fillColor: '#1a73e8', fillOpacity: 1, interactive: false }).addTo(tripUserLayer);
  const tg = tripTarget();
  if (tg && (t.phase === 'toStop' || t.phase === 'wait' || t.phase === 'final')) {
    L.polyline([ll, [tg.la, tg.lo]], { color: '#1a73e8', weight: 2, dashArray: '2 6', interactive: false }).addTo(tripUserLayer);
  }
  if (!t.follow) return;
  tripMapAuto();
  if (t.phase === 'ride') {
    tripMap.setView(ll, Math.max(tripMap.getZoom(), 15), { animate: true });
  } else if (tg && t.phase !== 'done') {
    const b = L.latLngBounds([ll, [tg.la, tg.lo]]);
    if (b.getNorthEast().distanceTo(b.getSouthWest()) < 120) tripMap.setView(ll, 18, { animate: true });
    else tripMap.fitBounds(b.pad(0.35), { animate: true, maxZoom: 18 });
  }
}

// pešia časť cesty (k nástupišťu / do cieľa) → navigácia v Google Maps
let gmapsAt = 0;
let tripMapMovedAt = 0, tripMapMoving = false;
function tripGmaps(e) {
  const t = trip;
  if (!t || !['toStop', 'final'].includes(t.phase)) return;
  const tg = tripTarget();
  if (!tg || Date.now() - gmapsAt < 1500) return;
  // ťuknutie na mapu: nie hneď po otvorení navigácie (2. ťuk z tlačidla cieľa)
  // ani keď ťuknutím len zastavuje posun / dokončuje zoom prstami
  if (e?.type === 'click' && (Date.now() - (t.openedAt || 0) < 1500 || tripMapMoving || Date.now() - tripMapMovedAt < 500)) return;
  if (Date.now() - layerClosedAt < 700) return; // druhé ťuknutie po zatvorení dialógu
  const url = gmapsUrl(tg.la, tg.lo, true);
  // bez systémových notifikácií (web, alebo nepovolené) upozornenie na výstup
  // príde len pri otvorenej appke — povedať to raz za cestu. Odkaz otvára až
  // tlačidlo v dialógu (vlastné gesto — prehliadač ho nezablokuje ako popup).
  const canNotify = !!window.Capacitor?.Plugins?.LocalNotifications && t.notifOk;
  if (!canNotify && t.phase === 'toStop' && !t.gmapsWarned) {
    $('gmGo').href = url;
    $('gmDlg').hidden = false;
    layerOpened($('gmGo'));
    return;
  }
  gmapsAt = Date.now();
  openExternal(url);
}
function closeGmDlg() {
  if ($('gmDlg').hidden) return;
  $('gmDlg').hidden = true;
  layerClosed();
}

function renderTripNav() {
  const t = trip;
  if (!t) return;
  const tg = tripTarget();
  const walking = t.phase === 'toStop' || t.phase === 'wait' || t.phase === 'final';
  $('tripNav').hidden = !(t.pos && tg && walking);
  const gm = !!tg && (t.phase === 'toStop' || t.phase === 'final');
  // nápoveda na mape len chvíľu (nezakrýva polohu); trvalé je tlačidlo „Maps“ v lište
  $('tripGmHint').hidden = !gm || Date.now() - (t.openedAt || 0) > 12000;
  $('tripMap').classList.toggle('gm-tap', gm);
  $('tripNav').classList.toggle('gm-tap', gm);
  if ($('tripNav').hidden) return;
  const d = haversine(t.pos.la, t.pos.lo, tg.la, tg.lo);
  const brg = bearingTo(t.pos.la, t.pos.lo, tg.la, tg.lo);
  const rot = compassHeading == null ? brg : (brg - compassHeading + 360) % 360;
  $('tripArrow').style.transform = `rotate(${rot}deg)`;
  $('tripNavTitle').textContent = t.phase === 'final' ? `Do cieľa: ${tg.name}` : `Na zastávku: ${tg.name}`;
  $('tripNavSub').textContent = d < 30
    ? 'si na mieste 🎯'
    : `${fmtDist(d)} · ~${Math.max(1, Math.round(d * WALK_DETOUR / WALK_SPEED / 60))} min pešo${compassHeading == null ? ' · šípka voči severu' : ''}`;
}

function rideBadge(l) {
  const r = D.routes[l.route];
  const head = l.head >= 0 ? D.heads[l.head] : (r.l || '');
  return `${badge(l.route)} <span class="muted">smer ${esc(head)}</span>`;
}

const stopsWord = (n) => `${n} ${n === 1 ? 'zastávka' : n >= 2 && n <= 4 ? 'zastávky' : 'zastávok'}`;

function countdown(secs) {
  if (secs < -90) return `${Math.round(-secs / 60)} min po odchode podľa CP`;
  if (secs <= 30) return 'teraz';
  const m = Math.ceil(secs / 60);
  return m >= 60 ? `o ${Math.floor(m / 60)} h ${m % 60} min` : `o ${m} min`;
}

// statická časť: hlavička + zoznam úsekov (mení sa len pri zmene fázy)
function renderTrip() {
  const t = trip;
  if (!t) return;
  const key = `${t.phase}|${t.ri}|${t.jIdx}`;
  if (key !== t.phaseKey) { t.phaseKey = key; t.phaseAt = Date.now(); }
  $('tripDestName').textContent = `${t.fav.icon} ${t.fav.label}`;
  $('tripDestSub').textContent = targetLabel(t.dest);
  const legs = $('tripLegs');
  legs.innerHTML = '';
  if (t.j) {
    t.rides.forEach((r, k) => {
      const div = document.createElement('div');
      const state = k < t.ri ? 'done' : k === t.ri ? 'cur' : '';
      div.className = `tleg ${state}`;
      const n = r.stops.length - 1;
      div.innerHTML = `
        <div class="t">${fmtTime(r.dep)}<br><span class="muted">${fmtTime(r.arr)}</span></div>
        <div>${t.seated.has(k - 1) ? '<span class="muted">🔄 zostaň sedieť, pokračuje ako</span> ' : ''}${rideBadge(r)}<br>
          <b>${esc(D.stops[r.from].n)}</b> → <b>${esc(D.stops[r.to].n)}</b>
          <span class="muted">· ${stopsWord(n)}</span></div>`;
      legs.appendChild(div);
    });
    const tr = t.j.transfers;
    $('tripSummary').textContent = `${fmtTime(t.j.depTime)} → ${fmtTime(t.j.arrTime)} · ${fmtDur(t.j.arrTime - t.j.depTime)} · ${tr === 0 ? 'bez prestupu' : tr === 1 ? '1 prestup' : `${tr} prestupy`}`;
  } else {
    $('tripSummary').textContent = '';
  }
  const preBoard = t.j && t.ri === 0 && (t.phase === 'toStop' || t.phase === 'wait');
  $('tripAlt').hidden = !((preBoard && t.journeys.length > 1) || (t.walkOnly && t.journeys.length));
  $('tripAlt').textContent = t.walkOnly ? '🚌 Radšej MHD' : '⇄ Iný spoj';
  $('tripBoard').hidden = !(t.phase === 'toStop' || t.phase === 'wait' || t.phase === 'ride');
  $('tripBoard').textContent = t.phase === 'ride' ? '✓ Vystúpil som' : '🚌 Už som nastúpil';
  $('tripReplan').hidden = t.phase === 'done' || t.phase === 'locating';
  $('tripExact').hidden = t.exactOk !== false || t.phase === 'done';
  renderTripLive();
}

// živá časť: hlavný pokyn, odpočet, poloha v autobuse (každú sekundu)
function renderTripLive() {
  const t = trip;
  if (!t) return;
  renderTripNav();
  let main = '', sub = '', cls = '';
  const now = t.phase === 'locating' ? 0 : tripNowSecs();
  switch (t.phase) {
    case 'locating':
      main = '📍 Zisťujem tvoju polohu…'; break;
    case 'error':
      main = '⚠️ Spojenie sa nedá naplánovať'; sub = esc(t.error || ''); cls = 'warn'; break;
    case 'toStop': case 'wait': {
      const r = t.rides[t.ri];
      const st = D.stops[r.from];
      const toDep = r.dep - now;
      main = t.phase === 'wait'
        ? `⏳ Čakaj na zastávke <b>${esc(st.n)}</b>`
        : `🚶 Choď na zastávku <b>${esc(st.n)}</b>`;
      sub = `${rideBadge(r)} · odchod <b>${fmtTime(r.dep)}</b> (${countdown(toDep)})`;
      if (t.phase === 'toStop' && t.pos) {
        const need = haversine(t.pos.la, t.pos.lo, st.la, st.lo) * WALK_DETOUR / WALK_SPEED;
        const slack = toDep - need;
        if (slack > 120) sub += `<br><span class="ok">✓ stíhaš, rezerva ~${Math.round(slack / 60)} min</span>`;
        else if (slack > 0) { sub += '<br><span class="hurry">⚡ ponáhľaj sa</span>'; cls = 'hurry'; }
        else { sub += '<br><span class="late">✗ pešo to už asi nestihneš</span>'; cls = 'warn'; }
      }
      if (t.missNote) { sub += `<br><span class="hurry">${esc(t.missNote)}</span>`; }
      break;
    }
    case 'ride': {
      const r = t.rides[t.ri];
      const n = r.stops.length;
      const nextK = Math.min(n - 1, Math.floor(t.prog + 0.12) + 1);
      const left = n - 1 - Math.floor(t.prog + 0.12);
      main = `🚌 Ideš linkou ${rideBadge(r)}`;
      if (t.seated.has(t.ri)) {
        const nx = t.rides[t.ri + 1];
        sub = `Ďalšia zastávka: <b>${esc(D.stops[r.stops[nextK]].n)}</b><br>`
          + `🔄 Zostaň sedieť — na zastávke <b>${esc(D.stops[r.to].n)}</b> autobus pokračuje ako linka ${badge(nx.route)}`;
        break;
      }
      sub = `Ďalšia zastávka: <b>${esc(D.stops[r.stops[nextK]].n)}</b><br>`
        + `${t.ri < t.rides.length - 1 ? 'Prestupuješ' : 'Vystupuješ'}: <b>${esc(D.stops[r.to].n)}</b> · `
        + `${left <= 1 ? '<span class="hurry">NA ĎALŠEJ</span>' : `o ${stopsWord(left)}`} (${fmtTime(r.arr)} podľa CP)`;
      if (left <= 1) cls = 'hurry';
      break;
    }
    case 'final':
      main = `🚶 Choď do cieľa <b>${esc(targetLabel(t.dest))}</b>`;
      if (t.pos) sub = `${fmtDist(destDistance(t, t.pos.la, t.pos.lo))}`;
      break;
    case 'done':
      main = '🎉 Si v cieli'; sub = 'Pekný deň!'; cls = 'ok'; break;
  }
  if (t.info && t.phase !== 'done') sub += `${sub ? '<br>' : ''}<span class="muted">${esc(t.info)}</span>`;
  if (t.gpsErr) sub += `${sub ? '<br>' : ''}<span class="late">GPS signál nedostupný — povoľ polohu.</span>`;
  const box = $('tripNow');
  const html = `<div class="tn-main">${main}</div>${sub ? `<div class="tn-sub">${sub}</div>` : ''}`;
  if (box.dataset.html !== html) {
    box.dataset.html = html;
    box.className = `trip-now ${cls}`;
    box.innerHTML = html;
  }
  // čítačka obrazovky: len pri zmene pokynu (nie každú sekundu odpočet)
  let sr = box.querySelector('.tn-main')?.textContent || '';
  if (t.phase === 'ride') sr += `. ${box.querySelector('.tn-sub')?.textContent.split('Vystupuješ')[0].split('Prestupuješ')[0] || ''}`;
  if ($('tripSr').textContent !== sr) $('tripSr').textContent = sr;
}

// ── inicializácia ────────────────────────────────────────────────────
async function main() {
  $('appVer').textContent = `v${APP_VERSION}`;
  document.title = `Odkiaľ Kam v${APP_VERSION} — MHD Prešov`;
  const now = nowInSk();
  $('dateInput').value = now.date;
  $('timeInput').value = now.time;

  $('nowBtn').addEventListener('click', () => {
    const n = nowInSk();
    $('dateInput').value = n.date;
    $('timeInput').value = n.time;
  });
  $('swapBtn').addEventListener('click', () => {
    const f = sel.from, t = sel.to;
    setSel('from', t); setSel('to', f);
    if (!t) $('fromInput').value = '';
    if (!f) $('toInput').value = '';
  });
  $('searchBtn').addEventListener('click', search);
  $('clearBtn').addEventListener('click', clearSearch);
  $('navClose').addEventListener('click', stopNav);
  $('navGmaps').addEventListener('click', () => {
    if (nav) openExternal(gmapsUrl(nav.lat, nav.lon));
  });
  $('geoBtn').addEventListener('click', useGeo);
  $('mapBtn').addEventListener('click', () => {
    const w = $('mapWrap');
    w.hidden = !w.hidden;
    if (w.hidden) { stopPosWatch(); return; }
    if (!w.hidden) {
      initMap();
      autoCenterMap();
      if (lastJourney) drawJourney(lastJourney);
      setTimeout(() => {
        map.invalidateSize();
        // po vyhľadaní ukáž nakreslenú trasu
        const layers = journeyLayer ? journeyLayer.getLayers() : [];
        if (layers.length) {
          const b = L.latLngBounds([]);
          layers.forEach((l) => l.getBounds ? b.extend(l.getBounds()) : b.extend(l.getLatLng()));
          if (b.isValid()) map.fitBounds(b.pad(0.2));
        }
      }, 60);
    }
  });

  try {
    await loadData();
  } catch (e) {
    setStatus(`Dáta sa nepodarilo načítať: ${e.message}`, true);
    return;
  }
  attachSuggest($('fromInput'), $('fromSuggest'), (v) => { sel.from = v; });
  attachSuggest($('toInput'), $('toSuggest'), (v) => { sel.to = v; });

  // notifikácie z cesty, ktorú systém ukončil spolu s appkou: po jej konci zrušiť
  cleanupStaleTripNotifs();

  // rýchle ciele
  loadFavs();
  loadWidgetCfg();
  initPlus(); // načíta stav Plus a nakreslí rýchle ciele
  initWidget();
  attachSuggest($('favStop'), $('favSuggest'), (v) => setFavTargetFrom(v));
  $('favSave').addEventListener('click', saveFavDlg);
  $('favCancel').addEventListener('click', () => closeFavDlg());
  $('favDel').addEventListener('click', () => {
    if (!favEdit) return;
    if (favEdit.i >= FAV_FREE) favs.splice(favEdit.i, 1); // ďalšie tlačidlá (Plus) sa odstránia celé
    else favs[favEdit.i] = { ...favs[favEdit.i], target: null };
    saveFavs(); renderFavs(); closeFavDlg();
  });
  $('favFromTo').addEventListener('click', () => { if (sel.to) setFavTargetFrom(sel.to); });
  $('favHere').addEventListener('click', async () => {
    $('favMsg').classList.remove('err');
    $('favMsg').textContent = 'Zisťujem polohu…';
    try {
      const { lat, lon } = await getPosition();
      setFavTargetFrom({ kind: 'point', lat, lon, label: 'uložená poloha' });
      $('favMsg').textContent = 'Cieľom bude toto miesto (appka nájde najbližšie zastávky).';
    } catch {
      $('favMsg').textContent = 'Polohu sa nepodarilo zistiť.';
      $('favMsg').classList.add('err');
    }
  });
  // pozadie dialógu zatvára len ťuknutie, ktoré naň aj začalo (nie dotyk z podržania)
  let dlgDown = null;
  $('favDlg').addEventListener('pointerdown', (e) => { dlgDown = e.target; });
  $('favDlg').addEventListener('click', (e) => {
    if (e.target === $('favDlg') && dlgDown === $('favDlg')) closeFavDlg();
    dlgDown = null;
  });

  // režim cesty
  $('tripClose').addEventListener('click', () => endTrip());
  $('taOk').addEventListener('click', dismissAlert);
  // lístok
  $('tktBtn').addEventListener('click', () => openTktDlg($('results').hidden ? null : lastJourney));
  $('tripTkt').addEventListener('click', () => openTktDlg(trip?.j || null));
  $('tktClose').addEventListener('click', () => closeTktDlg());
  let tktDown = null;
  $('tktDlg').addEventListener('pointerdown', (e) => { tktDown = e.target; });
  $('tktDlg').addEventListener('click', (e) => {
    if (e.target === $('tktDlg') && tktDown === $('tktDlg')) closeTktDlg();
    tktDown = null;
  });
  $('tripNav').addEventListener('click', (e) => { if (e.target !== $('tripGm')) tripGmaps(); });
  $('tripGm').addEventListener('click', () => tripGmaps());
  $('tripExact').addEventListener('click', async () => {
    const LN = window.Capacitor?.Plugins?.LocalNotifications;
    const t = trip;
    if (!LN?.changeExactNotificationSetting || !t) return;
    const r = await LN.changeExactNotificationSetting().catch(() => null);
    if (r && trip === t) { t.exactOk = r.exact_alarm === 'granted'; if (t.j) scheduleTripNotifs(); renderTrip(); }
  });
  $('gmCancel').addEventListener('click', closeGmDlg);
  $('gmGo').addEventListener('click', () => {
    if (trip) trip.gmapsWarned = true;
    gmapsAt = Date.now();
    setTimeout(closeGmDlg, 0); // odkaz (target=_blank) otvorí Google Maps sám
  });
  $('gmDlg').addEventListener('click', (e) => { if (e.target === $('gmDlg')) closeGmDlg(); });
  $('tripRecenter').addEventListener('click', () => {
    if (!trip) return;
    trip.follow = true; $('tripRecenter').hidden = true; updateTripUser();
  });
  $('tripBoard').addEventListener('click', () => {
    const t = trip;
    if (!t) return;
    // to isté tlačidlo mení význam — dvojité ťuknutie nesmie preskočiť jazdu
    if (Date.now() - (t.phaseAt || 0) < 1500) return;
    if (t.phase === 'ride') {
      const r = t.rides[t.ri];
      if (t.prog < r.stops.length - 2 - 0.12
        && !confirm(`Naozaj si už vystúpil? Do zastávky ${D.stops[r.to].n} ostáva ešte ${stopsWord(r.stops.length - 1 - Math.floor(t.prog))}.`)) return;
      alight();
    } else boardRide(0);
  });
  $('tripAlt').addEventListener('click', () => {
    if (!trip || !trip.journeys.length) return;
    useJourney(trip.walkOnly ? 0 : (trip.jIdx + 1) % trip.journeys.length);
    trip.info = null;
    drawTripJourney(); renderTrip();
  });
  $('tripReplan').addEventListener('click', async () => {
    const t = trip;
    if (!t) return;
    unlockAudio();
    if (!t.pos || Date.now() - t.pos.t > 60000) {
      t.phase = 'locating'; renderTrip();
      let pos = null;
      try { pos = await getPositionFull(); } catch {}
      if (trip !== t) return;
      if (!pos) { t.phase = 'error'; t.error = 'Polohu sa nepodarilo zistiť.'; renderTrip(); return; }
      t.pos = pos;
      if (pos.acc <= GOOD_ACC) t.good = pos;
      startTripWatch(t);
    }
    planFromHere('Prepočítané z tvojej aktuálnej polohy.');
  });
  window.addEventListener('popstate', () => {
    if (popSilently) { popSilently--; return; }
    // Späť zatvorí len najvrchnejšiu vrstvu
    if (!$('tripAlert').hidden) {
      dismissAlert();
      // záznam histórie pre vrstvu, ktorá ostala otvorená
      const keep = !$('tktDlg').hidden ? { tkt: 1 } : trip ? { trip: 1 } : null;
      if (keep) { try { history.pushState(keep, ''); } catch {} }
    } else if (!$('gmDlg').hidden) {
      closeGmDlg();
      if (trip) { try { history.pushState({ trip: 1 }, ''); } catch {} }
    } else if (!$('tktDlg').hidden) closeTktDlg(true);
    else if (!$('plusDlg').hidden) closePlusDlg(true);
    else if (!$('favDlg').hidden) closeFavDlg(true);
    else if (trip) endTrip(true);
  });
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    if (!$('tripAlert').hidden) dismissAlert();
    else if (!$('gmDlg').hidden) closeGmDlg();
    else if (!$('tktDlg').hidden) closeTktDlg();
    else if (!$('plusDlg').hidden) closePlusDlg();
    else if (!$('favDlg').hidden) closeFavDlg();
    else if (trip) endTrip();
    else return;
    e.preventDefault();
  });
  document.addEventListener('visibilitychange', () => {
    if (pageHidden()) onTripHidden(); else onTripVisible();
  });
  // Android APK: hardvérové Späť (bez @capacitor/app by appku len minimalizovalo
  // a navigácia s notifikáciami by bežala ďalej)
  const CapApp = window.Capacitor?.Plugins?.App;
  if (CapApp) {
    CapApp.addListener('backButton', ({ canGoBack }) => {
      if (!$('tripAlert').hidden) dismissAlert();
      else if (!$('gmDlg').hidden) closeGmDlg();
      else if (!$('tktDlg').hidden) closeTktDlg();
      else if (!$('plusDlg').hidden) closePlusDlg();
      else if (!$('favDlg').hidden) closeFavDlg();
      else if (trip) endTrip();
      else if (canGoBack) history.back();
      else CapApp.minimizeApp().catch(() => CapApp.exitApp());
    }).catch?.(() => {});
    CapApp.addListener('appStateChange', ({ isActive }) => {
      if (isActive) onTripVisible(); else onTripHidden();
    }).catch?.(() => {});
  }

  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
}
main();
