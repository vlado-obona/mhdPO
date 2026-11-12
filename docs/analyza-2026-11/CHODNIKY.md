# Navádzanie po chodníkoch – návrh (len posúdenie, bez implementácie)

Stav k 2026-11-12 14:09 (Europe/Bratislava). Na otázku Vlada z LOG 2026-11-12 12:59. Vypracoval Claude Code, druhý agent návrh nezávisle prekontroloval (prepočítal čísla, licenciu a prácnosť). Appka sa nemenila.

Merania: z dát, ktoré už sú v repe (`data/osm-places/`, stav OSM z 2. 10. 2026, `mhd-app/data/dataset.json`). Na OpenStreetMap, Overpass ani Geofabrik sa z prostredia Code nedá dostať, preto je dĺžka úplnej pešej siete len odhad – presné čísla dá krok 1. Znenie ODbL a pravidiel OSMF je citované z pamäti (online sa overiť nedalo).

## Odporúčanie

Áno, navádzanie po chodníkoch sa dá urobiť a dáta nebudú veľké (odhad: APK narastie o 0,1–0,6 MB). Dnes ale neviem povedať, či sú chodníky a priechody v Prešove v OpenStreetMap (OSM) zakreslené dosť dobre. Navrhujem dva kroky:

1. **Krok 1: zmerať skutočné dáta z OSM (asi 1 deň, appka sa nemení).** Nový, samostatný workflow stiahne chodníky, cestičky, schody, pešie zóny, priechody a značky chodníkov pri cestách. Vypíše čísla:
   - koľko km a koľko priechodov,
   - koľko nástupíšť je do 25 m od pešej siete,
   - či sa sieť nerozpadá na kúsky,
   - pri koľkých cestách adresa → zastávka trasu nájde,
   - aký veľký bude súbor.

   Výsledok pôjde do novej zložky (napr. `data/osm-walk/`) alebo len do výpisu behu. **Nie do dnešného workflowu „Miesta a adresy“:** jeho nový beh by obnovil aj miesta, adresy a ulice. Pri najbližšej zmene cestovných poriadkov by sa potom samé dostali do appky aj na web. Môj počítač sa na OSM nedostane, GitHub áno.
2. **Krok 2: rozhodnúť podľa čísel.** Návrh prahov, doladíme ich po meraní: aspoň 90 % nástupíšť do 25 m od pešej siete v jednom súvislom celku a trasa nájdená pri aspoň 95 % ciest adresa → zastávka.
   - **A) Navádzanie po chodníkoch.** Šípka vedie po trase a appka hovorí napríklad „Odboč doľava do ulice X“ alebo „Prejdi cez priechod“. Odhad 13–19 pracovných dní a terénny test.
   - **B) Len priechody.** Šípka ostane vzdušnou čiarou. Keď ale vedie cez hlavnú cestu, appka ukáže najbližší zakreslený priechod. Odhad 4–6 dní. Pozor: blízko cesty poloha nerozlíši, na ktorej strane stojíš.
   - **C) Nechať ako dnes:** vzdušná čiara a veta „Cez cestu len po priechode“.

Krok 1 by som spravil hneď. Medzi A a B rozhodnú čísla. Vždy so zálohou: keď trasa nevyjde, appka ukáže dnešnú šípku. Dnešný jednoduchý režim ešte nebol v teréne. Jeho terénny test pomôže aj chodníkom, lebo navádzanie po trase stavia naň.

**Prečo nestačia dáta, ktoré appka už má.** Appka dnes sťahuje z OSM len ulice s menom: 3 675 úsekov, 563 km. Pomenovaných chodníkov, peších zón a cestičiek je v nich len asi 16 km, k tomu 5 km poľných ciest. Priechody ani značky chodníkov v nich nie sú vôbec. Pešia sieť poskladaná z týchto dát sa rozpadla na 165 kúskov a pri 12,8 % ciest „adresa → najbližšia zastávka“ v nej nebolo spojenie. Chýbajú totiž práve nepomenované chodníky, skratky cez sídliská a priechody. Preto treba nové sťahovanie.

## Zdroj dát a licencia

