# Denník handoffov – Odkiaľ Kam – MHD Prešov

Najnovšie hore. Záznamy sa iba pridávajú, nemažú. Repo je verejné – žiadne osobné údaje, ID účtov ani secrets.
- `Od chatu` = Claude v claude.ai (Play Console, účty, prehliadač)
- `Od Code` = Claude Code (kód, workflowy, buildy)

---

### 2026-11-12 11:55 – Od chatu (automatická kontrola)
- Preposlané Vladovi: **skúška jednoduchého režimu na telefóne vonku (otázka z 10:16)** – A) samostatný workflow „skúšobná APK z vetvy“ (iný názov appky, nič do Play ani do Release) B) počkať na schválenie 1.7.3 a vydať ako 1.8.0 do interného testovania. Odporúčanie chatu: A – prahy (15/40/60 m, zlý smer) sú zatiaľ len zo simulácie a treba ich overiť v teréne skôr, než pôjdu do Play; workflow z vetvy `jednoduchy-rezim` nesmie prepísať `releases/` ani Release v1.7.3.
- Stále čaká na Vlada (preposlané 16:40 a 19:58): čísla liniek na označníkoch, mapka v prvej verzii, oslovenie (Code urobil ako voľbu v chránených nastaveniach = A), počet cieľov zadarmo a cieľová skupina.
- Kým Vlado neodpovie: vetvu nezlučovať, nič nevydávať.

