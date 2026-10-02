# scripts/mhd — dáta a overenie

Prehľad projektu, workflowy a postup vydania verzie sú v [README.md](../../README.md).

## Odkiaľ sú dáta a ako sa aktualizujú

- Zdroj: GTFS feed MHD Prešov — vydavateľ **R&G PLUS** (dodávateľ
  palubného/dispečerského systému DPMP; ten istý zdroj používa DPMP pre
  Google Maps), distribuovaný cez `https://transiq.xhyrom.dev/gtfs/sk/dpmp.zip`.
- Workflow `.github/workflows/mhd-gtfs-data.yml` **denne o 02:45 UTC**
  stiahne feed, pri zmene ho skompiluje (`scripts/mhd/build-data.mjs`) do
  `mhd-app/data/dataset.json`, commitne a zverejní web.
- Ručná aktualizácia: Actions → *Cestovné poriadky (GTFS)* → *Run workflow*
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

## Miesta a adresy (OpenStreetMap)

- Workflow *Miesta a adresy (OpenStreetMap)* stiahne cez Overpass API
  pomenované miesta, adresy a ulice v okolí zastávok do `data/osm-places/`.
- `scripts/mhd/places.mjs` (volá ho `build-data.mjs`) z nich vytvorí
  `mhd-app/data/places.json`:
  - miesta dostanú kategóriu, nepotrebné (lavičky, parkoviská…) a tie, čo sú
    viac než 1,5 km od zastávky, sa vynechajú,
  - rovnomenné ulice v rôznych obciach sa rozdelia podľa polohy.
- Názvy aj súradnice sú presne z OSM. Appka k nim len hľadá najbližšie zastávky.
