// MHD Prešov — plánovač spojení nad oficiálnymi GTFS dátami DPMP.
import { Raptor, planJourneys } from './raptor.js';

const $ = (id) => document.getElementById(id);
const statusEl = $('status');
const WALK_SPEED = 1.25; // m/s
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

function fmtTime(secs) {
  secs = Math.round(secs);
  const h = Math.floor(secs / 3600) % 24, m = Math.floor((secs % 3600) / 60);
  return `${h}:${String(m).padStart(2, '0')}`;
}
function fmtDur(secs) {
  const m = Math.round(secs / 60);
  return m >= 60 ? `${Math.floor(m / 60)} h ${m % 60} min` : `${m} min`;
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

// ── autocomplete ─────────────────────────────────────────────────────
function attachSuggest(input, box, onPick) {
  let items = [], active = -1;
  const render = () => {
    box.innerHTML = '';
    items.forEach((g, i) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.innerHTML = `${g.name} <span class="hint">(${g.stops.length}× nástupište)</span>`;
      if (i === active) b.classList.add('active');
      b.addEventListener('mousedown', (e) => { e.preventDefault(); pick(g); });
      box.appendChild(b);
    });
    box.hidden = items.length === 0;
  };
  const pick = (g) => {
    input.value = g.name;
    box.hidden = true;
    onPick({ kind: 'group', name: g.name, stops: g.stops, lat: g.lat, lon: g.lon });
  };
  input.addEventListener('input', () => {
    const q = norm(input.value.trim());
    onPick(null);
    if (q.length < 1) { box.hidden = true; return; }
    const starts = groups.filter((g) => g.norm.startsWith(q));
    const contains = groups.filter((g) => !g.norm.startsWith(q) && g.norm.includes(q));
    items = [...starts, ...contains].slice(0, 12);
    active = -1;
    render();
  });
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
function initMap() {
  if (map) return;
  map = L.map('map', { renderer: L.canvas(), zoomControl: true });
  map.setView([48.998, 21.24], 13);
  map.getContainer().style.background = '#eef1ee';
  // záložný podklad: sieť trás MHD (kopíruje ulice) — pane pod dlaždicami,
  // takže ju vidno len kým sa OSM dlaždice nenačítajú (a offline)
  map.createPane('basemap').style.zIndex = 150; // tilePane má 200
  const basemapRenderer = L.canvas({ pane: 'basemap' });
  fetch('data/basemap.json').then((r) => r.ok ? r.json() : null).then((lines) => {
    if (!lines || !map) return;
    L.layerGroup(lines.map((l) =>
      L.polyline(l, { pane: 'basemap', renderer: basemapRenderer, color: '#ccd6cc', weight: 3, opacity: 1, interactive: false }))).addTo(map);
  }).catch(() => {});
  L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
  }).addTo(map);
  markersLayer = L.layerGroup().addTo(map);
  journeyLayer = L.layerGroup().addTo(map);

  for (const g of groups) {
    const mk = L.circleMarker([g.lat, g.lon], {
      radius: 6, color: '#0b7a3b', weight: 2, fillColor: '#fff', fillOpacity: .9,
    }).addTo(markersLayer);
    mk.bindPopup(() => {
      const div = document.createElement('div');
      div.className = 'stop-popup';
      div.innerHTML = `<b>${g.name}</b><div class="btns"></div>`;
      const btns = div.querySelector('.btns');
      const mkBtn = (label, cls, cb) => {
        const b = document.createElement('button');
        b.textContent = label; b.className = cls;
        b.addEventListener('click', () => { cb(); map.closePopup(); });
        btns.appendChild(b);
      };
      mkBtn('Štart', 'b-start', () => setSel('from', { kind: 'group', name: g.name, stops: g.stops, lat: g.lat, lon: g.lon }));
      mkBtn('Cieľ', 'b-end', () => setSel('to', { kind: 'group', name: g.name, stops: g.stops, lat: g.lat, lon: g.lon }));
      return div;
    });
  }
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
function stopSetFor(s) {
  const m = new Map();
  if (!s) return m;
  if (s.kind === 'group') {
    for (const i of s.stops) m.set(i, 0);
    // blízke zastávky s iným názvom netreba — rieši ich prestupová relaxácia
  } else {
    const cand = [];
    D.stops.forEach((st, i) => {
      const d = haversine(s.lat, s.lon, st.la, st.lo);
      if (d <= POINT_RADIUS) cand.push([i, d]);
    });
    cand.sort((a, b) => a[1] - b[1]);
    for (const [i, d] of cand.slice(0, 8)) m.set(i, Math.round(d / WALK_SPEED));
  }
  return m;
}

