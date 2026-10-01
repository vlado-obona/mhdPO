// MHD Prešov — plánovač spojení nad oficiálnymi GTFS dátami DPMP.
import { Raptor, planJourneys } from './raptor.js';

// Verzia aplikácie — zobrazuje sa v názve; build-release.mjs a workflowy
// ju kontrolujú, takže nová verzia = zmeniť tu + zavolať build s tým istým číslom.
const APP_VERSION = '1.3.2';

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
let basemapLines = null;
function loadBasemap() {
  if (!basemapLines) {
    basemapLines = fetch('data/basemap.json').then((r) => r.ok ? r.json() : null).catch(() => null);
  }
  return basemapLines;
}

// OSM dlaždice + záložný podklad: sieť trás MHD (kopíruje ulice) v pane pod
// dlaždicami, takže ju vidno len kým sa dlaždice nenačítajú (a offline)
function addBaseLayers(m) {
  m.getContainer().style.background = '#eef1ee';
  m.createPane('basemap').style.zIndex = 150; // tilePane má 200
  const renderer = L.canvas({ pane: 'basemap' });
  loadBasemap().then((lines) => {
    if (!lines) return;
    L.layerGroup(lines.map((l) =>
      L.polyline(l, { pane: 'basemap', renderer, color: '#ccd6cc', weight: 3, opacity: 1, interactive: false }))).addTo(m);
  });
  L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
  }).addTo(m);
}

