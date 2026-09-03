// Vyhľadávanie spojení nad GTFS datasetom — algoritmus RAPTOR
// (Delling, Pajor, Werneck: Round-Based Public Transit Routing).
//
// Presnosť: pracuje priamo s časmi zo stop_times (žiadna interpolácia),
// kalendár rieši cez calendar + calendar_dates vrátane nočných spojov
// (časy > 24:00 patria k predchádzajúcemu prevádzkovému dňu).

const DAY = 86400;
const MAX_ROUNDS = 5;      // max. 4 prestupy
const HORIZON = 20 * 3600; // hľadáme spoje max. 20 h od zadaného času

export class Raptor {
  constructor(dataset) {
    this.d = dataset;
    // pre každú zastávku zoznam [patternIdx, pozícia v patterne]
    this.patternsAtStop = Array.from({ length: dataset.stops.length }, () => []);
    dataset.patterns.forEach((p, pi) => {
      p.stops.forEach((si, pos) => this.patternsAtStop[si].push([pi, pos]));
    });
    // pešie prestupy ako obojsmerný adjacency list
    this.foot = Array.from({ length: dataset.stops.length }, () => []);
    for (const [a, b, s] of dataset.transfers) {
      this.foot[a].push([b, s]);
      this.foot[b].push([a, s]);
    }
    this._svcCache = new Map();
  }

  // je service aktívny v daný dátum (číslo YYYYMMDD)?
  serviceActive(svcIdx, dateNum, weekday) {
    const key = dateNum;
    let cache = this._svcCache.get(key);
    if (!cache) {
      cache = new Int8Array(this.d.services.length).fill(-1);
      this._svcCache.set(key, cache);
    }
    if (cache[svcIdx] !== -1) return cache[svcIdx] === 1;
    const s = this.d.services[svcIdx];
    let active = false;
    if (s.rem.includes(dateNum)) active = false;
    else if (s.add.includes(dateNum)) active = true;
    else active = s.from <= dateNum && dateNum <= s.to && !!(s.d & (1 << weekday));
    cache[svcIdx] = active ? 1 : 0;
    return active;
  }

  /**
   * @param fromStops Map(stopIdx -> walkSecs) — východiská (0 pri výbere zastávky)
   * @param toStops   Map(stopIdx -> walkSecs) — ciele
   * @param dateInfo  {num: YYYYMMDD, weekday: 0=po..6=ne, prev: {num, weekday}, next: {num, weekday}}
   * @param depTime   sekundy od polnoci daného dňa
   * @returns pole journey objektov (pareto podľa počtu prestupov)
   */
  query(fromStops, toStops, dateInfo, depTime) {
    const N = this.d.stops.length;
    const best = new Float64Array(N).fill(Infinity);
    // parent[k][stop] = ako sme sa sem dostali v kole k
    const rounds = [];
    const arr0 = new Float64Array(N).fill(Infinity);
    const parent0 = new Array(N).fill(null);
    for (const [si, walk] of fromStops) {
      const t = depTime + walk;
      if (t < arr0[si]) {
        arr0[si] = t;
        best[si] = t;
        parent0[si] = { type: 'origin', walk };
      }
    }
    // pešia relaxácia už v kole 0 (od východiska k susedným zastávkam)
    this._relaxFoot(arr0, best, parent0, null);
    rounds.push({ arr: arr0, parent: parent0 });

    let marked = new Set();
    for (let i = 0; i < N; i++) if (arr0[i] < Infinity) marked.add(i);

    const dayOffsets = [
      { o: -1, ...dateInfo.prev },
      { o: 0, num: dateInfo.num, weekday: dateInfo.weekday },
      { o: 1, ...dateInfo.next },
    ];

    for (let k = 1; k < MAX_ROUNDS && marked.size; k++) {
      const prev = rounds[k - 1].arr;
      const arr = new Float64Array(N).fill(Infinity);
      const parent = new Array(N).fill(null);

      // ktoré patterny obsahujú označenú zastávku (s najskoršou pozíciou)
      const queue = new Map(); // patternIdx -> najmenšia pozícia
      for (const si of marked) {
        for (const [pi, pos] of this.patternsAtStop[si]) {
          const cur = queue.get(pi);
          if (cur === undefined || pos < cur) queue.set(pi, pos);
        }
      }
      marked = new Set();

      for (const [pi, startPos] of queue) {
        const p = this.d.patterns[pi];
        let onTrip = null; // {trip, o, boardPos}
        for (let pos = startPos; pos < p.stops.length; pos++) {
          const si = p.stops[pos];
          // vystúpenie
          if (onTrip) {
            const a = onTrip.trip.t[2 * pos] + onTrip.o * DAY;
            if (a < arr[si] && a < best[si] && a <= depTime + HORIZON) {
              arr[si] = a;
              best[si] = a;
              parent[si] = {
                type: 'ride', pattern: pi, trip: onTrip.trip, day: onTrip.o,
                boardPos: onTrip.boardPos, alightPos: pos,
              };
              marked.add(si);
            }
            // skorší príchod na si umožňuje skorší nástup ďalej
            const reach = prev[si];
            if (reach < a - 0.5) {
              const cand = this._earliestTrip(p, pos, reach, dayOffsets);
              if (cand && (cand.trip.t[2 * pos + 1] + cand.o * DAY) < a) onTrip = { ...cand, boardPos: pos };
            }
          } else if (prev[si] < Infinity) {
            const cand = this._earliestTrip(p, pos, prev[si], dayOffsets);
            if (cand) onTrip = { ...cand, boardPos: pos };
          }
        }
      }

      this._relaxFoot(arr, best, parent, marked);
      rounds.push({ arr, parent });
    }

    return this._extract(rounds, fromStops, toStops, depTime);
  }