// ── vyhľadanie a vykreslenie ────────────────────────────────────────
function search() {
  if (!D) return;
  if (!sel.from) { setStatus('Vyber východiskovú zastávku.', true); $('fromInput').focus(); return; }
  if (!sel.to) { setStatus('Vyber cieľovú zastávku.', true); $('toInput').focus(); return; }
  const fromStops = stopSetFor(sel.from);
  const toStops = stopSetFor(sel.to);
  if (!fromStops.size) { setStatus('V okolí zvoleného bodu nie je žiadna zastávka MHD.', true); return; }
  if (!toStops.size) { setStatus('V okolí cieľového bodu nie je žiadna zastávka MHD.', true); return; }

  const dateStr = $('dateInput').value;
  const timeStr = $('timeInput').value || '00:00';
  const di = dateInfoFor(dateStr);
  if (D.meta.validTo && di.num > D.meta.validTo) {
    setStatus(`Na tento dátum ešte nie sú zverejnené cestovné poriadky (platia do ${D.meta.validTo}).`, true);
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

    for (const l of j.legs) {
      const div = document.createElement('div');
      div.className = 'leg';
      if (l.type === 'walk') {
        div.innerHTML = `
          <div class="t">${fmtTime(l.dep)}</div>
          <div><span class="badge walk">pešo</span> ${fmtDur(l.secs)} — na zastávku <b>${D.stops[l.to].n}</b></div>`;
      } else {
        const r = D.routes[l.route];
        const head = l.head >= 0 ? D.heads[l.head] : (r.l || '');
        const inner = l.stops.slice(1, -1);
        div.innerHTML = `
          <div class="t">${fmtTime(l.dep)}<br><span class="muted">${fmtTime(l.arr)}</span></div>
          <div>
            ${badge(l.route)} <span class="muted">smer ${head}</span><br>
            <b>${D.stops[l.from].n}</b> → <b>${D.stops[l.to].n}</b><br>
            ${inner.length ? `<button class="stops-toggle">${inner.length} medziľahlé zastávky ▾</button><ul hidden></ul>` : `<span class="muted">bez medziľahlých zastávok</span>`}
          </div>`;
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
      body.appendChild(div);
    }
    if (j.finalWalk > 0) {
      const div = document.createElement('div');
      div.className = 'leg';
      div.innerHTML = `
        <div class="t">${fmtTime(j.arrTime - j.finalWalk)}</div>
        <div><span class="badge walk">pešo</span> ${fmtDur(j.finalWalk)} do cieľa</div>`;
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
function drawJourney(j) {
  lastJourney = j;
  if (!map) return;
  journeyLayer.clearLayers();
  const all = [];
  for (const l of j.legs) {
    if (l.type !== 'ride') continue;
    const pts = l.stops.map((si) => [D.stops[si].la, D.stops[si].lo]);
    all.push(...pts);
    L.polyline(pts, { color: '#0b7a3b', weight: 5, opacity: .85 }).addTo(journeyLayer);
    L.circleMarker(pts[0], { radius: 7, color: '#0b7a3b', fillColor: '#fff', fillOpacity: 1, weight: 3 }).addTo(journeyLayer);
    L.circleMarker(pts[pts.length - 1], { radius: 7, color: '#b3541e', fillColor: '#fff', fillOpacity: 1, weight: 3 }).addTo(journeyLayer);
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

// ── inicializácia ────────────────────────────────────────────────────
async function main() {
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
  $('geoBtn').addEventListener('click', useGeo);
  $('mapBtn').addEventListener('click', () => {
    const w = $('mapWrap');
    w.hidden = !w.hidden;
    if (!w.hidden) {
      initMap();
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

  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
}
main();
