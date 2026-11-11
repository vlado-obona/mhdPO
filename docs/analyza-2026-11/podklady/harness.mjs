// Spoločný harness: skutočné plánovanie appky v1.7.3 (app.js + raptor.js) v Node.
// Funkcie sa vyberajú priamo zo zdrojáka app.js (žiadna reimplementácia).
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import * as R from '../../../mhd-app/raptor.js';
const APP = fileURLToPath(new URL('../../../mhd-app/', import.meta.url));
export const D = JSON.parse(readFileSync(APP + 'data/dataset.json', 'utf8'));
export const raptor = new R.Raptor(D);
const src = readFileSync(APP + 'app.js', 'utf8');
function grabFn(name) {
  const m = new RegExp(`^function ${name}\\(`, 'm').exec(src);
  if (!m) throw new Error('chýba funkcia ' + name);
  let i = src.indexOf('{', src.indexOf(')', m.index)), depth = 0, j = i;
  for (; j < src.length; j++) { if (src[j] === '{') depth++; else if (src[j] === '}' && --depth === 0) break; }
  return src.slice(m.index, j + 1);
}
function grabLine(re) { const m = re.exec(src); if (!m) throw new Error('chýba ' + re); return m[0]; }
const parts = [
  grabLine(/^const WALK_SPEED = .*$/m), grabLine(/^const WALK_DETOUR = .*$/m), grabLine(/^const POINT_RADIUS = .*$/m),
  grabLine(/^const norm = .*$/m),
  grabFn('haversine'), grabFn('dateInfoFor'), grabFn('stopSetFor'), grabFn('destStopsFor'), grabFn('straightWalk'),
  grabLine(/^const walkStraight = .*$/m),
  grabLine(/^const TRANSFER_PENALTY = .*$/m), grabFn('rankJourneys'), grabFn('dominates'),
  grabLine(/^const journeyKey = .*$/m), grabFn('withDirect'),
  grabLine(/^const DIRECT_MAX_LATER = .*$/m), grabFn('planWithPrefs'),
];
const prefs = { direct: false };
const api = new Function('D', 'raptor', 'prefs', 'planJourneys', 'leaveTime', 'totalWalk', 'walkOnlySecs',
  parts.join('\n') + '\nreturn { WALK_SPEED, WALK_DETOUR, POINT_RADIUS, norm, haversine, dateInfoFor, stopSetFor, destStopsFor, straightWalk, walkStraight, rankJourneys, dominates, withDirect, planWithPrefs };')(
  D, raptor, prefs, R.planJourneys, R.leaveTime, R.totalWalk, R.walkOnlySecs);
export const { WALK_SPEED, WALK_DETOUR, POINT_RADIUS, norm, haversine, dateInfoFor, stopSetFor, destStopsFor, straightWalk, walkStraight, rankJourneys, planWithPrefs } = api;
export const { planJourneys, leaveTime, totalWalk, walkOnlySecs, tightenJourney } = R;

// skupiny zastávok podľa názvu — presne ako appka (loadData)
const byName = new Map();
D.stops.forEach((s, i) => { let g = byName.get(s.n); if (!g) byName.set(s.n, (g = { kind: 'group', name: s.n, norm: norm(s.n), stops: [], lat: 0, lon: 0 })); g.stops.push(i); });
export const groups = [...byName.values()];
for (const g of groups) { g.lat = g.stops.reduce((a, i) => a + D.stops[i].la, 0) / g.stops.length; g.lon = g.stops.reduce((a, i) => a + D.stops[i].lo, 0) / g.stops.length; }
export const group = (name) => groups.find((g) => g.name === name) || groups.find((g) => g.norm === norm(name)) || groups.find((g) => g.norm.startsWith(norm(name)));
export const point = (lat, lon, label = 'bod') => ({ kind: 'point', lat, lon, label });
export const hms = (s) => `${Math.floor(s / 3600)}:${String(Math.floor((s % 3600) / 60)).padStart(2, '0')}`;
export const secs = (hhmm) => { const [h, m] = hhmm.split(':').map(Number); return h * 3600 + m * 60; };

/** Presne to, čo urobí appka po ťuknutí na „Hľadať“ (search()).
 *  from/to: group(name) alebo point(lat, lon). date 'YYYY-MM-DD', time 'HH:MM' alebo sekundy.
 *  Vracia { journeys (v poradí kariet; [0] = odporúčané), walk (s pešo rovno do cieľa alebo Infinity),
 *           walkFirst, fromStops, toStops, direct, later }. */
export function appSearch(from, to, date, time, { direct = false } = {}) {
  let fromStops = stopSetFor(from); if (!fromStops.size) fromStops = stopSetFor(from, 1500);
  let toStops = destStopsFor(to); if (!toStops.size) toStops = destStopsFor(to, 1500);
  if (!fromStops.size || !toStops.size) return { journeys: [], walk: Infinity, fromStops, toStops, error: 'bez zastávky v okolí' };
  const di = dateInfoFor(date);
  const depTime = typeof time === 'number' ? time : secs(time);
  prefs.direct = direct;
  const walk = walkStraight(from, to, fromStops, toStops);
  const { js, direct: isDirect, later } = planWithPrefs(fromStops, toStops, di, depTime, walk);
  const walkFirst = walk < Infinity && (!js.length || depTime + walk <= Math.min(...js.map((j) => j.arrTime)));
  return { journeys: js, walk, walkFirst, fromStops, toStops, direct: isDirect, later, di, depTime };
}
/** Čitateľný popis spojenia. */
export function describe(j, fromStops) {
  const legs = j.legs.map((l) => l.type === 'ride' ? `${D.routes[l.route].s} ${D.stops[l.from].n} ${hms(l.dep)}→${D.stops[l.to].n} ${hms(l.arr)}`
    : l.type === 'stay' ? 'zostaň sedieť' : `pešo ${D.stops[l.from]?.n ?? '?'}→${D.stops[l.to]?.n ?? '?'} ${Math.round(l.secs / 60)}′`);
  return `odchod ${hms(leaveTime(j, fromStops))} príchod ${hms(j.arrTime)} prestupy ${j.transfers} chôdza ${Math.round(totalWalk(j, fromStops) / 60)}′ [${legs.join(' | ')}]`;
}
