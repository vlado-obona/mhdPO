// Jednoduchý režim (pre deti, seniorov a začiatočníkov): veľké dlaždice cieľov, jedna odpoveď
// vo vetách a sprevádzanie krok za krokom nad režimom cesty z app.js.
//
// Celý modul je jedna funkcia. V jednosúborovej verzii (scripts/mhd/build-release.mjs) sa moduly
// spájajú do jedného skriptu, takže mená na najvyššej úrovni by sa bili s app.js.
// `A` = funkcie a stav z app.js (pozri volanie initSimple v app.js).
export function initSimple(A) {
  const { $, esc, fmtTime, haversine, bearingTo } = A;
  const SLOW = 0.9;        // m/s – pomalšia chôdza (plánovač počíta s A.WALK_SPEED)
  const DETOUR = 1.2;      // vzdušná čiara → skutočná chôdza
  const RESERVE = 60;      // s – rezerva na príchod na zastávku
  const MIN_SLACK = 180;   // s – najmenej času na presadnutie (po odrátaní chôdze)
  const MAX_WAIT = 1500;   // s – dlhšie čakanie na prestupe radšej nie
  const WALK_ONLY_M = 450; // do tejto vzdialenosti sa ide pešo bez autobusu
  const WALK_FALLBACK_M = 2500; // dokiaľ sa ide pešo, keď žiadny spoj nie je lepší ako chôdza
  const NEAR_M = 40;       // bližšie než toto vedie zrak (obrázok tabule), nie šípka
  const ARRIVE_M = 15;     // príchod na zastávku podľa polohy
  const ASK_M = 60;        // iné nástupište bližšie než toto poloha nerozlíši → kontrolná otázka
  const SIB_M = 150;       // okruh, v ktorom sa hľadajú nástupištia s rovnakým menom
  const K = A.WALK_SPEED / SLOW;

  const cfg = () => {
    const p = A.prefs();
    if (!p.simple) p.simple = { on: false, formal: false, phone: '', who: '', intro: 0 };
    return p.simple;
  };
  const tx = (ty, vy) => (cfg().formal ? vy : ty); // tykanie (deti) / vykanie (dospelí a seniori)
  let root = null, screen = 'home', last = {}, spoken = '', lastVoice = '', clockTimer = null, gate = null;

  // ── kostra obrazovky ───────────────────────────────────────────────
  function mount() {
    if (root) return;
    root = document.createElement('div');
    root.id = 'sm'; root.className = 'sm'; root.hidden = true;
    root.innerHTML = `
      <header class="sm-top">
        <button type="button" class="sm-tbtn" id="smBack" data-a="back" hidden>← Späť</button>
        <h1 id="smTitle" tabindex="-1"></h1>
        <button type="button" class="sm-tbtn" id="smSpeak" data-a="speak" aria-label="Prečítať pokyn nahlas" hidden>🔊 Nahlas</button>
        <div class="sm-clock" id="smClock" hidden></div>
      </header>
      <div class="sm-dots" id="smDots" aria-hidden="true" hidden></div>
      <div class="sm-body" id="smBody"></div>
      <div class="sm-morewrap"><button type="button" class="sm-more" data-a="more" tabindex="-1" aria-hidden="true">▼ ďalej nižšie</button></div>
      <div class="sm-sr" id="smSr" aria-live="polite"></div>
      <div class="sm-actions" id="smActions"></div>
      <nav class="sm-help" aria-label="Pomoc">
        <button type="button" data-a="where"><span class="sm-ico" aria-hidden="true">📍</span><span>Kde som?</span></button>
        <button type="button" class="sm-call" data-a="call"><span class="sm-ico" aria-hidden="true">📞</span><span>Zavolať<small id="smWho"></small></span></button>
      </nav>
      <div class="sm-veil" id="smVeil" hidden><div class="sm-sheet" id="smSheet" role="dialog" aria-modal="true"></div></div>`;
    document.body.appendChild(root);
    root.addEventListener('click', (e) => {
      if (e.target === $('smVeil')) { closeSheet(); return; }
      const b = e.target.closest('[data-a]');
      if (b && !b.disabled) act(b.dataset.a, b.dataset.v);
    });
    $('smBody').addEventListener('scroll', more, { passive: true });
    window.addEventListener('resize', () => { if (!root.hidden) more(); });
  }
  function more() {
    const sc = $('smBody');
    root.classList.toggle('sm-has-more', sc.scrollHeight - sc.scrollTop - sc.clientHeight > 14);
  }
  // prekreslí len to, čo sa zmenilo (obrazovka sa obnovuje každú sekundu aj pri každej polohe)
  function view(v) {
    const set = (key, val, fn) => { if (last[key] !== val) { last[key] = val; fn(val); } };
    set('title', v.title || '', (x) => { $('smTitle').textContent = x; });
    set('back', !!v.back, (x) => { $('smBack').hidden = !x; });
    set('speak', !!v.speak, (x) => { $('smSpeak').hidden = !x; });
    set('clock', !!v.clock, (x) => { $('smClock').hidden = !x; if (x) tick(); });
    set('dots', v.dots || 0, (x) => {
      $('smDots').hidden = !x;
      $('smDots').innerHTML = x ? [1, 2, 3, 4].map((i) => `<span class="${i <= x ? 'on' : ''}"></span>`).join('') : '';
    });
    const same = v.vkey && v.vkey === last.vkey; // ten istý pokyn: nechať odrolované miesto
    last.vkey = v.vkey || '';
    set('body', v.body || '', (x) => { const sc = $('smBody'), y = sc.scrollTop; sc.innerHTML = x; sc.scrollTop = same ? y : 0; });
    if (!same) root.scrollTop = 0; // naležato sa roluje celá obrazovka
    set('act', v.act || '', (x) => { $('smActions').innerHTML = x; $('smActions').hidden = !x; });
    set('who', cfg().who || '', (x) => { $('smWho').textContent = x; });
    more();
    // tlačidlo, na ktoré človek ťukol, pri prekreslení zaniklo: fokus na nadpis novej obrazovky
    // (klávesnica a čítačka obrazovky nezostanú „nikde“)
    if (!same && !sheetOpen() && (document.activeElement === document.body || !document.activeElement)) $('smTitle').focus({ preventScroll: true });
  }
  function tick() {
    const el = $('smClock');
    if (el && !el.hidden) el.textContent = A.nowInSk().time.replace(/^0/, '');
  }
  // hárok nad obrazovkou: zvyšok obrazovky je kým je otvorený nedostupný (inert), fokus sa po
  // zavretí vráti na tlačidlo, ktoré hárok otvorilo
  let sheetFrom = null;
  const behind = (on) => { for (const el of root.children) if (el.id !== 'smVeil') el.inert = on; };
  function sheet(html) {
    if (!sheetOpen()) { const el = document.activeElement; sheetFrom = el && root.contains(el) ? (el.dataset.a || null) : null; }
    const box = $('smSheet');
    box.innerHTML = html;
    const h = box.querySelector('h2');
    if (h) { h.id = 'smSheetH'; box.setAttribute('aria-labelledby', 'smSheetH'); } else box.removeAttribute('aria-labelledby');
    $('smVeil').hidden = false;
    behind(true);
    setTimeout(() => box.querySelector('button, input')?.focus({ preventScroll: true }), 30);
  }
  function closeSheet() {
    gate = null;
    if (!root || $('smVeil').hidden) return;
    $('smVeil').hidden = true;
    behind(false);
    const back = sheetFrom && root.querySelector(`[data-a="${sheetFrom}"]:not([hidden])`);
    (back && back.offsetParent ? back : $('smTitle')).focus({ preventScroll: true });
    sheetFrom = null;
  }
  const sheetOpen = () => !!root && !$('smVeil').hidden;

  const btn = (a, label, cls = 'sm-secondary', v) => `<button type="button" class="${cls}" data-a="${a}"${v != null ? ` data-v="${esc(String(v))}"` : ''}>${label}</button>`;
  const END = () => btn('end', 'Ukončiť cestu', 'sm-secondary sm-danger');
  const big = (ico, h, p = '') => `<div class="sm-now">${ico ? `<div class="sm-bigico" aria-hidden="true">${ico}</div>` : ''}<h2>${h}</h2>${p}</div>`;
  const badge = (line, sm) => `<span class="sm-badge${sm ? ' sm-badge-s' : ''}">${esc(line)}</span>`;
  const mins = (n) => `${n} ${n === 1 ? 'minútu' : n < 5 ? 'minúty' : 'minút'}`;         // „o 1 minútu“
  const minsN = (n) => `${n} ${n === 1 ? 'minúta' : n < 5 ? 'minúty' : 'minút'}`;        // „asi 1 minúta“
  const stopsN = (n) => (n === 1 ? 'zastávka' : n < 5 ? 'zastávky' : 'zastávok');
  const roundM = (d) => (d >= 100 ? Math.round(d / 10) * 10 : Math.max(5, Math.round(d / 5) * 5));
  const clean = (n) => n.replace(/ \*$/, '');
  const request = (n) => / \*$/.test(n); // hviezdička v názve = zastávka na znamenie
  const lineOf = (r) => A.D().routes[r.route].s;
  // druh vozidla z dát (routes[].t = 1 je trolejbus); obe slová sa skloňujú rovnako: +u, +e, +om
  const veh = (r) => (A.D().routes[r.route].t === 1 ? 'trolejbus' : 'autobus');
  const Veh = (r) => (A.D().routes[r.route].t === 1 ? 'Trolejbus' : 'Autobus');
  const vico = (r) => (A.D().routes[r.route].t === 1 ? '🚎' : '🚌');
  const headOf = (r) => (r.head >= 0 ? A.D().heads[r.head] : (A.D().routes[r.route].l || ''));
  const norm180 = (a) => ((a + 540) % 360) - 180;
  const angDiff = (a, b) => Math.abs(norm180(a - b));

  // ── zapnutie, vypnutie ─────────────────────────────────────────────
  function apply() {
    const on = !!cfg().on;
    if (on) mount();
    document.body.classList.toggle('simple-on', on);
    if (root) root.hidden = !on;
    clearInterval(clockTimer);
    if (on) { clockTimer = setInterval(beat, 20000); last = {}; home(); }
  }
  // každých 20 s: hodiny a náhľad plánu (počas náhľadu ešte nebeží časovač cesty)
  function beat() {
    tick();
    const t = A.trip();
    if (!t || !t.simple || t.phase !== 'preview' || sheetOpen()) return;
    // čas odchodu zobrazeného spoja už prešiel → nový plán od teraz
    if (!t.walkOnly && t.journeys[t.jIdx] && t.journeys[t.jIdx].sm.leave < A.tripNowSecs() - 60) plan();
    else render();
  }
  function turnOn() {
    A.stopNav(); // navigácia k zastávke z bežného režimu by bežala skrytá ďalej
    cfg().on = true; A.savePrefs(); apply();
    sheet(`<h2>Jednoduchý režim je zapnutý</h2>
      <p>Na úvode sú veľké tlačidlá cieľov – tie isté ciele, ktoré sú nastavené v bežnej appke.</p>
      <p>Telefónne číslo na tlačidlo <b>Zavolať</b>, oslovenie (tykať / vykať) a vypnutie režimu sú v <b>Nastaveniach</b> na úvode.</p>
      <div class="sm-stack">${btn('setnow', 'Nastaviť teraz', 'sm-primary')}${btn('close', 'Neskôr')}</div>`);
    gate = { setnow: settings };
  }
  function turnOff() {
    const t = A.trip();
    if (t && t.simple) A.endTrip();
    cfg().on = false; A.savePrefs(); closeSheet(); apply();
    A.refreshMain();
  }

  // ── úvod: dlaždice cieľov ──────────────────────────────────────────
  function home() {
    screen = 'home';
    const fs = A.favs(), n = A.favVisible();
    let tiles = '', k = 0;
    for (let i = 0; i < n; i++) {
      const f = fs[i];
      if (!f.target) continue;
      tiles += `<button type="button" class="sm-tile sm-c${k++ % 6}" data-a="go" data-v="${i}"><span class="sm-tico" aria-hidden="true">${esc(f.icon)}</span><span class="sm-tname">${esc(f.label)}</span><span class="sm-tsub">${esc(clean(A.targetLabel(f.target)))}</span></button>`;
    }
    if (k % 2) tiles = tiles.replace('class="sm-tile ', 'class="sm-tile sm-wide '); // nepárny počet: prvá cez celú šírku
    const empty = tiles ? '' : `<div class="sm-next">${tx('Ciele ešte nie sú nastavené. Popros dospelého, nech ich nastaví.', 'Ciele ešte nie sú nastavené.')} Nastavujú sa v bežnej appke: Nastavenia → Vypnúť jednoduchý režim, potom podržať tlačidlo cieľa.</div>`;
    view({ title: tx('Kam ideš?', 'Kam idete?'), clock: true,
      body: `<div class="sm-tiles">${tiles}</div>${empty}
        <button type="button" class="sm-row" data-a="other"><span class="sm-ico" aria-hidden="true">🔎</span><span>Iné miesto<small>${tx('napíš, kam chceš ísť', 'napíšte, kam chcete ísť')}</small></span></button>
        <button type="button" class="sm-row" data-a="gate"><span class="sm-ico" aria-hidden="true">⚙️</span><span>Nastavenia<small>${tx('pre dospelého alebo pomocníka', 'oslovenie, telefón, vypnutie režimu')}</small></span></button>`,
      act: '' });
  }

  // ── iné miesto: zastávka, miesto alebo adresa ──────────────────────
  function other() {
    sheet(`<h2>${tx('Kam chceš ísť?', 'Kam chcete ísť?')}</h2>
      <label class="sm-field">${tx('Napíš zastávku, miesto alebo ulicu', 'Napíšte zastávku, miesto alebo ulicu')}<input id="smQ" type="text" autocomplete="off" enterkeyhint="search"></label>
      <div class="sm-stack" id="smRes"></div>
      <div class="sm-stack">${btn('close', 'Zavrieť')}</div>`);
    const q = $('smQ');
    let found = [];
    const run = () => {
      const s = A.norm(q.value.trim());
      found = [];
      if (s.length >= 2) {
        const gs = A.groups();
        for (const g of gs) if (g.norm.startsWith(s)) found.push({ ico: '🚏', name: g.name, sub: 'zastávka', target: { kind: 'group', name: g.name, lat: g.lat, lon: g.lon } });
        for (const g of gs) if (!g.norm.startsWith(s) && g.norm.includes(s)) found.push({ ico: '🚏', name: g.name, sub: 'zastávka', target: { kind: 'group', name: g.name, lat: g.lat, lon: g.lon } });
        found = found.slice(0, 4);
        for (const r of A.searchPlaces(q.value, 4)) found.push({ ico: '📍', name: r.name, sub: r.kind === 'addr' ? 'adresa' : r.kind === 'street' ? 'ulica' : 'miesto', target: { kind: 'point', lat: r.la, lon: r.lo, label: r.name } });
      }
      $('smRes').innerHTML = found.map((f, i) => `<button type="button" class="sm-row" data-a="pick" data-v="${i}"><span class="sm-ico" aria-hidden="true">${f.ico}</span><span>${esc(clean(f.name))}<small>${f.sub}</small></span></button>`).join('')
        || (s.length >= 2 ? `<p class="sm-note">${tx('Nič sa nenašlo. Skús to napísať inak.', 'Nič sa nenašlo. Skúste to napísať inak.')}</p>` : '');
    };
    q.addEventListener('input', run);
    A.loadPlaces().then(run).catch(() => {});
    gate = { pick: (i) => { const f = found[i]; if (f) { closeSheet(); A.startTrip(-1, { simple: true, fav: { icon: f.ico, label: clean(f.name), target: f.target } }); } } };
  }

  // ── plán: jedna odpoveď podľa pravidiel jednoduchého režimu ────────
  // z kariet plánovača vyberie tie, čo sa dajú stihnúť pomalšou chôdzou, radšej bez presadania
  function annotate(j, fromStops) {
    const rides = j.legs.filter((l) => l.type === 'ride');
    if (!rides.length) return null;
    const pre = Math.round((rides[0].dep - A.leaveTime(j, fromStops)) * K); // chôdza na prvú zastávku pomalším tempom
    let slack = Infinity, wait = 0, prev = null, walk = 0;
    for (const l of j.legs) {
      if (l.type === 'ride') {
        if (prev) { const s = l.dep - prev.arr - Math.round(walk * K); slack = Math.min(slack, s); wait = Math.max(wait, s); }
        prev = l; walk = 0;
      } else if (l.type === 'walk') walk += l.secs;
      else if (l.type === 'stay') prev = null; // zostaň sedieť – nepresadá sa
    }
    // chôdza po poslednom autobuse; príchod sa počíta z úsekov, nie z j.arrTime
    const fin = Math.round((walk + (j.finalWalk || 0)) * K);
    const changes = rides.length - 1 - j.legs.filter((l) => l.type === 'stay').length;
    return { rides, pre, slack, wait, changes, leave: rides[0].dep - pre - RESERVE, fin, arr: rides[rides.length - 1].arr + fin };
  }
  // Pravidlá výberu. Nikdy sa neponúkne presadnutie, ktoré sa pomalšou chôdzou nedá stihnúť (rezerva
  // pod 1 min), ani čakanie na prestupnej zastávke dlhšie ako 45 minút. Tesné presadnutie (pod
  // 3 min), viac presadnutí a dlhšie čakanie sa rátajú ako neskorší príchod – vyhrá teda
  // pohodlnejšia cesta, ak nie je oveľa pomalšia.
  const TIGHT = 60, HARD_WAIT = 2700;
  const FAR = 3 * 3600; // spoj o viac než 3 hodiny neskôr sa medzi „najbližšie“ neráta
  const usable = (a) => a.slack >= TIGHT && a.wait <= HARD_WAIT;
  // karta, ktorá by sa ukázala ako „dnes už nič nejde“: spoj až po polnoci a o viac než 2 hodiny
  const night = (j, now) => j.sm.rides[0].dep >= 86400 && now < 86400 && j.sm.leave - now > 7200;
  const jKey = (j) => j.sm.rides.map((r) => `${r.route}@${r.dep}`).join('|');
  const cost = (j) => { const a = j.sm; return a.arr + 600 * a.changes + 900 * Math.max(0, a.changes - 1) + (a.slack < MIN_SLACK ? 1500 : 0) + (a.wait > MAX_WAIT ? 600 : 0); };
  const clean0 = (a) => a.slack >= MIN_SLACK && a.changes <= 1 && a.wait <= MAX_WAIT;
  // Plánovač ráta s rýchlou chôdzou a presadnutím „na sekundu“. Kde by pri pomalšej chôdzi nezostal
  // čas, skúsia sa dve úpravy toho istého spojenia – vždy len na skutočné spoje tej istej linky:
  //   shiftBack: predošlá jazda skorším spojom (odíde sa skôr, príchod ostáva),
  //   shiftFwd:  ďalšia jazda neskorším spojom (odchod ostáva, príde sa neskôr).
  // Obe pracujú na kópii a vrátia ju len celú a správnu, inak null (jazdy spojené „zostaň sedieť“
  // sa nemenia; čakanie na prestupe nesmie prekročiť HARD_WAIT).
  const DAY = 86400;
  const cloneJ = (j) => ({ ...j, legs: j.legs.map((l) => ({ ...l })) });
  const daysOf = (di) => [{ o: -1, ...di.prev }, { o: 0, num: di.num, weekday: di.weekday }, { o: 1, ...di.next }];
  const lockedOf = (legs) => { const s = new Set(); legs.forEach((l, i) => { if (l.type === 'stay') { s.add(i - 1); s.add(i + 1); } }); return s; };
  // nahradí jazdu l iným spojom toho istého patternu (rovnaký nástup aj výstup)
  function setTrip(l, trip, o) {
    const shift = o * DAY;
    l.dep = trip.t[2 * l.boardPos + 1] + shift; l.arr = trip.t[2 * l.alightPos] + shift; l.head = trip.h; l.day = o;
    l.times = trip.t.slice(2 * l.boardPos, 2 * l.alightPos + 2).map((x) => x + shift);
  }
  function retime(j) { // časy peších úsekov podľa posunutých jázd
    const legs = j.legs;
    legs.forEach((l, i) => {
      if (l.type !== 'walk') return;
      if (i === 0 && legs[1]) { l.arr = legs[1].dep; l.dep = l.arr - l.secs; } else if (i > 0) { l.dep = legs[i - 1].arr; l.arr = l.dep + l.secs; }
    });
    j.depTime = legs[0].dep;
    return j;
  }
  function shiftBack(j0, di) {
    const j = cloneJ(j0), legs = j.legs, D = A.D(), R = A.raptor(), days = daysOf(di), locked = lockedOf(legs);
    let deadline = Infinity, walk = 0;
    for (let i = legs.length - 1; i >= 0; i--) {
      const l = legs[i];
      if (l.type === 'walk') { walk += l.secs; continue; }
      if (l.type === 'stay') { deadline = Infinity; walk = 0; continue; } // to isté vozidlo, nepresadá sa
      const need = deadline - Math.round(walk * K) - MIN_SLACK; // dokedy treba vystúpiť
      if (deadline < Infinity && l.arr > need) {
        if (locked.has(i) || l.pattern == null) return null;
        let best = null, bestArr = -Infinity, bestO = 0;
        for (const day of days) {
          for (const trip of D.patterns[l.pattern].trips) {
            const arr = trip.t[2 * l.alightPos] + day.o * DAY;
            // najneskorší spoj, ktorý to stihne – a nie taký skorý, aby čakanie prekročilo strop
            if (arr > need || arr <= bestArr || need - arr > HARD_WAIT - MIN_SLACK || !R.serviceActive(trip.sv, day.num, day.weekday)) continue;
            best = trip; bestArr = arr; bestO = day.o;
          }
        }
        if (!best) return null;
        setTrip(l, best, bestO);
      }
      deadline = l.dep; walk = 0;
    }
    return retime(j);
  }
  function shiftFwd(j0, di) {
    const j = cloneJ(j0), legs = j.legs, D = A.D(), R = A.raptor(), days = daysOf(di), locked = lockedOf(legs);
    let prev = null, walk = 0, lastRide = null, lastArr0 = 0;
    for (let i = 0; i < legs.length; i++) {
      const l = legs[i];
      if (l.type === 'walk') { walk += l.secs; continue; }
      if (l.type === 'stay') { prev = null; walk = 0; continue; } // ďalšia jazda je to isté vozidlo
      if (prev) {
        const ready = prev.arr + Math.round(walk * K), need = ready + MIN_SLACK; // odkedy sa dá nastúpiť
        if (l.dep < need) {
          if (locked.has(i) || l.pattern == null) return null;
          let best = null, bestDep = Infinity, bestO = 0;
          for (const day of days) {
            for (const trip of D.patterns[l.pattern].trips) {
              const dep = trip.t[2 * l.boardPos + 1] + day.o * DAY;
              // najskorší spoj, ktorý sa dá stihnúť – a čakanie naň najviac HARD_WAIT
              if (dep < need || dep >= bestDep || dep - ready > HARD_WAIT || !R.serviceActive(trip.sv, day.num, day.weekday)) continue;
              best = trip; bestDep = dep; bestO = day.o;
            }
          }
          if (!best) return null;
          lastArr0 = l.arr;
          setTrip(l, best, bestO);
        } else lastArr0 = l.arr;
      } else lastArr0 = l.arr;
      prev = l; lastRide = l; walk = 0;
    }
    if (lastRide) j.arrTime = (j.arrTime || 0) + lastRide.arr - lastArr0; // príchod sa posunul s poslednou jazdou
    return retime(j);
  }
  // Presadnutie na inej zastávke tých istých dvoch spojov: plánovač vyberie jedno miesto
  // prestupu, ale predošlý spoj sa dá viezť aj ďalej (alebo vystúpiť skôr) a do ďalšieho nastúpiť
  // na inej zastávke jeho trasy, kam sa dá dôjsť pešo. Použije sa, keď by na zastávke z plánovača
  // bolo treba čakať dlhšie než 45 minút alebo sa presadnutie pomalšou chôdzou nedá pohodlne
  // stihnúť. Spoje (vozidlá) aj príchod do cieľa ostávajú rovnaké, mení sa len miesto prestupu.
  const tripOf = (D, l) => D.patterns[l.pattern].trips.find((tr) => tr.t[2 * l.boardPos + 1] + l.day * DAY === l.dep && tr.t[2 * l.alightPos] + l.day * DAY === l.arr);
  function rideLeg(D, l, trip, b, a) {
    const p = D.patterns[l.pattern], shift = l.day * DAY;
    return { ...l, head: trip.h, from: p.stops[b], to: p.stops[a], dep: trip.t[2 * b + 1] + shift, arr: trip.t[2 * a] + shift,
      stops: p.stops.slice(b, a + 1), times: trip.t.slice(2 * b, 2 * a + 2).map((x) => x + shift), boardPos: b, alightPos: a };
  }
  function slideXfer(j0) {
    const D = A.D(), R = A.raptor(), j = cloneJ(j0);
    let changed = false;
    const rideIdx = () => j.legs.map((l, i) => (l.type === 'ride' ? i : -1)).filter((i) => i >= 0);
    let ri = rideIdx();
    for (let k = ri.length - 1; k >= 1; k--) { // od konca: zmena dĺžky úsekov neposunie skoršie indexy
      const ia = ri[k - 1], ib = ri[k], a = j.legs[ia], b = j.legs[ib], mid = j.legs.slice(ia + 1, ib);
      if (mid.some((l) => l.type === 'stay')) continue; // to isté vozidlo
      const locked = lockedOf(j.legs);
      if (locked.has(ia) || locked.has(ib) || a.pattern == null || b.pattern == null) continue;
      const walk0 = mid.reduce((s0, l) => s0 + (l.type === 'walk' ? l.secs : 0), 0);
      const slack0 = b.dep - a.arr - Math.round(walk0 * K);
      if (slack0 >= MIN_SLACK && slack0 <= HARD_WAIT) continue; // toto presadnutie je v poriadku
      const ta = tripOf(D, a), tb = tripOf(D, b);
      if (!ta || !tb) continue;
      const pa = D.patterns[a.pattern], pb = D.patterns[b.pattern], sa = a.day * DAY, sb = b.day * DAY;
      let best = null;
      for (let q = a.boardPos + 1; q < pa.stops.length; q++) {
        const sq = pa.stops[q], arrQ = ta.t[2 * q] + sa;
        const foot = new Map(R.foot[sq] || []);
        for (let p = 0; p < b.alightPos; p++) {
          const sp = pb.stops[p], f = sp === sq ? 0 : foot.get(sp);
          if (f == null) continue;
          const depP = tb.t[2 * p + 1] + sb, w = depP - arrQ - Math.round(f * K);
          if (w < MIN_SLACK || w > HARD_WAIT) continue;
          // najkratší čas medzi vystúpením a nástupom (radšej sa viezť ďalej než stáť), potom menej chôdze
          const sc = depP - arrQ;
          if (!best || sc < best.sc || (sc === best.sc && f < best.f)) best = { q, p, f, sc, sq, sp };
        }
      }
      if (!best) continue;
      const na = rideLeg(D, a, ta, a.boardPos, best.q), nb = rideLeg(D, b, tb, best.p, b.alightPos);
      const walk = best.sq === best.sp ? [] : [{ type: 'walk', from: best.sq, to: best.sp, secs: best.f, dep: na.arr, arr: na.arr + best.f }];
      j.legs.splice(ia, ib - ia + 1, na, ...walk, nb);
      changed = true;
      ri = rideIdx();
    }
    return changed ? retime(j) : null;
  }
  // Zozbiera použiteľné karty od času `from`. Plánovač vracia len pár najbližších spojov, preto sa
  // pýta v ďalších kolách neskôr a neskôr, kým sa nenájde karta bez výhrad (najviac 3 hodiny dopredu,
  // ak sa dovtedy našlo aspoň niečo).
  function gather(t, now, from, di) {
    const seen = new Set(), all = [], far = [];
    let dep = from, q = null;
    for (let round = 0; round < 8; round++) {
      q = query(t, dep, di);
      let lastDep = 0, lastAny = 0;
      for (const j0 of q.js) {
        const a0 = annotate(j0, q.fromStops);
        if (!a0) continue;
        // ďalšie kolo sa posúva podľa odchodov, ktoré vrátil plánovač (do 3 hodín od hľadaného času)
        lastAny = Math.max(lastAny, a0.rides[0].dep);
        if (a0.rides[0].dep - from <= FAR) lastDep = Math.max(lastDep, a0.rides[0].dep);
        // karta sa dá ponúknuť: odchod z miesta nie je v minulosti, prvý spoj nie je pred hľadaným
        // časom (variant so skorším spojom ho mohol posunúť) a presadnutia sa dajú stihnúť
        const fits = (j) => { const a = j === j0 ? a0 : annotate(j, q.fromStops); j.sm = a; return !!a && a.leave >= now - 30 && a.rides[0].dep >= from && usable(a); };
        // tesné presadnutie: pohodlnejšie varianty toho istého spojenia; pôvodné len vtedy, keď sa
        // žiadny variant nedá ponúknuť
        let cands = [j0];
        if (a0.slack < MIN_SLACK || a0.wait > HARD_WAIT) {
          const v = [shiftBack(j0, q.di), shiftFwd(j0, q.di), slideXfer(j0)].filter(Boolean).filter(fits);
          if (v.length) cands = v;
        }
        for (const j of cands) {
          if (!fits(j) || seen.has(jKey(j))) continue;
          const a = j.sm;
          seen.add(jKey(j));
          // Spoj o viac než 3 hodiny neskôr (plánovač ho pridáva ako poslednú možnosť, napr. zajtrajší)
          // nesmie ukončiť hľadanie skorších ani sa medzi ne zaradiť; je len záloha, keď nie je nič iné.
          (a.rides[0].dep - from > FAR ? far : all).push(j);
        }
      }
      if (all.some((j) => clean0(j.sm))) break;
      // kým sa nenašlo nič do 3 hodín, hľadá sa ďalej aj za nimi (dnešný spoj má prednosť pred zajtrajším)
      const next = lastDep || (!all.length ? lastAny : 0);
      if (!next) break;
      dep = Math.max(dep, next) + 60;
      if (dep - from > FAR && all.length) break;
      if (dep >= DAY + 6 * 3600) break; // ďalej než do zajtrajšieho rána sa nehľadá
    }
    return { list: all.length ? all : far, fromStops: q.fromStops, toStops: q.toStops, di: q.di };
  }
  // zoznam na obrazovku: prvá je najlepšia karta (najskorší príchod, presadnutie sa ráta ako 10 minút),
  // za ňou tie, čo odchádzajú neskôr – aby „Ísť neskôr“ naozaj znamenalo neskôr
  function order(list, now) {
    if (!list.length) return list;
    // pri rovnakej cene (rovnaký príchod, presadnutia aj výhrady) vyhrá neskorší odchod z miesta
    const best = list.reduce((x, y) => (cost(y) < cost(x) || (cost(y) === cost(x) && y.sm.leave > x.sm.leave) ? y : x));
    return [best, ...chain(best, list.filter((j) => !night(j, now)))];
  }
  // karty „neskôr“ za kartou prev: odchod z domu aj odchod spoja rastú a žiadna nie je horšia
  // (príchod, presadnutia, čakanie) než niektorá, čo odchádza až po nej
  function chain(prev, cand) {
    const rest = cand.filter((j) => j !== prev && j.sm.leave > prev.sm.leave && j.sm.rides[0].dep > prev.sm.rides[0].dep)
      .sort((x, y) => x.sm.leave - y.sm.leave || cost(x) - cost(y));
    const keep = [];
    let min = Infinity;
    for (let i = rest.length - 1; i >= 0; i--) if (cost(rest[i]) < min) { min = cost(rest[i]); keep.unshift(rest[i]); }
    // ďalšia karta musí mať na obrazovke neskorší čas „Vyraz o“ a nesmie byť tým istým posledným
    // vozidlom (ten istý autobus o zastávku ďalej nie je „neskôr“)
    const minute = (j) => Math.floor(j.sm.leave / 60);
    const lastV = (j) => { const r = j.sm.rides[j.sm.rides.length - 1]; return `${r.route}|${r.to}|${r.arr}`; };
    const out = [];
    let p = prev;
    for (const j of keep) if (minute(j) > minute(p) && j.sm.rides[0].dep > p.sm.rides[0].dep && lastV(j) !== lastV(p)) { out.push(j); p = j; }
    return out;
  }
  // di = deň, od ktorého sa počítajú časy plánu (po polnoci ostáva deň, keď plán vznikol)
  function query(t, depTime, di) {
    const origin = { kind: 'point', lat: t.pos.la, lon: t.pos.lo, label: 'Moja poloha' };
    let fromStops = A.stopSetFor(origin);
    if (!fromStops.size) fromStops = A.stopSetFor(origin, 1500);
    let toStops = A.destStopsFor(t.dest);
    if (!toStops.size) toStops = A.destStopsFor(t.dest, 1500);
    if (!fromStops.size || !toStops.size) return { js: [], fromStops, toStops, di };
    const walk = A.walkStraight(origin, t.dest, fromStops, toStops);
    // Bežné hľadanie vracia najrýchlejšie spojenia (presadnutie „na sekundu“, rýchla chôdza). Druhé
    // hľadanie ráta už pri výbere s pomalšou chôdzou medzi zastávkami a s rezervou na presadnutie –
    // nájde tak aj pohodlnú cestu cez inú prestupnú zastávku, ktorú by najrýchlejšie spojenie zakrylo.
    // (pre hľadanie s rezervou aj všetky okolité cieľové zastávky, nielen 12 najbližších)
    const toAll = A.destStopsFor(t.dest, undefined, Infinity);
    const js = [...A.planWithPrefs(fromStops, toStops, di, depTime, walk).js, ...A.planReserve(fromStops, toAll.size ? toAll : toStops, di, depTime, walk, MIN_SLACK, K)];
    return { js, fromStops, toStops, di };
  }
  // ďalší plán sa má hľadať až po čase `secs` (sekundy dňa terajšieho plánu) – uloží sa ako okamih
  const setAfter = (t, secs) => { t.smAfter = secs ? t.t0Epoch + (secs - t.t0Secs) * 1000 : null; };
  // volá sa namiesto planFromHere z app.js (prvý plán, „Autobus mi ušiel“, automatické prepočítanie)
  function plan(reason) {
    const t = A.trip();
    if (!t || !t.pos) return;
    A.cancelTripNotifs();
    t.t0Epoch = Date.now(); t.t0Secs = A.nowSecsSk();
    t.missNote = null; t.missSince = null; t.error = null; t.info = null; t.smErr = null;
    const u = uiOf(t), now = Math.floor(t.t0Secs);
    t.smDi = A.dateInfoFor(A.nowInSk().date); t.smPlanAt = Date.now();
    // „hľadaj až po spoji, ktorý ušiel“: okamih prepočítaný do sekúnd dňa nového plánu (po polnoci
    // je to iný deň než ten, v ktorom vznikol starý plán)
    const after = t.smAfter ? Math.floor(t.t0Secs + (t.smAfter - t.t0Epoch) / 1000) : 0;
    const { list: found, fromStops, toStops, di } = gather(t, now, Math.max(now, after), t.smDi);
    t.smAfter = null;
    const D = A.D();
    if (D.meta.validTo && di.num > D.meta.validTo) { t.phase = 'error'; t.smErr = 'valid'; return A.renderTrip(); }
    const destDist = A.destDistance(t, t.pos.la, t.pos.lo);
    t.smFrom = fromStops; t.smDist = destDist;
    const list = order(found, now), b0 = list[0];
    // Pešo sa ide: keď je cieľ blízko; keď žiadny spoj nie je (plánovač nevracia spoje horšie ako
    // chôdza); keď by spoj prišiel neskôr než pomalá chôdza (do 1 km), resp. o viac než 20 minút
    // neskôr (do 2,5 km). Zajtrajší spoj chôdzu nahradí len do 1 km – inak radšej „zavolaj“.
    const walkArr = now + destDist * DETOUR / SLOW;
    const walkBetter = !b0 || (night(b0, now) ? destDist <= 1000 : b0.sm.arr >= walkArr + (destDist <= 1000 ? 0 : 1200));
    if (destDist <= WALK_ONLY_M || (destDist <= WALK_FALLBACK_M && walkBetter)) {
      t.journeys = []; t.j = null; t.rides = []; t.walkOnly = true; t.smWalk = destDist;
      t.phase = u.started ? 'final' : 'preview';
      return A.renderTrip();
    }
    if (!list.length) {
      t.phase = 'error';
      t.smErr = !fromStops.size ? 'nostop' : !toStops.size ? 'nodest' : 'none';
      return A.renderTrip();
    }
    t.journeys = list; t.jIdx = 0; t.walkOnly = false;
    // rozbehnutá cesta a najbližší spoj ide až zajtra: nesprevádza sa na zastávku, kde by sa čakalo
    // do rána – ukáže sa „dnes už nič nejde“ (Zavolať, do 2,5 km aj „Pôjdem pešo“)
    if (u.started && night(b0, now)) { u.started = false; t.j = null; t.rides = []; }
    t.smOnBus = 0;
    if (u.started) {
      const was = t.rides[t.ri] ? veh(t.rides[t.ri]) : u.wasVeh || 'autobus';
      A.useJourney(0);
      if (reason) noteMissed(t, reason, was);
    } else t.phase = 'preview';
    A.renderTrip();
  }
  // oznam po prepočítaní počas cesty: late = na vybraný autobus už bolo neskoro, inak ušiel
  function noteMissed(t, reason, was) {
    const u = uiOf(t), r = t.rides[0];
    const why = reason === 'late' ? tx(`Ten ${was} už nestihneš. Nič sa nedeje, nebež.`, `Ten ${was} už nestihnete. Nič sa nedeje, neponáhľajte sa.`)
      : reason === 'early' ? `Nič sa nedeje. ${tx('Dovediem ťa', 'Dovediem vás')} aj odtiaľto.`
        : tx(`Ten ${was} už odišiel. Nič sa nedeje, nebež.`, `Ten ${was} už odišiel. Nič sa nedeje, neponáhľajte sa.`);
    u.note = `${why} ${reason === 'early' ? Veh(r) : `Ďalší ${veh(r)}`} ${lineOf(r)} ide o ${fmtTime(r.dep)}.`;
    u.noteAt = Date.now();
    u.noteSay = u.note; // povie sa spolu s prvou vetou novej obrazovky (render), aby ju tá neprerušila
  }
  // „Ísť neskôr“: ďalšia vybraná karta; keď dôjdu, hľadá sa od odchodu poslednej
  function later() {
    const t = A.trip();
    if (!t || t.phase !== 'preview' || !t.journeys.length) return;
    if (t.jIdx + 1 >= t.journeys.length) {
      const lastJ = t.journeys[t.journeys.length - 1], now = Math.floor(A.tripNowSecs());
      const more = gather(t, now, lastJ.sm.rides[0].dep + 60, t.smDi).list.filter((j) => !night(j, now)); // zajtrajší nie je „neskôr“
      t.journeys.push(...chain(lastJ, more));
    }
    if (t.jIdx + 1 < t.journeys.length) { t.jIdx++; render(); }
    else sheet(`<div class="sm-bigmsg"><h2>Neskôr dnes už nič nejde</h2><p>${tx('Ostáva čas, ktorý vidíš na obrazovke.', 'Ostáva čas, ktorý vidíte na obrazovke.')}</p></div><div class="sm-stack">${btn('close', 'Dobre', 'sm-primary')}</div>`);
  }

  function previewView(t, title) {
    const now = A.tripNowSecs(); // hodiny cesty: po polnoci idú ďalej, časy plánu sú od dňa, keď vznikol
    if (t.walkOnly) {
      const m = Math.max(1, Math.round(t.smWalk * DETOUR / SLOW / 60));
      return { title, back: true, vkey: 'pw',
        body: t.smWalk <= WALK_ONLY_M
          ? big('🚶', tx('Je to blízko. Pôjdeš pešo', 'Je to blízko. Pôjdete pešo'), `<p>${tx('Do cieľa to máš', 'Do cieľa to máte')} asi <b>${mins(m)}</b>.</p>`)
          : big('🚶', tx('Pôjdeš pešo', 'Pôjdete pešo'), `<p>${tx('Do cieľa to máš', 'Do cieľa to máte')} asi <b>${mins(m)}</b>.</p><p>Autobusom ani trolejbusom by to teraz nebolo rýchlejšie.</p>`),
        act: btn('start', tx('▶ Sprevádzaj ma', '▶ Sprevádzajte ma'), 'sm-primary') };
    }
    const j = t.journeys[t.jIdx], a = j.sm, r0 = a.rides[0], D = A.D();
    if (t.jIdx === 0 && night(j, now)) { // najbližší spoj ide až zajtra
      const wm = t.smDist <= WALK_FALLBACK_M ? Math.max(1, Math.round(t.smDist * DETOUR / SLOW / 60)) : 0;
      return { title, back: true, vkey: 'night', voice: `Dnes už nič nejde. Najbližší ${veh(r0)} ${lineOf(r0)} ide zajtra o ${fmtTime(r0.dep)}.`,
        body: big('🌙', 'Dnes už nič nejde', `<p>Najbližší ${veh(r0)} ${badge(lineOf(r0))} ide <b>zajtra o ${fmtTime(r0.dep)}</b> zo zastávky ${esc(clean(D.stops[r0.from].n))}.</p><p>${tx('Zavolaj, nech po teba niekto príde.', 'Zavolajte, nech po vás niekto príde.')}</p>`),
        act: `${btn('call', '📞 Zavolať', 'sm-primary')}${wm ? btn('walkonly', `🚶 ${tx('Pôjdem', 'Pôjdem')} pešo (asi ${mins(wm)})`) : ''}` };
    }
    const inMin = Math.max(0, Math.round((a.leave - now) / 60));
    const steps = [`<li><span class="sm-ico" aria-hidden="true">🚶</span><div><div class="sm-main">${tx('Choď', 'Choďte')} na zastávku ${esc(clean(D.stops[r0.from].n))}</div><div class="sm-sub">${minsN(Math.max(1, Math.round(a.pre / 60)))} pešo, ${tx('dovediem ťa', 'dovediem vás')}</div></div></li>`];
    let chain = 0;
    a.rides.forEach((r, i) => {
      const seated = i > 0 && t_seated(j, i);
      if (i > 0 && !seated) {
        steps.push(r.from === a.rides[i - 1].to
          ? `<li><span class="sm-ico" aria-hidden="true">🔁</span><div><div class="sm-main">${tx('Počkaj', 'Počkajte')} na ${veh(r)} ${badge(lineOf(r))}</div><div class="sm-sub">na tej istej zastávke</div></div></li>`
          : `<li><span class="sm-ico" aria-hidden="true">🔁</span><div><div class="sm-main">${tx('Prejdi', 'Prejdite')} na zastávku ${esc(clean(D.stops[r.from].n))}</div><div class="sm-sub">je blízko, ${tx('dovediem ťa', 'dovediem vás')}</div></div></li>`);
      }
      if (seated) steps.push(`<li><span class="sm-ico" aria-hidden="true">💺</span><div><div class="sm-main">${tx('Zostaň sedieť', 'Zostaňte sedieť')}</div><div class="sm-sub">${veh(r)} pokračuje ako linka ${esc(lineOf(r))}</div></div></li>`);
      else steps.push(`<li><span class="sm-ico" aria-hidden="true">${vico(r)}</span><div><div class="sm-main">${tx('Nastúp', 'Nastúpte')} do ${veh(r)}u ${badge(lineOf(r))} o ${fmtTime(r.dep)}</div><div class="sm-sub">Vpredu má napísané: <b>${esc(headOf(r))}</b></div></div></li>`);
      chain = (seated ? chain : 0) + r.stops.length - 1; // zastávky od nastúpenia, aj cez zmenu čísla linky
      const nxt = a.rides[i + 1];
      if (nxt && t_seated(j, i + 1)) return;
      const n = chain;
      steps.push(`<li><span class="sm-ico" aria-hidden="true">🔔</span><div><div class="sm-main">${tx('Vystúp', 'Vystúpte')} na zastávke ${esc(clean(D.stops[r.to].n))}</div><div class="sm-sub">Je to ${n}. zastávka · o ${fmtTime(r.arr)}${request(D.stops[r.to].n) ? ` · pred ňou <b>${tx('stlač', 'stlačte')} STOP</b>` : ''}</div></div></li>`);
    });
    if (a.fin > 45) steps.push(`<li><span class="sm-ico" aria-hidden="true">🚶</span><div><div class="sm-main">${tx('Dôjdi', 'Dôjdite')} pešo do cieľa</div><div class="sm-sub">${minsN(Math.max(1, Math.round(a.fin / 60)))} pešo, ${tx('dovediem ťa', 'dovediem vás')}</div></div></li>`);
    steps.push(`<li><span class="sm-ico" aria-hidden="true">🏁</span><div><div class="sm-main">V cieli ${tx('budeš', 'budete')} o ${fmtTime(a.arr)}</div><div class="sm-sub">${esc(clean(A.targetLabel(t.dest)))}</div></div></li>`);
    const tags = `<span class="sm-tag">${a.changes === 1 ? tx('Raz presadneš', 'Raz presadnete') : a.changes ? `${a.changes}× ${tx('presadneš', 'presadnete')}` : 'Bez presadania'}</span>${a.changes && isFinite(a.slack) ? `<span class="sm-tag${a.slack < MIN_SLACK ? ' sm-tag-w' : ''}">na presadnutie ${tx('máš', 'máte')} ${a.slack < MIN_SLACK ? 'len ' : ''}${mins(Math.max(1, Math.floor(a.slack / 60)))}</span>` : ''}`;
    const prev = t.jIdx > 0 ? btn('earlier', 'Ísť skôr') : '';
    return { title, back: true, speak: true, vkey: `plan${t.jIdx}`,
      read: `${tx('Vyraz o', 'Vyrazte o')} ${fmtTime(a.leave)}. ${Veh(r0)} ${lineOf(r0)} ide o ${fmtTime(r0.dep)} zo zastávky ${clean(D.stops[r0.from].n)}. ${a.changes === 1 ? tx('Raz presadneš.', 'Raz presadnete.') : a.changes ? `${a.changes}-krát ${tx('presadneš', 'presadnete')}.` : 'Bez presadania.'} V cieli ${tx('budeš', 'budete')} o ${fmtTime(a.arr)}.`,
      body: `<div class="sm-leave"><div class="sm-lbl">${tx('Vyraz o', 'Vyrazte o')}</div><div class="sm-bignum">${fmtTime(a.leave)}</div><div class="sm-in">${inMin <= 0 ? 'to je hneď teraz' : `to je o ${mins(inMin)}`}</div>
        <div class="sm-bus">${Veh(r0)} ${badge(lineOf(r0))} ide o <b>${fmtTime(r0.dep)}</b> zo zastávky <b>${esc(clean(D.stops[r0.from].n))}</b></div><div class="sm-tags">${tags}</div></div>
        <ol class="sm-steps">${steps.join('')}</ol>`,
      act: `${btn('start', tx('▶ Sprevádzaj ma', '▶ Sprevádzajte ma'), 'sm-primary')}${prev ? `<div class="sm-pair">${prev}${btn('later', 'Ísť neskôr')}</div>` : btn('later', 'Ísť neskôr')}` };
  }
  // jazda i pokračuje v tom istom autobuse ako jazda i−1 („zostaň sedieť“)
  function t_seated(j, i) {
    const rides = j.legs.filter((l) => l.type === 'ride');
    const idx = j.legs.indexOf(rides[i]);
    return idx > 0 && j.legs[idx - 1].type === 'stay';
  }

  // ── sprevádzanie ───────────────────────────────────────────────────
  // stav obrazovky patrí k jednému pešiemu úseku (zastávka alebo cieľ); po prepočítaní začína odznova
  function uiOf(t) {
    const key = `${t.t0Epoch}|${t.jIdx}|${t.ri}|${t.phase === 'final' ? 'f' : t.phase === 'ride' ? 'r' : 's'}`;
    if (!t.sm) t.sm = { started: false, note: null, noteAt: 0, key: null };
    if (t.sm.key !== key && ['toStop', 'wait', 'final', 'ride'].includes(t.phase)) {
      t.sm = { started: t.sm.started, note: t.sm.note, noteAt: t.sm.noteAt, noteSay: t.sm.noteSay, key, step: 'walk', ok: false, fix: false, bad: false,
        hist: [], hs: [], hw: null, peak: 0, view: 'arrow', cue: null, geo: null, said: {}, d0: null };
      spoken = ''; // nový úsek alebo nový plán: prvá veta obrazovky sa povie, aj keď sa volá rovnako
    }
    return t.sm;
  }
  function start() {
    const t = A.trip();
    if (!t || t.phase !== 'preview') return;
    const u = uiOf(t);
    // medzitým mohol čas odchodu prejsť → naplánovať znova a ísť rovno na ďalší
    if (!t.walkOnly && t.journeys[t.jIdx].sm.leave < A.tripNowSecs() - 90) {
      u.wasVeh = veh(t.journeys[t.jIdx].sm.rides[0]);
      u.started = true; plan('late'); A.beginTrip(); return;
    }
    u.started = true;
    if (t.walkOnly) t.phase = 'final'; else A.useJourney(t.jIdx);
    const nu = uiOf(t);
    if ((cfg().intro || 0) < 3) nu.step = 'intro';
    A.beginTrip();
    A.renderTrip();
  }

  // čím sa dá správne nástupište odlíšiť od ostatných s rovnakým menom (do 150 m):
  // none = žiadne iné nie je; line = iné túto linku nemajú; dir = linka z nich ide opačne; ask = nedá sa
  let byName = null;
  function cueOf(t, u) {
    if (u.cue) return u.cue;
    const D = A.D(), r = t.rides[t.ri], i = r.from, s = D.stops[i];
    if (!byName) { byName = new Map(); D.stops.forEach((x, k) => { if (D.stopDirs[k] && D.stopDirs[k].length) { if (!byName.has(x.n)) byName.set(x.n, []); byName.get(x.n).push(k); } }); }
    const dist = (k) => haversine(s.la, s.lo, D.stops[k].la, D.stops[k].lo);
    const sib = (byName.get(s.n) || []).filter((k) => k !== i && dist(k) <= SIB_M).sort((a, b) => dist(a) - dist(b));
    const sd = (D.stopDirs[i] || []).find(([rt, h]) => rt === r.route && h === r.head);
    const myB = sd ? sd[2] : null, line = lineOf(r);
    if (!sib.length) return (u.cue = { type: 'none', bus: myB });
    const same = sib.filter((k) => D.stopDirs[k].some(([rt]) => D.routes[rt].s === line));
    const type = !same.length ? 'line'
      : myB != null && same.every((k) => D.stopDirs[k].filter(([rt]) => D.routes[rt].s === line).every(([, , b]) => angDiff(myB, b) > 90)) ? 'dir' : 'ask';
    const ref = (same.length ? same : sib)[0];
    return (u.cue = { type, dist: dist(sib[0]), refDist: dist(ref), bus: myB, n: sib.length + 1 });
  }
  // ulica pri nástupišti a smer odchodu zrovnaný s jej osou – z mapy uloženej v appke (načíta sa raz)
  function geoOf(t, u) {
    if (u.geo) return u.geo;
    u.geo = { street: null, bus: null };
    const D = A.D(), r = t.rides[t.ri], s = D.stops[r.from], raw = cueOf(t, u).bus, g = u.geo;
    A.loadMapbase().then((M) => {
      if (!M) return;
      const kx = 111320 * Math.cos(s.la * Math.PI / 180), ky = 110540;
      const names = new Map(); let best = null;
      for (const st of M.streets) {
        const road = 'mpstr'.includes(st.c);
        if (!road && !st.n) continue;
        for (let k = 1; k < st.p.length; k++) {
          const ax = (st.p[k - 1][1] - s.lo) * kx, ay = (st.p[k - 1][0] - s.la) * ky, bx = (st.p[k][1] - s.lo) * kx, by = (st.p[k][0] - s.la) * ky;
          const dx = bx - ax, dy = by - ay, L2 = dx * dx + dy * dy;
          let q = L2 ? (-ax * dx - ay * dy) / L2 : 0; q = Math.max(0, Math.min(1, q));
          const dd = Math.hypot(ax + q * dx, ay + q * dy);
          if (st.n && dd < (names.get(st.n) ?? Infinity)) names.set(st.n, dd);
          if (road && L2 >= 64 && (!best || dd < best.d)) best = { d: dd, axis: (Math.atan2(dx, dy) * 180 / Math.PI + 360) % 360 };
        }
      }
      const nm = [...names].sort((a, b) => a[1] - b[1]);
      if (nm[0] && nm[0][1] <= 25 && !(nm[1] && nm[1][1] - nm[0][1] < 10)) g.street = nm[0][0];
      if (raw != null && best && best.d <= 25) {
        const c = [best.axis, (best.axis + 180) % 360].sort((a, b) => angDiff(a, raw) - angDiff(b, raw))[0];
        if (angDiff(c, raw) <= 75) g.bus = c;
      }
      if (A.trip() === t) render();
    }).catch(() => {});
    return u.geo;
  }
  // smer, ktorým sa človek pozerá: kompas telefónu, inak smer chôdze z posledných polôh
  const headingOf = (u) => (A.compassHeading() != null ? A.compassHeading() : u.course != null ? u.course : null);
  function turnText(rel, dest) {
    const a = Math.abs(rel), side = rel > 0 ? 'doprava' : 'doľava';
    if (a <= 20) return tx('Choď rovno.', 'Choďte rovno.');
    if (a <= 70) return tx(`Otoč sa trochu ${side}.`, `Otočte sa trochu ${side}.`);
    if (a <= 135) return tx(`Otoč sa ${side}.`, `Otočte sa ${side}.`);
    return `${tx('Otoč sa.', 'Otočte sa.')} ${dest ? 'Cieľ' : 'Zastávka'} je za ${tx('tebou', 'vami')}.`;
  }
  const SAFE = () => '<p class="sm-safe">Cez cestu len po priechode.</p>';
  const SAFE_V = () => tx('Cez cestu choď len po priechode pre chodcov.', 'Cez cestu choďte len po priechode pre chodcov.');
  const arrow = '<svg id="smArrow" viewBox="0 0 100 100" aria-hidden="true"><path d="M50 5 L87 88 L50 69 L13 88 Z"/></svg>';
  const busArrow = '<svg id="smBusArrow" viewBox="0 0 100 100" aria-hidden="true"><path d="M43 92 V40 H22 L50 6 L78 40 H57 V92 Z"/></svg>';

  // poloha vzhľadom na cieľ pešieho úseku + sledovanie zlého smeru a príchodu
  // poloha na zobrazenie: veľmi nepresná (nad 60 m) sa použije, len keď lepšia nie je alebo je stará
  function fixOf(t, u) {
    const p = t.pos;
    if (p && p.acc <= 60) u.gp = p;
    u.vague = !!p && p.acc > 60 && (!u.gp || p.t - u.gp.t > 30000); // dlhšie bez presnej polohy
    return p && p.acc > 60 && u.gp ? u.gp : p;
  }
  function walkGeo(t, u) {
    const D = A.D(), p = fixOf(t, u), dest = t.phase === 'final';
    let la, lo;
    if (dest) { const q = A.destPoint(t, p?.la, p?.lo); la = q.la; lo = q.lo; } else { const s = D.stops[t.rides[t.ri].from]; la = s.la; lo = s.lo; }
    if (!p) return { d: null, brg: null };
    const d = haversine(p.la, p.lo, la, lo), brg = bearingTo(p.la, p.lo, la, lo);
    if (u.pt !== p.t) { // nová poloha
      u.pt = p.t;
      if (u.d0 == null) u.d0 = d;
      if (p.acc <= 60) {
        if (!u.cref) u.cref = p;
        else if (haversine(u.cref.la, u.cref.lo, p.la, p.lo) >= 6) { u.course = bearingTo(u.cref.la, u.cref.lo, p.la, p.lo); u.cref = p; }
        u.hist.push([p.t, d]);
        while (u.hist.length && p.t - u.hist[0][0] > 60000) u.hist.shift();
        // vyhladená vzdialenosť = medián posledných 5 polôh; šum GPS (±30 m) tak nevyzerá ako chôdza
        const tail = u.hist.slice(-5).map((x) => x[1]).sort((x, y) => x - y), ds = tail[tail.length >> 1];
        u.hs.push([p.t, ds]);
        while (u.hs.length && p.t - u.hs[0][0] > 60000) u.hs.shift();
        const minD = Math.min(...u.hs.map((x) => x[1]));
        // rýchlosť vzďaľovania z vyhladenej vzdialenosti za posledných 8–15 s (nie z jedného skoku polohy)
        const old = u.hs.find((x) => p.t - x[0] <= 15000) || u.hs[0], dt = (p.t - old[0]) / 1000;
        const away = dt >= 8 ? (ds - old[1]) / dt : 0;
        u.growN = u.dsPrev != null && ds - u.dsPrev >= 2 ? (u.growN || 0) + 1 : 0; // súvislý rast, poloha za polohou
        u.dsPrev = ds;
        // rýchlosť presunu za posledných 8–15 s (z posunu polohy; jeden skok GPS ju veľmi nezmení)
        if (!u.trk) u.trk = [];
        u.trk.push([p.t, p.la, p.lo]);
        while (p.t - u.trk[0][0] > 15000) u.trk.shift();
        const tdt = (p.t - u.trk[0][0]) / 1000;
        const spd = tdt >= 8 ? haversine(u.trk[0][1], u.trk[0][2], p.la, p.lo) / tdt : 0;
        // Vzďaľuje sa rýchlosťou vozidla, súvisle a už vyše 100 m: vezie sa. Pri chôdzi do cieľa to
        // znamená, že nevystúpil → „vystúp na najbližšej zastávke“. Pred nástupom (aj keď už stál na
        // zastávke) môže sedieť v správnom spoji aj v inom → obrazovka sa opýta, nič neprikazuje.
        // Nový plán si človek vyžiada sám tlačidlom, keď je vonku (žiadne prepočítanie na červenej).
        if (!u.riding && away > 3.5 && u.growN >= 6 && ds - minD > 100) {
          u.riding = true; u.bad = false; u.ridePeak = ds; u.slowAt = null;
          if (!dest) u.step = 'walk'; // od zastávky je už ďaleko: po návrate sa k nej vedie znova
        } else if (u.riding) {
          // Ide späť pešo: aspoň 25 s len rýchlosťou chôdze, za ten čas o 20 m bližšie a spolu o 40 m
          // bližšie než najďalej. Vozidlo na červenej, v zastávke alebo na ceste, čo sa stáča späť,
          // to nesplní (stojí, alebo sa medzitým hýbe rýchlo) – otázka „Si v autobuse?“ ostáva.
          u.ridePeak = Math.max(u.ridePeak, ds);
          const slow = spd <= 2.5 && !(t.speedAvg > 2.5);
          if (!slow) u.slowAt = null; else if (!u.slowAt) u.slowAt = [p.t, ds];
          if (u.slowAt && p.t - u.slowAt[0] >= 25000 && u.slowAt[1] - ds >= 20 && u.ridePeak - ds > 40) {
            u.riding = false; u.slowAt = null; u.hs = [[p.t, ds]]; u.hw = null;
            if (dest && d > 1000) u.wantReplan = true; // do cieľa je ďaleko: radšej nový plán z miesta, kde je
          }
        }
        // Základ pre „zlý smer“: vyhladená vzdialenosť, ktorá sa mení najviac rýchlosťou chôdze
        // (3 m/s). Krátky skok polohy – k zastávke aj od nej – ju tak takmer neposunie. Kým sa človek
        // vzďaľuje rýchlejšie než chôdzou (merané z vyhladenej vzdialenosti, nie z jednej polohy) alebo
        // sa aspoň 5 s za sebou presúva rýchlosťou vozidla (aj šikmo od zastávky), základ sa počíta
        // odznova – potom sa neporovnáva s miestom spred minúty. Šum polohy pri chôdzi samotný ho
        // nevynuluje (krátke výkyvy rýchlosti len pozdržia hlásenie).
        const fast = away > 3 || spd > 3;
        u.vrun = spd > 3.5 ? (u.vrun || 0) + 1 : 0;
        if (!u.hw || away > 3 || u.vrun >= 5 || u.riding) u.hw = { v: ds, t: p.t, min: [[p.t, ds, p.acc]] };
        else {
          const cap = 3 * Math.max(0.5, (p.t - u.hw.t) / 1000);
          u.hw.v += Math.max(-cap, Math.min(cap, ds - u.hw.v)); u.hw.t = p.t;
          u.hw.min.push([p.t, u.hw.v, p.acc]);
          while (p.t - u.hw.min[0][0] > 60000) u.hw.min.shift();
        }
        const dw = u.hw.v, mw = u.hw.min.reduce((x, y) => (y[1] < x[1] ? y : x)), minW = mw[1];
        // zlý smer: vzdialenosť narástla o 40 m (alebo o dvojnásobok chyby polohy, alebo o súčet chýb
        // teraz a pri minime – minimum z nepresnej polohy nesmie spustiť poplach, keď sa poloha spresní)
        // nad minimum z poslednej minúty a práve teraz stále rastie rýchlosťou chôdze, pri dvoch polohách
        // za sebou; zruší sa až po skutočnom priblížení; vibrácia a hlas najviac raz za 30 s
        const over = !u.riding && !fast && away > 0.3 && u.hist.length >= 5 && dw - minW > Math.max(40, p.acc * 2, p.acc + mw[2]) && d > NEAR_M;
        if (u.step === 'walk' && !u.bad) {
          u.badN = over ? (u.badN || 0) + 1 : 0;
          if (u.badN >= 2) {
            u.bad = true; u.peak = ds; u.badN = 0;
            u.badQuiet = p.t - (u.badAt || -1e9) < 30000;
            if (!u.badQuiet) { u.badAt = p.t; A.buzz([200, 100, 200]); }
          }
        } else if (u.bad) { u.peak = Math.max(u.peak, ds); if (u.peak - ds > 15 || d <= NEAR_M) { u.bad = false; u.hs = [[p.t, ds]]; u.hw = null; } }
        // od zastávky (potvrdenej alebo s otázkou) odišiel pešo ďaleko: znova ho k nej viesť
        if (!dest && !u.riding && ['atstop', 'check', 'unsure', 'nofix'].includes(u.step)) {
          if (ds > 80 && p.acc <= 40 && spd <= 3) { if (!u.leftAt) u.leftAt = p.t; } else u.leftAt = null;
          if (u.leftAt && p.t - u.leftAt >= 20000) { u.step = 'walk'; u.ok = false; u.leftAt = null; u.said.start = false; u.minD = d; u.d0 = d; }
        }
        u.minD = Math.min(u.minD ?? Infinity, d); // najbližšie, kam sa dostal (hlásenie „ešte N metrov“ len smerom dnu)
        // po oprave („stojíš na druhej strane“) poloha obe nástupištia nerozlíši: príchod až keď sa človek pohol
        const moved = !u.fix || u.fixLa == null || (p.t - u.fixAt > 15000 && haversine(u.fixLa, u.fixLo, p.la, p.lo) >= 10);
        // okolo zastávky sa dá aj prejsť vo vozidle: príchod len pri rýchlosti chôdze
        if (!dest && u.step === 'walk' && !u.riding && !(spd > 3) && d <= ARRIVE_M && p.acc <= 25 && moved) arrive(t, false);
      }
    }
    return { d, brg, acc: p.acc };
  }
  function atStop(u, ok) {
    u.step = 'atstop'; u.ok = ok; u.bad = false;
    const t = A.trip();
    if (ok && t && t.rides[t.ri]) t.smOkStop = t.rides[t.ri].from; // overené nástupište (pre ďalší spoj z neho)
  }
  // manual = ťukol „Som na zastávke“; inak ho priviedla poloha
  function arrive(t, manual) {
    const u = uiOf(t), c = cueOf(t, u);
    if (c.type === 'line' || c.type === 'dir') {
      // bez otázky len vtedy, keď ho priviedla poloha a iné nástupište je ďalej, než koľko poloha kolíše
      if (!manual && !u.fix && c.dist >= ASK_M) return atStop(u, true);
      // otázka na smer potrebuje kompas; bez neho len rada, čo si pozrieť na autobuse
      u.step = c.type === 'dir' && A.compassHeading() == null ? 'unsure' : 'check';
      return;
    }
    atStop(u, c.type === 'none' && !manual); // jediné nástupište: stačí poloha; „ask“ sa overiť nedá
  }
  function hereTap() {
    const t = A.trip();
    if (!t) return;
    const u = uiOf(t), g = walkGeo(t, u), dest = t.phase === 'final';
    const go = () => { u.bad = false; if (dest) A.arrived(); else { arrive(t, true); render(); } };
    if (g.d == null || g.d <= NEAR_M) return go();
    const D = A.D();
    sheet(`<h2>${dest ? tx('Naozaj si už v cieli?', 'Naozaj ste už v cieli?') : tx('Naozaj si už pri zastávke?', 'Naozaj ste už pri zastávke?')}</h2>
      <p>Telefón si myslí, že ${tx('si', 'ste')} ešte <b>${roundM(g.d)} m</b> ${dest ? 'od cieľa' : 'od zastávky'}.</p>
      ${dest ? '' : `<p>${tx('Stojíš', 'Stojíte')} pri tabuli s názvom <b>${esc(clean(D.stops[t.rides[t.ri].from].n))}</b>?</p>`}
      <div class="sm-stack">${btn('close', tx('Nie, veď ma ďalej', 'Nie, veďte ma ďalej'), 'sm-primary')}${btn('hereyes', dest ? tx('Áno, som v cieli', 'Áno, som v cieli') : tx('Áno, stojím pri nej', 'Áno, stojím pri nej'))}</div>`);
    gate = { hereyes: () => { closeSheet(); go(); } };
  }

  function walkView(t, title) {
    const D = A.D(), u = uiOf(t), dest = t.phase === 'final';
    // presadnutie na tom istom nástupišti, alebo ďalší spoj z nástupišťa, ktoré je už overené
    // (ušiel spoj, človek stojí stále tam): netreba nikam ísť ani sa znova pýtať
    if (!dest && u.step === 'walk' && !u.same) {
      u.same = true;
      const rr = t.rides[t.ri], sp = D.stops[rr.from], p = t.pos;
      const here = t.smOkStop === rr.from && p && haversine(p.la, p.lo, sp.la, sp.lo) <= NEAR_M;
      if ((t.ri > 0 && rr.from === t.rides[t.ri - 1].to) || here) atStop(u, true);
    }
    const g = walkGeo(t, u); // môže zmeniť u.step (príchod podľa polohy) aj u.riding
    if (!dest && u.step === 'atstop' && !u.riding) return waitView(t, title);
    const r = dest ? null : t.rides[t.ri], st = dest ? null : D.stops[r.from];
    const cue = dest ? { type: 'none' } : cueOf(t, u), geo = dest ? {} : geoOf(t, u);
    const line = dest ? '' : lineOf(r), name = dest ? t.fav.label : clean(st.n);
    const V = dest ? '' : veh(r), missBtn = dest ? '' : `${Veh(r)} mi ušiel`;
    const base = { title, speak: true, dots: dest ? 4 : 1 };
    const step = u.riding ? 'walk' : u.step; // vezie sa: otázka „si v autobuse?“ má prednosť pred každým krokom
    if (step === 'intro') return { ...base, vkey: 'intro',
      voice: tx('Najprv sa zastav. Drž telefón pred sebou, displejom hore. Šípka sa otáča spolu s tebou. Pri chôdzi sa pozeraj pred seba, nie do telefónu.', 'Najprv sa zastavte. Držte telefón pred sebou, displejom hore. Šípka sa otáča spolu s vami. Pri chôdzi sa pozerajte pred seba, nie do telefónu.'),
      body: `${big('📱', tx('Najprv sa zastav', 'Najprv sa zastavte'), `<p>${tx('Drž', 'Držte')} telefón <b>pred sebou, displejom hore</b>. Šípka sa otáča spolu s ${tx('tebou', 'vami')}.</p>`)}
        <div class="sm-next">Pri chôdzi sa ${tx('pozeraj', 'pozerajte')} <b>pred seba</b>, nie do telefónu. Keď ${tx('pôjdeš', 'pôjdete')} zle${dest ? '' : ` alebo ${tx('budeš', 'budete')} pri zastávke`}, poviem to a zavibrujem.</div>`,
      act: `${btn('introok', 'Rozumiem, ideme', 'sm-primary')}${END()}` };
    if (step === 'check') { // pri zastávke: over, že je na správnom nástupišti
      if (cue.type === 'line') return { ...base, vkey: 'check', voice: `${tx('Pozri sa', 'Pozrite sa')} na tabuľu zastávky. Je na nej číslo ${line}?`,
        body: `<div class="sm-now"><h2>${tx('Pozri sa', 'Pozrite sa')} na tabuľu zastávky</h2><p class="sm-q">Je na nej číslo ${badge(line)}?</p></div>
          <div class="sm-next">Číslo ${tx('hľadaj', 'hľadajte')} na tabuli zastávky alebo na papieri s časmi odchodov, ktorý na nej visí.</div>`,
        act: `${btn('yes', `Áno, je tam ${esc(line)}`, 'sm-primary')}<div class="sm-pair">${btn('no', 'Nie, nie je')}${btn('idk', 'Neviem')}</div>${END()}` };
      // Zastávky oproti sebe: kto stojí pri správnej tvárou k ceste, tomu autobus odchádza doprava (jazdí sa vpravo).
      return { ...base, vkey: 'check', voice: tx('Postav sa tvárou k ceste. Kam ukazuje šípka, doprava alebo doľava?', 'Postavte sa tvárou k ceste. Kam ukazuje šípka, doprava alebo doľava?'),
        body: `<div class="sm-now"><p class="sm-pre">${tx('Postav sa', 'Postavte sa')} tvárou k ceste.</p><h2>Kam ukazuje šípka?</h2><div class="sm-busdir">${busArrow}</div><p><span aria-hidden="true">${vico(r)}</span> Tadiaľ pôjde ${V} <b>${esc(line)}</b>.</p></div>
          <div class="sm-next">${tx('Drž', 'Držte')} telefón pred sebou. Šípka ukazuje, ktorým smerom ${V} odíde.</div>`,
        act: `<div class="sm-pair sm-pair-big">${btn('left', '⬅ Doľava')}${btn('right', 'Doprava ➜')}</div><div class="sm-pair">${btn('idk', 'Neviem')}${END()}</div>` };
    }
    if (step === 'nofix') { // stojí na inom nástupišti s rovnakým menom
      const dm = `${roundM(cue.refDist)} m`, other = cue.type === 'dir';
      return { ...base, vkey: 'nofix',
        voice: other ? `To nevadí. Odtiaľto ide ${V} ${line} opačným smerom. ${tx('Tvoja', 'Vaša')} zastávka je na druhej strane cesty. ${SAFE_V()}` : `To nevadí. Tu ${V} ${line} nezastavuje. ${tx('Tvoja', 'Vaša')} zastávka je kúsok ďalej.`,
        body: big('🙂', 'To nevadí', other
          ? `<p>Odtiaľto ide ${V} <b>${esc(line)}</b> opačným smerom. ${tx('Tvoja', 'Vaša')} zastávka je <b>na druhej strane cesty</b>, asi ${dm}.</p>${SAFE()}`
          : `<p>Tu ${V} <b>${esc(line)}</b> nezastavuje. ${tx('Tvoja', 'Vaša')} zastávka je kúsok ďalej, asi <b>${dm}</b>.</p>`),
        act: `${btn('fixgo', tx('Ukáž mi ju', 'Ukážte mi ju'), 'sm-primary')}${END()}` };
    }
    if (step === 'unsure') { // „Neviem“ (alebo druhé „Nie“ po oprave): nikam neposielať
      const run = `Ak ${V} ${esc(line)} zastaví o kúsok ďalej, ${tx('nebež k nemu. Ťukni', 'nebežte k nemu. Ťuknite')} „${missBtn}“.`;
      if (cue.type === 'line' && !u.fix) return { ...base, vkey: 'unsure',
        voice: `Nevadí. Na tabuli alebo na papieri s časmi odchodov má byť číslo ${line}. Ak tam nie je, ${tx('tvoja', 'vaša')} zastávka je kúsok ďalej.`,
        body: `<div class="sm-now"><h2>Nevadí</h2><p>Na tabuli alebo na papieri s časmi odchodov má byť číslo ${badge(line)}.</p><p>Ak tam nie je, ${tx('tvoja', 'vaša')} zastávka je asi <b>${roundM(cue.refDist)} m</b> odtiaľto.</p></div>
          <div class="sm-next">${run} Ak ${tx('nevieš', 'neviete')}, čo ďalej, ${tx('ťukni', 'ťuknite')} Zavolať.</div>`,
        act: `${btn('wait', 'Počkám tu', 'sm-primary')}<div class="sm-pair">${btn('fixgo', tx('Ukáž mi druhú zastávku', 'Ukážte mi druhú zastávku'))}${btn('call', '📞 Zavolať')}</div>` };
      // bez odpovede (telefón nemá kompas, otázka na smer sa nedá položiť): bez „Nevadí“
      const h2 = u.asked ? `Nevadí. ${tx('Ostaň', 'Ostaňte')} stáť tu` : `${tx('Si', 'Ste')} pri zastávke. ${tx('Ostaň', 'Ostaňte')} stáť tu`;
      const two = cue.type !== 'dir' ? '' : cue.n > 2 ? `Zastávky ${esc(name)} sú tu na oboch stranách cesty. ` : `Zastávky ${esc(name)} sú tu dve, oproti sebe. `;
      return { ...base, vkey: 'unsure',
        voice: `${h2}. ${two}Keď príde ${V}, ${tx('pozri sa', 'pozrite sa')} naň spredu. ${tx('Nastúp', 'Nastúpte')}, len ak má číslo ${line} a nápis ${headOf(r)}.`,
        body: `${big(u.asked ? '🙂' : '🚏', h2, `<p>Keď príde ${V}, ${tx('pozri sa', 'pozrite sa')} naň spredu. ${tx('Nastúp', 'Nastúpte')}, len ak má číslo ${badge(line)} a nápis <b>${esc(headOf(r))}</b>.</p>`)}
          <div class="sm-next">${two}Ak má iný nápis, ${tx('nenastupuj', 'nenastupujte')}. Ak ${tx('nevieš', 'neviete')}, čo ďalej, ${tx('ťukni', 'ťuknite')} Zavolať.</div>`,
        act: `${btn('wait', 'Dobre, počkám tu', 'sm-primary')}<div class="sm-pair">${btn('call', '📞 Zavolať')}${END()}</div>` };
    }

    // chôdza: šípka a vzdialenosť, do 40 m obrázok tabule
    const stopBtn = dest ? 'Som v cieli' : 'Som na zastávke';
    const lbl = u.fix ? tx('Prejdi na správnu zastávku', 'Prejdite na správnu zastávku') : dest ? tx('Choď do cieľa', 'Choďte do cieľa')
      : t.ri > 0 ? tx('Teraz choď na zastávku', 'Teraz choďte na zastávku') : tx('Choď na zastávku', 'Choďte na zastávku');
    const plate = dest ? `<div class="sm-plate"><span aria-hidden="true">${esc(t.fav.icon)}</span>${esc(t.fav.label)}</div>` : `<div class="sm-plate"><span class="sm-pi" aria-hidden="true">${vico(r)}</span>${esc(name)}</div>`;
    if (g.d == null) return { ...base, vkey: 'nopos', body: big('📍', tx('Hľadám, kde si…', 'Hľadám, kde ste…'), `<p>${tx('Postoj chvíľu vonku.', 'Postojte chvíľu vonku.')}</p>`), act: `${btn('here', stopBtn)}${END()}` };
    const head = headingOf(u), rel = head == null ? null : norm180(g.brg - head);
    const near = g.d <= NEAR_M, mm = roundM(g.d), now = A.tripNowSecs();
    // čas: stíha / tesne / nestihne (pomalšou chôdzou)
    let status = '', late = false;
    if (!dest && !u.fix) {
      const slack = r.dep - now - g.d * DETOUR / SLOW;
      // „nestihneš“ len vtedy, keď to platí aj z najbližšieho miesta, kde podľa chyby polohy môže stáť,
      // a nikdy blízko zastávky (poloha tam môže byť nepresnejšia, než hlási; spoj môže meškať)
      const sure = r.dep - now - Math.max(0, g.d - (g.acc || 0)) * DETOUR / SLOW <= 0;
      const close = g.d <= Math.max(80, NEAR_M + (g.acc || 0));
      if (slack > 90) status = `<span class="sm-ok">✓ ${tx('stíhaš', 'stíhate')}</span>`;
      else if (close && now > r.dep) status = `<span class="sm-tight">${Veh(r)} mal prísť o ${fmtTime(r.dep)}. Môže meškať.</span>`;
      else if (slack > 0 || !sure || close) status = `<span class="sm-tight">${Veh(r)} príde o chvíľu. ${tx('Nebež.', 'Neponáhľajte sa.')}</span>`;
      else { late = true; status = `<span class="sm-tight">${tx('asi nestihneš', 'asi nestihnete')}</span>`; }
    }
    if (u.vague) { late = false; status = '<span class="sm-tight">poloha je nepresná</span>'; } // z nepresnej polohy sa „nestihneš“ netvrdí
    else if (late && t.speedAvg > 3) { late = false; status = ''; } // hýbe sa rýchlosťou vozidla: možno už sedí v spoji
    const note = u.note && Date.now() - u.noteAt < 45000 ? `<div class="sm-warn">${esc(u.note)}</div>` : '';
    const across = !dest && cue.type === 'dir' && u.fix;
    const safe = across ? '<p class="sm-safe"><span aria-hidden="true">⚠️</span> Zastávka je za cestou. Prejdi len po priechode.</p>'.replace('Prejdi', tx('Prejdi', 'Prejdite')) : SAFE();
    const where = dest ? `Cieľ: <b>${esc(clean(A.targetLabel(t.dest)))}</b>.` : `${Veh(r)} <b>${esc(line)}</b> ide o <b>${fmtTime(r.dep)}</b>.${geo.street ? ` Zastávka je na ulici <b>${esc(geo.street)}</b>.` : ''}`;
    let body, voice = '', vkey;
    if (u.riding && dest) { // po poslednej jazde sa vzďaľuje rýchlosťou vozidla: nevystúpil, alebo vystúpil neskoro
      vkey = 'riding';
      voice = tx('Vyzerá to, že sa ešte vezieš. Vystúp na najbližšej zastávke a ťukni Som vonku. Potom ťa dovediem ďalej.', 'Vyzerá to, že sa ešte veziete. Vystúpte na najbližšej zastávke a ťuknite Som vonku. Potom vás dovediem ďalej.');
      body = `${big('🔔', tx('Vystúp na najbližšej zastávke', 'Vystúpte na najbližšej zastávke'), `<p>${tx('Vyzerá to, že sa ešte vezieš.', 'Vyzerá to, že sa ešte veziete.')}</p>`)}
        <div class="sm-next">Nič sa nedeje. Keď ${tx('vystúpiš, ťukni', 'vystúpite, ťuknite')} „Som vonku“ a ${tx('dovediem ťa', 'dovediem vás')} ďalej z miesta, kde ${tx('budeš', 'budete')}.</div>`;
    } else if (u.riding) { // pred nástupom sa vezie: v správnom spoji (nepotvrdil zastávku), alebo v inom – opýtať sa
      vkey = 'carried';
      const q = tx(`Vyzerá to, že sa vezieš. Si v ${V}e ${line}?`, `Vyzerá to, že sa veziete. Ste v ${V}e ${line}?`);
      voice = `${q} ${tx(`Ak áno, ťukni Som v ${V}e. Ak nie, vystúp na najbližšej zastávke a ťukni Som vonku.`, `Ak áno, ťuknite Som v ${V}e. Ak nie, vystúpte na najbližšej zastávke a ťuknite Som vonku.`)}`;
      body = `<div class="sm-now"><div class="sm-bigico" aria-hidden="true">${vico(r)}</div><h2>${tx(`Si v ${V}e`, `Ste v ${V}e`)} ${badge(line)}?</h2><p>${tx('Vyzerá to, že sa vezieš.', 'Vyzerá to, že sa veziete.')}</p><p>Vpredu má mať napísané: <b>${esc(headOf(r))}</b></p></div>
        <div class="sm-next">Ak ${tx('si', 'ste')} v inom, nič sa nedeje: ${tx('vystúp', 'vystúpte')} na najbližšej zastávke a ${tx('ťukni', 'ťuknite')} „Som vonku“. ${tx('Dovediem ťa', 'Dovediem vás')} ďalej z miesta, kde ${tx('budeš', 'budete')}.</div>`;
    } else if (u.bad) {
      const sayBad = tx('Ideš opačným smerom. Otoč sa.', 'Idete opačným smerom. Otočte sa.');
      vkey = 'bad'; voice = u.badQuiet ? '' : sayBad; // hlas najviac raz za 30 s
      body = `<div class="sm-walk sm-bad"><p class="sm-wlbl">${lbl}</p>${plate}
        <div class="sm-wrow"><div class="sm-compass">${rel == null ? '<span class="sm-noarrow">?</span>' : arrow}</div><div class="sm-dist"><b>${mm} m</b><span>${tx('vzďaľuješ sa', 'vzďaľujete sa')}</span></div></div>
        <p class="sm-say">${sayBad}</p></div>
        <div class="sm-next">Nič sa nedeje. Stačí sa otočiť – šípka ${tx('ťa', 'vás')} povedie ďalej.</div>`;
    } else if (near && !dest && !u.fix) {
      const byNum = cue.type === 'line' || cue.type === 'none', asks = (cue.type === 'line' || cue.type === 'dir') && cue.dist < ASK_M;
      const all = [...new Set((D.stopDirs[r.from] || []).map(([rt]) => D.routes[rt].s))].filter((l) => l !== line).slice(0, 3);
      const sign = `<div class="sm-sign"><div class="sm-sign-top"><span aria-hidden="true">${vico(r)}</span>${esc(name)}</div>${byNum ? `<div class="sm-sign-lines"><span class="on">${esc(line)}</span>${all.map((l) => `<span>${esc(l)}</span>`).join('')}<em>…</em></div>` : ''}</div>`;
      const two = cue.n > 2 ? `Je tu viac zastávok ${esc(name)}.` : `Sú tu dve zastávky ${esc(name)}.`;
      const say = cue.type === 'line' ? [`${two} ${tx('Tvoja', 'Vaša')} má na tabuli číslo `, '.']
        : cue.type === 'none' ? [`${tx('Hľadaj', 'Hľadajte')} tabuľu zastávky s číslom `, '.']
        : asks ? [`Zastávky ${esc(name)} sú tu ${cue.n > 2 ? 'na oboch stranách cesty' : 'dve, oproti sebe'}. Pri zastávke sa ${tx('ťa opýtam, či stojíš', 'vás opýtam, či stojíte')} na správnej strane.`, '']
        : [`${tx('Hľadaj', 'Hľadajte')} tabuľu zastávky ${esc(name)}. Keď k nej ${tx('prídeš', 'prídete')}, poviem to.`, ''];
      vkey = 'near'; voice = `${tx('Už si blízko.', 'Už ste blízko.')} ${byNum ? `${say[0]}${line}${say[1]}` : say[0]} ${SAFE_V()}`;
      body = `${note}<div class="sm-walk"><div class="sm-whead"><div><p class="sm-wlbl">${tx('Už si blízko', 'Už ste blízko')}</p><b>${mm} m</b></div><div class="sm-compass sm-compass-s">${rel == null ? '<span class="sm-noarrow">?</span>' : arrow}</div></div>
        ${sign}<p class="sm-say">${byNum ? `${say[0]}${badge(line)}${say[1]}` : say[0]}</p>${SAFE()}</div>
        <div class="sm-next">${request(st.n) ? 'Zastávka je na znamenie. ' : ''}${where}${byNum && asks ? ` Pri zastávke sa ${tx('ťa ešte opýtam, či stojíš', 'vás ešte opýtam, či stojíte')} správne.` : ''}</div>`;
    } else {
      const fixD = u.fix && !dest ? roundM(cue.refDist) : null; // oprava: vzdialenosť nástupíšť z dát, poloha je tu nepresná
      const say = across ? 'Zastávka je na druhej strane cesty.'
        : rel == null ? tx('Urob pár krokov. Ukážem ti smer.', 'Urobte pár krokov. Ukážem vám smer.') : turnText(rel, dest);
      // hlas: na začiatku, pri 100 m a pri 50 m
      // pásmo podľa najbližšej dosiahnutej vzdialenosti (kolísanie polohy ho nevráti späť) a až keď je
      // aspoň 8 m bližšie než na začiatku chôdze (prvá veta vzdialenosť už povedala)
      const md = u.minD ?? g.d;
      const band = late ? 'late' : md > 100 || (u.d0 ?? md) - md < 8 ? 'far' : md > 50 ? 'd100' : 'd50';
      const lateSay = tx(`Tento ${V} asi nestihneš. Nič sa nedeje, nebež. Ťukni „Nájdi mi ďalší“.`, `Tento ${V} asi nestihnete. Nič sa nedeje, neponáhľajte sa. Ťuknite „Nájdite mi ďalší“.`);
      vkey = u.said.start ? band : 'start';
      // Prvá veta povie vzdialenosť (a prípadne „nestihneš“) sama: pásmo, v ktorom chôdza začína, ani
      // vzdialenejšie pásma sa už neohlasujú – ich hlas by prvú vetu hneď prerušil.
      if (!u.said.start) {
        const sb = g.d > 100 ? 'far' : g.d > 50 ? 'd100' : 'd50';
        for (const k of ['far', 'd100', 'd50']) { u.said[k] = true; if (k === sb) break; }
        if (late) u.said.late = true;
      }
      voice = !u.said.start
        ? `${dest ? `${lbl}.` : `${lbl} ${name}.`} Je to ${fixD != null ? `asi ${fixD}` : mm} metrov. ${rel == null || across ? '' : say} ${across ? tx('Zastávka je na druhej strane cesty. Prejdi len po priechode pre chodcov.', 'Zastávka je na druhej strane cesty. Prejdite len po priechode pre chodcov.') : SAFE_V()}${late ? ` ${lateSay}` : ''}`
        : band === 'late' ? lateSay
          : band === 'far' || u.fix ? '' : `Ešte ${mm} metrov.`;
      const tail = u.fix ? (cue.type === 'dir' ? `Zastávka je oproti. Pri nej sa ${tx('ťa znova opýtam, či stojíš', 'vás znova opýtam, či stojíte')} správne.` : `Tu, kde ${tx('si', 'ste')} teraz, ${V} ${esc(line)} nezastavuje. Pri zastávke sa znova opýtam.`)
        : `${where} Šípka ukazuje priamo na ${dest ? 'cieľ' : 'zastávku'}. Dom alebo plot ${tx('obíď', 'obíďte')} po chodníku.`;
      const lateBox = late ? `<div class="sm-warn">${tx(`Tento ${V} asi nestihneš. Nič sa nedeje, nebež. Ťukni „Nájdi mi ďalší“.`, `Tento ${V} asi nestihnete. Nič sa nedeje, neponáhľajte sa. Ťuknite „Nájdite mi ďalší“.`)}</div>` : '';
      body = `${note}<div class="sm-walk"><p class="sm-wlbl">${near && dest ? tx('Už si skoro v cieli', 'Už ste skoro v cieli') : lbl}</p>${plate}
        <div class="sm-wrow"><div class="sm-compass">${rel == null ? '<span class="sm-noarrow">?</span>' : arrow}</div><div class="sm-dist">${fixD != null ? `<b>asi ${fixD} m</b>` : `<b>${mm} m</b><span>asi ${minsN(Math.max(1, Math.round(g.d * DETOUR / SLOW / 60)))}</span>${status}`}</div></div>
        <p class="sm-say">${say}</p>${safe}</div>${lateBox}
        <div class="sm-next">${tail}</div>`;
    }
    // keď má spoj prísť (alebo už išiel), dá sa povedať „som v autobuse“ aj bez potvrdenia zastávky
    const due = !dest && now >= r.dep - 120;
    const findBtn = btn('missed', tx('Nájdi mi ďalší', 'Nájdite mi ďalší'));
    const act = u.riding && dest ? `${btn('offbus', 'Som vonku', 'sm-primary')}${END()}`
      : u.riding ? `${btn('board', `Áno, som v ${V}e`, 'sm-primary')}<div class="sm-pair">${btn('offbus', 'Som vonku')}${END()}</div>`
      : u.bad ? `${btn('here', stopBtn)}${END()}`
        : due ? `${btn('here', stopBtn, near ? 'sm-primary' : 'sm-secondary')}<div class="sm-pair">${btn('board', `Som v ${V}e`)}${late ? findBtn : btn('missed', missBtn)}</div>${END()}`
          : near ? `${btn('here', stopBtn, 'sm-primary')}${dest || u.fix ? END() : `<div class="sm-pair">${btn('missed', missBtn)}${END()}</div>`}`
            : `${btn('here', stopBtn)}${late ? `<div class="sm-pair">${findBtn}${END()}</div>` : END()}`;
    // priorita hlasu: varovanie a otázka hneď; „ešte N metrov“ sa vynechá, kým znie iná veta
    const pri = u.bad || u.riding ? 'urgent' : vkey === 'd100' || vkey === 'd50' ? 'low' : 'normal';
    return { ...base, body, act, voice, vkey, pri, once: !u.bad && !u.riding,
      read: u.riding ? voice : `${dest ? lbl : `${lbl} ${name}`}. ${u.fix && !dest ? 'Zastávka je blízko.' : `Ešte ${mm} metrov.`} ${u.bad || u.fix ? '' : rel == null ? '' : turnText(rel, dest)}` };
  }

  function waitView(t, title) {
    const D = A.D(), u = uiOf(t), r = t.rides[t.ri], st = D.stops[r.from], cue = cueOf(t, u), line = lineOf(r), next = D.stops[r.stops[1]];
    const now = A.tripNowSecs(), late = now > r.dep + 60, gone = now > r.dep + 420, V = veh(r), missBtn = `${Veh(r)} mi ušiel`;
    // po čase odchodu: najprv „môže meškať“, po 7 minútach „asi už odišiel“ (nikdy nečakať donekonečna)
    const lateTxt = gone ? `${Veh(r)} ${line} mal prísť o ${fmtTime(r.dep)} a stále tu nie je. Asi už odišiel. ${tx('Ťukni', 'Ťuknite')} „${missBtn}“ a ${tx('nájdem ti', 'nájdem vám')} ďalší.`
      : late ? `${Veh(r)} mal prísť o ${fmtTime(r.dep)}. Môže meškať – ${tx('počkaj', 'počkajte')}. Ak ${tx('ti', 'vám')} ušiel, ${tx('ťukni', 'ťuknite')} „${missBtn}“.` : '';
    return { title, speak: true, dots: 2, vkey: `wait${u.ok ? 1 : 0}${gone ? 'g' : late ? 'l' : ''}`,
      voice: lateTxt || `${u.ok ? tx('Si na správnej zastávke. ', 'Ste na správnej zastávke. ') : ''}${tx('Čakaj', 'Čakajte')} na ${V} ${line}. Príde o ${fmtTime(r.dep)}. Vpredu má napísané ${headOf(r)}.`,
      body: `${u.note && Date.now() - u.noteAt < 45000 ? `<div class="sm-warn">${esc(u.note)}</div>` : ''}<div class="sm-now">${u.ok ? `<p class="sm-ok">✓ ${tx('Si', 'Ste')} na správnej zastávke</p>` : '<div class="sm-bigico" aria-hidden="true">🚏</div>'}<h2>${tx('Čakaj', 'Čakajte')} na ${V} ${badge(line)}</h2><p>Príde o <b>${fmtTime(r.dep)}</b></p><p>Vpredu má napísané: <b>${esc(headOf(r))}</b></p>
        ${request(st.n) ? `<p class="sm-safe">Zastávka na znamenie: keď prichádza ${V} ${esc(line)}, ${tx('zdvihni', 'zdvihnite')} ruku.</p>` : ''}</div>
        ${lateTxt ? `<div class="sm-warn">${esc(lateTxt)}</div>` : ''}
        ${cue.type === 'ask' ? `<div class="sm-warn">Pri nástupe sa ${tx('spýtaj', 'spýtajte')} vodiča, či ide na zastávku ${esc(clean(D.stops[r.to].n))}.</div>` : ''}
        <div class="sm-next">${next ? `${Veh(r)} pôjde smerom na zastávku <b>${esc(clean(next.n))}</b>. ` : ''}Iné autobusy a trolejbusy ${tx('nechaj', 'nechajte')} odísť${request(st.n) ? `, ruku pri nich ${tx('nedvíhaj', 'nedvíhajte')}` : ''}.${u.ok ? '' : ` Ak ${V} ${esc(line)} zastaví o kúsok ďalej, ${tx('nebež', 'nebežte')} k nemu.`} Keď ${tx('nastúpiš, ťukni', 'nastúpite, ťuknite')} „Som v ${V}e“.</div>`,
      act: `${btn('board', `Som v ${V}e`, 'sm-primary')}<div class="sm-pair">${btn('missed', missBtn)}${END()}</div>` };
  }

  function rideView(t, title) {
    const D = A.D(), r = t.rides[t.ri];
    // vozidlo, ktoré pokračuje pod iným číslom linky („zostaň sedieť“), je pre človeka jedna jazda
    let end = t.ri;
    while (t.seated.has(end) && end + 1 < t.rides.length) end += 1;
    const re = t.rides[end], out = clean(D.stops[re.to].n), V = veh(r);
    let left = Math.max(0, r.stops.length - 1 - Math.floor(t.prog + 0.12));
    for (let k = t.ri + 1; k <= end; k++) left += t.rides[k].stops.length - 1;
    const stay = end > t.ri ? `${Veh(r)} cestou zmení číslo na ${lineOf(t.rides[t.ri + 1])}. ${tx('Zostaň sedieť', 'Zostaňte sedieť')}.` : '';
    const lastRide = end === t.rides.length - 1;
    const body = left <= 1
      ? `${big('🔔', `${tx('Vystúp', 'Vystúpte')} na ďalšej zastávke`, `<p><b>${esc(out)}</b></p>${request(D.stops[re.to].n) ? `<p class="sm-safe">${tx('Stlač', 'Stlačte')} tlačidlo STOP.</p>` : ''}`)}
        <div class="sm-next">${lastRide ? (A.tailWalk(t) > 30 ? `Potom ${tx('ťa', 'vás')} dovediem pešo do cieľa.` : `Potom ${tx('si', 'ste')} v cieli.`) : `Potom ${tx('ťa', 'vás')} dovediem k ďalšiemu ${veh(t.rides[end + 1])}u.`}</div>`
      : `<div class="sm-now"><div class="sm-bigico" aria-hidden="true">${vico(r)}</div><h2>${tx('Seď, ešte nevystupuj', 'Seďte, ešte nevystupujte')}</h2><p>${tx('Vystúpiš', 'Vystúpite')} na zastávke <b>${esc(out)}</b></p><p class="sm-count">${left}</p><p>${stopsN(left)} do výstupu</p></div>
        ${stay ? `<div class="sm-warn">${stay}</div>` : ''}
        <div class="sm-next">Pred výstupom <b>zazvoním a zavibrujem</b>. Telefón ${tx('môžeš', 'môžete')} schovať.</div>`;
    return { title, speak: true, dots: 3, vkey: `ride${end}${left <= 1 ? 'x' : ''}`,
      voice: left <= 1 ? '' : `${tx('Seď. Vystúpiš', 'Seďte. Vystúpite')} na zastávke ${out}. ${stay} Pred výstupom zazvoním.`,
      body, act: `<div class="sm-pair">${btn('alight', `Som vonku z ${V}u`)}${END()}</div>` };
  }

  function errorView(t, title) {
    const e = t.smErr || 'pos';
    const M = {
      pos: ['📍', tx('Neviem, kde si', 'Neviem, kde ste'), `${tx('Povoľ', 'Povoľte')} appke polohu a ${tx('choď', 'choďte')} von, kde je lepší signál.`],
      valid: ['📅', 'Cestovný poriadok je starý', tx('Popros dospelého, nech aktualizuje aplikáciu.', 'Treba aktualizovať aplikáciu.')],
      nostop: ['🚏', 'Nablízku nie je zastávka', 'V okolí 1,5 km nie je žiadna zastávka MHD Prešov.'],
      nodest: ['🚏', 'Pri cieli nie je zastávka', 'Do 1,5 km od cieľa nie je žiadna zastávka MHD Prešov.'],
      none: ['🌙', 'Teraz tam nič nejde', tx('Skús to neskôr alebo zavolaj.', 'Skúste to neskôr alebo zavolajte.')],
    }[e];
    return { title, back: true, vkey: `err${e}`, voice: `${M[1]}. ${M[2]}`,
      body: big(M[0], M[1], `<p>${M[2]}</p>`),
      act: `${btn('retry', tx('Skús znova', 'Skúste znova'), 'sm-primary')}${btn('call', '📞 Zavolať')}` };
  }

  function tripView(t) {
    const title = `${t.fav.icon} ${t.fav.label}`;
    uiOf(t);
    switch (t.phase) {
      case 'locating': return { title, back: true, vkey: 'loc', body: big('📍', tx('Hľadám, kde si…', 'Hľadám, kde ste…'), `<p>${tx('Postoj chvíľu vonku.', 'Postojte chvíľu vonku.')}</p>`), act: '' };
      case 'error': return errorView(t, title);
      case 'preview': return previewView(t, title);
      case 'toStop': case 'wait': case 'final': return walkView(t, title);
      case 'ride': return rideView(t, title);
      case 'done': return { title, vkey: 'done', voice: tx('Si v cieli. Výborne.', 'Ste v cieli. Výborne.'),
        body: `<div class="sm-bigmsg"><div class="sm-bigico" aria-hidden="true">🎉</div><h2>${tx('Si v cieli', 'Ste v cieli')}</h2><p>${esc(clean(A.targetLabel(t.dest)))}</p><p>Výborne, cesta je za ${tx('tebou', 'vami')}.</p></div>`,
        act: btn('done', 'Hotovo', 'sm-primary') };
      default: return { title, body: '', act: '' };
    }
  }

  // šípky sa otáčajú s telefónom bez prekreslenia obrazovky
  const turned = { a: 0, b: 0 };
  function rot(el, key, deg) {
    turned[key] += norm180(deg - turned[key]); // najkratšou stranou, nie cez celý kruh
    if (el.dataset.on) { el.style.transform = `rotate(${turned[key].toFixed(0)}deg)`; return; }
    el.dataset.on = '1'; // čerstvo nakreslená šípka: nastaviť hneď, bez animácie z nuly
    el.style.transition = 'none';
    el.style.transform = `rotate(${turned[key].toFixed(0)}deg)`;
    void el.getBoundingClientRect();
    el.style.transition = '';
  }
  function applyArrows() {
    const t = A.trip();
    if (!t || !t.simple || !t.sm || !root) return;
    const u = t.sm, a = $('smArrow'), b = $('smBusArrow'), p = u.hist ? fixOf(t, u) : t.pos, D = A.D();
    if (a && p && ['toStop', 'wait', 'final'].includes(t.phase)) {
      let la, lo;
      if (t.phase === 'final') { const q = A.destPoint(t, p.la, p.lo); la = q.la; lo = q.lo; } else { const s = D.stops[t.rides[t.ri].from]; la = s.la; lo = s.lo; }
      const head = headingOf(u);
      if (head != null) rot(a, 'a', norm180(bearingTo(p.la, p.lo, la, lo) - head));
    }
    if (b && A.compassHeading() != null && u.cue) {
      const bus = (u.geo && u.geo.bus != null) ? u.geo.bus : u.cue.bus;
      if (bus != null) { u.busRel = norm180(bus - A.compassHeading()); rot(b, 'b', u.busRel); }
    }
  }
  // Po odchode spoja sa človek vzďaľuje od zastávky, ale poloha je nepresná alebo sa hýbe po trase
  // rýchlosťou vozidla: jadro vtedy „spoj ušiel“ nevyhlási (app.js, t.smOnBus) a tu sa opýtame.
  // hlas obrazovky; pamätá si, dokedy asi potrvá (otázka v hárku počká, aby vetu neprerušila)
  let voiceEnd = 0, voiceLater = null;
  function voiceOut(say) { clearTimeout(voiceLater); voiceEnd = Date.now() + Math.min(15000, 800 + say.length * 65); A.speak(say); }
  function askOnBus(t) {
    const u = t.sm, r = t.rides[t.ri];
    if (u && u.riding) { t.smOnBus = 0; return; } // to isté sa už pýta obrazovka („Si v autobuse X?“)
    if (!t.smOnBus || Date.now() - t.smOnBus > 5000 || !u || u.askedBus || !r || !['toStop', 'wait'].includes(t.phase) || sheetOpen()) return;
    u.askedBus = true; t.smOnBus = 0;
    const q = tx(`Si už v ${veh(r)}e ${lineOf(r)}?`, `Ste už v ${veh(r)}e ${lineOf(r)}?`);
    sheet(`<h2>${esc(q)}</h2><p>${Veh(r)} mal odísť o <b>${fmtTime(r.dep)}</b>.</p>
      <div class="sm-stack">${btn('busyes', `Áno, som v ${veh(r)}e`, 'sm-primary')}${btn('busno', `Nie, ${veh(r)} mi ušiel`)}</div>`);
    gate = {
      busyes: () => { closeSheet(); if (A.trip() === t && ['toStop', 'wait'].includes(t.phase)) A.boardRide(0); },
      busno: () => { closeSheet(); if (A.trip() === t) { setAfter(t, r.dep + 60); A.replan('missed'); } },
    };
    // práve znie veta obrazovky („autobus môže meškať…“): otázka zaznie až po nej
    const wait = voiceEnd - Date.now();
    if (wait > 0) setTimeout(() => { if (A.trip() === t && gate && gate.busyes && sheetOpen()) voiceOut(q); }, wait);
    else voiceOut(q);
  }
  function render() {
    if (!cfg().on || !root) return;
    const t = A.trip();
    if (!t || !t.simple) { if (screen === 'trip') home(); return; }
    screen = 'trip';
    const v = tripView(t); // spracuje aj novú polohu (príchod, „vezie sa“)
    askOnBus(t);
    view(v);
    applyArrows();
    lastVoice = v.read || v.voice || '';
    const u = t.sm;
    let say = '', pri = v.pri || 'normal';
    const fresh = !!v.vkey && v.vkey !== spoken;
    if (fresh) {
      spoken = v.vkey;
      const again = v.once && u && u.said && u.said[v.vkey] && v.vkey !== 'start'; // pri kolísaní polohy neopakovať
      if (u && u.said) u.said[v.vkey] = true;
      if (v.voice && !again && !sheetOpen()) say = v.voice; // otázku v hárku hlas obrazovky neprekričí
    }
    // oznam po prepočítaní („ten autobus už odišiel, ďalší ide o…“) sa povie pred prvou vetou novej
    // obrazovky ako jedna súvislá reč – samostatne by ho tá veta hneď prerušila
    if (u && u.noteSay && !sheetOpen()) { say = `${u.noteSay} ${say}`; u.noteSay = null; pri = 'urgent'; }
    say = say.replace(/\s+/g, ' ').trim();
    if (say) {
      $('smSr').textContent = say;
      // Kým ešte znie predošlá veta: varovanie a otázka ju prerušia, „ešte N metrov“ sa vynechá,
      // ostatné počká na jej koniec (ak je obrazovka stále tá istá).
      const busy = voiceEnd - Date.now();
      clearTimeout(voiceLater);
      if (busy <= 0 || pri === 'urgent') voiceOut(say);
      else if (pri !== 'low') { const key = spoken; voiceLater = setTimeout(() => { if (A.trip() === t && spoken === key && !sheetOpen()) voiceOut(say); }, busy); }
    } else if (fresh && !v.voice && v.read) $('smSr').textContent = v.read.replace(/\s+/g, ' ').trim(); // čítačke obrazovky, nie nahlas
    // po jazde v poslednom úseku ďaleko od cieľa: nový plán z miesta, kde človek je (mimo vykresľovania)
    if (u && u.wantReplan) { u.wantReplan = false; setTimeout(() => { if (A.trip() === t && t.phase === 'final') { t.smAfter = null; A.replan('early'); } }, 0); }
  }

  // odpoveď na „Kam ukazuje šípka?“: rozhoduje, kam šípka v tej chvíli naozaj ukazuje;
  // keď sa odpoveď so šípkou nezhoduje alebo človek nestojí tvárou k ceste, nikam ho neposielame
  function answerDir(side) {
    const t = A.trip(), u = uiOf(t);
    applyArrows();
    const rel = u.busRel;
    const real = rel == null ? null : rel > 20 && rel < 160 ? 'right' : rel < -20 && rel > -160 ? 'left' : null;
    u.asked = true;
    if (real && real === side) { if (side === 'right') atStop(u, true); else u.step = u.fix ? 'unsure' : 'nofix'; } else u.step = 'unsure';
    render();
  }

  // ── tlačidlá ───────────────────────────────────────────────────────
  function act(a, v) {
    const t = A.trip(), u = t && t.simple ? uiOf(t) : null;
    if (gate && gate[a]) return gate[a](v);
    switch (a) {
      case 'close': closeSheet(); break;
      case 'more': $('smBody').scrollBy({ top: $('smBody').clientHeight * 0.7, behavior: 'smooth' }); break;
      case 'go': A.startTrip(Number(v), { simple: true }); break;
      case 'other': other(); break;
      case 'back': if (!back(false)) home(); break;
      case 'speak': A.unlockAudio(); A.speak(lastVoice || $('smBody').innerText.replace(/\s+/g, ' ')); break;
      case 'start': A.unlockAudio(); start(); break;
      case 'later': later(); break;
      case 'earlier': if (t && t.jIdx > 0) { t.jIdx--; render(); } break;
      case 'walkonly': if (t && t.phase === 'preview') { t.journeys = []; t.jIdx = 0; t.walkOnly = true; t.smWalk = t.smDist; render(); } break;
      case 'introok': cfg().intro = (cfg().intro || 0) + 1; A.savePrefs(); u.step = 'walk'; render(); break;
      case 'here': hereTap(); break;
      case 'yes': atStop(u, true); render(); break;
      case 'no': u.asked = true; u.step = u.fix ? 'unsure' : 'nofix'; render(); break;
      case 'idk': u.asked = true; u.step = 'unsure'; render(); break;
      case 'left': case 'right': answerDir(a); break;
      case 'fixgo':
        u.fix = true; u.step = 'walk'; u.bad = false; u.hist = []; u.hs = []; u.said = {}; spoken = '';
        u.fixAt = Date.now(); u.fixLa = t.pos ? t.pos.la : null; u.fixLo = t.pos ? t.pos.lo : null;
        render(); break;
      case 'wait': atStop(u, false); render(); break;
      case 'board': if (t && Date.now() - (t.phaseAt || 0) > 1500 && ['toStop', 'wait'].includes(t.phase)) A.boardRide(0); break;
      // dvojité ťuknutie nesmie preskočiť aj ďalší spoj: krátko po novom pláne sa neráta
      case 'missed': if (t && Date.now() - (t.smPlanAt || 0) > 1500) {
        const r = t.rides[t.ri];
        const before = r && A.tripNowSecs() <= r.dep;
        setAfter(t, r ? r.dep + 60 : 0);
        A.replan(before ? 'late' : 'missed'); // pred odchodom: „nestihneš“, nie „už odišiel“
      } break;
      case 'alight': alightTap(t); break;
      case 'offbus': if (t && Date.now() - (t.smPlanAt || 0) > 1500) { t.smAfter = null; A.replan('early'); } break; // vystúpil neskôr: plán z miesta, kde je
      case 'retry': if (t && Date.now() - (t.smPlanAt || 0) > 1500) { t.smErr = null; A.replan(); } break;
      case 'done': A.endTrip(); break;
      case 'end': endAsk(); break;
      case 'endyes': closeSheet(); A.endTrip(); break;
      case 'where': where(); break;
      case 'call': call(); break;
      case 'callyes': closeSheet(); dial(); break;
      case 'gate': openGate(); break;
      default: break;
    }
  }
  // „Som vonku“: pri výstupnej zastávke sa pokračuje podľa plánu; kdekoľvek skôr sa po potvrdení
  // hľadá cesta nanovo z miesta, kde človek stojí (nikdy nie „si v cieli“ o pár zastávok skôr)
  function alightTap(t) {
    if (!t || t.phase !== 'ride' || Date.now() - (t.phaseAt || 0) < 1500) return;
    const D = A.D(), r = t.rides[t.ri];
    let end = t.ri;
    while (t.seated.has(end) && end + 1 < t.rides.length) end += 1;
    let left = Math.max(0, r.stops.length - 1 - Math.floor(t.prog + 0.12));
    for (let k = t.ri + 1; k <= end; k++) left += t.rides[k].stops.length - 1;
    const ex = D.stops[t.rides[end].to], g = A.goodFix(t);
    // bez polohy sa priebeh jazdy odhaduje len po predposlednú zastávku: v čase príchodu je to výstup
    const due = !g && left <= 1 && A.tripNowSecs() - Math.max(0, t.delay || 0) >= t.rides[end].arr - 30;
    if (left === 0 || (end === t.ri && (due || (g && haversine(g.la, g.lo, ex.la, ex.lo) < 80)))) return A.alight();
    sheet(`<h2>${tx(`Naozaj si už vonku z ${veh(r)}u?`, `Naozaj ste už vonku z ${veh(r)}u?`)}</h2><p>Do zastávky <b>${esc(clean(ex.n))}</b> ${left === 1 ? 'ostáva' : left < 5 ? 'ostávajú' : 'ostáva'} ešte ${left} ${stopsN(left)}.</p>
      <div class="sm-stack">${btn('close', 'Nie, ešte sedím', 'sm-primary')}${btn('alightyes', 'Áno, som vonku')}</div>`);
    gate = { alightyes: () => { closeSheet(); t.smAfter = null; A.replan('early'); } };
  }
  function endAsk() {
    const t = A.trip(), rideAhead = t && !t.walkOnly && ['toStop', 'wait', 'ride'].includes(t.phase);
    sheet(`<h2>Naozaj ukončiť cestu?</h2><p>${tx('Prestanem ťa sprevádzať', 'Prestanem vás sprevádzať')}${rideAhead ? ' a <b>nezazvoním pred výstupom</b>' : ' do cieľa'}.</p>
      <div class="sm-stack">${btn('close', 'Nie, pokračovať v ceste', 'sm-primary')}${btn('endyes', 'Áno, ukončiť', 'sm-secondary sm-danger')}</div>`);
  }

  // ── pomoc: Kde som? / Zavolať ──────────────────────────────────────
  function dial() {
    const a = document.createElement('a');
    a.href = `tel:${cfg().phone.replace(/[^+\d]/g, '')}`;
    document.body.appendChild(a); a.click(); a.remove();
  }
  function call() {
    const c = cfg();
    if (!c.phone) return sheet(`<h2>📞 Číslo nie je nastavené</h2><p>${tx('Telefónne číslo nastaví dospelý v Nastaveniach na úvodnej obrazovke.', 'Telefónne číslo sa nastavuje v Nastaveniach na úvodnej obrazovke.')}</p><div class="sm-stack">${btn('close', 'Dobre', 'sm-primary')}</div>`);
    sheet(`<h2>📞 Zavolať${c.who ? ` ${esc(c.who)}` : ''}?</h2><p class="sm-tel">${esc(c.phone)}</p>
      <div class="sm-stack">${btn('callyes', 'Áno, zavolať', 'sm-primary')}${btn('close', 'Nie')}</div>`);
  }
  async function where() {
    const t = A.trip(), fs = A.favs();
    // cesta domov jedným ťuknutím (dlaždica s domčekom alebo s názvom Domov), ak tam človek práve nejde
    let hi = -1;
    for (let i = 0; i < A.favVisible(); i++) if (fs[i].target && (fs[i].icon === '🏠' || /^domov$/i.test(String(fs[i].label).trim()))) { hi = i; break; }
    const running = !!(t && t.simple && t.sm && t.sm.started && t.phase !== 'done'); // rozbehnutá cesta inam
    const homeBtn = hi >= 0 && !(t && t.simple && t.fav === fs[hi]) ? btn('gohome', '🏠 Chcem ísť domov', running ? 'sm-secondary' : 'sm-primary') : '';
    sheet(`<h2>📍 ${tx('Tu si', 'Tu ste')}</h2><p id="smWhereTxt">${tx('Hľadám, kde si…', 'Hľadám, kde ste…')}</p><div class="sm-stack">${homeBtn}${btn('call', `📞 Zavolať${cfg().who ? ` ${esc(cfg().who)}` : ''}`)}${btn('close', 'Zavrieť', homeBtn && !running ? 'sm-secondary' : 'sm-primary')}</div><p class="sm-note">Poloha zostáva v telefóne. Nikam sa neposiela.</p>`);
    const goHome = () => { closeSheet(); A.unlockAudio(); A.startTrip(hi, { simple: true }); };
    gate = !homeBtn ? null : { gohome: () => {
      if (!running) return goHome();
      // rozbehnutú cestu jedno ťuknutie neukončí – najprv otázka
      sheet(`<h2>Ísť domov?</h2><p>${tx('Prestanem ťa sprevádzať', 'Prestanem vás sprevádzať')} do cieľa <b>${esc(t.fav.label)}</b> a nájdem cestu domov.</p>
        <div class="sm-stack">${btn('close', 'Nie, pokračovať v ceste', 'sm-primary')}${btn('gohomeyes', 'Áno, chcem ísť domov')}</div>`);
      gate = { gohomeyes: goHome };
    } };
    let p = t && t.pos && Date.now() - t.pos.t < 30000 ? t.pos : null;
    if (!p) { try { p = await A.getPositionFull(); } catch { p = null; } }
    const el = $('smWhereTxt');
    if (!el) return;
    if (!p) { el.textContent = tx('Polohu sa nepodarilo zistiť. Choď von, kde je lepší signál.', 'Polohu sa nepodarilo zistiť. Choďte von, kde je lepší signál.'); return; }
    const ns = A.nearestStop(p.la, p.lo);
    el.innerHTML = `Najbližšia zastávka: <b>${esc(clean(ns.name))}</b> (${roundM(ns.d)} m).`;
    const M = await A.loadMapbase().catch(() => null);
    if (!M || !$('smWhereTxt')) return;
    const kx = 111320 * Math.cos(p.la * Math.PI / 180), ky = 110540; let best = null;
    for (const st of M.streets) {
      if (!st.n) continue;
      for (let k = 1; k < st.p.length; k++) {
        const ax = (st.p[k - 1][1] - p.lo) * kx, ay = (st.p[k - 1][0] - p.la) * ky, dx = (st.p[k][1] - st.p[k - 1][1]) * kx, dy = (st.p[k][0] - st.p[k - 1][0]) * ky, L2 = dx * dx + dy * dy;
        let q = L2 ? (-ax * dx - ay * dy) / L2 : 0; q = Math.max(0, Math.min(1, q));
        const dd = Math.hypot(ax + q * dx, ay + q * dy);
        if (!best || dd < best.d) best = { d: dd, n: st.n };
      }
    }
    if (best && best.d <= 40) $('smWhereTxt').innerHTML += `<br>${tx('Si', 'Ste')} pri ulici <b>${esc(best.n)}</b>, Prešov.`;
  }

  // ── chránené nastavenia ────────────────────────────────────────────
  function openGate() {
    const a = 6 + Math.floor(Math.random() * 4), b = 6 + Math.floor(Math.random() * 4);
    sheet(`<h2>⚙️ ${tx('Len pre dospelých', 'Nastavenia')}</h2><p>Koľko je <b>${a} × ${b}</b>?</p>
      <label class="sm-field">Výsledok<input id="smGate" inputmode="numeric" autocomplete="off"></label>
      <p class="sm-note" id="smGateMsg">${tx('Nastavenia sú chránené, aby ich dieťa nezmenilo omylom.', 'Nastavenia sú chránené, aby sa nezmenili omylom.')}</p>
      <div class="sm-stack">${btn('gateok', 'Pokračovať', 'sm-primary')}${btn('close', 'Späť')}</div>`);
    gate = { gateok: () => { if ($('smGate').value.trim() === String(a * b)) settings(); else $('smGateMsg').textContent = 'To nie je správne. Skúste to znova.'; } };
  }
  function settings() {
    const c = cfg();
    sheet(`<h2>Nastavenia jednoduchého režimu</h2>
      <label class="sm-field">Oslovenie<select id="smFormal"><option value="0"${c.formal ? '' : ' selected'}>Tykať (deti)</option><option value="1"${c.formal ? ' selected' : ''}>Vykať (dospelí a seniori)</option></select></label>
      <label class="sm-field">Telefón na tlačidlo „Zavolať“<input id="smPhone" type="tel" autocomplete="off" placeholder="číslo rodiča alebo opatrovateľa" value="${esc(c.phone || '')}"></label>
      <label class="sm-field">Komu sa volá (text na tlačidle)<input id="smWhoIn" type="text" autocomplete="off" placeholder="napr. mame, dcére, synovi" value="${esc(c.who || '')}"></label>
      <p class="sm-note">Ciele (dlaždice) sú obľúbené ciele z bežnej appky. Upravia sa tam: vypnite jednoduchý režim a podržte tlačidlo cieľa.</p>
      <div class="sm-stack">${btn('setsave', 'Uložiť', 'sm-primary')}${btn('setoff', 'Vypnúť jednoduchý režim')}</div>`);
    gate = {
      setsave: () => { c.formal = $('smFormal').value === '1'; c.phone = $('smPhone').value.trim(); c.who = $('smWhoIn').value.trim(); A.savePrefs(); closeSheet(); last = {}; if (A.trip()?.simple) render(); else home(); },
      setoff: turnOff,
    };
  }

  // ── háčiky pre app.js ──────────────────────────────────────────────
  // Späť / Escape: vráti true, ak ho jednoduchý režim spracoval. Rozbehnutú cestu Späť nikdy
  // neukončí bez otázky. popped = volané z popstate (záznam histórie je už preč).
  function back(popped) {
    if (!cfg().on || !root) return false;
    if (sheetOpen()) { closeSheet(); return true; }
    const t = A.trip();
    if (!t || !t.simple) return false;
    if (!t.sm || !t.sm.started || t.phase === 'done') A.endTrip(!!popped);
    else endAsk();
    return true;
  }
  // texty celoobrazovkového upozornenia pred výstupom (vracia null, ak nejde o jednoduchú cestu)
  function alertText(t, k, atStop) {
    const D = A.D(), r = t.rides[k], out = clean(D.stops[r.to].n), next = t.rides[k + 1], when = atStop ? 'TERAZ' : 'NA ĎALŠEJ ZASTÁVKE';
    const stopBtn = request(D.stops[r.to].n) && !atStop ? ` ${tx('Stlač', 'Stlačte')} tlačidlo STOP.` : '';
    return {
      stop: request(D.stops[r.to].n) ? tx('stlač STOP', 'stlačte STOP') : '', // pre nadpis notifikácie služby na pozadí
      title: `${cfg().formal ? 'VYSTÚPTE' : 'VYSTÚP'} ${when}`,
      sub: `${tx('Vystúp', 'Vystúpte')}: ${out}.${stopBtn}${next ? ` Potom ${tx('ťa', 'vás')} dovediem k ďalšiemu ${veh(next)}u.` : A.tailWalk(t) > 30 ? ` Potom ${tx('ťa', 'vás')} dovediem pešo do cieľa.` : ''}`,
      say: `Pozor! ${atStop ? `Teraz ${tx('vystúp', 'vystúpte')} na zastávke ${out}.` : `Na ďalšej zastávke ${out} ${tx('vystúp', 'vystúpte')}.`}${stopBtn}`,
    };
  }

  function bgText(t) {
    const D = A.D(), r = t.rides[Math.min(t.ri, t.rides.length - 1)];
    if (!r) return 'Sprevádzanie do cieľa.';
    return t.phase === 'ride' ? `${Veh(r)} ${lineOf(r)} · pred výstupom zazvoním.`
      : `${Veh(r)} ${lineOf(r)} o ${fmtTime(r.dep)} zo zastávky ${clean(D.stops[r.from].n)}.`;
  }

  return {
    bgText,
    isOn: () => !!cfg().on,
    init() { cfg(); apply(); },
    turnOn, turnOff, render, plan, back, alertText,
    heading: applyArrows,
    // vezie sa a obrazovka sa pýta „si v autobuse?“ – jadro vtedy „spoj ušiel“ samo nevyhlasuje
    carried: (t) => !!(t && t.sm && t.sm.riding),
    tripOpened() { mount(); spoken = ''; lastVoice = ''; last = {}; screen = 'trip'; closeSheet(); },
    tripEnded() { spoken = ''; if (cfg().on) { last = {}; home(); } },
  };
}
