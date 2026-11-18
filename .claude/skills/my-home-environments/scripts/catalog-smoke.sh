#!/usr/bin/env bash
# catalog-smoke.sh <staging|production> [--out file.png] [--home ID]
#
# Smoke test of the catalogue pages in headless Chromium, at 1440x900 and at 390x844 with touch (and
# 844x390 for sideways scrolling): the top-bar or control-panel entry opens /catalog, both kinds are
# shown with use counts and rendered thumbnails (kept in the Cache Storage), search filters, a card
# opens its piece page, the back button returns to /catalog and then to /, and a deep link to
# /catalog/furniture/furniture.bed loads in a fresh browser and survives a reload. Every type's
# piece page draws in 3D with dimension labels in cm, openings have a section with frame (and glass)
# rectangles, and the playground changes the bed's colour and width live. Also: no console or page
# errors, every control has a name, nothing scrolls sideways on the phone, the inspector is usable
# at 844x390, and /?focus=<a window of the home> selects it (chip with its name and piece page link).
# Uses: where-used, Place (faked), and only where mock-home exists (staging, never production) a real
# mock-home frame-colour edit undone again: the only writes.
# Screenshots: <out>, <out>-phone.png, <out>-{window,window-section,door,bed,focus,uses,history,place}.png
# and the same with -phone. Exit 0 when every check passes. Every other write is refused inside the
# browser. Uses the Playwright set-up of screenshot.sh. --home picks a home by id (?home=).
set -euo pipefail
script_dir=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
# shellcheck source=lib.sh
source "$script_dir/lib.sh"

usage() {
  sed -n '2,17s/^# \{0,1\}//p' "$0" >&2
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
