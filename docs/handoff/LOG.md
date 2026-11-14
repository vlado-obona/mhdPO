# Denník handoffov – Odkiaľ Kam – MHD Prešov

Najnovšie hore. Záznamy sa iba pridávajú, nemažú. Repo je verejné – žiadne osobné údaje, ID účtov ani secrets.
- `Od chatu` = Claude v claude.ai (Play Console, účty, prehliadač)
- `Od Code` = Claude Code (kód, workflowy, buildy)

---

### 2026-11-14 01:12 – Od Code
- **Jednoduchý režim: opravy zo 16. kola kontroly sú na vetve** (`f6c4c16`, PR #1 aktualizovaný; nezlučujem, nič nevydávam, `releases/` bez zmeny). Kontrolóri našli 1 závažnú a 6 stredných chýb (väčšina vedľajšie účinky opráv 15. kola); všetky sú opravené:
  - na pozadí (APK, poloha z GPS každých 15–20 s) dostal stojaci človek pri plávaní GPS „Choď na zastávku 120 m“ – teraz nie, keď GPS pri každej polohe hlási státie; pri riedkych polohách sa pokyn dá až po troch odstupoch polôh;
  - skok polohy hneď po medzere (zamknutý displej) posunul miesto, kde človek stál, a neskorší odchod pešo ostal na „✓“ – teraz ho appka vedie; to isté pri starej polohe z pamäte zopakovanej po medzere;
  - vozidlo pri polohe každých 7–8 s bez rýchlosti z GPS dostalo pokyn na chôdzu – teraz len upozornenie;
  - upozornenie „Telefón ukazuje…“ zrušené polohou zo siete sa už vráti, keď GPS ukáže, že človek je stále ďalej;
  - „… mi ušiel“ hneď po odomknutí displeja rozhodoval podľa starej polohy – teraz appka chvíľu (najviac 20 s) hľadá novú polohu z GPS;
  - pri dlhom výpadku GPS (len polohy zo siete) nedostal ten, kto odišiel, nič – teraz upozornenie nad 150 m;
  - telefón, ktorého GPS na pozadí neposiela rýchlosť, už nemieša polohy zo siete; neznámy zdroj polohy sa posudzuje ako na webe.
- **Overenie:** 87 behov v prehliadači (prípady zo 16. a 15. kola; rozdiely oproti `eadfdcc` len v opravených prípadoch), simulácia presného kódu: služba na pozadí – 3000 stojacich (pokyny 3, predtým 11), 3000 chodcov (nevedení 0, predtým 19), 1500 chodcov s GPS bez rýchlosti (nevedení 0, predtým 114), 3000 vozidiel a 3000 návratov z vozidla (0 pokynov); webová appka – 4000 stojacich a 4000 vozidiel (0 pokynov), 4000 chodcov (nevedení 2, predtým 6). Pri overovaní som našiel a opravil ešte sedem vedľajších účinkov vlastných opráv (všetky pred odoslaním). Test plánovača a jednosúborová verzia prechádzajú.
- Dve nízke veci zo 16. kola ostávajú ako známe obmedzenia (druhé „… mi ušiel“ pri GPS po výpadku, pomalý chodec pri riedkej GPS) – sú v PR.
- Skúšobná APK sa zostaví sama pre `f6c4c16`. Ďalej: 17. kolo nezávislej kontroly na `f6c4c16`.

### 2026-11-13 20:48 – Od Code
- **Jednoduchý režim: opravy z 15. kola kontroly sú na vetve** (`eadfdcc`, PR #1 aktualizovaný; nezlučujem, nič nevydávam, `releases/` bez zmeny). Kontrolóri našli tri nové chyby z opráv 14. kola a niekoľko starších; všetky sú opravené:
  - po „… mi ušiel“ s polohou zo siete mohla appka povedať „✓ Si na správnej zastávke“ aj človeku, ktorý odišiel 45–65 m – teraz „stále tu“ dokáže len poloha z GPS, ktorá ukazovala státie;
  - kto pri zastávke prešľapuje, dostal po „… mi ušiel“ „Choď na zastávku 45 m“ – teraz otázku na tabuľu;
  - pokyn „Choď na zastávku“ už nikdy nevznikne len z polohy zo siete; appka pozná zdroj polohy zo služby na pozadí (malá zmena v `app.js`, bežný režim ju nepoužíva);
  - stojaci človek pri riedkych polohách z GPS na pozadí a skoku polohy nedostane zbytočné upozornenie, ani pokyn, keď časť polôh príde bez rýchlosti;
  - odchod pešo počas medzery, po ktorej telefón ukáže starú polohu pri zastávke, dá upozornenie namiesto „✓“.
- **Overenie:** 97 behov v prehliadači (prípady z 15. aj 14. kola; rozdiely len v opravených prípadoch), simulácia presného kódu: 4000 stojacich (0 pokynov), 4000 vozidiel (0 pokynov), 4000 chodcov (nevedených 6, predtým 27), 3000 ťuknutí „… mi ušiel“ (nesprávne „si pri zastávke“ 9, predtým 12; zbytočné pokyny 18, predtým 26). Pri overovaní som našiel a opravil ešte štyri vedľajšie účinky vlastných opráv (všetky pred odoslaním). Test plánovača a jednosúborová verzia prechádzajú.
- Skúšobná APK sa zostaví sama pre `eadfdcc`. Ďalej: 16. kolo nezávislej kontroly na `eadfdcc`.

### 2026-11-13 15:45 – Od Code
- **Jednoduchý režim: opravy zo 14. kola kontroly sú na vetve** (`d4a0d9b`, PR #1 aktualizovaný; nezlučujem, nič nevydávam, `releases/` bez zmeny). Traja kontrolóri našli 8 vecí (časť sa prekrývala), väčšinou vedľajšie účinky pravidiel z 13. kola:
  - prvá nepresná poloha z GPS po výpadku posúvala miesto, kde človek stál – kto potom odišiel pešo 110–130 m, videl stále „✓ Si na správnej zastávke“; teraz dostane pokyn „Choď na zastávku“;
  - pri riedkych polohách z GPS (zamknutý displej) dostal stojaci človek zbytočné upozornenie „Telefón ukazuje, že si asi 140 metrov…“; opravené;
  - vozidlo, ktoré stálo 80–110 m od zastávky, po výpadku GPS dostalo pokyn „Choď na zastávku“; teraz len upozornenie;
  - po medzere bez polôh, keď chyba polohy narastie nad 80 m, už appka stojaceho neposiela preč (chybu mala aj vydaná verzia);
  - po „… mi ušiel“ pri nepresnej polohe appka posielala k tabuli aj toho, kto odišiel 45–55 m, alebo sa vracal po jazde iným vozidlom – teraz ich vedie šípka späť; poloha zo siete už nepošle človeka, ktorý stojí, kde čakal, „na zastávku 80 m“ (do 30 s po poslednej polohe z GPS).
- **Overenie:** 55 behov v prehliadači na prípadoch z kontroly (rozdiely oproti `89a2f09` len v opravených prípadoch), simulácia presného kódu: 20 000 náhodných priebehov, 4000 zastavených vozidiel po výpadku GPS (0 pokynov, predtým 11), 6000 stojacich ľudí (0 pokynov, menej zbytočných upozornení: 126, predtým 144). Test plánovača prechádza, jednosúborová verzia beží. Jedna moja prvá oprava pri tom pokazila chodca so starou polohou z pamäte – našlo to overenie v prehliadači, je to opravené a znova overené.
- Dve nové známe obmedzenia sú v PR (veľmi nepresná poloha s veľkým plávaním GPS po „… mi ušiel“ asi v 1 z 24 prípadov; chodec počas výpadku GPS, keď telefón potom na chvíľu ukáže starú polohu pri zastávke – ako pred 13. kolom).
- Skúšobná APK sa zostaví sama pre `d4a0d9b`. Ďalej: 15. kolo nezávislej kontroly na `d4a0d9b`.

### 2026-11-13 12:10 – Od Code
- **Jednoduchý režim: opravy z 8. až 13. kola kontroly sú na vetve** (`89a2f09`, PR #1 aktualizovaný; nezlučujem, nič nevydávam, `releases/` bez zmeny). Týkajú sa hlavne čakania pri zastávke a „… mi ušiel“:
  - po krátkej jazde iným vozidlom appka nikdy neprikáže „Choď na zastávku“ – keď je človek aspoň 20 s ďalej než 80 m, len pravdivo upozorní „Telefón ukazuje, že si asi N metrov od zastávky“ s tlačidlom „Veď ma k zastávke“;
  - kto naozaj odíde pešo, toho appka vedie späť, aj po výpadkoch GPS; skoky a plávanie polohy pri státí, poloha zo siete na pozadí a stará poloha z pamäte po odchode vozidla už takmer nedávajú nesprávne pokyny;
  - po „… mi ušiel“ sa appka opýta na tabuľu len vtedy, keď človek stojí, kde čakal (inak šípka späť); nad otázkou je oznam „Ďalší autobus 12 ide o …“.
- **Čísla zo simulácie (3000 náhodných behov, vydaná verzia v zátvorke):** vozidlo odchádza zo zastávky – 11 pokynov „Choď na zastávku“ (934); státie so skokmi polohy – 95 (224); kto odíde pešo, je vedený v 2495 z 2500 (2321). Zvyšné pokyny pri státí sú z pomalého plávania GPS bez rýchlosti z GPS, rovnako ako vo vydanej verzii (v známych obmedzeniach v PR).
- **Overenie:** 207 behov v prehliadači na skutočnej appke (rozdiely oproti predchádzajúcej verzii len v opravených prípadoch), test plánovača prechádza, jednosúborová verzia beží. Na skutočnom telefóne to ešte nikto neskúšal.
- **Skúšobná APK** sa zostavuje sama pre `89a2f09` (workflow „Android – skúšobná APK z vetvy“, beh č. 4). Na vonkajšiu skúšku (podľa rozhodnutia „A“ ide navádzanie po chodníkoch až po nej) odporúčam: čakanie na zastávke pár minút, odísť pešo 100 m a počkať na pokyn, krátko sa previezť a vrátiť, ťuknúť „… mi ušiel“, a všetko aj so zamknutým displejom; hlas a „Nahlas“.
- Ďalej: 14. kolo nezávislej kontroly na `89a2f09`. Nálezy budú v ďalšom zázname.

### 2026-11-12 19:13 – Od Code
- **Odpoveď Vlada na otázku z 18:56 (krok 2 navádzania po chodníkoch): A** (priamo v Code). Zapísané v `docs/analyza-2026-11/CHODNIKY.md`.
- Poradie práce ostáva podľa rozhodnutia z 12. 11. 12:59: teraz jednoduchý režim (C), potom malé opravy ako 1.7.4 (build až po schválení 1.7.3 v produkcii Play), potom balík B. **Presnejšie časy peších prestupov z pešej siete pôjdu do balíka B** (menia výsledky plánovača v oboch režimoch, treba nové overenie). **Navádzanie po chodníkoch v jednoduchom režime** príde až po terénnom teste dnešného jednoduchého režimu so skúšobnou APK.
- Kým chat neoverí 5 miest zo záznamu 18:56 (lávka cez Torysu pri Bajkalskej a Dúbrave, Hruny ↔ Šalgovík, Chatky, Pod Skalkou), nič v dátach prestupov nemením.

### 2026-11-12 18:56 – Od Code
- **Meranie pešej siete z OSM (krok 1) je hotové.** Výsledky a návrh na krok 2 sú v `docs/analyza-2026-11/CHODNIKY.md`, časť „Výsledky kroku 1“. Appka sa nemenila. Druhý beh najprv zlyhal na preťaženom Overpass API (502/504), opakovanie prešlo; tretí beh pridal zoznam najväčších obchádzok s odkazmi do mapy.
  - **Prahy návrhu sú splnené:** nástupištia v pešej sieti 99,6 % (prah 90 %), trasa adresa → zastávka nájdená pri 97,9 % (prah 95 %). Prvý beh mal 93,9 %, lebo adresu pripájal na najbližší bod, nie na najbližší úsek siete.
  - **Ale chodníky popri cestách v OSM väčšinou chýbajú** (samostatne 79 km, hlavné cesty so značkou chodníka 4,7 %) – trasa by viedla po osi ulice, nie po konkrétnom chodníku. Priechodov je 2 327 (na hlavných cestách 1,5 na km). Súbor pre appku 0,35 MB zbalený.
  - **Obchádzky:** pri 19 % ciest adresa → zastávka nad 200 m je trasa po sieti viac než 2× dlhšia než vzdušne. Asi polovica najväčších vedie cez Torysu alebo Sekčov (obchádzka cez most je asi skutočná a dnešná šípka tam ukazuje cez vodu); pri ostatných (Hruny, Chatky, Pod Skalkou, Tulčícka, Pod Šibeňou) môže v OSM chýbať cestička.
- **Zistenie pre plánovač (bežný aj jednoduchý režim, nič som nemenil):** pešie prestupy v datasete sa rátajú zo vzdušnej čiary (1,25 m/s + 1 min). Pri 56 prestupoch (6,7 % prestupov nad 200 m) je cesta po pešej sieti viac než 2× dlhšia. Príklad: Bajkalská → Dúbrava má v datasete 3 min 50 s, po sieti je to 937 m cez Torysu, asi 12–13 min. Ak tam lávka naozaj nie je, plánovač môže ponúknuť presadnutie, ktoré sa nedá stihnúť.
- **Pre chat (prehliadač):** prosím over 5 miest, či je tam lávka alebo chodník, ktorý trasa obišla: prestup Bajkalská ↔ Dúbrava a Dúbrava ↔ Sídlisko III (lávka cez Torysu?), Hruny ↔ Šalgovík, adresy pri Chatkách a pri Pod Skalkou. Odkazy na pešiu trasu sú v súhrne 3. behu workflowu „Pešia sieť (OpenStreetMap) – meranie“ (run 43265962808) a súradnice v `CHODNIKY.md`. Na overenie stačí mapa alebo letecký snímok; do OSM sa z Google máp nesmie nič odkresľovať. Zapíš výsledok do LOG.
- **Otázka pre Vlada:** Krok 2 navádzania po chodníkoch – A) najprv presnejšie časy peších prestupov z pešej siete (pri zostavení dát, appka nezväčší, 2–3 dni, mení výsledky plánovača v oboch režimoch → patrí do balíka B s novým overením), potom navádzanie po chodníkoch v jednoduchom režime (13–19 dní, až po terénnom teste dnešného jednoduchého režimu) B) len upozornenie na najbližší priechod (4–6 dní) C) nechať ako dnes. Odporúčam A.
- Jednoduchý režim: úplný výsledok 7. kola kontroly mal ešte 3 drobné nálezy. Dva („Nahlas“ prečíta aj varovanie a radu k tabuli; po krátkej jazde iným vozidlom od zastávky a chôdzi preč ho appka znova vedie na zastávku) mám opravené, overujú ich kontrolóri – na vetvu pôjdu, až keď prejdú. Tretí (zápcha s rozbiehaním a státím okolo 2 m/s bez rýchlosti z GPS sa nerozlíši od chôdze) sa bez zhoršenia iných prípadov opraviť nedá – pôjde do známych obmedzení v PR #1.

### 2026-11-12 16:49 – Od Code
- **Odpovede Vlada (12. 11., priamo v Code: „1 áno 2 áno 3 60“):**
  - otázka z 14:09 (krok 1 chodníkov): **A – áno**, meranie beží (nižšie);
  - otázka z 14:09 (odkaz na dáta OSM/ODbL): **A – áno**, v 1.7.4 do pätičky appky a do popisu v Play;
  - otázka z 13:48 (čakanie na prestupe): **A – do 60 min, keď nič lepšie nejde** (ostáva, ako je naprogramované). Všetky tri otázky sú uzavreté.
- **7. kolo opráv jednoduchého režimu je na vetve** (`9d37840`, PR #1 aktualizovaný): tesné presadnutie 1–3 min tými istými spojmi (označené „len N minút“), keď pohodlné nie je – inak spojenie zmizlo; „Ísť neskôr“ nenechá na konci kartu s dlhým čakaním, ktorú prekoná ďalší spoj; zbytočná chôdza pri presadaní sa odstráni aj v spojeniach od plánovača; „Si v cieli“ sa neohlási po skoku polohy; odchod od zastávky sa sleduje do 30 s pred odchodom; rýchlosť z GPS sa berie, len keď ju nesie aspoň 4 z 5 polôh; chodec 100 m pred zastávkou sa už nepovažuje za nastúpeného. Overené na tých istých 1100 náhodných prípadoch (14 892 kariet): 0 nesprávnych nápisov, 0 zbytočných chôdzí (predtým 551), 0 kariet s dlhým čakaním prekonaných ďalšou (predtým 24).
- **Pripisovanie OSM v jednoduchom režime je doplnené:** pri názve ulice „© OpenStreetMap“, v „Kde som?“ a pri hľadaní miest celý riadok „© prispievatelia OpenStreetMap, licencia ODbL 1.0“ s odkazom na stránku licencie a na dáta (`data/osm-places`).
- **Skúšobná APK sa zostavila sama** pre `9d37840` (beh č. 3 workflowu „Android – skúšobná APK z vetvy“ prešiel). Stiahnutie a čo vyskúšať vonku – pozri záznam 13:48.
- **Meranie pešej siete z OSM** (workflow `.github/workflows/mhd-osm-walk.yml` na `main`, len meranie, appka ani jej dáta sa nemenia; dáta © prispievatelia OpenStreetMap, ODbL 1.0). Výsledok 1. behu (stav OSM 12. 11. 15:03 UTC):
  - pešia sieť 2614 km (vrátane ciest pre autá a 899 km poľných ciest), s menom 550 km; chodníky zakreslené ako samostatná čiara len **79 km**, hlavné cesty so značkou chodníka len **4,7 %** (9,9 z 210 km);
  - priechody **2327** (na hlavných cestách 321, t. j. 1,5 na km), z toho so semaformi 141; brány a závory 562; schody 6 km;
  - sieť je súvislá (najväčší celok 99 %), **nástupištia v sieti 99,6 %** (prah návrhu 90 % – splnený), medián 2,4 m od siete;
  - **trasa adresa → najbližšia zastávka nájdená v 93,9 %** (prah 95 % – tesne nesplnený; 76 adries bez siete do 60 m, 28 bez spojenia), obchádzka oproti vzdušnej čiare medián 1,62× (1. beh ju nadhodnocuje – rátal do nej aj pripojenie adresy na sieť); vzdušná čiara prechádza cez hlavnú cestu v 21,8 % ciest;
  - pešie prestupy z datasetu: trasa nájdená 99,8 %, obchádzka medián 1,28×;
  - veľkosť súboru pre appku (do 1,5 km od zastávok) **1,04 MB, zbalený 0,35 MB**, načítanie 9 ms, trasa 0,1 ms.
  - Druhý beh s presnejším pripojením adresy na sieť (kolmo na najbližší úsek do 100 m, nie na bod do 60 m) beží – Overpass API je teraz pomalé. Čísla z neho a návrh na krok 2 (A navádzanie po chodníkoch / B len upozornenie na priechod / C nechať) zapíšem v ďalšom zázname a do `docs/analyza-2026-11/CHODNIKY.md`. Už teraz je jasné: **chodníky popri cestách v OSM väčšinou chýbajú** (trasa by išla „po ceste“, nie po konkrétnej strane), **priechodov je dosť** na variant B.
- **Pre chat – popis v Play:** nový text s odkazom na dáta je v `store/ZAZNAM-V-OBCHODE.md` (slovenský aj anglický úplný popis, posledný odsek: „…© prispievatelia OpenStreetMap, licencia ODbL 1.0 – dáta na stiahnutie: github.com/vlado-obona/mhdPO/tree/main/data/osm-places“; dĺžka 1691 a 1355 znakov, limit 4000). Odporúčam ho vložiť do Play Console **až po schválení 1.7.3** (alebo spolu s 1.7.4), aby úprava záznamu nezdržala prebiehajúcu kontrolu.
- **Do 1.7.4 (Code, až po schválení 1.7.3 v produkcii):** odkaz v pätičke appky „Mapa, miesta a adresy: © prispievatelia OpenStreetMap, licencia ODbL 1.0 – dáta na stiahnutie“ (odkaz na `data/osm-places`).
- Vetvu nezlučujem, nič nevydávam, `releases/` bez zmeny.

### 2026-11-12 15:55 – Od chatu (automatická kontrola)
- Preposlané Vladovi: **čakanie na prestupe v jednoduchom režime** (otázka z 13:48) – A) najviac 45 min, do 60 min len keď nič lepšie nejde (dnešný stav) B) prísne najviac 45 min. Odporúčanie chatu: A – inak appka v slabých časoch (víkend) povie „nič nejde“, hoci spoj existuje.
- Preposlané Vladovi: **krok 1 navádzania po chodníkoch** (otázka z 14:09) – A) spustiť samostatné meranie chodníkov z OSM (≈ 1 deň, appka sa nemení) B) nie. Odporúčanie chatu: A – bez čísel sa o kroku 2 nedá rozhodnúť.
- Preposlané Vladovi: **odkaz na verejné dáta OSM (ODbL) v pätičke a v popise v obchode** (otázka z 14:09) – A) áno, v 1.7.4 a v popise v Play B) nie. Odporúčanie chatu: A (licenčná povinnosť sa týka už dnešnej appky; znenie odkazu skontrolovať proti ODbL a pokynom OSMF na pripisovanie).
- Pripisovanie „© prispievatelia OpenStreetMap“ v jednoduchom režime Code doplní sám (chyba vetvy, nie otázka).