- **Zdroj:** OpenStreetMap, ten istý ako pri dnešnej mape, miestach a adresách. Licencia ODbL 1.0 dovoľuje aj komerčné použitie, teda aj verziu Plus, ak sa splnia podmienky nižšie.
- **Podmienky platia už dnes.** Appka už nesie databázy odvodené z OSM: mapbase.json (3 675 úsekov ulíc) a places.json (miesta a adresy). Chodníky pridajú len ďalší súbor rovnakého druhu.
  - **Pripisovanie (čl. 4.3):** pri verejne použitom výsledku z dát (mapa, trasa, pokyn, názov ulice) má byť oznámenie, z ktorého sa človek primerane dozvie, že dáta sú z OSM a pod ODbL. Bežný režim ho má: pätička (index.html, ~r. 245) a roh mapy (app.js, ~r. 342). **Jednoduchý režim ho nemá.** Je to obrazovka cez celý displej, ktorá pätičku zakryje, a pritom ukazuje názvy ulíc z OSM („Si pri ulici …“, „Zastávka je na ulici …“). Treba doplniť riadok na obrazovke chôdze: „Ulice a trasa: © prispievatelia OpenStreetMap“.
  - **Share-alike (čl. 4.4):** súbor s chodníkmi je odvodená databáza, lebo je to výťah podstatnej časti OSM a jeho úprava. Ak ho appka verejne používa, smie byť len pod ODbL.
    - Kód appky nie je databáza, ODbL sa naň nevzťahuje.
    - Cestovné poriadky v samostatnom súbore tvoria s chodníkmi „kolektívnu databázu“ (čl. 4.5). Pod ODbL preto ísť nemusia.
    - **Pozor:** GTFS feed v súbore `attributions.txt` uvádza ako producenta „OpenStreetMap contributors“. Časť dát z GTFS (asi tvary trás v basemap.json, možno aj polohy zastávok) teda môže už byť z OSM. Treba to overiť.
    - Samostatný súbor pre chodníky je dobrý zvyk. Ak by sa neskôr časy chôdze po chodníkoch zapisovali do dataset.json, treba to overiť tiež.
  - **Prístup k dátam (čl. 4.6):** ľuďom, ktorí appku používajú, treba ponúknuť kópiu odvodenej databázy alebo postup, ako vznikla, cez internet zadarmo. Verejné repo dáta aj skripty má, ale **appka naň dnes nikde neodkazuje** a v repe chýba výslovný údaj o licencii dát. Treba doplniť odkaz do pätičky, do jednoduchého režimu a do popisu v obchode („Dáta z OpenStreetMap sú pod ODbL 1.0, na stiahnutie: …“). Rovnakú vetu dať aj do README a SOURCE.txt.
  - **Technické obmedzenia (čl. 4.7):** ak obchod pridá šifrovanie alebo podmienky, ktoré obmedzujú práva z ODbL, treba popri tom ponúknuť neobmedzenú kópiu, ktorá je aspoň rovnako dostupná. Odkaz z bodu 4.6 by to podľa môjho čítania pokryl. Týka sa to už dnešnej mapy. iOS zatiaľ v App Store nie je, lebo zápis do Apple Developer nie je dokončený. **Odporúčam overiť.**
  - **Bez záruky (čl. 7):** dáta sú „tak, ako sú“. Do appky by som dal vetu „Trasa je orientačná, podľa OpenStreetMap. Cez cestu len po priechode.“
- **Pravidlá OSMF na pripisovanie** (z pamäti, treba overiť):
  - text „© prispievatelia OpenStreetMap“ alebo „© OpenStreetMap“,
  - odkaz na openstreetmap.org/copyright,
  - viditeľne tam, kde sa dáta používajú: pri mape v rohu mapy, pri navigácii bez mapy na obrazovke chôdze.

  Appka nemá obrazovku „O aplikácii“. Pripisovanie schované len v nastaveniach by bolo hraničné.
