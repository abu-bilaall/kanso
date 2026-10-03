#!/usr/bin/env bash
#
# Download a product photo master into product-images/_masters/.
#
# Masters only. Derivatives are the pipeline's job, not this script's — see
# scripts/process-product-images.mjs and docs/IMAGES.md.
#
# This script used to also crop and write product-images/manifest.json. It
# stopped doing that because that manifest is a frozen contract shape
# (docs/CONTRACTS.md § *Product images*) and the entries this script wrote did
# not fit it: running it produced a file that threw the moment `@/lib/images`
# was imported. Fetching a photo must never be able to break the storefront.
#
# Usage:
#   scripts/fetch-product-image.sh --slug <slug> --source-url <url>
#   scripts/fetch-product-image.sh --slug <slug> --photo-id <unsplash-id>
#
# Options:
#   --slug        lowercase kebab-case product slug; becomes the filename
#   --source-url  full image URL, taken from urls.raw in a search response
#   --photo-id    Unsplash API photo id, used to build the download URL
#   --force       overwrite an existing master
#
# Masters are gitignored. Nothing this script writes reaches version control.

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
MASTER_DIR="$ROOT/product-images/_masters"
MIN_LONG_EDGE=2000

usage() {
  sed -n '4,24p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'
}

die() { printf 'error: %s\n' "$1" >&2; exit 1; }

SLUG=""
PHOTO_ID=""
SOURCE_URL=""
FORCE=0

while [ $# -gt 0 ]; do
  case "$1" in
    --slug) SLUG="${2:-}"; shift 2 ;;
    --source-url) SOURCE_URL="${2:-}"; shift 2 ;;
    --photo-id) PHOTO_ID="${2:-}"; shift 2 ;;
    --force) FORCE=1; shift ;;
    -h|--help) usage; exit 0 ;;
    *) die "unknown argument: $1" ;;
  esac
done

[ -n "$SLUG" ] || { usage >&2; die "--slug is required"; }
[[ "$SLUG" =~ ^[a-z0-9]+(-[a-z0-9]+)*$ ]] || die "--slug must be lowercase kebab-case, got: $SLUG"
[ -n "$PHOTO_ID$SOURCE_URL" ] || die "--photo-id or --source-url is required"

command -v magick >/dev/null || die "ImageMagick 7 (magick) is required"
command -v curl >/dev/null || die "curl is required"

MASTER="$MASTER_DIR/$SLUG.jpg"
[ "$FORCE" -eq 1 ] || [ ! -e "$MASTER" ] || die "$MASTER exists; pass --force to replace it"

mkdir -p "$MASTER_DIR"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

if [ -n "$SOURCE_URL" ]; then
  URL="$SOURCE_URL"
elif [ -n "$UNSPLASH_ACCESS_KEY" ]; then
  URL="https://api.unsplash.com/photos/$PHOTO_ID/download?client_id=$UNSPLASH_ACCESS_KEY"
else
  die "--photo-id needs UNSPLASH_ACCESS_KEY, or pass --source-url with the direct image URL"
fi

printf 'fetching %s\n' "$SLUG"
curl --fail --silent --show-error --location --max-time 120 "$URL" -o "$TMP/master"

identify -format '' "$TMP/master" 2>/dev/null || die "what came back from $URL is not a readable image"

read -r W H <<EOF
$(identify -format '%w %h' "$TMP/master")
EOF
LONG=$(( W > H ? W : H ))
[ "$LONG" -ge "$MIN_LONG_EDGE" ] ||
  die "long edge is ${LONG}px, below the ${MIN_LONG_EDGE}px floor; a 4:3 crop from it would be too small to export at 640w"

# Normalise orientation and strip metadata on the way in: EXIF can name the
# photographer, a device and a location, and none of that should sit in a
# gitignored folder waiting to be re-uploaded with its provenance intact.
magick "$TMP/master" -auto-orient -colorspace sRGB -strip -quality 95 "$MASTER"

printf 'master: %sx%s  %s\n' "$W" "$H" "$MASTER"
printf 'next: add or adjust this slug in scripts/product-image-crops.json, then run\n'
printf '      node scripts/process-product-images.mjs --slug %s\n' "$SLUG"