#!/usr/bin/env bash
# mobile-smoke.sh <staging|production> [--out file.png] [--home ID]
#
# Smoke test of the phone layout (390x844 and 844x390, touch) in headless Chromium: the top bar and the
# collapsed sheet leave the 3D view free, a tap opens and closes each panel, the level switcher cuts the
# building away, a furniture item is placed and then dragged, rotated, long-pressed, duplicated and deleted by
# touch, walk mode is entered and left, and held across the sheet is at the side. Ends with a screenshot (and
# <out>-landscape.png). Also: nothing is drawn while nothing moves (WebGL draw calls are counted), the canvas'
# pixel ratio is capped, every control has a name, and the web app manifest and its icons are served; finish
# textures are asked for in one size per device and compile no shader when they arrive.
# Exit 0 when every check passes.
# Read-only: every placement write is answered inside the browser (as the api would), every other write
# (photos, photo requests, settings, the home) is refused there. Uses the Playwright set-up of
# screenshot.sh. --home picks a home by id (default: the first one).
set -euo pipefail
script_dir=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
# shellcheck source=lib.sh
source "$script_dir/lib.sh"

usage() {
  sed -n '2,14s/^# \{0,1\}//p' "$0" >&2
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
out=${out:-${TMPDIR:-/tmp}/my-home-$SITE_ENV-mobile-$(date +%Y%m%d-%H%M%S).png}
[[ $out == /* ]] || out="$PWD/$out"
[[ $out == *.png ]] || die "--out must end in .png"

# Installs the pinned Playwright and Chromium if they are missing.
"$script_dir/screenshot.sh" --check >/dev/null
export MY_HOME_PLAYWRIGHT_DIR=${MY_HOME_PLAYWRIGHT_DIR:-${XDG_CACHE_HOME:-$HOME/.cache}/my-home-environments/playwright}
node_cmd=(node)
command -v ao-heavy >/dev/null 2>&1 && [[ ${AO_HEAVY_ACTIVE:-} != 1 ]] && node_cmd=(ao-heavy node)
"$script_dir/with-site-token.sh" "$SITE_ENV" -- "${node_cmd[@]}" "$script_dir/mobile-smoke.mjs" "$out" ${home:+"$home"}
