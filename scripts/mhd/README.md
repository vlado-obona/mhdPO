# MHD Prešov — plánovač spojení

Webová aplikácia (PWA) na plánovanie spojení MHD Prešov s prestupmi,
postavená na oficiálnych cestovných poriadkoch DPMP. Beží na
`/mhd/` (súbory v `public/mhd/`).

## Funkcie

- vyhľadávanie spojení **s prestupmi** (algoritmus RAPTOR, beží celý
  v prehliadači — po načítaní funguje aj offline),
- výber štartu a cieľa **písaním** (našepkávač) alebo **ťuknutím na mape**
  (zastávka aj ľubovoľný bod — dopočíta sa pešia chôdza k najbližším
  zastávkam),
- tlačidlo 📍 nastaví štart podľa **aktuálnej polohy**,
- dátum a čas sa **predvyplní podľa teraz** (časová zóna Europe/Bratislava),
- nočné spoje cez polnoc, pešie prestupy medzi blízkymi zastávkami,
- inštalovateľná **PWA pre Android** (Chrome → menu → *Pridať na plochu* /
  *Nainštalovať aplikáciu*).

## Odkiaľ sú dáta a ako sa aktualizujú

- Zdroj: GTFS feed MHD Prešov — vydavateľ **R&G PLUS** (dodávateľ
  palubného/dispečerského systému DPMP; ten istý zdroj používa DPMP pre
  Google Maps), distribuovaný cez `https://transiq.xhyrom.dev/gtfs/sk/dpmp.zip`.
- Workflow `.github/workflows/mhd-gtfs-data.yml` **denne o 02:45 UTC**
  stiahne feed, skompiluje ho (`scripts/mhd/build-data.mjs`) do
  `public/mhd/data/dataset.json` a pri zmene commitne + spustí deploy.
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
npm run dev            # aplikácia na http://localhost:4321/mhd/
node scripts/mhd/build-data.mjs   # rekompilácia datasetu z data/gtfs-presov/
node scripts/mhd/test-router.mjs  # validácia routera
```

## Natívna Android aplikácia (voliteľné)

PWA sa dá zabaliť do APK/AAB pre Google Play cez
[Bubblewrap](https://github.com/GoogleChromeLabs/bubblewrap)
(Trusted Web Activity):

```bash
npx @bubblewrap/cli init --manifest https://auresa.sk/mhd/manifest.webmanifest
npx @bubblewrap/cli build
```

Vyžaduje nasadenú stránku na HTTPS a `assetlinks.json` (vygeneruje
bubblewrap) v `public/.well-known/`.
