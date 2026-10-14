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
    // „zostaň sedieť“: spoj pokračuje ako iná linka (v GTFS dva spoje)
    this.cont = new Map();
    for (const [pi, ti, pi2, ti2] of dataset.links || []) {
      this.cont.set(dataset.patterns[pi].trips[ti], { pi: pi2, trip: dataset.patterns[pi2].trips[ti2] });
    }
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
   * @param opts.toExtra Map(stopIdx -> sekundy) — prirážka pri výbere cieľovej
   *                  zastávky (okolité zastávky: chôdza sa počíta dvojnásobne,
   *                  aby autobus priamo na zastávku nevyhral len o pár sekúnd)
   * @param opts.accept (journey) => bool — spojenie, ktoré neprejde (napr. horšie
   *                  ako chôdza), sa nevráti a neblokuje ďalšie ciele ani kolá
   * @returns pole journey objektov (pareto podľa počtu prestupov)
   */
  query(fromStops, toStops, dateInfo, depTime, opts = {}) {
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
    // cieľová zastávka dosiahnuteľná pešo nesmie zablokovať príchod autobusom
    // (inak vyhrá okolitá zastávka a chôdza späť); spojenia horšie ako chôdza
    // rovno do cieľa vyradí planJourneys
    for (const si of toStops.keys()) best[si] = Infinity;
    rounds.push({ arr: arr0, parent: parent0 });

    let marked = new Set();
    for (let i = 0; i < N; i++) if (arr0[i] < Infinity) marked.add(i);
    // „zostaň sedieť“ z predošlého kola: pattern nadväzujúceho spoja →
    // {jazda po konečnú, next: {pi, trip}} — smie sa nastúpiť LEN do toho spoja
    let stays = new Map();

    const dayOffsets = [
      { o: -1, ...dateInfo.prev },
      { o: 0, num: dateInfo.num, weekday: dateInfo.weekday },
      { o: 1, ...dateInfo.next },
    ];

    for (let k = 1; k < MAX_ROUNDS && (marked.size || stays.size); k++) {
      const prev = rounds[k - 1].arr;
      const prevStays = stays;
      stays = new Map();
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
      for (const sp of prevStays.values()) queue.set(sp.next.pi, 0);
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
                boardPos: onTrip.boardPos, alightPos: pos, viaStay: onTrip.viaStay,
              };
              marked.add(si);
            }
            // na konečnej spoja, ktorý pokračuje ako iná linka: cestujúci sedí
            // ďalej → v ďalšom kole pokračuje práve nadväzujúcim spojom (nie
            // hocijakým autobusom z tej zastávky — to by bol prestup)
            // (kľúč = nadväzujúci pattern: z jednej zastávky môže pokračovať
            // viac liniek; z jedného patternu stačí najskorší spoj)
            if (pos === p.stops.length - 1 && this.cont.size) {
              const c = this.cont.get(onTrip.trip);
              const dep2 = c && c.trip.t[1] + onTrip.o * DAY;
              const sp = c && stays.get(c.pi);
              if (c && a <= depTime + HORIZON && (!sp || dep2 < sp.dep2)) {
                stays.set(c.pi, {
                  pattern: pi, trip: onTrip.trip, day: onTrip.o, viaStay: onTrip.viaStay,
                  boardPos: onTrip.boardPos, alightPos: pos, arr: a, next: c, dep2,
                });
              }
            }
            // skorší príchod na si umožňuje skorší nástup ďalej
            const reach = prev[si];
            if (reach < a - 0.5) {
              const cand = this._earliestTrip(p, pos, reach, dayOffsets);
              if (cand && (cand.trip.t[2 * pos + 1] + cand.o * DAY) < a) onTrip = { ...cand, boardPos: pos };
            }
          } else {
            let cand = prev[si] < Infinity ? this._earliestTrip(p, pos, prev[si], dayOffsets) : null;
            if (cand) cand = { ...cand, boardPos: pos };
            // sedí ďalej v tom istom autobuse (pri rovnakom odchode má prednosť)
            const sp = pos === 0 ? prevStays.get(pi) : null;
            if (sp) {
              if (!cand || sp.dep2 <= cand.trip.t[2 * pos + 1] + cand.o * DAY) {
                cand = { trip: sp.next.trip, o: sp.day, boardPos: 0, viaStay: true };
              }
            }
            if (cand) onTrip = cand;
          }
        }
      }

      this._relaxFoot(arr, best, parent, marked);
      rounds.push({ arr, parent, stays });
    }

    return this._extract(rounds, toStops, opts.toExtra, opts.accept);
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

  // pre každé kolo najlepší cieľ (príchod s prirážkou za okolitú zastávku),
  // ktorý prejde kontrolou accept; odmietnutý sa vráti len ako js.rejected
  // (aby planJourneys vedel posunúť čas) a neblokuje ďalšie kolá
  _extract(rounds, toStops, toExtra, accept) {
    const journeys = [];
    let bestSoFar = Infinity;
    for (let k = 1; k < rounds.length; k++) {
      const cands = [];
      for (const [si, walk] of toStops) {
        // cieľ musí byť dosiahnutý jazdou/prestupom v kole k
        const a = rounds[k].arr[si];
        if (a === Infinity) continue;
        // okolitá zastávka len priamo z autobusu (nie pešo z inej + ďalej pešo)
        const x = toExtra?.get(si) || 0;
        if (x && rounds[k].parent[si]?.type === 'walk') continue;
        cands.push({ si, sc: a + walk + x, arr: a + walk, walk });
      }
      cands.sort((p, q) => p.sc - q.sc);
      for (const c of cands) {
        if (c.sc >= bestSoFar) break;
        const legs = this._path(rounds, k, c.si);
        if (!legs) continue;
        const j = {
          depTime: legs[0].dep,
          arrTime: c.arr,
          score: c.sc,
          finalWalk: c.walk,
          // sedenie v tom istom autobuse (iné číslo linky) nie je prestup
          transfers: legs.filter((l) => l.type === 'ride').length - 1 - legs.filter((l) => l.type === 'stay').length,
          legs,
        };
        if (accept && !accept(j)) { journeys.rejected ??= j; continue; }
        bestSoFar = c.sc;
        journeys.push(j);
        break;
      }
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
      // jazda; ak sa do nej len „sedelo ďalej“, pred ňou je jazda po konečnú
      // z predošlého kola a medzi nimi úsek „zostaň sedieť“
      let rp = par, p;
      for (;;) {
        p = this.d.patterns[rp.pattern];
        legs.unshift(this._rideLeg(rp.pattern, rp.trip, rp.day, rp.boardPos, rp.alightPos));
        if (!rp.viaStay) break;
        round--;
        const sp = round >= 1 && rounds[round].stays?.get(rp.pattern);
        if (!sp) return null;
        legs.unshift(this._stayLeg(sp.pattern, sp.arr, rp.pattern));
        rp = sp;
      }
      si = p.stops[rp.boardPos];
      round--;
    }
    if (guard >= 50) return null;
    return legs.length ? legs : null;
  }

  _rideLeg(pi, t, day, b, a) {
    const p = this.d.patterns[pi];
    const shift = day * DAY;
    return {
      type: 'ride',
      route: p.r,
      head: t.h,
      from: p.stops[b],
      to: p.stops[a],
      dep: t.t[2 * b + 1] + shift,
      arr: t.t[2 * a] + shift,
      stops: p.stops.slice(b, a + 1),
      times: t.t.slice(2 * b, 2 * a + 2).map((x) => x + shift),
      pattern: pi, day,
      boardPos: b, alightPos: a,
    };
  }

  // „zostaň sedieť“: z konečnej patternu pi1 na začiatok nadväzujúceho pi2
  _stayLeg(pi1, arr, pi2) {
    const p1 = this.d.patterns[pi1];
    return { type: 'stay', from: p1.stops[p1.stops.length - 1], to: this.d.patterns[pi2].stops[0], secs: 0, dep: arr, arr };
  }

  /**
   * Všetky spojenia bez prestupu (jedna jazda, prípadne „zostaň sedieť“ v tom
   * istom autobuse) s odchodom do HORIZON. Na rozdiel od RAPTORu prejde každý
   * spoj, nielen najskorší z linky — nadväznosť na inú linku má len niektorý
   * spoj. Nástup tam, kam je najmenej chôdze a autobus sa ešte stihne.
   * Výstup sa volí podľa príchodu s prirážkou opts.toExtra (ako v query).
   * @returns nedominované spojenia (neskorší odchod = skorší príchod), podľa odchodu
   */
  directJourneys(fromStops, toStops, dateInfo, depTime, opts = {}) {
    const extra = opts.toExtra;
    const walkOnly = opts.walkOnly ?? Infinity; // spojenie musí byť lepšie ako chôdza (beatsWalking)
    const d = this.d, N = d.stops.length, end = depTime + HORIZON;
    // kolo 0 ako v query: východiská + pešo k susedným zastávkam
    const arr0 = new Float64Array(N).fill(Infinity);
    const best = new Float64Array(N).fill(Infinity);
    const par0 = new Array(N).fill(null);
    for (const [si, walk] of fromStops) {
      const t = depTime + walk;
      if (t < arr0[si]) { arr0[si] = t; best[si] = t; par0[si] = { type: 'origin', walk }; }
    }
    this._relaxFoot(arr0, best, par0, null);
    // z miesta výstupu do cieľa: priamo (cieľová zastávka) alebo pešo k nej
    const exit = new Map(); // stop -> {to, foot, secs, sc}
    for (const [ti, w] of toStops) {
      const x = extra?.get(ti) || 0;
      const c = exit.get(ti);
      if (!c || w + x < c.sc) exit.set(ti, { to: ti, foot: 0, secs: w, sc: w + x });
      if (x) continue; // okolitá zastávka len priamo z autobusu (ako v _extract)
      for (const [s2, f] of this.foot[ti]) {
        const c2 = exit.get(s2);
        if (!c2 || f + w + x < c2.sc) exit.set(s2, { to: ti, foot: f, secs: f + w, sc: f + w + x });
      }
    }
    const days = [
      { o: -1, ...dateInfo.prev },
      { o: 0, num: dateInfo.num, weekday: dateInfo.weekday },
      { o: 1, ...dateInfo.next },
    ];
    const pats = new Set();
    for (let si = 0; si < N; si++) if (arr0[si] < Infinity) for (const [pi] of this.patternsAtStop[si]) pats.add(pi);
    const cands = [];
    for (const pi of pats) {
      const p = d.patterns[pi], last = p.stops.length - 1;
      for (const day of days) {
        const shift = day.o * DAY;
        for (const trip of p.trips) {
          if (trip.t[2 * last] + shift < depTime || trip.t[1] + shift > end) continue;
          if (!this.serviceActive(trip.sv, day.num, day.weekday)) continue;
          let b = -1, bw = Infinity, top = null;
          const consider = (chain, a, si, w0) => {
            const e = exit.get(si);
            if (!e) return;
            // zbytočná jazda: na miesto výstupu alebo k cieľovej zastávke sa dá
            // od odchodu z miesta dôjsť pešo skôr (napr. jedna zastávka a späť)
            const lv = chain[0].trip.t[2 * chain[0].b + 1] + shift - w0 - depTime;
            if (lv + arr0[si] <= a || lv + arr0[e.to] <= a + e.foot) return;
            const total = a + e.secs, score = a + e.sc, walk = w0 + e.secs;
            if (walkOnly < Infinity && !(lv + depTime + walkOnly > total || walk < walkOnly - 120)) return;
            if (!top || score < top.score || (score === top.score && walk < top.walk)) {
              top = { total, score, walk, chain, exit: e, a, bw: w0 };
            }
          };
          for (let pos = 0; pos <= last; pos++) {
            const si = p.stops[pos];
            if (b >= 0) {
              const a = trip.t[2 * pos] + shift;
              if (a > end) break;
              consider([{ pi, trip, b, a: pos }], a, si, bw);
            }
            const dep = trip.t[2 * pos + 1] + shift;
            // (pri rovnakej chôdzi neskorší nástup = neskorší odchod z miesta)
            if (pos < last && arr0[si] <= dep && dep <= end && arr0[si] - depTime <= bw) { b = pos; bw = arr0[si] - depTime; }
          }
          if (b < 0) continue;
          // autobus pokračuje ako iná linka — sedí sa ďalej
          let chain = [{ pi, trip, b, a: last }], cur = trip;
          const bw0 = bw;
          for (let hop = 1; hop < MAX_ROUNDS - 1; hop++) {
            const c = this.cont.get(cur);
            if (!c) break;
            const p2 = d.patterns[c.pi], last2 = p2.stops.length - 1;
            for (let pos = 1; pos <= last2; pos++) {
              const a = c.trip.t[2 * pos] + shift;
              if (a > end) break;
              consider([...chain, { pi: c.pi, trip: c.trip, b: 0, a: pos }], a, p2.stops[pos], bw0);
            }
            chain = [...chain, { pi: c.pi, trip: c.trip, b: 0, a: last2 }];
            cur = c.trip;
          }
          // odchod z miesta: nástup najlepšieho výstupu mínus chôdza k nemu
          if (top) cands.push({ ...top, o: day.o, leave: trip.t[2 * top.chain[0].b + 1] + shift - top.bw });
        }
      }
    }
    // nedominované: od najneskoršieho odchodu, nechaj len tie so skorším príchodom
    cands.sort((x, y) => y.leave - x.leave || x.score - y.score || x.walk - y.walk);
    const keep = [];
    let minT = Infinity;
    for (const c of cands) if (c.score < minT) { keep.push(c); minT = c.score; }
    keep.reverse();
    return keep.map((c) => {
      const legs = [];
      const p0 = d.patterns[c.chain[0].pi], bStop = p0.stops[c.chain[0].b];
      const par = par0[bStop];
      if (par?.type === 'walk') legs.push({ type: 'walk', from: par.from, to: bStop, secs: par.secs, dep: arr0[bStop] - par.secs, arr: arr0[bStop] });
      c.chain.forEach((r, i) => {
        if (i) legs.push(this._stayLeg(c.chain[i - 1].pi, legs[legs.length - 1].arr, r.pi));
        legs.push(this._rideLeg(r.pi, r.trip, c.o, r.b, r.a));
      });
      if (c.exit.foot) {
        const lr = legs[legs.length - 1];
        legs.push({ type: 'walk', from: lr.to, to: c.exit.to, secs: c.exit.foot, dep: c.a, arr: c.a + c.exit.foot });
      }
      return { depTime: legs[0].dep, arrTime: c.total, score: c.score, finalWalk: toStops.get(c.exit.to), transfers: 0, legs };
    });
  }
}