### 2026-11-12 10:16 – Od Code
- Na pokyn Vlada („Áno začni programovať jednoduchý režim“, 11. 11.) je naprogramovaná prvá verzia **jednoduchého režimu** (balík C: kap. 5.2, 5.5 a časť 5.3 z `docs/analyza-2026-11/ANALYZA.md`). **Je len na vetve `jednoduchy-rezim` (draft PR #1). Nič nie je zlúčené ani vydané:** `main` je bez zmeny kódu, web sa nenasadil, žiadny build, verzia ostáva 1.7.3, `releases/` bez zmeny.
- Čo je hotové:
  - zapnutie tlačidlom „🧭 Jednoduchý režim“ na úvode bežnej appky; vypnutie, tykanie/vykanie a číslo na „Zavolať“ sú v nastaveniach chránených príkladom na násobenie;
  - úvod s veľkými dlaždicami (obľúbené ciele) a „Iné miesto“; dole stále „Kde som?“ a „Zavolať“;
  - plán ako jedna odpoveď vo vetách („Vyraz o…“, kroky, „Ísť neskôr / Ísť skôr“); „Dnes už nič nejde“ so „Zavolať“ a prípadne „Pôjdem pešo“;
  - sprevádzanie pešo na zastávku (šípka, vzdialenosť, „stíhaš“, zlý smer s vibráciou, obrázok tabule do 40 m, kontrolná otázka pri zastávke – číslo linky alebo smer šípky), čakanie, jazda s počtom zastávok, upozornenie pred výstupom, pešo do cieľa;
  - zmeškaný spoj, výstup skôr, „vezieš sa – si v autobuse X?“ (aj v inom autobuse pred nástupom; nový plán až po ťuknutí „Som vonku“), nepresná poloha, odchod od zastávky (znova ho k nej dovedie).
- Pravidlá plánu v jednoduchom režime: pomalá chôdza 0,9 m/s + 1 min rezerva; presadnutie s rezervou pod 1 min sa neponúkne, pod 3 min je označené „len N minút“; čakanie na prestupe najviac 45 min; pešo do 450 m vždy, do 1 km keď autobus nie je skôr, do 2,5 km keď je o viac než 20 min neskôr alebo nič nejde; zajtrajší spoj o viac než 2 h → „Dnes už nič nejde“.
- Zmeny, ktoré sa dotknú aj bežného režimu (po zlúčení): kompas berie skutočný sever (`deviceorientationabsolute`); peší úsek po poslednej jazde sa ráta aj vtedy, keď ho plán má ako samostatný úsek (`tailWalk`); `dataset.json` má pri linkách `t = 1` pre trolejbusy (z GTFS `route_type`, inak zhodný); service worker `mhd-shell-v2` + nové súbory `simple.js`, `simple.css`; plánovač má voliteľné nastavenia, ktoré používa len jednoduchý režim (rezerva na presadnutie, pomalšia chôdza, príchod pešo neorezáva príchod autobusom) – bez nich dáva rovnaké výsledky ako doteraz (overené na 3000 náhodných hľadaniach, 0 rozdielov; `scripts/mhd/test-router.mjs` prechádza).
- Overenie: päť kôl nezávislej kontroly (šieste beží); v každom kontrolóri skúšali skutočnú appku v prehliadači s falošnou polohou, časom a kompasom a každý vážnejší nález overil ďalší agent. V 5. kole: 1100 náhodných prvých odpovedí, 6118 krokov „Ísť neskôr“ a 725 prepočítaní bez porušenia pravidiel plánu; zvyšné prípady (strop 45 min na prestupe, nočné spoje, rovnako dobré karty) opravené v `6d2cff0`. Sprevádzanie skúšané na realistických stopách GPS (1 poloha za sekundu, šum 3–25 m): zlý autobus aj s červenou a cestou, čo sa stáča späť, skoky polohy, chôdza opačným smerom, auto šikmo od zastávky, hlas. Jednosúborová verzia sa zostaví a jednoduchý režim v nej beží.
- **Neoverené:** nič z toho nebežalo na skutočnom telefóne – kompas, hlas, vibrácie, presnosť GPS pri zastávkach, správanie pri zamknutom displeji. Prahy (15 m príchod, 40 m tabuľa, 60 m otázka, 45–55 m zlý smer) sú zo simulácie, nie z terénu.
- Známe obmedzenia (zo simulácie): pri veľmi nepresnej polohe (40–60 m) môže „ideš opačným smerom“ prísť neskoro alebo vôbec (šípka a vzdialenosť však vedú správne); na ulici, ktorá vedie najprv 25–35 m od zastávky, sa pri šume 12–15 m môže ozvať aj pri správnej chôdzi (asi 2 z 9 behov); keď iné vozidlo ide presne po trase plánovaného spoja v jeho čase, appka ho berie ako nástup.
- Odchýlky od návrhu v 5.5: „ideš opačným smerom“ až po 45–55 m (návrh 20 m – pri šume GPS by plašilo); meškajúci spoj sa nevymení sám, človek ťukne „Nájdi mi ďalší“; otázka na číslo linky znie „na tabuli zastávky alebo na papieri s časmi odchodov“.
- Zámerne zatiaľ nie je: mapka pri chôdzi, upozornenia na priechody, poistka „si v inom autobuse“ po potvrdenom nástupe, obnova cesty po zabití appky, ostatné ochrany z 5.3. Počet dlaždíc sa riadi doterajším pravidlom (2 ciele zadarmo, viac s Plus).
- Pozor pri skúšaní: ručné spustenie workflowu „Android (APK + AAB)“ z vetvy by prepísalo `releases/v1.7.3/` a súbory v GitHub Release v1.7.3 – **nespúšťať ho z vetvy**. Jednosúborová HTML verzia z vetvy sa dá preklikať na počítači, vonku s polohou nie.
- **Otázka pre Vlada:** Ako chceš jednoduchý režim vyskúšať na telefóne vonku? A) pridám samostatný workflow „skúšobná APK z vetvy“ (iný názov appky, nič nenahráva do Play ani do Release) B) počkať na schválenie 1.7.3 a potom vydať ako 1.8.0 do interného testovania. Odporúčam A.
- Stále otvorené otázky pre Vlada (z 11. 11.): čísla liniek na označníkoch (appka sa na ne zatiaľ pýta – ak nie sú, prepnem na otázku na smer); mapka v prvej verzii (zatiaľ nie je); oslovenie (urobené ako voľba v chránených nastaveniach); počet cieľov zadarmo a cieľová skupina (text tlačidla je zatiaľ „pre seniorov a začiatočníkov“).
- Ďalej (Code): dokončím 6. kolo kontroly (prípadné opravy pribudnú na vetvu a krátky zápis sem), potom čakám na odpovede; vetvu nezlučujem.

### 2026-11-11 19:58 – Od chatu (automatická kontrola)
- Preposlané Vladovi: **čísla liniek na označníkoch DPMP (otázka z 18:03)** – A) áno, sú → kontrolná otázka „Je na tabuli číslo 8?“ B) nie / nie všade → len otázka na smer šípky. Odporúčanie chatu: overiť na 2–3 zastávkach v teréne (fotka), dovtedy počítať s B.
- Preposlané Vladovi: **mapka v prvej verzii navádzania (otázka z 18:03)** – A) len šípka + obrázok tabule (odporúčanie chatu – mapka je najprácnejšia) B) aj mapka.
- Preposlané Vladovi: **oslovenie v jednoduchom režime (otázka z 18:03)** – A) voľba tykať/vykať v chránených nastaveniach (odporúčanie chatu) B) opýtať sa pri prvom spustení.
- Stále čaká na Vlada (preposlané 16:40): počet cieľov zadarmo v jednoduchom režime a cieľová skupina.
- Kým Vlado neodpovie: v appke nič nemeniť ani nevydávať.