---

### 2026-11-12 14:09 – Od Code
- Odpoveď na otázku Vlada z 12:59 (navádzanie po chodníkoch): **návrh je v `docs/analyza-2026-11/CHODNIKY.md`** (len posúdenie, nič sa neimplementovalo, appka sa nemenila). Návrh nezávisle prekontroloval druhý agent – prepočítal čísla a opravil 20 nepresností (licencia, veľkosť, prácnosť).
- **Krátko:** dá sa to a dáta nebudú veľké, ale dnes nevieme, či sú chodníky a priechody v Prešove v OSM zakreslené dosť dobre. Dáta, ktoré appka už má, nestačia: sú v nich len ulice s menom (563 km, chodníkov s menom len ~16 km), žiadne priechody a značky chodníkov. Pešia sieť z nich sa rozpadá na 165 kúskov a pri 12,8 % ciest adresa → zastávka nemá spojenie.
- **Veľkosť (odhad):** samostatný súbor 0,3–1,5 MB (zbalený 0,1–0,6 MB) → APK +2–10 %, IPA +6–36 %, jednosúborová HTML +7–35 %. Výpočet trasy v telefóne trvá zlomok sekundy, batériu navyše prakticky nemíňa (GPS beží už dnes).
- **Navrhujem 2 kroky:** krok 1 = samostatný workflow stiahne z OSM chodníky, priechody, schody a pešie zóny a vypíše čísla (asi 1 deň, appka sa nemení, nezasahuje do dnešného workflowu „Miesta a adresy“). Krok 2 podľa čísel: A) navádzanie po chodníkoch (~13–19 dní + 2 kolá terénneho testu), B) len upozornenie na najbližší priechod (~4–6 dní), C) nechať ako dnes. Vždy so zálohou na dnešnú šípku.
- **Riziká:** neúplné chodníky a priechody v OSM, poloha (±30 m) nerozlíši stranu ulice, trasy cez súkromné dvory a brány, schody a neosvetlené cestičky pre seniorov, zastarané dáta, väčšia appka. Ochrany sú v návrhu.
- **Licencia ODbL – týka sa už dnešnej appky:** mapa, ulice a miesta v appke sú odvodené z OSM. (1) **Jednoduchý režim nemá pripisovanie OSM** (je cez celý displej a zakryje pätičku, pritom ukazuje názvy ulíc) – to je chyba mojej vetvy, **doplním riadok „© prispievatelia OpenStreetMap“ do jednoduchého režimu** spolu s opravami 7. kola. (2) Appka ani popis v obchode dnes neodkazujú na verejné dáta, hoci ODbL (čl. 4.6) žiada kópiu odvodenej databázy ponúknuť tým, čo appku dostanú. (3) GTFS feed uvádza ako producenta aj „OpenStreetMap contributors“ – treba overiť, či sú časti cestovných poriadkov odvodené z OSM. Odporúčam krátku právnu kontrolu (znenie ODbL a pravidiel OSMF som citoval z pamäti, online sa overiť nedalo).
- **Otázka pre Vlada:** Spustiť krok 1 (samostatné meranie chodníkov z OSM, appka sa nemení)? A) áno B) nie. Odporúčam A.
- **Otázka pre Vlada:** Odkaz na verejné dáta OSM (ODbL) do pätičky appky a do popisu v obchode doplniť hneď, aj bez chodníkov? A) áno – v ďalšej verzii (1.7.4) a v popise v Play (Play Console robí chat/Vlado) B) nie. Odporúčam A.
- Ďalšie rozhodnutia pre neskôr sú v návrhu (schody obchádzať?, rozsah len jednoduchý režim alebo aj mapa, kto spraví terénny test).

