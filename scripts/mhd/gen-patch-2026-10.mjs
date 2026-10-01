#!/usr/bin/env node
// Vygeneruje opravu GTFS (feed 1382, CP september 2026) na cestovné poriadky
// DPMP platné od 1. 10. 2026 → data/gtfs-patches/1382-dpmp-2026-10-01.json
//
// Zdroje (stiahnuté do data/dpmp-lcp/):
//   - oznam DPMP „Zmeny v cestovných poriadkoch 23 spojov MHD - od 1. októbra 2026“
//   - oficiálne linkové CP „aktualizácia k 1. 10. 2026“ (PDF, rozparsované do lcp.json)
//
// Pravidlá (nič sa nevymýšľa):
//   - menia sa len spoje uvedené v ozname DPMP; časy berieme z PDF platného od 1.10.2026,
//   - nový spoj = kópia existujúceho spoja GTFS rovnakého variantu trasy (rovnaké
//     písmeno v PDF), posunutá na odchod z PDF → zastávky aj jazdné doby z GTFS,
//   - linka 17 Širpo → Sídlisko III nemá v GTFS žiadny spoj: zastávky (nástupištia)
//     sú zložené z úsekov, ktoré v GTFS jazdia iné linky, časy = odchod + posun z PDF,
//   - každý vytvorený/zmenený spoj sa overí proti PDF (posuny zastávok); pri nezhode skončí chybou.
// Spoje mimo oznamu ostávajú podľa GTFS (drobné rozdiely PDF↔GTFS: CHANGELOG).
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';

const GT = 'data/gtfs-presov';
const OUT = 'data/gtfs-patches/1382-dpmp-2026-10-01.json';
const LCP = JSON.parse(readFileSync('data/dpmp-lcp/lcp.json', 'utf8'));

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
const hms = (s) => [Math.floor(s / 3600), Math.floor(s / 60) % 60, s % 60].map((x) => String(x).padStart(2, '0')).join(':');
const hm = (s) => `${Math.floor(s / 3600)}:${String(Math.floor(s / 60) % 60).padStart(2, '0')}`;
const at = (t) => { const [h, m] = t.split(':').map(Number); return h * 3600 + m * 60; };

const feed = csv(`${GT}/feed_info.txt`)[0];
if (feed.feed_version !== '1382') throw new Error(`oprava je pre feed 1382, nie ${feed.feed_version}`);
const stops = new Map(csv(`${GT}/stops.txt`).map((s) => [s.stop_id, s]));
const trips = new Map(csv(`${GT}/trips.txt`).map((t) => [t.trip_id, t]));
const ST = new Map();
for (const r of csv(`${GT}/stop_times.txt`)) {
  let a = ST.get(r.trip_id);
  if (!a) ST.set(r.trip_id, (a = []));
  a.push(r);
}
for (const a of ST.values()) a.sort((x, y) => Number(x.stop_sequence) - Number(y.stop_sequence));

// ── porovnanie s PDF ────────────────────────────────────────────────
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
function block(line, smer) {
  const b = LCP.find((x) => x.line === line && x.smer === smer);
  if (!b) throw new Error(`PDF: chýba ${line} smer ${smer}`);
  return b;
}
function pdfHas(b, col, T, flags) {
  return b.deps[col].some((d) => d.h * 3600 + d.m * 60 === T && d.flags === flags);
}
// odchýlky časov spoja od PDF: kotva = prvá zastávka spoja, ktorá je v zozname PDF,
// jej odchod musí byť T (spoj „zo zastávky X“: T = odchod z X)
function deviations(b, stList, T) {
  const m = []; let k = 0;
  stList.forEach((s, j) => {
    const name = stops.get(s.stop_id).stop_name;
    for (let i = k; i < b.stops.length; i++) if (nameMatch(name, b.stops[i].name)) { m.push({ j, i }); k = i + 1; return; }
  });
  if (m.length < 2) throw new Error(`spoj sa nedá priradiť k PDF ${b.line} ${b.smer}`);
  const a = m[0];
  const base = sec(stList[a.j].departure_time) - b.stops[a.i].off * 60;
  if (sec(stList[a.j].departure_time) !== T) throw new Error(`kotva ${stops.get(stList[a.j].stop_id).stop_name}: ${hm(sec(stList[a.j].departure_time))} ≠ PDF ${hm(T)}`);
  return m.map(({ j, i }) => {
    const s = stList[j], p = b.stops[i];
    const last = j === stList.length - 1, first = j === 0;
    const dA = first ? 0 : sec(s.arrival_time) - (base + p.arr * 60);
    const dD = last ? 0 : sec(s.departure_time) - (base + p.off * 60);
    return `${p.name}:${dA / 60}/${dD / 60}`;
  }).filter((x) => !x.endsWith(':0/0'));
}