### 2026-11-11 18:03 – Od Code
- **Rozhodnutie Vlada (11. 11.): rieši sa teraz len jednoduchý režim (balík C).** Odpoveď na otázku z 16:20 „Čím začať?“. Opravy plánovača a bežnej obrazovky (balíky A, B) počkajú.
- Na pokyn Vlada doplnený návrh **aktívneho navádzania pešo na zastávku** v jednoduchom režime („nevedia, ako sa zastávka volá, ani kde je“): kapitola **5.5** v `docs/analyza-2026-11/ANALYZA.md` a nové obrazovky v ukážke `docs/analyza-2026-11/jednoduchy-rezim-ukazka.html`. **V appke sa nič nemenilo** (žiadna verzia, žiadny build).
- Čo ukážka ukazuje: úvod „drž telefón pred sebou“, veľká šípka so vzdialenosťou a „✓ stíhaš“, zlý smer, otáčaná mapka, obrázok tabule do 40 m, kontrolná otázka pri zastávke (číslo linky alebo „Postav sa tvárou k ceste. Kam ukazuje šípka?“) s odpoveďami vrátane „Neviem“, oprava pri zlom nástupišti, „Tento autobus už nestihneš“, zastávka na znamenie, tá istá obrazovka pri presadaní a pešo do cieľa. Dáta sú skutočné (12. 11. 2026: Sibírska, Škára, Na Hlavnej, Solivar, Eperia).
- Kľúčové zistenia z dát: 61 % nástupíšť má do 60 m iné nástupište s rovnakým menom → poloha nestačí, treba otázku. V 55 % nástupov rozhoduje smer jazdy, v 22 % číslo linky. Orientačný bod je len asi pri pätine nástupíšť, názov ulice pri 75 %. Smer odchodu v dátach (`stopDirs`) je vzdušný k ďalšej zastávke (Sibírska 48° mimo ulice) → pri zostavovaní dát ho zrovnať s ulicou. Sieť chodníkov a priechodov appka nemá → šípka vedie vzdušnou čiarou, appka len pripomína priechod.
- Reprodukovateľné podklady: `podklady/nastupistia-rozlisenie.mjs` (všetky čísla z 5.5), `podklady/navadzanie-data.mjs` (dáta ukážky; výstup je zhodný s konštantou `NAV` v ukážke).
- Preverené dvoma kolami nezávislého posudku (dieťa, senior, technický overovateľ). 1. kolo: 4 vážne nálezy (fajka bez overenia, „neviem“ posielalo cez cestu, čiara cez vozovku, chýbal pokyn pozerať pred seba) – opravené. 2. kolo: z 18 nálezov 13 opravených úplne, 5 čiastočne, 0 neopravených + nové nálezy – zapracované. Posledná úprava (otázka „Kam ukazuje šípka?“) už ďalší posudok nevidela, len automatický test ukážky (220 obrazoviek, 4 veľkosti displeja, 0 problémov) a kontrolu na dátach (nástupište je vpravo od ulice v smere jazdy v 94 % merateľných prípadov).
- Zistenie o dnešnej appke: keď človek nastúpi do iného autobusu, asi minútu po odchode napíše „Spoj ti pravdepodobne ušiel“ a prepočíta cestu z idúceho autobusu (`evaluateTrip` → `planFromHere`) – bez upozornenia, že má vystúpiť. Navrhnutá poistka „Si v inom autobuse“.
- Neoverené: čo je na označníkoch DPMP (web to nepotvrdil); presné pravidlo zastávky na znamenie pri nástupe; všetky prahy (40 m, 15 m, 60 m) a otázka o šípke bez skúšky v teréne.
- **Otázka pre Vlada:** Sú na označníkoch zastávok v Prešove čísla liniek? (od toho závisí otázka „Je na tabuli číslo 8?“)
- **Otázka pre Vlada:** Má byť mapka už v prvej verzii navádzania, alebo stačí šípka a obrázok tabule? (mapka je najprácnejšia časť)
- **Otázka pre Vlada:** Oslovenie – stačí voľba tykať/vykať v chránených nastaveniach, alebo sa má režim opýtať pri prvom spustení?
- Stále otvorené z 16:20: koľko cieľov zadarmo v jednoduchom režime a pre koho ho ponúknuť (Play deklarácia 13+).
- Ďalej (Code): čakám na pokyn, či začať jednoduchý režim programovať v appke. Pozor pri tom: push do `mhd-app/` na `main` hneď nasadí web (pages.yml) → vyvíjať na samostatnej vetve alebo za prepínačom; 1.7.3 je na kontrole v Play, job „produkcia“ neschvaľovať.
### 2026-11-11 16:40 – Od chatu (automatická kontrola)
- Preposlané Vladovi: **poradie práce po analýze v1.7.3 (otázka z 11. 11. 16:20)** – A) malé opravy ako 1.7.4 (chyba plánovača, „zajtra“, „Vyraz o…“, prijatie napísaného názvu); B) lepší výber zastávok a rezerva na prestup; C) jednoduchý režim. Odporúčanie chatu: A → B → C, build 1.7.4 až po schválení 1.7.3 v produkcii Play.
- Preposlané Vladovi: **jednoduchý režim – počet cieľov zadarmo a cieľová skupina (otázka z 11. 11. 16:20)** – A) ponechať 2 ciele zadarmo, režim s 4–6 cieľmi v platenej verzii; B) v jednoduchom režime 4–6 cieľov zadarmo. Skupina: oficiálne seniori a 13+ (deklarácia v Play ostáva 13+, deti pod 13 nie – iná deklarácia by znamenala pravidlá Families). Odporúčanie chatu: rozhodnúť až pri C; skupinu ponechať 13+ / seniori.
- Kým Vlado neodpovie: nič nemeniť, v appke nič nevydávať.

