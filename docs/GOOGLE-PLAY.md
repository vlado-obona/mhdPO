# Google Play – stav a postup

Stav k 5. 10. 2026 (súhrn z Play Console). Neobsahuje žiadne heslá ani kľúče.

## Aplikácia
| Položka | Hodnota |
|---|---|
| Vývojár | BEDEKA, s.r.o. (developer ID 9184503168027888643) |
| Aplikácia | Odkiaľ Kam – MHD Prešov (app ID 4973310957021774926) |
| Balíček | `sk.operatorsystem.mhdpresov` (nemeniteľný) |
| Play App Signing | zapnuté – podpisový kľúč spravuje Google; náš keystore (secrets `ANDROID_KEYSTORE_*`) je **upload kľúč** |
| Interné testovanie | aktívne od 1.6.1 (versionCode 261005339), zoznam „Interní testeri“ |
| Testovanie licencií | zoznam „Interní testeri“, RESPOND_NORMALLY (nákupy zadarmo) |

## Pravidlá pre build
- **versionCode** = `YYMMDD·1000 + (minúta dňa / 2)`, 9 číslic, vždy rastie (≥ 261005339, limit 2 100 000 000).
- **Poznámky k vydaniu** („Čo je nové“): jazykový tag **`sk`** (Play odmieta `sk-SK`), max. 500 znakov – workflow ich berie z `releases/CHANGELOG.txt`.
- Android workflow po builde nahrá AAB do **interného testovania** cez servisný účet (secret `PLAY_SERVICE_ACCOUNT_JSON`). Bez secretu sa krok preskočí.
- Do produkcie sa verzia posúva ručne: Play Console → Interné testovanie → Propagovať vydanie.
- R8/ProGuard nie je zapnutý (Capacitor release bez minifikácie), preto `mapping.txt` neexistuje – upozornenie Play na chýbajúci súbor je len informačné.
- `assetlinks.json` netreba – appka je natívna (Capacitor), nie TWA.

## Čaká
- Platobný profil (Vlado) → potom jednorazový produkt `odkialkam_plus` („Odkiaľ Kam Plus“, 2,49 EUR, možnosť nákupu `buy`, spätne kompatibilná, aktivovať).
- Nastavenie aplikácie: obsah aplikácie (zásady súkromia, reklamy, IARC, cieľová skupina 13+, Data safety, vládna appka), záznam v obchode (texty, ikona, grafika, snímky).
- Servisný účet pre automatické nahrávanie (secret `PLAY_SERVICE_ACCOUNT_JSON`).
