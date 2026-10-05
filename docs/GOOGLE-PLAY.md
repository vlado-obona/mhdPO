# Google Play – stav a postup

Stav k 5. 10. 2026 14:50 (súhrn z Play Console). Neobsahuje žiadne heslá ani kľúče.

## Aplikácia
| Položka | Hodnota |
|---|---|
| Vývojár | BEDEKA, s.r.o. (developer ID 9184503168027888643) |
| Aplikácia | Odkiaľ Kam – MHD Prešov (app ID 4973310957021774926) |
| Balíček | `sk.operatorsystem.mhdpresov` (nemeniteľný) |
| Play App Signing | zapnuté – podpisový kľúč spravuje Google; náš keystore (secrets `ANDROID_KEYSTORE_*`) je **upload kľúč** |
| Interné testovanie | aktívne od 1.6.1; posledná 1.6.3 (versionCode 261005387), zoznam „Interní testeri“ |
| Testovanie licencií | zoznam „Interní testeri“, RESPOND_NORMALLY (nákupy zadarmo) |
| Platobný profil | Google Payments BEDEKA, s.r.o. (organizácia), prepojený |
| Produkt Plus | `odkialkam_plus`, jednorazový INAPP (trvalý – **nikdy nekonzumovať**), možnosť nákupu `buy`, spätne kompatibilná, **aktívny**, 174 krajín; SK 2,49 € s DPH (základ 2,02 € bez DPH) |

## Nákup Plus v appke
- Plugin `@capgo/native-purchases`: nákup `purchaseProduct({productType:'inapp'})` – plugin nákup sám potvrdí (acknowledge).
- Pri každom štarte `getPurchases('inapp')` → Plus podľa nákupu v stave PURCHASED; nepotvrdený nákup (napr. odložená platba dokončená mimo appky) appka potvrdí cez `acknowledgePurchase` (od v1.6.3) – inak ho Play po 3 dňoch vráti.
- Cena na tlačidle je z Google Play (`priceString` = formattedPrice), nie natvrdo.
- Play Billing Library (9.x) posiela diagnostiku volaní billing API do Google cez `datatransport` (backend CCT). Workflow od v1.6.4 odstráni z manifestu `TransportBackendDiscovery` (`tools:node="remove"`) a kontroluje výsledné APK – logger knižnice je celý v `try/catch`, udalosti bez backendu sa zahodia. Vďaka tomu platí Data safety „nezbiera“.
- Kontrolóri Google Plus nekúpia – nevadí: platené doplnky nie sú „obmedzený prístup“ (prihlásenie), jadro appky je celé dostupné. Odomykací kód netreba; ak by ho Google pri kontrole vyžiadal, doplní sa.

## Upozornenie na výstup
- Pri otvorenej appke: GPS (watchPosition) + zvuk, vibrácia, hlas; displej ostáva zapnutý (KeepAwake).
- Pri zamknutom displeji / appke v pozadí: naplánovaná lokálna notifikácia podľa CP + zisteného meškania (LocalNotifications, `allowWhileIdle`; presne s povolením „Budíky a pripomienky“ = SCHEDULE_EXACT_ALARM). Poloha sa na pozadí NEzisťuje – žiadna foreground service ani ACCESS_BACKGROUND_LOCATION. Texty v obchode to tak popisujú (od 5. 10. 2026).

## Pravidlá pre build
- **versionCode** = `YYMMDD·1000 + (minúta dňa / 2)`, 9 číslic, vždy rastie (posledný nahratý 261005387, limit 2 100 000 000).
- **Poznámky k vydaniu** („Čo je nové“): jazykový tag **`sk`** (Play odmieta `sk-SK`), max. 500 znakov – workflow ich berie z `releases/CHANGELOG.txt`.
- Android workflow po builde nahrá AAB do **interného testovania** cez servisný účet (secret `PLAY_SERVICE_ACCOUNT_JSON`). Bez secretu sa krok preskočí.
- Do produkcie sa verzia posúva ručne: Play Console → Interné testovanie → Propagovať vydanie.
- R8/ProGuard nie je zapnutý (Capacitor release bez minifikácie), preto `mapping.txt` neexistuje – upozornenie Play na chýbajúci súbor je len informačné (pády v Android vitals budú čitateľné aj bez neho).
- `assetlinks.json` netreba – appka je natívna (Capacitor), nie TWA.

## Čaká
- Platobný profil – Vlado: bankový účet (bez neho žiadne výplaty), DIČ/IČ DPH, prihlásenie do programu 15 % poplatku (skupina účtov + podmienky).
- Nastavenie aplikácie: obsah aplikácie (zásady súkromia, reklamy, IARC, cieľová skupina 13+, Data safety, vládna appka), záznam v obchode (texty, ikona, grafika, snímky) – podklady v `store/`.
- Servisný účet pre automatické nahrávanie (secret `PLAY_SERVICE_ACCOUNT_JSON`).
