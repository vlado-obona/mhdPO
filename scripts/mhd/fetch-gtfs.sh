#!/usr/bin/env bash
# Stiahne oficiálny GTFS feed MHD Prešov (DPMP).
#
# Beží v GitHub Actions (plný prístup na internet). Postup:
#   1. Ak je zadaná GTFS_URL, použije ju priamo.
#   2. Inak skúsi zoznam známych/pravdepodobných priamych URL.
#   3. Inak crawluje oficiálne stránky (dpmp.sk, mhdpresov.sk, egov.presov.sk,
#      presov.sk, alvaria.sk) a hľadá odkazy na GTFS zip — vrátane JS bundlov
#      SPA aplikácie mhdpresov.sk.
# Výsledok: rozbalený feed v data/gtfs-presov/ + SOURCE.txt s provenience.
# Bez nálezu skončí s kódom 3 (logy obsahujú všetko nájdené na ručnú analýzu).
set -uo pipefail

DEST="data/gtfs-presov"
TMP="$(mktemp -d)"
UA="Mozilla/5.0 (X11; Linux x86_64) MHD-Presov-planner-data-fetch (kontakt: repo auresa-web)"

log() { echo "[fetch-gtfs] $*"; }

DEADLINE=$((SECONDS + 480)) # globálny limit na sieťové pokusy (8 min)

fetch() { # fetch URL FILE
  if [ $SECONDS -gt $DEADLINE ]; then
    log "(deadline — preskakujem $1)"
    return 1
  fi
  curl -sSL --connect-timeout 8 --max-time 45 -A "$UA" -o "$2" "$1" 2>/dev/null
}

is_gtfs_zip() { # súbor je zip a obsahuje stops.txt + stop_times.txt
  local f="$1"
  file "$f" | grep -qi 'zip' || return 1
  local listing
  listing=$(unzip -l "$f" 2>/dev/null) || return 1
  echo "$listing" | grep -q 'stops.txt' && echo "$listing" | grep -q 'stop_times.txt'
}

try_url() { # stiahne URL; ak je to validný GTFS zip, nastaví FOUND_URL/FOUND_FILE
  local url="$1"
  local f="$TMP/candidate.zip"
  log "Skúšam: $url"
  fetch "$url" "$f" || return 1
  [ -s "$f" ] || return 1
  if is_gtfs_zip "$f"; then
    FOUND_URL="$url"
    FOUND_FILE="$f"
    return 0
  fi
  return 1
}

FOUND_URL=""
FOUND_FILE=""

# ── 1. explicitná URL ────────────────────────────────────────────────
if [ -n "${GTFS_URL:-}" ]; then
  try_url "$GTFS_URL" || { log "CHYBA: zadaná GTFS_URL nie je validný GTFS zip"; exit 2; }
fi

# ── 2b. open data katalóg mesta Prešov (geodatakatalog) ─────────────
if [ -z "$FOUND_URL" ]; then
  for cat in "https://egov.presov.sk/GeoDataKatalog/dpmp.txt" \
             "https://egov.presov.sk/GeoDataKatalog/dpmp.csv" \
             "https://egov.presov.sk/GeoDataKatalog/"; do
    cf="$TMP/katalog.csv"
    log "Katalóg: $cat"
    fetch "$cat" "$cf" || continue
    [ -s "$cf" ] || continue
    log "── Obsah $cat (prvých 100 riadkov) ──"
    head -100 "$cf" | iconv -f WINDOWS-1250 -t UTF-8 2>/dev/null || head -100 "$cf"
    log "── koniec obsahu ──"
    while read -r u; do
      try_url "$u" && break
    done < <({
      grep -oiE 'https?://[^",;[:space:]]+' "$cf"
      # relatívne názvy súborov v katalógu (zip/gtfs)
      grep -oiE '[A-Za-z0-9_./-]+\.(zip|txt)' "$cf" | grep -iE 'gtfs|zip' \
        | sed 's#^#https://egov.presov.sk/GeoDataKatalog/#'
    } | grep -iE 'gtfs|zip' | sort -u)
    [ -n "$FOUND_URL" ] && break
  done
fi

# ── 2. známe kandidátske URL ─────────────────────────────────────────
if [ -z "$FOUND_URL" ]; then
  CANDIDATES=(
    "https://www.dpmp.sk/gtfs.zip"
    "https://www.dpmp.sk/gtfs/gtfs.zip"
    "https://www.dpmp.sk/opendata/gtfs.zip"
    "https://www.dpmp.sk/files/gtfs.zip"
    "https://www.dpmp.sk/google_transit.zip"
    "https://dpmp.sk/gtfs.zip"
    "https://mhdpresov.sk/gtfs.zip"
    "https://mhdpresov.sk/data/gtfs.zip"
    "https://mhdpresov.sk/api/gtfs.zip"
    "https://api.mhdpresov.sk/gtfs.zip"
    "https://opendata.presov.sk/gtfs.zip"
    "https://egov.presov.sk/opendata/gtfs.zip"
  )
  for u in "${CANDIDATES[@]}"; do
    if try_url "$u"; then break; fi
  done
fi

