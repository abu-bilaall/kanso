#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OUT_ROOT="$ROOT/product-images"
MANIFEST="$OUT_ROOT/manifest.json"
MASTER_W=2600
DEFAULT_WIDTHS_4_3="640 1200 1600"
DEFAULT_WIDTHS_1_1="320 800"
WEBP_QUALITY=82
JPEG_QUALITY=85

usage() {
  cat <<'USAGE'
Usage:
  fetch-product-image.sh --category <desk|carry|write> --slug <slug>
                         (--photo-id <id> | --source-url <url>)
                         [--ratio <4:3|1:1>] [--widths "<w> <w>"] [--focus <x,y>]
                         [--zoom <0.2-1.0>] [--variant <name>] [--alt <text>]

Fetches a high-resolution master, crops to the requested aspect ratio, and
exports WebP + JPEG into product-images/<category>/.

Ratios and default widths (chosen from the Stitch desktop screens):
  4:3   catalogue cards and product detail main   640 / 1200 / 1600
  1:1   detail gallery thumbs and cart thumbs       320 /  800

Options:
  --category   desk | carry | write
  --slug       lowercase kebab-case product slug
  --photo-id   Unsplash API photo id (the short id such as IZj7vckPGiw), used
               for attribution; the image itself comes from --source-url
  --source-url full image URL, taken from urls.raw in a search response
  --ratio      4:3 (default) or 1:1
  --widths     override the default widths for the ratio
  --focus      focal point in 0..1 source coordinates, e.g. 0.5,0.35
  --zoom       portion of the crop window to keep, 1.0 (default) is widest
  --variant    filename/manifest key suffix, e.g. detail; main is the default
  --alt        alt text recorded in the manifest
  --master-file  reuse an already downloaded master instead of fetching again

Environment:
  UNSPLASH_ACCESS_KEY  optional; resolves photographer and licence details
                       into product-images/manifest.json
  UNSPLASH_ATTRIBUTION_CACHE  path to a saved search response, used to resolve
                       attribution without spending an API request
USAGE
}

die() { printf 'error: %s\n' "$1" >&2; exit 1; }

CATEGORY=""
SLUG=""
PHOTO_ID=""
SOURCE_URL=""
RATIO="4:3"
WIDTHS=""
FOCUS="0.5,0.5"
ZOOM="1.0"
VARIANT="main"
ALT=""
MASTER_FILE=""

while [ $# -gt 0 ]; do
  case "$1" in
    --category) CATEGORY="${2:-}"; shift 2 ;;
    --slug) SLUG="${2:-}"; shift 2 ;;
    --photo-id) PHOTO_ID="${2:-}"; shift 2 ;;
    --source-url) SOURCE_URL="${2:-}"; shift 2 ;;
    --ratio) RATIO="${2:-}"; shift 2 ;;
    --widths) WIDTHS="${2:-}"; shift 2 ;;
    --focus) FOCUS="${2:-}"; shift 2 ;;
    --zoom) ZOOM="${2:-}"; shift 2 ;;
    --variant) VARIANT="${2:-}"; shift 2 ;;
    --alt) ALT="${2:-}"; shift 2 ;;
    --master-file) MASTER_FILE="${2:-}"; shift 2 ;;
    -h|--help) usage; exit 0 ;;
    *) die "unknown argument: $1" ;;
  esac
done

[ -n "$CATEGORY" ] || { usage >&2; die "--category is required"; }
[ -n "$SLUG" ] || { usage >&2; die "--slug is required"; }
[ -n "$PHOTO_ID$SOURCE_URL" ] || { usage >&2; die "--photo-id or --source-url is required"; }

case "$CATEGORY" in
  desk|carry|write) ;;
  *) die "--category must be desk, carry, or write" ;;
esac

case "$RATIO" in
  "4:3") RATIO_NUM=4; RATIO_DEN=3; DEFAULT_WIDTHS="$DEFAULT_WIDTHS_4_3"; RATIO_SLUG="4x3" ;;
  "1:1") RATIO_NUM=1; RATIO_DEN=1; DEFAULT_WIDTHS="$DEFAULT_WIDTHS_1_1"; RATIO_SLUG="1x1" ;;
  *) die "--ratio must be 4:3 or 1:1" ;;
esac
[ -n "$WIDTHS" ] || WIDTHS="$DEFAULT_WIDTHS"

[[ "$SLUG" =~ ^[a-z0-9]+(-[a-z0-9]+)*$ ]] || die "--slug must be lowercase kebab-case, got: $SLUG"
[[ "$VARIANT" =~ ^[a-z0-9]+(-[a-z0-9]+)*$ ]] || die "--variant must be lowercase kebab-case"
[[ "$FOCUS" =~ ^[01](\.[0-9]+)?,[01](\.[0-9]+)?$ ]] || die "--focus must look like 0.5,0.35"
awk -v z="$ZOOM" 'BEGIN{exit !(z>0.2 && z<=1.0)}' || die "--zoom must be between 0.2 and 1.0"
command -v magick >/dev/null || die "ImageMagick 7 (magick) is required"
command -v jq >/dev/null || die "jq is required"