function initMap() {
  if (map) return;
  map = L.map('map', { renderer: L.canvas(), zoomControl: true });
  map.setView([48.998, 21.24], 13);
  addBaseLayers(map);
  markersLayer = L.layerGroup().addTo(map);
  journeyLayer = L.layerGroup().addTo(map);

  // každé nástupište zvlášť (sú na správnej strane cesty) + smerová
  // šípka podľa azimutu odchodu autobusov
  const groupByName = new Map(groups.map((g) => [g.name, g]));
  D.stops.forEach((st, si) => {
    const dirs = (D.stopDirs && D.stopDirs[si]) || [];
    // jedna malá šípka v smere odchodu, rovnobežne s cestou — všetky
    // spoje z nástupišťa idú tým istým smerom, stačí kruhový priemer azimutov
    if (dirs.length) {
      const r = Math.PI / 180;
      let x = 0, y = 0;
      for (const [, , b] of dirs) { x += Math.cos(b * r); y += Math.sin(b * r); }
      const brg = Math.hypot(x, y) > 0.3 ? (Math.atan2(y, x) / r + 360) % 360 : dirs[0][2];
      L.marker(offsetPoint(st.la, st.lo, brg, 16), {
        icon: L.divIcon({
          className: 'stop-dir',
          html: `<span style="transform:rotate(${brg - 90}deg)">➤</span>`,
          iconSize: [14, 14], iconAnchor: [7, 7],
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
  const fromStops = stopSetFor(sel.from);
  const toStops = stopSetFor(sel.to);
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

// ── rýchle ciele (dve veľké tlačidlá) ───────────────────────────────
// Cieľ sa ukladá názvom zastávky (indexy sa po aktualizácii CP menia)
// a súradnicami ako záloha pre prípad, že zastávku premenujú.
const FAV_KEY = 'mhd-presov.favs.v1';
const FAV_ICONS = ['🏠', '🏫', '💼', '🏥', '🛒', '⭐', '❤️', '⚽'];
let favs = [
  { icon: '🏠', label: 'Domov', target: null },
  { icon: '🏫', label: 'Škola', target: null },
];
let favStorageOk = true;
let favEdit = null;

function loadFavs() {
  try {
    const v = JSON.parse(localStorage.getItem(FAV_KEY) || 'null');
    if (Array.isArray(v) && v.length === 2) favs = v.map((f, i) => ({ ...favs[i], ...f }));
  } catch { favStorageOk = false; }
}
function saveFavs() {
  try { localStorage.setItem(FAV_KEY, JSON.stringify(favs)); favStorageOk = true; }
  catch { favStorageOk = false; }
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

function renderFavs() {
  favs.forEach((f, i) => {
    const b = $(`fav${i}`);
    b.classList.toggle('unset', !f.target);
    b.querySelector('.fav-ico').textContent = f.icon;
    b.querySelector('.fav-lbl').textContent = f.label;
    b.querySelector('.fav-sub').textContent = f.target ? targetLabel(f.target) : 'podrž a nastav cieľ';
    b.setAttribute('aria-label', f.target
      ? `${f.label}: navigovať do ${targetLabel(f.target)}. Podržaním upravíš.`
      : `${f.label}: cieľ nie je nastavený, ťukni a nastav ho`);
  });
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
  const dlg = !$('favDlg').hidden, tk = !$('tktDlg').hidden, tr = !$('trip').hidden, al = !$('tripAlert').hidden;
  for (const el of document.querySelectorAll('body > header, body > main, body > footer')) el.inert = dlg || tk || tr || al;
  $('trip').inert = al || tk;
  $('favDlg').inert = al || tr;
  $('tktDlg').inert = al;
}
function layerOpened(focusEl) {
  focusBack.push(document.activeElement);
  setInertBehind();
  setTimeout(() => focusEl?.focus({ preventScroll: true }), 30);
}
function layerClosed() {
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
  $('favDel').hidden = !f.target;
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
  return { zone2: z2, mins: Math.round((rides.at(-1).arr - rides[0].dep) / 60) };
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
      ? `Na túto cestu potrebuješ <b>celosieťový</b> lístok — trasa ide aj do II. tarifného pásma (${esc(adv.zone2)}). Pri platbe kartou zvoľ na validátore celosieťový lístok.`
      : 'Na túto cestu stačí lístok pre <b>I. tarifné pásmo</b>.';
    if (adv.mins > 60) h += ` Jazda trvá ${adv.mins} min — jeden 60-min. SMS lístok nestačí na celú cestu.`;
    $('tktRec').innerHTML = h;
  }
  $('tktRec').hidden = !adv;
  $('tktDlg').hidden = false;
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
    alerted: new Set(), seated: new Set(), alertTimer: null, follow: true, speedAvg: 0,
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
      // na trase — nástup, ak je na trase linky a autobus tam podľa CP už mohol byť
      if (!onRoute && now >= r.dep - 60) {
        const far = routeProgress(r.stops, g.la, g.lo, 0, n - 1);
        if (far.d < 120 && far.p >= 1 && schedAt(r, far.p) <= now + 180) { boardRide(far.p); return; }
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
  } catch {}
  if (trip === t && t.j) scheduleTripNotifs();
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
function cancelAllTripNotifs() {
  const LN = window.Capacitor?.Plugins?.LocalNotifications;
  if (!LN) return;
  LN.cancel({ notifications: Array.from({ length: 10 }, (_, k) => ({ id: TRIP_NOTIF_BASE + k })) }).catch(() => {});
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
function tripGmaps() {
  const t = trip;
  if (!t || !['toStop', 'final'].includes(t.phase)) return;
  const tg = tripTarget();
  if (!tg || Date.now() - gmapsAt < 1500) return;
  // bez systémových notifikácií (web, alebo nepovolené) upozornenie na výstup
  // príde len pri otvorenej appke — povedať to raz za cestu
  const canNotify = !!window.Capacitor?.Plugins?.LocalNotifications && t.notifOk;
  if (!canNotify && t.phase === 'toStop' && !t.gmapsWarned) {
    t.gmapsWarned = true;
    if (!confirm('Otvorím navigáciu v Google Maps.\n\nKým bude appka MHD v pozadí, upozornenie na výstup nepríde — po príchode na zastávku sa sem vráť (appka rozpozná nástup).')) return;
  }
  gmapsAt = Date.now();
  openExternal(gmapsUrl(tg.la, tg.lo, true));
}

function renderTripNav() {
  const t = trip;
  if (!t) return;
  const tg = tripTarget();
  const walking = t.phase === 'toStop' || t.phase === 'wait' || t.phase === 'final';
  $('tripNav').hidden = !(t.pos && tg && walking);
  const gm = !!tg && (t.phase === 'toStop' || t.phase === 'final');
  $('tripGmHint').hidden = !gm;
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
  document.title = `MHD Prešov v${APP_VERSION} — plánovač spojení`;
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

  // notifikácie z cesty, ktorú systém ukončil spolu s appkou, sú neplatné
  cancelAllTripNotifs();

  // rýchle ciele
  loadFavs();
  renderFavs();
  [0, 1].forEach((i) => attachLongPress($(`fav${i}`), () => startTrip(i), () => openFavDlg(i)));
  attachSuggest($('favStop'), $('favSuggest'), (v) => setFavTargetFrom(v));
  $('favSave').addEventListener('click', saveFavDlg);
  $('favCancel').addEventListener('click', () => closeFavDlg());
  $('favDel').addEventListener('click', () => {
    if (!favEdit) return;
    favs[favEdit.i] = { ...favs[favEdit.i], target: null };
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
  $('tripNav').addEventListener('click', tripGmaps);
  $('tripNav').addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); tripGmaps(); } });
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
      if (trip) { try { history.pushState({ trip: 1 }, ''); } catch {} }
    } else if (!$('tktDlg').hidden) closeTktDlg(true);
    else if (!$('favDlg').hidden) closeFavDlg(true);
    else if (trip) endTrip(true);
  });
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    if (!$('tripAlert').hidden) dismissAlert();
    else if (!$('tktDlg').hidden) closeTktDlg();
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
      else if (!$('tktDlg').hidden) closeTktDlg();
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