/**
 * Optimalizácia čakania: posunie odchod čo najneskôr pri ZACHOVANOM príchode.
 * RAPTOR nájde najskorší príchod, ale prvé legy môžu byť zbytočne skoré —
 * ak ide neskorší spoj tej istej linky, ktorý prestup ešte stihne, vyberie
 * sa ten (menej čakania doma aj na prestupe). Pracuje len so spojmi z CP.
 */
export function tightenJourney(raptor, journey, dateInfo) {
  const legs = journey.legs;
  const dayOffsets = [
    { o: -1, ...dateInfo.prev },
    { o: 0, num: dateInfo.num, weekday: dateInfo.weekday },
    { o: 1, ...dateInfo.next },
  ];
  // jazdy spojené „zostaň sedieť“ sú konkrétne dva spoje — tie sa nemenia
  const locked = new Set();
  legs.forEach((l, i) => { if (l.type === 'stay') { locked.add(i - 1); locked.add(i + 1); } });
  // spätný prechod: deadline = dokedy musí leg skončiť, aby nadväznosť ostala
  let deadline = Infinity;
  for (let i = legs.length - 1; i >= 0; i--) {
    const l = legs[i];
    if (l.type === 'walk') { if (deadline < Infinity) deadline -= l.secs; continue; }
    if (l.type === 'stay') continue;
    if (deadline === Infinity || l.pattern == null || locked.has(i)) { deadline = l.dep; continue; } // posledná jazda určuje príchod — ostáva
    const p = raptor.d.patterns[l.pattern];
    let bestTrip = null, bestDep = l.dep, bestO = l.day;
    for (const day of dayOffsets) {
      const shift = day.o * DAY;
      for (const trip of p.trips) {
        const dep = trip.t[2 * l.boardPos + 1] + shift;
        const arr = trip.t[2 * l.alightPos] + shift;
        if (arr > deadline || dep <= bestDep) continue;
        if (!raptor.serviceActive(trip.sv, day.num, day.weekday)) continue;
        bestTrip = trip; bestDep = dep; bestO = day.o;
      }
    }
    if (bestTrip) {
      const shift = bestO * DAY;
      l.dep = bestTrip.t[2 * l.boardPos + 1] + shift;
      l.arr = bestTrip.t[2 * l.alightPos] + shift;
      l.head = bestTrip.h;
      l.times = bestTrip.t.slice(2 * l.boardPos, 2 * l.alightPos + 2).map((x) => x + shift);
      l.day = bestO;
    }
    deadline = l.dep;
  }
  // pešie úseky: prvý čo najneskôr (neskorší odchod z miesta), prestupové
  // hneď po vystúpení (čaká sa radšej pri nástupišti ďalšieho spoja)
  for (let i = 0; i < legs.length; i++) {
    const l = legs[i];
    if (l.type !== 'walk') continue;
    if (i === 0 && legs[1]) {
      l.arr = legs[1].dep;
      l.dep = legs[1].dep - l.secs;
    } else if (i > 0) {
      l.dep = legs[i - 1].arr;
      l.arr = l.dep + l.secs;
    }
  }
  journey.depTime = legs[0].dep;
  return journey;
}