---

### 2026-11-11 16:20 – Od Code
- Na pokyn Vlada hotová **hĺbková analýza plánovania trás a obrazovky v1.7.3** + návrh **jednoduchého režimu** pre deti a seniorov: `docs/analyza-2026-11/ANALYZA.md`, klikateľná ukážka `docs/analyza-2026-11/jednoduchy-rezim-ukazka.html`. **V appke sa nič nemenilo** (žiadna nová verzia, žiadny build).
- Postup: 5 oblastí, každú nezávisle preveril druhý agent (žiadny nález nevyvrátený). Plánovanie porovnané s nezávislým výpočtom na ~12 000 hľadaniach.
- Hlavné závery: žiadny vymyslený spoj (26 187 kariet); medzi 25 najvyťaženejšími zastávkami je najskoršia karta do 1 min od optima v 97–98 %. Slabiny: úzky výber zastávok pri ceste z adresy (strop 8 nástupíšť, pevných 700 m → 1,6–2,6 % „Žiadne spojenie“, ~5 % spoj až na druhý deň), prestupy bez rezervy (7,5 % odporúčaní má prestup 0–1 min), karta bez „Vyraz o…“ a bez „zajtra“, chýba „Neskôr/Skôr“.
- Nájdené chyby (zatiaľ **neopravené**): 6 v plánovači (najvážnejšia: prepis príchodu autobusom príchodom pešo, ~1 % hľadaní medzi okrajovými zastávkami; skúšobná oprava v `docs/analyza-2026-11/podklady/raptor-oprava-stitkov.diff`, prešla test-router 19/19) a 5 na obrazovke (návrhy prekrývajú pole „Kam“, presne napísaný názov sa neprijme, preklepy, nečitateľný pokyn v tmavom vzhľade, skloňovanie).
- Pozor: v Android APK je vypnuté priblíženie dvoma prstami (v konfigurácii Capacitoru chýba `zoomEnabled`).
- 136 možných chýbajúcich väzieb „zostaň sedieť“ je len hypotéza z dát – **u DPMP neoverené, nedopĺňať**.
- **Otázka pre Vlada:** Čím začať? (A) malé opravy ako 1.7.4 – chyba plánovača, „zajtra“, „Vyraz o…“, prijatie napísaného názvu; (B) lepší výber zastávok a rezerva na prestup; (C) jednoduchý režim. Odporúčam A → B → C. Pozn.: 1.7.3 je na kontrole v produkcii Play – ďalší build radšej až po schválení.
- **Otázka pre Vlada:** Koľko cieľov má byť v jednoduchom režime zadarmo (dnes 2, režim potrebuje 4–6) a pre koho ho oficiálne ponúknuť (Play deklarácia je 13+, „nie pod 13“)?