const removeTrips = [];
const addTrips = [];
const log = [];
const tripRow = (t) => ({
  route_id: t.route_id, service_id: t.service_id, trip_headsign: t.trip_headsign,
  direction_id: t.direction_id, shape_id: t.shape_id || '',
});
function shifted(tid, delta) {
  return ST.get(tid).map((r) => [r.stop_id, hms(sec(r.arrival_time) + delta), hms(sec(r.departure_time) + delta)]);
}
const asSt = (rows) => rows.map(([stop_id, a, d]) => ({ stop_id, arrival_time: a, departure_time: d }));

// verifikácia: spoj je v PDF (stĺpec školský deň) a odchýľky = odchýľky vzoru
function verify(b, flags, T, rows, tmpl) {
  if (!pdfHas(b, 'school', T, flags)) throw new Error(`PDF ${b.line} ${b.smer}: chýba ${hm(T)}${flags}`);
  const dev = deviations(b, asSt(rows), T);
  if (tmpl) {
    const ts = ST.get(tmpl.trip);
    const tdev = deviations(b, ts, sec(ts[0].departure_time) + (tmpl.anchorOff || 0));
    if (dev.join() !== tdev.join()) throw new Error(`${b.line} ${hm(T)}: profil ${dev} ≠ vzor ${tmpl.trip} ${tdev}`);
  } else if (dev.length) throw new Error(`${b.line} ${hm(T)}: odchýlky od PDF ${dev}`);
  return dev;
}

// nový spoj = kópia vzoru posunutá tak, aby odchod z kotvy bol T
let seq = 0;
function cloneTrip({ line, smer, time, flags = '', tmpl, why, headsign }) {
  const b = block(line, smer);
  const T = at(time);
  const src = ST.get(tmpl);
  if (!src) throw new Error(`vzor ${tmpl} neexistuje`);
  const delta = T - sec(src[0].departure_time);
  const rows = shifted(tmpl, delta);
  const dev = verify(b, flags, T, rows, { trip: tmpl });
  const id = `dpmp1026_${line}_${time.replace(':', '')}${flags ? '_' + flags : ''}_${++seq}`;
  addTrips.push({ trip_id: id, ...tripRow(trips.get(tmpl)), ...(headsign ? { trip_headsign: headsign } : {}), note: `${why}; vzor ${tmpl}`, stop_times: rows });
  log.push(`+ ${line.padEnd(3)} ${smer.padEnd(16)} ${time}${flags} (vzor ${tmpl}${dev.length ? `, odchýlky ako vzor: ${dev.join(' ')}` : ''})`);
}
// posun existujúceho spoja na nový odchod (zmena časov podľa oznamu)
function shiftTrip({ line, smer, tid, from, to, flags = '', why }) {
  const b = block(line, smer);
  const src = ST.get(tid);
  if (hm(sec(src[0].departure_time)) !== from) throw new Error(`${tid}: odchod ${hm(sec(src[0].departure_time))} ≠ ${from}`);
  const T = at(to);
  const rows = shifted(tid, T - sec(src[0].departure_time));
  verify(b, flags, T, rows, { trip: tid, anchorOff: 0 });
  removeTrips.push(tid);
  addTrips.push({ trip_id: tid, ...tripRow(trips.get(tid)), note: why, stop_times: rows });
  log.push(`~ ${line.padEnd(3)} ${smer.padEnd(16)} ${from} → ${to}${flags} (${tid})`);
}
// spoj s explicitne zadanými zastávkami; časy = T + posun z PDF
function explicitTrip({ line, smer, time, flags = '', stopIds, base, replace, why, headsign, direction_id, shape_id = '' }) {
  const b = block(line, smer);
  const T = at(time);
  let k = 0;
  const rows = stopIds.map((sid) => {
    const name = stops.get(sid)?.stop_name;
    if (!name) throw new Error(`zastávka ${sid} neexistuje`);
    for (let i = k; i < b.stops.length; i++) {
      if (nameMatch(name, b.stops[i].name)) {
        k = i + 1;
        return [sid, hms(T + (b.stops[i].arr - b.stops[0].off) * 60), hms(T + (b.stops[i].off - b.stops[0].off) * 60)];
      }
    }
    throw new Error(`${line} ${smer}: zastávka ${name} nie je v PDF`);
  });
  rows[0][1] = rows[0][2];
  rows.at(-1)[2] = rows.at(-1)[1];
  verify(b, flags, T, rows, null);
  const id = replace || `dpmp1026_${line}_${time.replace(':', '')}${flags ? '_' + flags : ''}_${++seq}`;
  if (replace) removeTrips.push(replace);
  addTrips.push({ trip_id: id, ...(base ? tripRow(trips.get(base)) : {}), route_id: line, service_id: '1382_PD',
    ...(headsign ? { trip_headsign: headsign } : {}), ...(direction_id !== undefined ? { direction_id } : {}),
    ...(shape_id !== undefined && !base ? { shape_id } : {}), note: why, stop_times: rows });
  log.push(`${replace ? '~' : '+'} ${line.padEnd(3)} ${smer.padEnd(16)} ${time}${flags} (${replace ? 'nahradený ' + replace : 'nová trasa zo zastávok GTFS'})`);
}