/**
 * Bližšia nástupná zastávka na ten istý spoj: RAPTOR nastúpi na prvej zastávke
 * spoja, ktorú zo štartu stihne, aj keď ten istý autobus ide aj cez bližšiu
 * (napr. 6 min pešo na Lomnickú namiesto 4 min na Lesnícku). Ak sa autobus dá
 * stihnúť aj na bližšej zastávke ďalej po trase, nastúpi sa tam.
 */
export function preferNearBoarding(journey, fromStops, queryTime) {
  const legs = journey.legs;
  // úvodná chôdza medzi zastávkami (štart → zastávka A → pešo na B → jazda)
  const r = legs[0]?.type === 'walk' ? 1 : 0;
  const l = legs[r];
  if (!l || l.type !== 'ride') return journey;
  const startStop = r ? legs[0].from : l.from;
  if (!fromStops.has(startStop)) return journey;
  let bestPos = -1, bestWalk = fromStops.get(startStop) + (r ? legs[0].secs : 0);
  for (let k = r ? 0 : 1; l.boardPos + k < l.alightPos; k++) {
    const si = l.stops[k], w = fromStops.get(si);
    if (w == null || w >= bestWalk || (k === 0 && !r)) continue;
    if (queryTime + w > l.times[2 * k + 1]) continue; // autobus by tam už ušiel
    bestPos = l.boardPos + k; bestWalk = w;
  }
  // rovnaká zastávka ako doteraz bez úvodnej chôdze → nič nemeniť
  if (bestPos < 0 || (!r && bestPos === l.boardPos)) return journey;
  const k = bestPos - l.boardPos;
  l.from = l.stops[k];
  l.stops = l.stops.slice(k);
  l.times = l.times.slice(2 * k);
  l.dep = l.times[1];
  l.boardPos = bestPos;
  if (r) legs.shift();
  journey.depTime = l.dep;
  return journey;
}