### 2026-11-11 15:40 – Od chatu (zápis za Code – workflow robil chat v tomto repe)
- Hotové: nový workflow **„iOS TestFlight“** (`.github/workflows/mhd-ios-testflight.yml`). Prvý podpísaný build **v1.7.3 (build 261111435)** nahratý do App Store Connect 11. 11. 2026, Apple ho spracúva.
  - Spúšťanie: ručne (workflow_dispatch) a automaticky po úspešnom workflowe „Android (APK + AAB)“ na `main`.
  - Podpis: archive len s lokálnym podpisom (`CODE_SIGN_IDENTITY=-`), distribučný certifikát a App Store profil vytvorí v cloude `xcodebuild -exportArchive` s API kľúčom (`-allowProvisioningUpdates`). Automatický podpis už pri archive zlyhá: tím nemá registrované zariadenie, takže Apple nevydá vývojársky profil.
  - Číslo buildu = rovnaká 9-ciferná schéma ako Android versionCode (počíta sa pri builde, vždy rastie).
  - Info.plist: `CFBundleDisplayName` „Odkiaľ Kam“ (bez verzie), `ITSAppUsesNonExemptEncryption = false`, poloha len „pri používaní“ (bez polohy na pozadí; na iPhone upozornenie na výstup funguje, kým je appka otvorená).
  - Privacy manifest bez sledovania a zberu údajov (UserDefaults `CA92.1`), ikony zlúčené bez alfa kanála, **len iPhone** (`TARGETED_DEVICE_FAMILY = 1`; iPad sa dá pridať neskôr, po vydaní odobrať nie), od ďalšieho buildu minimálne iOS 15 (Apple od apríla 2027 nižšie neprijme).
  - Secrets `APP_STORE_CONNECT_*` vložil Vlado; kľúč sa zapisuje len na runneri a po behu maže. Podpísaná IPA sa necommituje.
- Zlyhalo: nič (prvý pokus s automatickým podpisom pri archive – opravené).
- Ďalej (chat): po spracovaní buildu Test Information a externá skupina testerov v TestFlighte.
- **Google Play (chat, 11. 11.):** deklarácia služby v popredí uložená s videom (YouTube, nezaradené); **prvé produkčné vydanie 1.7.3 (261102542) odoslané na kontrolu**, všetky krajiny, rýchle kontroly prešli. Spravované zverejňovanie je vypnuté → po schválení sa appka zverejní sama. Odteraz schválenie jobu „produkcia“ v GitHube reálne vydá nový build do produkcie.

---

### 2026-11-02 20:09 – Od chatu
- **Odpoveď na otázku z 2. 11. 19:15 (dočasne znížené cestovné DPMP 12. 10. – 10. 11. 2026): rozhodnutie Vlada B** – nechať tak, appka ukazuje plné ceny, poznámku o zľave nedopĺňať a novú verziu kvôli tomu nevydávať.

---

### 2026-11-02 19:55 – Od chatu (automatická kontrola)
- Preposlané Vladovi: **dočasne znížené cestovné DPMP 12. 10. – 10. 11. 2026 (otázka z 2. 11. 19:15)** – A) doplniť do appky dočasnú poznámku o zľave (platná len do 10. 11.); B) nechať tak, appka ukazuje plné ceny. Odporúčanie chatu: B (ostáva týždeň, zákazník zaplatí menej, nie viac; nová verzia kvôli tomu nestojí za to). Kým Vlado neodpovie, platí B (nič nemeň).

---

### 2026-11-02 19:15 – Od Code
- Na pokyn Vlada („prever platnosť CP, ak sú zmeny zapracuj, ak nie povoľ používať aktuálnu verziu“) overené na dpmp.sk (cez Firecrawl + nový workflow „DPMP LCP kontrola“ `mhd-dpmp-lcp.yml`, výsledok v `data/dpmp-lcp/current/`):
  - LCP má nový súbor (c6baafa364.pdf, 13. 10. – redizajn webu), ale všetkých 42 strán CP je textovo zhodných s verziou z 1. 10.; parser dáva pre 78 smerov rovnaké odchody; najnovšia „Platnosť od“ je 1. 10. 2026. Aktuality inú zmenu CP nehlásia. → **Zmeny nie sú.**
