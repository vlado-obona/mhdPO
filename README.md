# Odkiaľ Kam – MHD Prešov

Neoficiálny plánovač spojení mestskej hromadnej dopravy v Prešove pre
Android, iOS a web. Hľadá spojenia s prestupmi podľa verejných cestovných
poriadkov DPMP a funguje offline: dáta sú v aplikácii a vyhľadávanie beží
v telefóne. Prevádzkovateľ: BEDEKA, s.r.o.

## Čo appka vie

- **Spojenia s prestupmi.** Algoritmus RAPTOR. Rieši aj „zostaň sedieť“
  (spoj pokračuje ako iná linka), nočné linky a pešie prestupy.
- **Odkiaľ / Kam.** Dá sa zadať zastávka, **miesto podľa názvu** (námestie,
  kostol, obchodné centrum, nemocnica, úrad…), **ulica alebo adresa**
  („Hlavná 47“), ťuknutie na mapu alebo aktuálna poloha. Pri mieste appka
  ukáže najbližšiu zastávku a pripočíta chôdzu.
- **Rýchle ciele s režimom cesty.** Navedie ťa na zastávku, sleduje jazdu
  cez GPS a upozorní ťa pred výstupom zvukom, vibráciou, hlasom aj
  notifikáciou.
- **Lístok.** Odkazy na SMS lístok, platbu kartou a aplikácie DPMP.
- **Odkiaľ Kam Plus** (len Android, jednorazový nákup cez Google Play Billing,
  produkt `odkialkam_plus`, typ „jednorazový produkt“): až 6 rýchlych cieľov,
  tmavý režim a widget „Najbližší autobus“ (natívny kód v `android-native/`,
  dáta mu posiela appka cez most `WidgetBridge`). Jadro appky je zadarmo. Nákup sa overuje v telefóne cez Google
  Play (plugin `@capgo/native-purchases`), bez vlastného servera.

## Štruktúra

| Cesta | Obsah |
|---|---|
| `mhd-app/` | appka (HTML/CSS/JS, PWA). `data/` = skompilovaný dataset, miesta, podkladová mapa |
| `scripts/mhd/` | kompilácia dát (`build-data.mjs`, `places.mjs`, `gtfs-patch.mjs`), release (`build-release.mjs`), testy (`test-router.mjs`) |
| `data/gtfs-presov/` | surový GTFS feed DPMP (provenience v `SOURCE.txt`) |
| `data/gtfs-patches/` | zmeny CP vyhlásené DPMP, ktoré ešte nie sú vo feede (overené proti PDF) |
| `data/dpmp-lcp/`, `data/dpmp-info/` | oficiálne podklady DPMP (linkové CP v PDF, stránky o lístkoch) na overenie |
| `data/osm-places/` | miesta a adresy z OpenStreetMap (© prispievatelia OSM, ODbL) |
| `web/` | stránky na GitHub Pages: `sukromie/` = zásady ochrany súkromia |
| `releases/` | hotové verzie (`vX.Y.Z/`) a `CHANGELOG.txt` |

## Workflowy (GitHub Actions)

| Workflow | Čo robí |
|---|---|
| **Android (APK + AAB)** | Capacitor 8, targetSdk 36, balíček `sk.operatorsystem.mhdpresov`. Podpisuje kľúčom zo secrets `ANDROID_KEYSTORE_B64` + `ANDROID_KEYSTORE_PASSWORD` (alias `android`); bez nich zlyhá. |
| **iOS (IPA)** | nepodpísaná IPA (Sideloadly/AltStore), kým nie je Apple Developer účet |
| **Web (GitHub Pages)** | appka na `https://vlado-obona.github.io/mhdPO/`, zásady súkromia na `/sukromie/` |
| **Cestovné poriadky (GTFS)** | denne stiahne GTFS feed. Pri zmene skompiluje dataset a commitne ho. |
| **Miesta a adresy (OpenStreetMap)** | stiahne miesta a adresy z OSM (Overpass) |
| **DPMP info o lístkoch** | stiahne oficiálne stránky DPMP o lístkoch |

Android a iOS workflowy zoberú verziu z `APP_VERSION` v `mhd-app/app.js`.
Súbory commitnú do `releases/vX.Y.Z/` a pridajú ich do GitHub Release `vX.Y.Z`.

## Nová verzia

1. Zvýš `APP_VERSION` v `mhd-app/app.js` a doplň `releases/CHANGELOG.txt`.
2. `node scripts/mhd/build-data.mjs`, ak sa zmenili dáta.
3. `node scripts/mhd/test-router.mjs`. Všetky kontroly musia prejsť.
4. `node scripts/mhd/build-release.mjs X.Y.Z` vytvorí appku v jednom HTML súbore.
5. Spusti workflowy **Android** a **iOS**: Actions → Run workflow.
   `versionCode` sa zvyšuje automaticky.

Názov na ploche telefónu obsahuje verziu (napr. „Odkiaľ Kam v1.4.0“).

## Bezpečnosť

Keystore, heslá ani obsah secrets nikdy necommitovať ani nevypisovať.
Záloha kľúča je mimo repozitára.

## Dáta a licencie

- Cestovné poriadky: verejné dáta Dopravného podniku mesta Prešov, a.s.
  (GTFS, vydavateľ R&G PLUS) a ním zverejnené zmeny CP.
- Miesta, ulice, adresy a mapové podklady: © prispievatelia
  [OpenStreetMap](https://www.openstreetmap.org/copyright), ODbL 1.0.
- Aplikácia nie je oficiálnou aplikáciou DPMP ani mesta Prešov.
