#!/usr/bin/env bash
# catalog-smoke.sh <staging|production> [--out file.png] [--home ID]
#
# Smoke test of the catalogue pages in headless Chromium, at 1440x900 and at 390x844 with touch (and
# 844x390 for sideways scrolling): the top-bar or control-panel entry opens /catalog, both kinds are
# shown with use counts and rendered thumbnails (kept in the Cache Storage), search filters, a card
# opens its piece page, the back button returns to /catalog and then to /, and a deep link to
# /catalog/furniture/furniture.bed loads in a fresh browser and survives a reload. Also: no console
# or page errors, every control has a name, nothing scrolls sideways on the phone. Ends with
# screenshots (<out> and <out>-phone.png). Exit 0 when every check passes.
# Read-only: every write is refused inside the browser; the default layout the viewer creates for a
# home without one is answered there, never stored. Uses the Playwright set-up of screenshot.sh.
# --home picks a home by id (kept in the links as ?home=).
set -euo pipefail
script_dir=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
# shellcheck source=lib.sh
source "$script_dir/lib.sh"

usage() {
  sed -n '2,13s/^# \{0,1\}//p' "$0" >&2
  exit 2
}

[[ $# -ge 1 ]] || usage
resolve_env "$1"
shift
out='' home=''
while [[ $# -gt 0 ]]; do
  [[ $# -ge 2 ]] || usage
  case "$1" in
    --out) out=$2 ;;
    --home) home=$2 ;;
    *) usage ;;
  esac
  shift 2
done
out=${out:-${TMPDIR:-/tmp}/my-home-$SITE_ENV-catalog-$(date +%Y%m%d-%H%M%S).png}
[[ $out == /* ]] || out="$PWD/$out"
[[ $out == *.png ]] || die "--out must end in .png"

# Installs the pinned Playwright and Chromium if they are missing.
"$script_dir/screenshot.sh" --check >/dev/null
export MY_HOME_PLAYWRIGHT_DIR=${MY_HOME_PLAYWRIGHT_DIR:-${XDG_CACHE_HOME:-$HOME/.cache}/my-home-environments/playwright}
node_cmd=(node)
command -v ao-heavy >/dev/null 2>&1 && [[ ${AO_HEAVY_ACTIVE:-} != 1 ]] && node_cmd=(ao-heavy node)
"$script_dir/with-site-token.sh" "$SITE_ENV" -- "${node_cmd[@]}" "$script_dir/catalog-smoke.mjs" "$out" ${home:+"$home"}
