# Google Play – stav a postup

Stav k 5. 10. 2026 14:50 (súhrn z Play Console). Neobsahuje žiadne heslá ani kľúče.

## Aplikácia
| Položka | Hodnota |
|---|---|
| Vývojár | BEDEKA, s.r.o. (developer ID 9184503168027888643) |
| Aplikácia | Odkiaľ Kam – MHD Prešov (app ID 4973310957021774926) |
| Balíček | `sk.operatorsystem.mhdpresov` (nemeniteľný) |
| Play App Signing | zapnuté – podpisový kľúč spravuje Google; náš keystore (secrets `ANDROID_KEYSTORE_*`) je **upload kľúč** |
| Interné testovanie | aktívne od 1.6.1; posledná 1.6.9 (automaticky 8. 10. 2026; pred ňou 1.6.6 = 261005419), zoznam „Interní testeri“ |
| Testovanie licencií | zoznam „Interní testeri“, RESPOND_NORMALLY (nákupy zadarmo) |
| Platobný profil | Google Payments BEDEKA, s.r.o. (organizácia), prepojený |
| Produkt Plus | `odkialkam_plus`, jednorazový INAPP (trvalý – **nikdy nekonzumovať**), možnosť nákupu `buy`, spätne kompatibilná, **aktívny**, 174 krajín; SK 2,49 € s DPH (základ 2,02 € bez DPH) |

## Nákup Plus v appke
- Plugin `@capgo/native-purchases`: nákup `purchaseProduct({productType:'inapp'})` – plugin nákup sám potvrdí (acknowledge).
- Pri každom štarte `getPurchases('inapp')` → Plus podľa nákupu v stave PURCHASED; nepotvrdený nákup (napr. odložená platba dokončená mimo appky) appka potvrdí cez `acknowledgePurchase` (od v1.6.3) – inak ho Play po 3 dňoch vráti.
- Cena na tlačidle je z Google Play (`priceString` = formattedPrice), nie natvrdo.
- Play Billing Library (9.x) posiela diagnostiku volaní billing API do Google cez `datatransport` (backend CCT). Workflow od v1.6.4 odstráni z manifestu `TransportBackendDiscovery` (`tools:node="remove"`) a kontroluje výsledné APK – logger knižnice je celý v `try/catch`, udalosti bez backendu sa zahodia. Vďaka tomu platí Data safety „nezbiera“.
- Kontrolóri Google Plus nekúpia – nevadí: platené doplnky nie sú „obmedzený prístup“ (prihlásenie), jadro appky je celé dostupné. Odomykací kód netreba; ak by ho Google pri kontrole vyžiadal, doplní sa.

## Upozornenie na výstup (od v1.6.5 podľa GPS aj pri zamknutom displeji)
- Režim cesty spustí natívnu službu `TripTrackerService` (foreground service, typ `location`, trvalá notifikácia „Odkiaľ Kam sleduje tvoju cestu“ s tlačidlom „Ukončiť sledovanie“). Spúšťa sa len z otvorenej appky po udelení polohy → stačí poloha „pri používaní“, **bez ACCESS_BACKGROUND_LOCATION** (workflow to kontroluje v hotovom APK).
- Služba posiela polohy do JS (plugin `TripTracker`, udalosť `location`); JS vyhodnocuje jazdu ako na obrazovke (nástup, meškanie, upozornenie zvuk + vibrácie + hlas + notifikácia).
- Záloha 1: ak JS 15 s neodpovedá (systém uspal WebView), služba upozorní sama pri priblížení k predposlednej zastávke (vo vozidle) alebo pri výstupnej zastávke.
- Záloha 2: notifikácia podľa CP + meškania (LocalNotifications); kým GPS zo služby žije, odsúva sa – príde len pri výpadku GPS.
- Služba končí: príchod do cieľa, ukončenie cesty, „Ukončiť sledovanie“, alebo čas konca cesty + 30 min.
- **Play Console → Obsah aplikácie → Povolenia služieb v popredí:** typ Poloha, úloha Navigácia (sledovanie cesty spustené používateľom), popis v `store/ZAZNAM-V-OBCHODE.md`, **video** (YouTube nezaradené): ťuk na Domov → trvalá notifikácia → zamknutie displeja → upozornenie pred zastávkou → koniec sledovania.
- Data safety ostáva „nezbiera“ – poloha sa spracúva len v zariadení.