- Hotové: **v1.7.3** – CP od 1. 10. platia aj **1. 11. – 22. 12. 2026** (oprava `data/gtfs-patches/1382_1384-predlzenie-2026-11.json`, len pridané dni do služieb 1384, žiadne nové spoje). 17. 11. už nie je deň pracovného pokoja (vlada.gov.sk) → pracovný deň, rovnako ako 1. 9. a 28. 10. vo feede DPMP. Koniec 22. 12. = posledný deň vyučovania; od 23. 12. majú vianočné CP DPMP, ešte nezverejnené.
- v1.7.3 automaticky v internom testovaní (versionCode 261102542), APK/AAB/IPA/HTML v GitHub Releases, web (Pages) nasadený. test-router 4h overuje, že každý deň 1. 11. – 22. 12. má presne spoje rovnakého dňa v týždni z 22.–28. 10.
- Denná kontrola GTFS upravená: raz týždenne spustí aj „DPMP LCP kontrola“; od ~15. 12. upozorní, ak nebudú vianočné CP.
- Zlyhalo: nič.
- Vlado: produkciu (job „produkcia“ pri 1.7.3) **neschvaľovať**, kým nie je deklarácia služby v popredí s videom.
- **Otázka pre Vlada:** DPMP má od 12. 10. do 10. 11. 2026 dočasne znížené základné cestovné (SMS 0,75 € / 0,80 € namiesto 1,50 € / 1,60 €; platba kartou za cenu zľavneného). Appka ukazuje plné ceny. Doplniť do appky dočasnú poznámku (len do 10. 11.), alebo nechať tak? Bez odpovede nechávam tak (do 10. 11. je to týždeň a zákazník zaplatí menej, nie viac).

### 2026-10-31 14:25 – Od Code
- Posledný deň platnosti CP: GTFS feed je stále 1382_1384 (do 31. 10.), nový feed nie je ani po dnešnom ručnom spustení workflowu „Cestovné poriadky (GTFS)“.
- **Od 1. 11. appka nemá cestovné poriadky** (povie, že CP platia len do 31. 10.; trvalo tak bude, kým DPMP/transiq nevydá nový feed). Platí rozhodnutie A.
- Denná kontrola beží ďalej; po príchode feedu hneď vydám novú verziu (väzby „zostaň sedieť“ overím pre nový feed).

### 2026-10-28 14:40 – Od Code
- GTFS feed stále 1382_1384 (do 31. 10.), CP na november zatiaľ nie je.
- Termín 28. 10. na otázku k 1. 11. uplynul bez odpovede → platí **A (čakať)**: nič nemením, appka pre 1. 11. povie, že CP platia len do 31. 10. Keď príde nový feed, hneď vydám novú verziu (väzby „zostaň sedieť“ pre nový feed overím podľa postupu).
- Ak Vlado chce B (predĺženie podľa PDF), stačí napísať – urobím to aj neskôr.

### 2026-10-25 15:30 – Od chatu (automatická kontrola)
- Preposlané Vladovi znova (pripomienka podľa záznamu Code 14:22, termín 28. 10.): **1. 11. bez GTFS feedu** – A) čakať na nový feed, appka pre 1. 11. povie, že CP nemá (odporúčanie Code aj chatu); B) 28. 10. predĺžiť októbrový CP na 1. 11. podľa PDF (nedeľa/sviatok) s poznámkou, že posilové spoje k cintorínom v appke nie sú. Kým Vlado neodpovie, nič nemeň; dennú kontrolu GTFS nechaj bežať.

---

### 2026-10-25 14:22 – Od Code
- **Upozornenie: CP na november stále nie je.** GTFS feed je stále 1382_1384 (platný do 31. 10.); denný workflow „Cestovné poriadky (GTFS)“ dnes beží bez zmeny.
- Od 1. 11. appka nebude mať spoje (povie, že CP platia len do 31. 10.), kým nepríde nový feed – vtedy hneď vydám novú verziu.
- Stále čaká **otázka pre Vlada** zo 20. 10. (1. 11.: A čakať / B predĺžiť októbrový CP podľa PDF) – rozhodnutie treba do 28. 10.

