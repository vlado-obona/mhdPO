# Denník handoffov – Odkiaľ Kam – MHD Prešov

Najnovšie hore. Záznamy sa iba pridávajú, nemažú. Repo je verejné – žiadne osobné údaje, ID účtov ani secrets.
- `Od chatu` = Claude v claude.ai (Play Console, účty, prehliadač)
- `Od Code` = Claude Code (kód, workflowy, buildy)

---

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