// chôdza od východiska k zastávke, kde spojenie začína (bez úvodného pešieho úseku)
function startWalk(j, fromStops) {
  return fromStops.get(j.legs[0].from) ?? 0;
}
/** Chôdza od východiska k prvej zastávke (aj s úvodným pešým úsekom). */
export function originWalk(j, fromStops) {
  const l0 = j.legs[0];
  if (!j.legs.some((l) => l.type === 'ride')) return 0;
  return startWalk(j, fromStops) + (l0.type === 'walk' ? l0.secs : 0);
}
/** Odchod z miesta: odchod prvej jazdy mínus chôdza k nej. */
export function leaveTime(j, fromStops) {
  const r = j.legs.find((l) => l.type === 'ride');
  return r ? r.dep - originWalk(j, fromStops) : j.depTime;
}
/** Všetka chôdza spojenia (k prvej zastávke, pri prestupoch aj do cieľa). */
export function totalWalk(j, fromStops) {
  return startWalk(j, fromStops) + j.legs.reduce((a, l) => a + (l.type === 'walk' ? l.secs : 0), 0) + j.finalWalk;
}

/**
 * Chôdza rovno do cieľa bez MHD (sekundy): k zastávke pri východisku, najviac
 * jeden peší prestup a od cieľovej zastávky do cieľa — ako kolo 0 v query.
 * Infinity, keď sa pešo „dosiahnuteľné“ zastávky nestretnú.
 */