  _relaxFoot(arr, best, parent, marked) {
    const changed = [];
    for (let i = 0; i < arr.length; i++) if (arr[i] < Infinity) changed.push(i);
    for (const si of changed) {
      // pešo len z miesta, kam sme nedošli pešo (žiadne reťazenie chôdze)
      if (parent[si] && parent[si].type === 'walk') continue;
      for (const [to, secs] of this.foot[si]) {
        const t = arr[si] + secs;
        if (t < arr[to] && t < best[to]) {
          arr[to] = t;
          best[to] = t;
          parent[to] = { type: 'walk', from: si, secs };
          if (marked) marked.add(to);
        }
      }
    }
  }

  // najskorší spoj patternu p nastupiteľný na pozícii pos v čase >= tau
  _earliestTrip(p, pos, tau, dayOffsets) {
    let bestTrip = null, bestDep = Infinity;
    for (const day of dayOffsets) {
      const shift = day.o * DAY;
      for (const trip of p.trips) {
        const dep = trip.t[2 * pos + 1] + shift;
        if (dep < tau || dep >= bestDep) continue;
        if (!this.serviceActive(trip.sv, day.num, day.weekday)) continue;
        bestTrip = { trip, o: day.o };
        bestDep = dep;
      }
    }
    return bestTrip;
  }

  _extract(rounds, fromStops, toStops, depTime) {
    const journeys = [];
    let bestSoFar = Infinity;
    for (let k = 1; k < rounds.length; k++) {
      // najlepší cieľ v kole k
      let bestStop = -1, bestT = Infinity, bestWalk = 0;
      for (const [si, walk] of toStops) {
        // cieľ musí byť dosiahnutý jazdou/prestupom v kole k
        const a = rounds[k].arr[si];
        if (a < Infinity && a + walk < bestT) { bestT = a + walk; bestStop = si; bestWalk = walk; }
      }
      if (bestStop < 0 || bestT >= bestSoFar) continue;
      const legs = this._path(rounds, k, bestStop);
      if (!legs) continue;
      bestSoFar = bestT;
      journeys.push({
        depTime: legs[0].dep,
        arrTime: bestT,
        finalWalk: bestWalk,
        transfers: legs.filter((l) => l.type === 'ride').length - 1,
        legs,
      });
    }
    return journeys;
  }

  _path(rounds, k, stop) {
    const legs = [];
    let si = stop, round = k;
    let guard = 0;
    while (round >= 0 && guard++ < 50) {
      const par = rounds[round].parent[si];
      if (!par) {
        // dosiahnutý už v skoršom kole rovnakou cestou
        round--;
        continue;
      }
      if (par.type === 'origin') break;
      if (par.type === 'walk') {
        legs.unshift({
          type: 'walk', from: par.from, to: si, secs: par.secs,
          dep: rounds[round].arr[si] - par.secs, arr: rounds[round].arr[si],
        });
        si = par.from;
        // chôdza neminie kolo — parent v tom istom kole
        continue;
      }
      // ride
      const p = this.d.patterns[par.pattern];
      const t = par.trip;
      const shift = par.day * DAY;
      legs.unshift({
        type: 'ride',
        route: p.r,
        head: t.h,
        from: p.stops[par.boardPos],
        to: p.stops[par.alightPos],
        dep: t.t[2 * par.boardPos + 1] + shift,
        arr: t.t[2 * par.alightPos] + shift,
        stops: p.stops.slice(par.boardPos, par.alightPos + 1),
        times: t.t.slice(2 * par.boardPos, 2 * par.alightPos + 2).map((x) => x + shift),
      });
      si = p.stops[par.boardPos];
      round--;
    }
    if (guard >= 50) return null;
    return legs.length ? legs : null;
  }
}

/** Viac odchodov za sebou: opakuje query s posunutým časom odchodu. */
export function planJourneys(raptor, fromStops, toStops, dateInfo, depTime, want = 4) {
  const out = [];
  const seen = new Set();
  let t = depTime;
  for (let i = 0; i < want * 3 && out.length < want; i++) {
    const js = raptor.query(fromStops, toStops, dateInfo, t);
    if (!js.length) break;
    // pareto výber: netriviálne alternatívy s menej prestupmi tiež ukáž
    let advanced = false;
    for (const j of js) {
      const key = j.legs.map((l) => l.type === 'ride' ? `${l.route}:${l.from}:${l.to}:${l.dep}` : `w${l.from}-${l.to}`).join('|');
      if (!seen.has(key)) {
        seen.add(key);
        out.push(j);
        advanced = true;
      }
    }
    const firstRide = js[js.length - 1].legs.find((l) => l.type === 'ride');
    if (!firstRide) break;
    const next = firstRide.dep + 60;
    if (next <= t) break;
    t = next;
    if (!advanced && i > want * 2) break;
  }
  // vyhoď dominované spojenia (existuje neskorší odchod s rovnakým či
  // skorším príchodom a nie horším počtom prestupov)
  const filtered = out.filter((j) => !out.some((k) =>
    k !== j && k.depTime >= j.depTime && k.arrTime <= j.arrTime && k.transfers <= j.transfers &&
    (k.depTime > j.depTime || k.arrTime < j.arrTime || k.transfers < j.transfers)));
  filtered.sort((a, b) => a.arrTime - b.arrTime || a.transfers - b.transfers);
  return filtered.slice(0, want + 2);
}