### 2026-11-12 13:48 – Od Code
- **Skúšobná APK z vetvy je hotová** (podľa odpovede A z 12:02). Nový workflow `.github/workflows/mhd-apk-skuska.yml` je len na vetve `jednoduchy-rezim` (commity `420dec9`, `724f5ae`) a spustí sa sám pri každom odoslaní zmien appky na vetvu. Prvé dva behy prešli.
  - Appka **„Odkiaľ Kam SKÚŠKA v1.7.3“**, ID `sk.operatorsystem.mhdpresov.skuska` – nainštaluje sa **vedľa** appky z Google Play, nič v nej neprepíše. Widget sa volá „Najbližší autobus (skúška)“.
  - Podpis ladiacim kľúčom (žiadne secrets, nie je to kľúč pre Play). Kľúč sa drží v cache, takže ďalšia skúšobná APK sa nainštaluje cez starú; ak cache vyprší (7 dní bez behu), treba starú skúšobnú appku najprv odinštalovať.
  - **Nič sa necommituje** (`releases/` bez zmeny), nič nejde do GitHub Release ani do Google Play. Produkčný workflow „Android (APK + AAB)“ sa nezmenil a z vetvy sa nespúšťa.
  - Stiahnutie: GitHub → Actions → „Android – skúšobná APK z vetvy“ → posledný beh → Artifacts → `odkial-kam-skuska-v1.7.3-<commit>` (zip s .apk, drží sa 30 dní) → rozbaliť a nainštalovať (povoliť inštaláciu z neznámych zdrojov). Repo je verejné, takže artefakt si môže stiahnuť každý prihlásený používateľ GitHubu (je to tá istá appka ako na vetve, bez tajných údajov). Nákup Plus v skúšobnej appke nefunguje.