- **Obchody:** Google Play aj App Store chcú, aby appka mala práva na obsah. ODbL ich dáva, ak sa splnia podmienky vyššie. Nepoznám pravidlo obchodu, ktoré by dáta pod ODbL zakazovalo (treba overiť). Údaje o ochrane dát (Data safety) sa nemenia: trasa sa počíta v telefóne a poloha nikam nejde. Popis v obchode (store/ZAZNAM-V-OBCHODE.md) OSM už uvádza. Stačí doplniť „pešie trasy“ a odkaz na dáta.
- **Pozor:** znenie ODbL aj pravidiel OSMF uvádzam z pamäti, online sa overiť nedalo. Pred vydaním odporúčam krátku právnu kontrolu alebo otázku na OSMF Licensing Working Group. Overiť treba hlavne:
  - či na čl. 4.6 a 4.7 stačí odkaz v appke,
  - či sú dáta z GTFS odvodené z OSM,
  - kde má byť pripisovanie.

## Offline dáta a veľkosť

- **Namerané na dnešných dátach:** pešia sieť z pomenovaných ulíc (556 km) má 150–217 kB, zbalená 58–83 kB. To je 270–390 bajtov na km (zbalené 105–150 B/km).
- **Hustejšia sieť:** úplná pešia sieť má na km viac križovatiek (priechody, napojenia chodníkov). Skúsil som to na tom istom grafe. Pri 18–22 uzloch na km namiesto 9 a s 1 bajtom príznakov (priechod, schody) vychádza 550–620 B/km, zbalené 190–210 B/km.
- **Odhad dĺžky celej pešej siete (nemerané):** asi 1 000–2 500 km, teda 2–4,5× viac než ulice s menom. Väčšina chodníkov, ciest na sídliskách a obslužných ciest totiž v OSM meno nemá. Ak by sa stiahli aj lesné a poľné cesty v celom výreze, bude to viac: 39 % plochy výrezu je ďalej než 1,5 km od zastávky a asi 32 % plochy je les. Presné číslo dá krok 1.
- **Odhad veľkosti súboru:** 0,3–1,5 MB, zbalený 0,1–0,6 MB. Na porovnanie: dáta appky majú dnes rozbalené 3,97 MB, v APK zbalené 0,71 MB. Nárast podľa verzie:
  - APK 1.7.3 (6,17 MB): o 2–10 %,
  - nepodpísaná IPA (1,69 MB): o 6–36 %,
  - jednosúborová HTML (4,34 MB, dáta v nej sú nezbalené): o 7–35 %.
- **Kde budú dáta:** v samostatnom súbore (napr. `mhd-app/data/chodniky.json`) s vlastnou verziou, tak ako dnešná mapa. Dôvody:
  - cestovné poriadky sa menia často, chodníky zriedka;
  - súbor sa načíta až pri prvej chôdzi, takže nespomalí štart;
  - licencie sa ľahšie oddelia.

  Do jednosúborovej verzie sa vloží rovnako ako mapa. Vo webovej verzii ho treba uložiť vopred, lebo sw.js dnes ukladá data/ až pri prvom načítaní. Inak by bez internetu chýbal.
- **Orezanie:** odporúčam brať len okolie zastávok (asi 1,5 km) a poľné či lesné cesty len v zástavbe. Pomenované ulice sú z 94 % do 1,5 km od zastávky, ale pre nepomenované lesné cesty to neplatí. Koľko to ušetrí, ukáže krok 1.

## Ako by to fungovalo v appke

Na začiatku chôdze appka priamo v telefóne vypočíta trasu po chodníkoch, buď k nástupišťu, alebo od poslednej zastávky do cieľa. Potom:

- **Šípka** ukazuje na najbližší bod trasy, ktorý je aspoň asi 40 m pred tebou (alebo dvojnásobok chyby polohy), napríklad na roh. Bližší bod nie: poloha kolíše asi ±30 m a šípka by skákala. Dnes appka pod 40 m nahrádza šípku obrázkom tabule z rovnakého dôvodu.
- **Vety** budú napríklad „Choď rovno po chodníku“, „Odboč doľava do ulice X“ alebo „Prejdi cez priechod“. Rohy bližšie než asi 50 m od seba poloha nerozlíši, preto appka povie meno ulice. „Prejdi cez priechod“ povie len pri priechode zakreslenom v mape, inak ostane „Cez cestu len po priechode“.
- **Metre a minúty** budú podľa dĺžky trasy. Aj výber spoja v jednoduchom režime musí počítať chôdzu k prvej zastávke a od poslednej po trase, nie vzdušnou čiarou × 1,2. Inak by appka hneď po naplánovaní hlásila „asi nestihneš“.
- **Strana ulice:** poloha ju nerozlíši. Trasa sa preto začne z oboch chodníkov a „Prejdi cez priechod“ zaznie, len keď ho treba z oboch.
- **Zlý smer:** dnes appka sleduje, či rastie vzdušná vzdialenosť k zastávke. Po novom by sledovala, koľko ostáva prejsť po trase. Polohu treba na trasu premietať len v okolí posledného miesta, inak preskočí na súbežný chodník alebo iný kus trasy. Zisťovanie „vezieš sa“ ostane na vzdušnej vzdialenosti. Prahy (40 m, 3 m/s) boli ladené na vzdušnú čiaru, treba ich znova overiť.
- **Nová trasa:** keď si od trasy ďalej než asi 40 m (alebo dvojnásobok chyby polohy), a to pri niekoľkých polohách za sebou, appka prepočíta trasu z miesta, kde stojíš. Najviac raz za 15–20 sekúnd. Namiesto „Otoč sa“ tak často stačí „Pôjdeme inou cestou“.
- **Príchod ostane ako dnes:** 15 m od nástupišťa, obrázok tabule do 40 m a kontrolná otázka pri zastávkach oproti sebe.
- **Záloha:** keď trasa nevyjde alebo si ďalej než asi 60 m od zakreslenej siete, appka ukáže dnešnú šípku. Keď je trasa oveľa dlhšia než vzdušná čiara, appka ostane pri trase. Dlhá obchádzka býva skutočná (trať, rieka, rýchlostná cesta, plot) a vzdušná čiara by viedla práve tam.
- **Batéria a výkon:**
  - Hľadanie trasy trvalo na počítači menej než 1 ms.
  - Načítanie a príprava siete s 20–60 tisíc uzlami trvali 30–55 ms.
  - Telefón je odhadom 3–10× pomalší. Raz pri prvej chôdzi to teda potrvá do pol sekundy, potom milisekundy. Pamäť zaberie pár MB.
  - Batériu míňa hlavne GPS a displej, a tie bežia už dnes. Trasa na tom prakticky nič nezmení (odhad, na telefóne nemerané).
- **Voliteľne:** mapa v bežnom režime by mohla kresliť pešiu trasu po chodníkoch namiesto rovnej prerušovanej čiary. Časy chôdze v celom plánovači (aj pri prestupoch) by zmenili výber spojov a treba ich znova overiť.

## Prácnosť (odhad v pracovných dňoch)

| Časť | Dni |
|---|---|
| Krok 1: samostatný workflow, sťahovanie z OSM a kontrolné čísla, appka sa nemení | 1 |
| Súbor s chodníkmi pri builde (orezanie, verzia, jednosúborová verzia, uloženie vopred na webe, kontrola čísel pred commitom) | 2–3 |
| Hľadanie trasy v appke (pokuty za schody, cestu bez chodníka a súkromné miesta; priechody; obe strany ulice) | 2–3 |
| Jednoduchý režim: šípka po trase, metre po trase, zlý smer, nová trasa, vety a hlas, záloha | 4–6 |
| Výber spoja v jednoduchom režime s chôdzou po trase | 1–2 |
| Testy so simulovanou chôdzou a šumom GPS, kontrola pri všetkých 509 nástupištiach, kolá posudku | 2–3 |
| Pripisovanie a odkaz na dáta (appka aj jednoduchý režim, obchod, README) | 0,5 |
| **Spolu variant A** | **asi 13–19** |
| Variant B (len najbližší priechod) | krok 1 a 4–6 |
| Terénny test (ty alebo tester, 5–10 trás), rátať s 2 kolami | 1–2 na kolo |

Dni sú odhad pri bežnom programovaní, podľa rozsahu dnešného navádzania (asi 370 riadkov v simple.js). Šesť kôl jeho kontroly trvalo podľa commitov asi 14 hodín, takže samotný kód môže ísť rýchlejšie. Skrátiť sa nedajú krok 1, opravy dát v OSM a terénne testy.

