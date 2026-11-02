# Denník handoffov – Odkiaľ Kam – MHD Prešov

Najnovšie hore. Záznamy sa iba pridávajú, nemažú. Repo je verejné – žiadne osobné údaje, ID účtov ani secrets.
- `Od chatu` = Claude v claude.ai (Play Console, účty, prehliadač)
- `Od Code` = Claude Code (kód, workflowy, buildy)

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