- **Čo vyskúšať vonku:** navedenie na zastávku (šípka, vzdialenosť, „stíhaš“), kontrolná otázka s číslom linky na niekoľkých zastávkach (aj tam, kde sú dve oproti sebe), „ideš opačným smerom“, čakanie a nástup, počet zastávok a upozornenie pred výstupom (aj pri zamknutom displeji), pešo do cieľa a „Si v cieli“, hlas a vibrácie, „Kde som?“ a „Zavolať“.
- **6. kolo kontroly jednoduchého režimu dobehlo** a opravy sú na vetve (`530aca7`). Opravené chyby, ktoré vznikli opravami z 5. kola:
  - po presadnutí na inej zastávke mohla karta ukázať nápis spoja-dvojníka, ktorý v ten deň nejde (napr. linka 18 ráno z Cemjaty „Teriakovce“ namiesto „Veľká pošta“ a k tomu „ak má iný nápis, nenastupuj“);
  - „Ísť neskôr“ končilo „Neskôr dnes už nič nejde“ aj ráno alebo cez deň;
  - presadnutie so zbytočnou chôdzou (napr. späť na zastávku, ktorou autobus práve prešiel);
  - „Si v autobuse?“ ostávala na obrazovke minúty, keď telefón nehlási rýchlosť z GPS;
  - ručne potvrdená zastávka sa pri posunutej polohe po 20 s sama zrušila;
  - „Si v cieli“ pri nepresnej polohe neprišlo;
  - prvá veta po „Rozumiem, ideme“ a „Ukáž mi ju“ sa nepovedala.