### 2026-10-20 11:55 – Od chatu (automatická kontrola)
- Preposlané Vladovi: **1. 11. bez GTFS feedu (otázka z 09:05)** – A) čakať na nový feed, appka pre 1. 11. povie, že CP nemá; B) 28. 10. predĺžiť októbrový CP na 1. 11. podľa PDF (nedeľa/sviatok) s poznámkou, že posilové spoje k cintorínom v appke nie sú. Kým Vlado neodpovie, nič nemeň; dennú kontrolu GTFS nechaj bežať.

---

### 2026-10-20 09:05 – Od Code
- Kontrola pred jesennými prázdninami: dáta v appke (feed 1382_1384, od v1.6.7) už obsahujú prázdninové dni 29.–30. 10. (vlastný CP „pracovný deň – prázdniny“) aj sobotu 31. 10. Oprava z PDF netreba.
- **1. 11. (nedeľa, Sviatok všetkých svätých) v dátach nie je** – GTFS feed platí len do 31. 10.; workflow „Cestovné poriadky (GTFS)“ som spustil 20. 10. ráno – nový feed zatiaľ nie je.
- Linkové CP v PDF (stiahnuté 1. 10.) majú len „Platnosť od …“ bez konca, ale okolo 1. 11. DPMP zvykne mať posilové spoje k cintorínom a novšie oznamy zo sandboxu neviem overiť (dpmp.sk je blokovaný).
- **Otázka pre Vlada:** Ako riešiť 1. 11., ak nový GTFS feed do 28. 10. nepríde? (A) čakať na feed, appka do vtedy pre 1. 11. povie, že CP nemá (odporúčam); (B) 28. 10. predĺžiť októbrový CP na 1. 11. podľa PDF (stĺpec nedeľa/sviatok, overené proti PDF) s poznámkou, že posilové spoje k cintorínom v appke nie sú.
- Denná kontrola GTFS beží ďalej (od 25. 10. upozorní, ak nebude CP na november).

### 2026-10-14 15:35 – Od Code
- Hotové: **v1.7.2** v internom testovaní (versionCode 261014405), súbory v GitHub Releases. Oprava z 5. kola revízie: pri krátkych cestách appka (aj widget) preskočila použiteľné odchody – prvý autobus o hodiny neskôr alebo žiadny.
- Revízia uzavretá: 5 kôl, posledné kolo našlo už len túto jednu chybu; test-router ju pokrýva (4g).
- Zlyhalo: nič.
- Vlado: produkciu (job „produkcia“ pri 1.7.2) **neschvaľovať**, kým nie je deklarácia služby v popredí s videom.

### 2026-10-14 13:40 – Od Code
- Hotové: **v1.7.0** a **v1.7.1** (14. 10.) – obe automaticky v internom testovaní (versionCode 261014304, 261014345), APK/AAB/IPA/HTML v GitHub Releases.
  - Políčko „Bez prestupu“ (priame spoje vrátane „zostaň sedieť“; keď priamy nejde alebo príde o viac ako hodinu neskôr, appka to povie a ukáže spoje s prestupom).
  - Cieľová zastávka aj s okolitými zastávkami do 700 m s chôdzou (podnet Vlada: Ľ. Podjavorinskej 21 → ZŠ Ľubotice ide linka 37 z Lesníckej bez prestupu).
  - Odporúčané spojenie zohľadní prestupy aj chôdzu; spojenia horšie ako chôdza sa nevypíšu, appka povie „Pešo to máš rovno do cieľa ~X min“.
  - Oprava staršej chyby (aj v 1.6.9): „zostaň sedieť“ sa ukazovalo aj pri prestupe na iný autobus.
- Kontrola: 4 kolá nezávislej revízie (5. kolo na 1.7.1 → oprava v 1.7.2), nálezy opravené pred vydaním alebo v 1.7.1; test-router rozšírený (kontrola priamych spojov hrubou silou, „zostaň sedieť“, kruhové spojenia).
- Zlyhalo: nič.
- Vlado: produkciu v GitHube (job „produkcia“ pri 1.7.1) **neschvaľovať**, kým nie je deklarácia služby v popredí s videom; inak bez zmeny (video, platobný profil, Apple).

### 2026-10-14 09:50 – Od chatu
- Založený kanál handoffov: `docs/handoff/HANDOFF.md` + tento denník; pravidlo v `CLAUDE.md`.
- `docs/GOOGLE-PLAY.md` ostáva hlavný technický stav – chat ho číta, nemení.
- Nová úloha pre Code: žiadna.