export function walkOnlySecs(raptor, fromStops, toStops) {
  const a0 = new Map();
  for (const [s, w] of fromStops) if (!(a0.get(s) <= w)) a0.set(s, w);
  for (const [s, w] of fromStops) for (const [s2, f] of raptor.foot[s]) if (!(a0.get(s2) <= w + f)) a0.set(s2, w + f);
  let best = Infinity;
  for (const [t, w] of toStops) { const a = a0.get(t); if (a != null && a + w < best) best = a + w; }
  return best;
}
// spojenie má zmysel, keď je v cieli skôr, ako by bol pešo rovno do cieľa
// (od toho istého odchodu), alebo ušetrí aspoň 2 min chôdze — inak napr.
// jazda okolo cieľa a pešo späť z okolitej zastávky
function beatsWalking(j, fromStops, walkOnly) {
  return leaveTime(j, fromStops) + walkOnly > j.arrTime || totalWalk(j, fromStops) < walkOnly - 120;
}

/** Viac odchodov za sebou: opakuje query s posunutým časom odchodu. */
export function planJourneys(raptor, fromStops, toStops, dateInfo, depTime, want = 4, opts = {}) {
  // chôdza rovno do cieľa: appka môže dodať vlastný odhad (vzdušnou čiarou)
  const walkOnly = Math.min(opts.walkOnly ?? Infinity, walkOnlySecs(raptor, fromStops, toStops));
  if (opts.direct) {
    // bez prestupu: najbližšie priame spoje (prejde všetky, nie po kolách RAPTORu)
    const js = raptor.directJourneys(fromStops, toStops, dateInfo, depTime, { ...opts, walkOnly })
      .filter((j) => beatsWalking(j, fromStops, walkOnly)).slice(0, want);
    for (const j of js) tightenJourney(raptor, j, dateInfo);
    return js.sort((a, b) => a.arrTime - b.arrTime);
  }
  const out = [];
  const seen = new Set();
  let t = depTime;
  for (let i = 0; i < want * 3 && out.length < want; i++) {
    // spojenie horšie ako chôdza rovno do cieľa sa odmietne už pri výbere cieľa
    // (inak by zablokovalo lepšie spojenie s prestupom v ďalšom kole)
    const tq = t;
    const accept = (j) => {
      tightenJourney(raptor, j, dateInfo);
      preferNearBoarding(j, fromStops, tq);
      return beatsWalking(j, fromStops, walkOnly);
    };
    const js = raptor.query(fromStops, toStops, dateInfo, t, { ...opts, accept });
    const ref = js.length ? js[js.length - 1] : js.rejected;
    if (!ref) break;
    // pareto výber: netriviálne alternatívy s menej prestupmi tiež ukáž
    let advanced = !js.length;
    for (const j of js) {
      const key = j.legs.map((l) => l.type === 'ride' ? `${l.route}:${l.from}:${l.to}:${l.dep}` : `w${l.from}-${l.to}`).join('|');
      if (!seen.has(key)) {
        seen.add(key);
        out.push(j);
        advanced = true;
      }
    }
    const firstRide = ref.legs.find((l) => l.type === 'ride');
    if (!firstRide) break;
    const next = firstRide.dep + 60;
    if (next <= t) break;
    t = next;
    if (!advanced && i > want * 2) break;
  }
  // vyhoď dominované spojenia: existuje neskorší odchod z miesta s rovnakým
  // či skorším príchodom (s prirážkou za okolitú cieľovú zastávku), nie viac
  // prestupov a nie o viac ako minútu dlhšou chôdzou
  const lv = new Map(out.map((j) => [j, leaveTime(j, fromStops)]));
  const wk = new Map(out.map((j) => [j, totalWalk(j, fromStops)]));
  const filtered = out.filter((j) => !out.some((k) =>
    k !== j && lv.get(k) >= lv.get(j) && k.score <= j.score && k.transfers <= j.transfers && wk.get(k) <= wk.get(j) + 60 &&
    (lv.get(k) > lv.get(j) || k.score < j.score || k.transfers < j.transfers || wk.get(k) < wk.get(j) - 60)));
  filtered.sort((a, b) => a.arrTime - b.arrTime || a.transfers - b.transfers);
  return filtered.slice(0, want + 2);
}