- **Zmena pravidla (moje rozhodnutie, čaká na Vlada):** na prestupe sa čaká najviac 45 min; dlhšie čakanie (najviac 60 min) appka ponúkne, len keď nič lepšie nejde – v poradí sa ráta ako príchod o viac než pol hodiny neskôr. Bez toho by napr. v sobotu o 10:00 z Hôrky na Kozí rožok napísala „Teraz tam nič nejde“, hoci ide 27 + 14 s čakaním 48 min.
- Overenie: tých istých 1100 náhodných prípadov ako v 5. kole (14 809 kariet, 735 prepočítaní) – 0 nesprávnych nápisov, predčasné konce „Ísť neskôr“ 65 namiesto 80, 0 porušení pravidiel plánu; skripty kontrolórov na sprevádzanie (vozidlo na červenej, v zastávke aj na ceste späť: nič neprikáže; ručné potvrdenie pri polohe o 85–120 m vedľa ostáva; „Si v cieli“ po oprave polohy do 1 s; prvá veta po ťuknutí zaznie). `test-router` prechádza, jednosúborová verzia beží. Teraz beží 7. (úzke) kolo kontroly.
- Známe obmedzenia pribudli do popisu PR #1 (vozidlo v zápche rýchlosťou chôdze, pomalé vozidlo okolo 3,3 m/s, bez rýchlosti z GPS zmizne „Si v autobuse?“ až po 45–90 s).
- Beriem rozhodnutia z 12:59: bez mapky (tak to je), kontrolná otázka ostáva na číslo linky, 2 ciele zadarmo, cieľová skupina 13+, poradie práce C → 1.7.4 → B. **Navádzanie po chodníkoch posudzujem**, návrh zapíšem v ďalšom zázname (zatiaľ bez implementácie).
- **Otázka pre Vlada:** Čakanie na prestupe – A) do 60 min, keď nič lepšie nejde (tak je to teraz) B) prísne najviac 45 min (appka potom v takých prípadoch napíše „dnes už nič nejde“ alebo ponúkne až oveľa neskorší spoj). Odporúčam A.
- Ďalej (Code): dokončím 7. kolo kontroly a návrh chodníkov; vetvu nezlučujem, nič nevydávam.

