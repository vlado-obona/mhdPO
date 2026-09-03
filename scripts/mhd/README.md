# MHD Prešov — plánovač spojení

Samostatná webová aplikácia (PWA) na plánovanie spojení MHD Prešov
s prestupmi, postavená na oficiálnych cestovných poriadkoch DPMP.
Zdroj appky je v `mhd-app/`, nasadzuje sa na **https://operatorsystem.sk/mhd/**
(nezávislé od webu auresa.sk — vlastný deploy aj secrets).

## Funkcie

- vyhľadávanie spojení **s prestupmi** (algoritmus RAPTOR, beží celý
  v prehliadači — po načítaní funguje aj offline),
- výber štartu a cieľa **písaním** (našepkávač) alebo **ťuknutím na mape**
  (zastávka aj ľubovoľný bod — dopočíta sa pešia chôdza k najbližším
  zastávkam),
- tlačidlo 📍 nastaví štart podľa **aktuálnej polohy**,
- dátum a čas sa **predvyplní podľa teraz** (časová zóna Europe/Bratislava),
- nočné spoje cez polnoc, pešie prestupy medzi blízkymi zastávkami.

## Inštalácia do telefónu

- **Android**: Chrome → `https://operatorsystem.sk/mhd/` → menu (⋮) →
  *Pridať na plochu / Nainštalovať aplikáciu*. Alebo APK/AAB z workflowu
  *MHD Presov - Android (TWA)* (pozri nižšie).
- **iPhone/iPad**: Safari → `https://operatorsystem.sk/mhd/` → tlačidlo
  **Zdieľať** (štvorec so šípkou) → **Pridať na plochu**. Appka beží
  celoobrazovkovo s vlastnou ikonou a funguje aj offline (iOS 11.3+).
  Distribúcia cez App Store by vyžadovala Apple Developer účet (99 USD/rok),
  macOS build a review — na bežné používanie stačí inštalácia zo Safari.

## Nasadenie (deploy)

Workflow `.github/workflows/deploy-mhd.yml` nasadí `mhd-app/` cez SFTP do
`$MHD_SFTP_PATH/mhd` na hostingu operatorsystem.sk. Vyžaduje secrets:

| Secret | Význam |
|---|---|
| `MHD_SFTP_HOST` / `MHD_SFTP_PORT` | SFTP server hostingu (Websupport) |
| `MHD_SFTP_USER` / `MHD_SFTP_PASS` | prihlásenie |
| `MHD_SFTP_PATH` | webroot domény operatorsystem.sk |

Spúšťa sa pri zmene `mhd-app/` na maine, ručne, a po dennej aktualizácii dát.

## Odkiaľ sú dáta a ako sa aktualizujú

- Zdroj: GTFS feed MHD Prešov — vydavateľ **R&G PLUS** (dodávateľ
  palubného/dispečerského systému DPMP; ten istý zdroj používa DPMP pre
  Google Maps), distribuovaný cez `https://transiq.xhyrom.dev/gtfs/sk/dpmp.zip`.
- Workflow `.github/workflows/mhd-gtfs-data.yml` **denne o 02:45 UTC**
  stiahne feed, pri zmene ho skompiluje (`scripts/mhd/build-data.mjs`) do
  `mhd-app/data/dataset.json`, commitne a spustí deploy.
- Ručná aktualizácia: Actions → *MHD Presov - GTFS data* → *Run workflow*
  (voliteľne s vlastnou `gtfs_url`, ak by sa zdroj presunul).
- Surový feed je v `data/gtfs-presov/` (provenience v `SOURCE.txt`).

## Overenie presnosti

`node scripts/mhd/test-router.mjs` kontroluje nad reálnym datasetom:

1. rekonštrukciu spojov z CP (časy sa musia zhodovať na sekundu),
2. validitu prestupov (nadväznosť legov, rezerva na prestup),
3. krížovú kontrolu s odchodmi z realtime open data DPMP
   (`egov.presov.sk/GeoDataKatalog/dpmp.csv`) — pri poslednom overení
   30/32 zhôd (2 nezhody na linke 2 boli pravdepodobne operatívne zmeny),
4. nočné linky N1/N2 cez polnoc.

## Vývoj

```bash
npx http-server mhd-app -p 8080   # alebo hociktorý statický server
node scripts/mhd/build-data.mjs   # rekompilácia datasetu z data/gtfs-presov/
node scripts/mhd/test-router.mjs  # validácia routera
```

## Android APK / Google Play (TWA)

Workflow `.github/workflows/mhd-android.yml` (Bubblewrap, konfigurácia
`android/twa-manifest.json`, package `sk.operatorsystem.mhdpresov`) vyrobí:

- `app-release-signed.apk` — priama inštalácia (sideload),
- `app-release-bundle.aab` — na nahratie do Google Play Console,
- `assetlinks.json` — patrí na `https://operatorsystem.sk/.well-known/assetlinks.json`
  (bez neho sa TWA otvára s lištou prehliadača).

Podpisový kľúč: secrets `ANDROID_KEYSTORE_B64` + `ANDROID_KEYSTORE_PASSWORD`;
bez nich sa vygeneruje nový a priloží do artefaktu (treba si ho uložiť —
Play vyžaduje rovnaký kľúč pre každú aktualizáciu). Pri novej verzii zvýš
`appVersionCode` v `android/twa-manifest.json`.