# ── 3. crawl oficiálnych stránok ─────────────────────────────────────
extract_links() { # z HTML/JS vytiahne absolútne URL + href/src, doplní doménu
  local file="$1" base="$2"
  {
    grep -oiE 'https?://[^"'\''<> )]+' "$file" || true
    grep -oiE '(href|src)="[^"]+"' "$file" | sed -E 's/^(href|src)="//; s/"$//' \
      | while read -r h; do
          case "$h" in
            http*) echo "$h" ;;
            /*) echo "${base%/}$h" ;;
          esac
        done || true
  } | sort -u
}

if [ -z "$FOUND_URL" ]; then
  SEEDS=(
    "https://www.dpmp.sk/"
    "https://www.dpmp.sk/sitemap.xml"
    "https://www.dpmp.sk/cestovne-poriadky"
    "https://www.dpmp.sk/otvorene-data"
    "https://www.dpmp.sk/open-data"
    "https://mhdpresov.sk/"
    "https://www.presov.sk/cestovne-poriadky-presovskej-mhd-su-uz-aj-v-mapach-google-oznam/mid/491238/ma0/all/.html"
    "https://www.alvaria.sk/use-cases/mhd-presov/"
    "https://egov.presov.sk/Default.aspx?NavigationState=1200:0:"
  )
  ALL_LINKS="$TMP/links.txt"; : > "$ALL_LINKS"
  n=0
  for s in "${SEEDS[@]}"; do
    p="$TMP/page$((n++)).html"
    log "Crawlujem: $s"
    fetch "$s" "$p" || continue
    base=$(echo "$s" | grep -oE 'https?://[^/]+')
    extract_links "$p" "$base" >> "$ALL_LINKS"
    # zmienky o gtfs priamo v texte (kontext do logu)
    grep -oiE '.{0,120}gtfs.{0,120}' "$p" | head -20 | sed 's/^/[zmienka] /' || true
  done

  # JS bundle SPA mhdpresov.sk môžu obsahovať API URL
  grep -iE '\.js(\?|$)' "$ALL_LINKS" | grep -iE 'mhdpresov|dpmp' | head -15 | while read -r js; do
    jf="$TMP/bundle.js"
    log "Sťahujem JS bundle: $js"
    fetch "$js" "$jf" || continue
    extract_links "$jf" "$(echo "$js" | grep -oE 'https?://[^/]+')" >> "$ALL_LINKS"
    grep -oiE '.{0,80}gtfs.{0,80}' "$jf" | head -20 | sed 's/^/[js-zmienka] /' || true
  done

  sort -u "$ALL_LINKS" -o "$ALL_LINKS"
  log "── Nájdené odkazy súvisiace s dátami/CP: ──"
  grep -iE 'gtfs|opendata|otvoren|cestovn|poriad|\.zip|api\.' "$ALL_LINKS" | head -120 || true
  log "── koniec zoznamu ──"

  # priame gtfs zip odkazy
  while read -r u; do
    try_url "$u" && break
  done < <(grep -iE 'gtfs[^"]*\.zip|google_transit[^"]*\.zip|\.zip' "$ALL_LINKS" | grep -iE 'gtfs|transit|cestovn|poriad' | head -20)

  # druhá úroveň: podstránky s "gtfs/opendata/cestovne poriadky" v URL
  if [ -z "$FOUND_URL" ]; then
    m=0
    while read -r u; do
      p="$TMP/sub$((m++)).html"
      log "Crawlujem podstránku: $u"
      fetch "$u" "$p" || continue
      base=$(echo "$u" | grep -oE 'https?://[^/]+')
      extract_links "$p" "$base" | grep -iE '\.zip|gtfs' | head -30 >> "$TMP/sub_links.txt" || true
    done < <(grep -iE 'dpmp\.sk|presov\.sk|mhdpresov\.sk' "$ALL_LINKS" | grep -iE 'gtfs|opendata|otvoren|cestovn|poriad|data' | grep -viE '\.(pdf|jpg|png|zip|css)' | head -15)
    if [ -f "$TMP/sub_links.txt" ]; then
      sort -u "$TMP/sub_links.txt" | tee -a "$ALL_LINKS" | sed 's/^/[podstránka-odkaz] /'
      while read -r u; do
        try_url "$u" && break
      done < <(sort -u "$TMP/sub_links.txt" | grep -iE '\.zip')
    fi
  fi
fi

# ── výsledok ─────────────────────────────────────────────────────────
if [ -z "$FOUND_URL" ]; then
  log "GTFS feed sa nepodarilo nájsť automaticky. Pozri logy vyššie a spusti"
  log "workflow znova s parametrom gtfs_url."
  exit 3
fi

log "✔ GTFS feed nájdený: $FOUND_URL"
rm -rf "$DEST"
mkdir -p "$DEST"
unzip -o -d "$DEST" "$FOUND_FILE"
sha=$(sha256sum "$FOUND_FILE" | cut -d' ' -f1)
{
  echo "zdroj: $FOUND_URL"
  echo "stiahnuté: $(date -u +%FT%TZ)"
  echo "sha256: $sha"
} > "$DEST/SOURCE.txt"

log "── Súhrn feedu ──"
for f in agency.txt calendar.txt calendar_dates.txt feed_info.txt; do
  [ -f "$DEST/$f" ] && { echo "== $f =="; head -5 "$DEST/$f"; }
done
for f in "$DEST"/*.txt; do
  echo "$(basename "$f"): $(($(wc -l < "$f") - 1)) riadkov"
done
exit 0