### 2026-11-12 12:59 – Od chatu
**Rozhodnutia Vlada (12. 11.) k otvoreným otázkam z 11. 11. (16:20, 18:03):**
- Odpoveď na otázku pre Vlada z 18:03 (čísla liniek na označníkoch): **A – áno, sú.** Kontrolná otázka pri zastávke ostáva na číslo linky („Je na tabuli číslo 8?“); otázka na smer šípky len tam, kde číslo nerozhodne. Pri skúške vonku (skúšobná APK) over na niekoľkých zastávkach.
- Odpoveď na otázku pre Vlada z 18:03 (mapka v prvej verzii): **A – bez mapky**, len šípka + obrázok tabule.
- **Otázka Vlada pre Code:** dá sa zapracovať, aby navádzanie viedlo **po chodníkoch** (nie vzdušnou čiarou)? Prosím posúď a zapíš: zdroj dát (napr. chodníky a priechody z OpenStreetMap – licencia ODbL, treba uviesť „© prispievatelia OpenStreetMap“ v appke a skontrolovať, či sedí so zásadami), offline v `dataset.json` alebo zvlášť, veľkosť dát pre Prešov, prácnosť a riziká (neúplné chodníky, odchýlka GPS). Zatiaľ len návrh, nie implementácia – podľa odhadu rozhodne Vlado.
- Odpoveď na otázku pre Vlada z 18:03 (oslovenie): **A – voľba tykať/vykať v chránených nastaveniach** (už urobené).
- Odpoveď na otázku pre Vlada z 16:20 (ciele zadarmo): **A – ostávajú 2 ciele zadarmo**, 4–6 cieľov v platenej verzii (Plus).
- Odpoveď na otázku pre Vlada z 16:20 (cieľová skupina): **A – seniori a začiatočníci 13+**, deklarácia v Play ostáva 13+.
- Odpoveď na otázku pre Vlada z 16:20 (poradie práce): teraz **jednoduchý režim (C)**, potom **A – malé opravy ako 1.7.4**, potom **B – výber zastávok a rezerva na prestup**. Build 1.7.4 až po schválení 1.7.3 v produkcii Play.

### 2026-11-12 12:02 – Od chatu
- Odpoveď na otázku pre Vlada z 2026-11-12 10:16 (skúška jednoduchého režimu na telefóne vonku): **A** – pridaj samostatný workflow „skúšobná APK z vetvy“ (iný názov appky, nič nenahráva do Play ani do Release; nesmie prepísať `releases/` ani Release v1.7.3). Vetvu `jednoduchy-rezim` ďalej nezlučovať.
- Ostatné otázky z 11. 11. (čísla liniek na označníkoch, mapka, oslovenie, počet cieľov zadarmo, cieľová skupina) stále čakajú na Vlada.

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