const OBN = 'obnovený spoj v školských dňoch (oznam DPMP 1.10.2026)';

// ── linka 17 ────────────────────────────────────────────────────────
cloneTrip({ line: '17', smer: 'Širpo', time: '5:32', tmpl: '1382_7203', why: OBN });
explicitTrip({ line: '17', smer: 'Sídlisko III', time: '14:01', why: OBN, headsign: 'Sídlisko III', direction_id: '0',
  // Širpo, Družstevná, Strojnícka, Ľubochnianska (úseky linky 33/7), Dopravný podnik, Rázc. Kúty,
  // Duklianska (21/28/1/7), Poliklinika (E), Levočská (23/11/18), Volgogradská … Sídlisko III (34/29/8)
  stopIds: ['343', '344', '345', '346', '341', '342', '214', '156', '157', '188', '189', '190', '191', '192', '430'] });

// ── linka 28 ────────────────────────────────────────────────────────
cloneTrip({ line: '28', smer: 'Ľubotice', time: '6:38', flags: 'J', tmpl: '1382_7103', why: `${OBN}; nadväzuje na linku 44 o 6:20` });
cloneTrip({ line: '28', smer: 'Delňa', time: '6:53', flags: 'H', tmpl: '1382_1190', why: `${OBN}; z Trojice ďalej ako linka 32 (7:10)` });

// ── linka 32 ────────────────────────────────────────────────────────
cloneTrip({ line: '32', smer: 'Trojica', time: '7:56', tmpl: '1382_7081', why: OBN });
cloneTrip({ line: '32', smer: 'Sibírska', time: '7:10', flags: 'A', tmpl: '1382_421', why: OBN });
cloneTrip({ line: '32', smer: 'Sibírska', time: '12:42', flags: 'A', tmpl: '1382_421', why: OBN });
for (const t of ['14:57', '15:37', '15:57', '16:37']) cloneTrip({ line: '32', smer: 'Sibírska', time: t, tmpl: '1382_7228', why: OBN });
// predĺžené spoje 12:57 a 13:37: doteraz z Trojice (13:02, 13:42), od 1.10. už z Okružnej
for (const [t, old] of [['12:57', '1382_7401'], ['13:37', '1382_247']]) {
  cloneTrip({ line: '32', smer: 'Sibírska', time: t, tmpl: '1382_7228', why: `predĺžený spoj (z Okružnej namiesto z Trojice), nahrádza ${old}` });
  removeTrips.push(old);
}

// ── linka 32A ───────────────────────────────────────────────────────
for (const t of ['12:46', '13:26', '14:46', '15:26', '15:46', '16:26', '16:46']) cloneTrip({ line: '32A', smer: 'Okružná', time: t, tmpl: '1382_7221', why: OBN });

// ── linka 34 ────────────────────────────────────────────────────────
// B = neobslúži Levočskú, Jilemnického, Košickú (vzor 6:25B), C = cez Clementisovu (vzor 16:03)
for (const t of ['14:25', '15:55']) cloneTrip({ line: '34', smer: 'Pod Šalgovíkom', time: t, flags: 'B', tmpl: '1382_3177', why: OBN });
for (const t of ['15:03', '16:33']) cloneTrip({ line: '34', smer: 'Sídlisko III', time: t, flags: 'C', tmpl: '1382_7428', why: OBN });
// 16:03 je v PDF od 1.10. bez „C“ (cez Levočskú) — cez Clementisovu ide nový 16:33
cloneTrip({ line: '34', smer: 'Sídlisko III', time: '16:03', tmpl: '1382_3192', why: 'PDF od 1.10.2026: 16:03 cez Levočskú (Clementisovu obsluhuje obnovený 16:33C); nahrádza 1382_7428' });
removeTrips.push('1382_7428');

