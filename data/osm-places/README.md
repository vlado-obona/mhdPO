# Dáta z OpenStreetMap

Údaje © prispievatelia [OpenStreetMap](https://www.openstreetmap.org/copyright),
licencia [Open Database License (ODbL) 1.0](https://opendatacommons.org/licenses/odbl/1-0/).

## Čo tu je

| Súbor | Obsah |
|---|---|
| `pois.json` | pomenované miesta (obchody, úrady, školy, zastávky, námestia…) |
| `addresses.json` | adresy (ulica, číslo, mesto) |
| `streets.json` | pomenované cesty a ulice s geometriou |
| `areas.json` | plochy pre podkladovú mapu (voda, parky, lesy, lúky, cintoríny) |
| `SOURCE.txt` | kedy a z akého stavu OSM sa dáta stiahli, výrez územia |

Stiahol ich workflow [Miesta a adresy (OpenStreetMap)](../../.github/workflows/mhd-osm-places.yml)
z Overpass API – presné dotazy sú v ňom.

## Čo z nich vzniká v appke

Z týchto súborov skript `scripts/mhd/build-data.mjs` (s `places.mjs` a `mapbase.mjs`)
vytvorí databázy, ktoré appka Odkiaľ Kam nosí v sebe:

- `mhd-app/data/places.json` – miesta, adresy a ulice na vyhľadávanie a na „Kde som?“,
- `mhd-app/data/mapbase.json` – podkladová mapa (ulice, voda, parky, lesy).

Aj tieto odvodené databázy sú pod licenciou **ODbL 1.0** a dajú sa voľne stiahnuť
z tohto verejného repozitára (spolu so skriptami, ktorými vznikli). Cestovné poriadky
(`mhd-app/data/dataset.json`, zdroj GTFS DPMP) sú samostatná databáza.

Meranie pešej siete pre návrh navádzania po chodníkoch (workflow
[Pešia sieť (OpenStreetMap) – meranie](../../.github/workflows/mhd-osm-walk.yml))
do appky nič nepridáva; jeho výsledky sú len v artefakte behu.