LARGEST=$(printf '%s\n' $WIDTHS | sort -rn | head -1)
WIDTH_LIST=$(printf '%s\n' $WIDTHS | sort -rn | tr '\n' ' ')

OUT_DIR="$OUT_ROOT/$CATEGORY"
mkdir -p "$OUT_DIR"

if [ -n "$SOURCE_URL" ]; then
  MASTER_URL="$SOURCE_URL"
else
  MASTER_URL="https://images.unsplash.com/photo-$PHOTO_ID?fm=jpg&q=90&w=$MASTER_W"
fi

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
MASTER_CACHE_DIR="${ROOT}/.cache/masters"
mkdir -p "$MASTER_CACHE_DIR"

if [ -n "$MASTER_FILE" ]; then
  [ -f "$MASTER_FILE" ] || die "--master-file not found: $MASTER_FILE"
  MASTER="$MASTER_FILE"
  printf 'using cached master: %s\n' "$MASTER"
else
  CACHE_KEY="${PHOTO_ID:-$(printf '%s' "$SOURCE_URL" | md5sum | cut -d' ' -f1)}"
  MASTER="$MASTER_CACHE_DIR/$CACHE_KEY.jpg"
  if [ -s "$MASTER" ]; then
    printf 'using cached master: %s\n' "$MASTER"
  else
    printf 'fetching master: %s\n' "$MASTER_URL"
    curl -sSL --max-time 600 --retry 4 --retry-delay 3 --retry-connrefused --fail \
      -o "$MASTER.part" "$MASTER_URL" || { rm -f "$MASTER.part"; die "download failed"; }
    identify -format '' "$MASTER.part" 2>/dev/null || { rm -f "$MASTER.part"; die "downloaded file is not a readable image"; }
    mv "$MASTER.part" "$MASTER"
  fi
fi

identify -format '' "$MASTER" 2>/dev/null || die "master is not a readable image"

read -r SW SH <<EOF
$(identify -format '%w %h' "$MASTER")
EOF
printf 'master: %sx%s  ratio %s  variant %s\n' "$SW" "$SH" "$RATIO" "$VARIANT"

FX="${FOCUS%%,*}"
FY="${FOCUS##*,}"

FULL_CW=$(( SW * RATIO_DEN / RATIO_NUM ))
FULL_CH=$(( SW * RATIO_NUM / RATIO_DEN ))
if [ "$FULL_CH" -gt "$SH" ]; then
  FULL_CW=$(( SH * RATIO_NUM / RATIO_DEN ))
  FULL_CH=$SH
fi

CW=$(awk -v c="$FULL_CW" -v z="$ZOOM" 'BEGIN{printf "%d", c*z}')
CH=$(awk -v c="$FULL_CH" -v z="$ZOOM" 'BEGIN{printf "%d", c*z}')

X=$(awk -v p="$FX" -v s="$SW" -v c="$CW" 'BEGIN{v=p*s-c/2; if(v<0)v=0; if(v>s-c)v=s-c; printf "%d", v}')
Y=$(awk -v p="$FY" -v s="$SH" -v c="$CH" 'BEGIN{v=p*s-c/2; if(v<0)v=0; if(v>s-c)v=s-c; printf "%d", v}')

if [ "$CW" -lt "$LARGEST" ]; then
  die "crop is ${CW}px wide, too small for the ${LARGEST}w export; raise --zoom or use a larger master"
fi

SUFFIX="$SLUG-$RATIO_SLUG-$VARIANT"
TOTAL=0
FILES_JSON="[]"
for W in $WIDTH_LIST; do
  H=$(awk -v w="$W" -v n="$RATIO_NUM" -v d="$RATIO_DEN" 'BEGIN{printf "%d", w*d/n}')
  BASE="$OUT_DIR/$SUFFIX-${W}w"
  magick "$MASTER" -crop "${CW}x${CH}+${X}+${Y}" +repage \
    -filter Lanczos -resize "${W}x${H}!" -strip \
    -quality "$WEBP_QUALITY" -define webp:method=6 "$BASE.webp"
  magick "$MASTER" -crop "${CW}x${CH}+${X}+${Y}" +repage \
    -filter Lanczos -resize "${W}x${H}!" -strip -interlace Plane \
    -sampling-factor 4:2:0 -quality "$JPEG_QUALITY" "$BASE.jpg"
  WB=$(stat -c%s "$BASE.webp")
  JB=$(stat -c%s "$BASE.jpg")
  TOTAL=$(( TOTAL + WB + JB ))
  printf '  %5sw x%-5s webp %8s B   jpeg %8s B\n' "$W" "$H" "$WB" "$JB"
  FILES_JSON=$(jq -c --arg w "$W" --arg h "$H" --arg webp "$BASE.webp" --arg jpg "$BASE.jpg" \
    '. + [{"width":($w|tonumber),"height":($h|tonumber),"webp":$webp,"jpeg":$jpg}]' <<<"$FILES_JSON")