// ── linka 39 ────────────────────────────────────────────────────────
cloneTrip({ line: '39', smer: 'Švábska', time: '7:45', tmpl: '1382_7282', why: `${OBN}; nahrádza čiastkový spoj 1382_2570 (Žel. stanica 8:03 → Lomnická)` });
removeTrips.push('1382_2570');

// ── časové posuny a zmeny trás ──────────────────────────────────────
// 14: spoj 7:00 zo Záborského predĺžený po Trojicu (namiesto Kpt. Nálepku)
explicitTrip({ line: '14', smer: 'Kanaš', time: '7:00', flags: 'T', base: '1382_6975', replace: '1382_6975', headsign: 'Trojica',
  why: 'oznam DPMP: spoj 7:00 zo Záborského predĺžený po Trojicu',
  stopIds: [...ST.get('1382_6975').slice(0, -1).map((r) => r.stop_id), '330', '2', '1'] });
shiftTrip({ line: '21', smer: 'Fintice', tid: '1382_1175', from: '7:50', to: '7:56', flags: 'B', why: 'oznam DPMP: posun 7:50 → 7:56' });
shiftTrip({ line: '29', smer: 'Nemocnica', tid: '1382_7244', from: '7:15', to: '7:03', why: 'oznam DPMP: posun 7:15 → 7:03' });
shiftTrip({ line: '29', smer: 'Nemocnica', tid: '1382_241', from: '7:43', to: '7:18', flags: 'N', why: 'oznam DPMP: posun 7:43 → 7:18' });
shiftTrip({ line: '29', smer: 'Nemocnica', tid: '1382_7246', from: '8:15', to: '8:03', why: 'oznam DPMP: posun 8:15 → 8:03' });
shiftTrip({ line: '29', smer: 'Sídlisko III', tid: '1382_7245', from: '7:33', to: '7:21', why: 'oznam DPMP: posun 7:33 → 7:21' });
shiftTrip({ line: '29', smer: 'Sídlisko III', tid: '1382_7247', from: '8:33', to: '8:21', why: 'oznam DPMP: posun 8:33 → 8:21' });
shiftTrip({ line: '33', smer: 'Širpo', tid: '1382_7450', from: '18:40', to: '18:05', flags: 'A', why: 'oznam DPMP: posun 18:40 → 18:05' });

// ── kalendár: 1.–28. 10. 2026 (29.–30. 10. sú jesenné prázdniny → iný CP) ──
const addDates = { '1382_PD': [], '1382_SO': [], '1382_NE': [] };
for (let d = 1; d <= 28; d++) {
  const date = new Date(Date.UTC(2026, 9, d));
  const wd = date.getUTCDay();
  const key = wd === 0 ? '1382_NE' : wd === 6 ? '1382_SO' : '1382_PD';
  addDates[key].push(`202610${String(d).padStart(2, '0')}`);
}

// kontrola: každý odstránený spoj, ktorý sa nenahrádza rovnakým ID, je naozaj v GTFS
for (const t of removeTrips) if (!trips.has(t)) throw new Error(`odstraňovaný spoj ${t} nie je v GTFS`);
const restored = log.filter((l) => l.startsWith('+')).length;

const patch = {
  id: 'dpmp-2026-10-01',
  baseFeedVersion: '1382',
  title: 'Cestovné poriadky DPMP od 1. 10. 2026',
  validFrom: '20261001',
  validTo: '20261028',
  sources: [
    'https://www.dpmp.sk — oznam „Zmeny v cestovných poriadkoch 23 spojov MHD - od 1. októbra 2026“ (data/dpmp-lcp/news-1519.html)',
    'https://www.dpmp.sk — Linkové cestovné poriadky, aktualizácia k 1. 10. 2026 (data/dpmp-lcp/LCP-2026-10-01.pdf)',
  ],
  notes: [
    '29.–30. 10. 2026 sú jesenné prázdniny (CP „pracovný deň-prázdniny“) — v GTFS 1382 nie je, preto platnosť do 28. 10. 2026.',
    'Spoje mimo oznamu DPMP ostávajú podľa GTFS 1382.',
  ],
  calendar: { addDates, removeBefore: '20261001' },
  removeTrips: [...new Set(removeTrips)],
  addTrips,
  summary: log,
};
mkdirSync('data/gtfs-patches', { recursive: true });
writeFileSync(OUT, JSON.stringify(patch, null, 1) + '\n');
console.log(log.join('\n'));
console.log(`\nnové spoje: ${restored}, odstránené/nahradené: ${patch.removeTrips.length}, spolu zapísaných: ${addTrips.length}`);
console.log(`PD ${addDates['1382_PD'].length} dní, SO ${addDates['1382_SO'].length}, NE ${addDates['1382_NE'].length} → ${OUT}`);