## Riziká

- **Neúplné chodníky v OSM:** pri ceste často chýba značka, či má chodník, a trasa by potom viedla „po ceste“. Ak je chodník zakreslený zvlášť, trasa ho môže obísť po osi cesty. Ochrana: penalizovať hlavné cesty bez chodníka, nepoužiť cestu, ktorá má chodník zakreslený zvlášť, povedať „Tu chodník v mape nie je“ a v núdzi použiť zálohu.
- **Chýbajúce priechody:** trasa by mohla viesť cez cestu tam, kde priechod nie je, alebo robiť zbytočnú obchádzku. Dnes vzdušná čiara pretne hlavnú cestu pri 19 % ciest adresa → zastávka a pri 37 % peších prestupov. Je to spodná hranica. Ochrana: „Prejdi cez priechod“ len pri zakreslenom priechode, inak stála pripomienka.
- **Chyba GPS:** appka počíta so šumom asi ±30 m. Chodník je široký 1,5–3 m, ulica s oboma chodníkmi 10–25 m (odhad). Appka preto nerozozná stranu ulice ani to, či si šiel cez priechod. Rohy bližšie než asi 50 m od seba môže zameniť. Pri panelákoch poloha skáče viac, preto musí byť hlásenie „zišiel si z trasy“ opatrné.
- **Súkromné a zamknuté miesta:** dvory, areály firiem, školy, brány, obchodné centrá v noci, vjazdy k domom. V OSM často nemajú značku o prístupe. Ochrana: vynechať cesty so značkou súkromné alebo zákaz pre chodcov (access=private/no, foot=no), penalizovať vjazdy a brány, neviesť cez budovy.
- **Schody a terén:** schody nie sú vždy zakreslené ako schody. Strmé, nespevnené a neosvetlené cestičky (park v noci) nie sú vhodné pre seniorov, kočíky ani deti. Ochrana: pokuty za schody a za cestičky bez údaja o povrchu a osvetlení, voliteľne schody obchádzať.
- **Pešie zóny a námestia zakreslené ako plochy:** trasa by išla po ich okraji. Treba ich spracovať zvlášť.
- **Zastarané dáta:** workflow OSM sa dnes spúšťa len ručne (stav OSM v appke je z 2. 10. 2026). V APK a IPA sa dáta zmenia len s novou verziou. Pribúdajú stavby, ploty, uzavreté priechody. Chybná úprava v OSM môže sieť rozbiť, preto pred commitom treba kontrolovať čísla (km, priechody, nástupištia v sieti). Opravy v OSM môže robiť ktokoľvek, ale nesmú sa odkresľovať z Google máp.
- **Veľkosť appky:** APK +2–10 %, IPA +6–36 %, jednosúborová HTML +7–35 % (odhad).
- **Viac pokynov môže seniorov miasť:** stále len jedna veta naraz a hlas pri rohu, nie pri každom kroku.
- **Overenie:** skutočné dáta sa dajú overiť až cez workflow a správanie appky až v teréne.
- **Licencia:** pripisovanie v jednoduchom režime, odkaz na dáta v appke a právna kontrola (pozri vyššie). Týka sa to už aj dnešnej appky.

## Čo treba rozhodnúť

1. Spustiť krok 1, teda samostatné meranie z OSM bez zmeny appky? A) áno B) nie
2. Po meraní: A) navádzanie po chodníkoch B) len priechody C) nechať ako dnes
3. Schody: A) obchádzať (seniori, kočík), ak je obchádzka do ~100 m B) neobchádzať
4. Rozsah: A) len jednoduchý režim B) aj mapa v bežnom režime C) aj časy chôdze v plánovači (treba nové overenie)
5. Pripisovanie OSM a odkaz na verejné dáta doplniť hneď, aj bez chodníkov? A) riadok na obrazovke chôdze a odkaz v pätičke (odporúčam) B) len v nastaveniach jednoduchého režimu
6. Právna kontrola licencie pred vydaním: A) áno (odporúčam) B) nie
7. Kto spraví terénny test a kde (centrum, sídlisko, hlavná cesta s priechodom, okraj mesta)?