done

PHOTO_PAGE="https://unsplash.com/photos/$PHOTO_ID"
PHOTOGRAPHER="null"
PHOTOGRAPHER_URL="null"
LICENSE="null"

CACHE="${UNSPLASH_ATTRIBUTION_CACHE:-}"
if [ -n "$CACHE" ] && [ -f "$CACHE" ] && [ -n "$PHOTO_ID" ]; then
  HIT=$(jq -c --arg id "$PHOTO_ID" \
    '[.results[]? | select(.id == $id)] | .[0] // empty' "$CACHE" 2>/dev/null || true)
  if [ -n "$HIT" ]; then
    PHOTOGRAPHER=$(jq -r '.user.name // "null"' <<<"$HIT")
    PHOTOGRAPHER_URL=$(jq -r '.user.links.html // "null"' <<<"$HIT")
    LICENSE=$(jq -r '.license // "null"' <<<"$HIT")
    PHOTO_PAGE=$(jq -r '.links.html // .links.self' <<<"$HIT")
    DL=$(jq -r '.links.download_location // "null"' <<<"$HIT")
    if [ "$DL" != "null" ] && [ -n "${UNSPLASH_ACCESS_KEY:-}" ]; then
      curl -sS --max-time 30 -o /dev/null -H "Authorization: Client-ID $UNSPLASH_ACCESS_KEY" "$DL" || true
    fi
  fi
elif [ -n "${UNSPLASH_ACCESS_KEY:-}" ] && [ -n "$PHOTO_ID" ]; then
  if META=$(curl -sS --max-time 30 --fail -H "Authorization: Client-ID $UNSPLASH_ACCESS_KEY" \
      "https://api.unsplash.com/photos/$PHOTO_ID"); then
    PHOTOGRAPHER=$(jq -r '.user.name // "null"' <<<"$META")
    PHOTOGRAPHER_URL=$(jq -r '.user.links.html // "null"' <<<"$META")
    LICENSE=$(jq -r '.license // "null"' <<<"$META")
    PHOTO_PAGE=$(jq -r '.links.html // .links.self' <<<"$META")
    DL=$(jq -r '.links.download_location // "null"' <<<"$META")
    [ "$DL" = "null" ] || curl -sS --max-time 30 -o /dev/null -H "Authorization: Client-ID $UNSPLASH_ACCESS_KEY" "$DL" || true
  else
    printf 'warning: attribution lookup failed\n' >&2
  fi
fi

VARIANT_COUNT=0
for W in $WIDTH_LIST; do VARIANT_COUNT=$(( VARIANT_COUNT + 2 )); done

ENTRY=$(jq -n \
  --arg category "$CATEGORY" --arg slug "$SLUG" --arg ratio "$RATIO" --arg ratio_slug "$RATIO_SLUG" \
  --arg variant "$VARIANT" --arg focus "$FOCUS" --arg zoom "$ZOOM" --arg alt "$ALT" \
  --arg source_id "$PHOTO_ID" --arg master_url "$MASTER_URL" --arg page_url "$PHOTO_PAGE" \
  --arg photographer "$PHOTOGRAPHER" --arg photographer_url "$PHOTOGRAPHER_URL" --arg license "$LICENSE" \
  --argjson master_width "$SW" --argjson master_height "$SH" --argjson files "$FILES_JSON" \
  --arg generated_at "$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
  '{
    category: $category,
    slug: $slug,
    aspect_ratio: $ratio,
    variant: $variant,
    focus: $focus,
    zoom: ($zoom|tonumber),
    alt: (if $alt == "" then null else $alt end),
    source: {
      provider: (if $source_id == "" then "direct-url" else "unsplash" end),
      photo_id: (if $source_id == "" then null else $source_id end),
      master_url: $master_url,
      page_url: $page_url,
      photographer: (if $photographer == "null" then null else $photographer end),
      photographer_url: (if $photographer_url == "null" then null else $photographer_url end),
      license: (if $license == "null" then null else $license end)
    },
    master: {width: $master_width, height: $master_height},
    sizes: $files,
    generated_at: $generated_at
  }')

[ -f "$MANIFEST" ] || printf '{}\n' > "$MANIFEST"
jq --arg cat "$CATEGORY" --arg slug "$SLUG" --arg ratio_slug "$RATIO_SLUG" --arg variant "$VARIANT" \
  --argjson entry "$ENTRY" \
  '. as $root
   | .[$cat] = ((.[$cat] // {}) | .[$slug] = ((.[$slug] // {}) | .[$ratio_slug] = ((.[$ratio_slug] // {}) | .[$variant] = $entry)))' \
  "$MANIFEST" | jq --sort-keys . > "$TMP/manifest.json"
mv "$TMP/manifest.json" "$MANIFEST"

printf '%s: %s files, %s total\n' "$SUFFIX" "$VARIANT_COUNT" "$(numfmt --to=iec "$TOTAL")"