## Automatické vydávanie (Vlado len schvaľuje)
1. Build (workflow „Android (APK + AAB)“) nahrá AAB do **interného testovania** (status completed → testeri ho majú hneď). Potrebuje secret `PLAY_SERVICE_ACCOUNT_JSON`.
2. Job **„produkcia“** potom čaká na schválenie v GitHub prostredí `produkcia` (povinný schvaľovateľ vlado-obona). Príde e-mail / notifikácia v appke GitHub → **Review deployments → Approve**.
3. Po schválení `scripts/mhd/play-release.py` vydá to isté AAB (rovnaký versionCode) do **produkcie** s poznámkami z CHANGELOG → Google ho skontroluje a zverejní.
   - Ak je v Play Console zapnuté „Spravované zverejňovanie“, vydanie sa len pripraví a odošle sa v Play Console.
   - Kým appka nie je zverejnená, Play prijme len koncept → prvé vydanie do produkcie sa odošle ručne v Play Console.
4. Novší build staré čakanie na schválenie zruší (schvaľuje sa vždy najnovšia verzia). Odmietnuť = Reject (verzia ostane len v internom testovaní).
- Poistka: job „produkcia“ sa spustí len pri premennej repozitára `PLAY_PROD_SCHVALOVANIE = zapnute` — nastavuje sa spolu s povinným schvaľovateľom, aby nikdy nešlo do produkcie bez schválenia.

## Stav nastavenia (7. 10. 2026)
- Záznam v obchode SK/EN uložený (veta o upozornení „aj pri zamknutom displeji a aj keď autobus mešká v zápche“), profil vývojára s promo textom.
- **Povolenia služieb v popredí – chýba:** Obsah aplikácie → „Povolenia pre službu na popredí“ → úloha **Navigácia** → povinný **odkaz na video** (bez neho sa nedá uložiť ani koncept). Interné testovanie neblokuje, odoslanie na kontrolu áno.
- Automatické nahrávanie **funguje od v1.6.9 (8. 10. 2026)**: build sám nahral AAB do interného testovania a job „produkcia“ čakal na schválenie. Kým appka nie je zverejnená a nie je hotová deklarácia služby v popredí (video), produkciu NESCHVAĽOVAŤ (Reject alebo nechať čakať — novší build čakanie zruší).

## Pravidlá pre build
- **versionCode** = `YYMMDD·1000 + (minúta dňa / 2)`, 9 číslic, vždy rastie (posledný nahratý 261005419, limit 2 100 000 000).
- **Poznámky k vydaniu** („Čo je nové“): jazykový tag **`sk`** (Play odmieta `sk-SK`), max. 500 znakov – workflow ich berie z `releases/CHANGELOG.txt`.
- Android workflow po builde nahrá AAB do **interného testovania** cez servisný účet (secret `PLAY_SERVICE_ACCOUNT_JSON`). Bez secretu sa krok preskočí.
- Do produkcie: po schválení v GitHube automaticky (pozri vyššie), alebo ručne Play Console → Interné testovanie → Propagovať vydanie.
- R8/ProGuard nie je zapnutý (Capacitor release bez minifikácie), preto `mapping.txt` neexistuje – upozornenie Play na chýbajúci súbor je len informačné (pády v Android vitals budú čitateľné aj bez neho).
- `assetlinks.json` netreba – appka je natívna (Capacitor), nie TWA.

## Čaká
- Platobný profil – Vlado: bankový účet (bez neho žiadne výplaty), DIČ/IČ DPH, prihlásenie do programu 15 % poplatku (skupina účtov + podmienky).
- Nastavenie aplikácie: obsah aplikácie (zásady súkromia, reklamy, IARC, cieľová skupina 13+, Data safety, vládna appka), záznam v obchode (texty, ikona, grafika, snímky) – podklady v `store/`.
- Servisný účet pre automatické nahrávanie (secret `PLAY_SERVICE_ACCOUNT_JSON`).
