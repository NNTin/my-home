#!/usr/bin/env bash
# walk-smoke.sh <staging|production> [--out file.png]
#
# Smoke test of walk mode on a phone-sized screen (390x844, touch) in headless Chromium: opens /?walk=first,
# pushes the pad (walks, turns, stops), checks the controls and the minimap fit without overlapping, that the
# minimap tracks the figure, then puts the figure at the stair from the enlarged map and walks it up: the map
# must switch level. Nothing may log an error, also when leaving walk mode (from the overview, opened by
# address, restored). Screenshots of the overview and the stair. Exit 0 when every check passes.
# Read-only: it takes no photo and changes nothing. Uses the Playwright set-up of screenshot.sh.
set -euo pipefail
script_dir=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
# shellcheck source=lib.sh
source "$script_dir/lib.sh"

usage() {
  sed -n '2,9s/^# \{0,1\}//p' "$0" >&2
  exit 2
}

[[ $# -ge 1 ]] || usage
resolve_env "$1"
shift
out=''
while [[ $# -gt 0 ]]; do
  [[ $# -ge 2 && $1 == --out ]] || usage
  out=$2
  shift 2
done
out=${out:-${TMPDIR:-/tmp}/my-home-$SITE_ENV-walk-$(date +%Y%m%d-%H%M%S).png}
[[ $out == /* ]] || out="$PWD/$out"

# Installs the pinned Playwright and Chromium if they are missing.
"$script_dir/screenshot.sh" --check >/dev/null
export MY_HOME_PLAYWRIGHT_DIR=${MY_HOME_PLAYWRIGHT_DIR:-${XDG_CACHE_HOME:-$HOME/.cache}/my-home-environments/playwright}
node_cmd=(node)
command -v ao-heavy >/dev/null 2>&1 && [[ ${AO_HEAVY_ACTIVE:-} != 1 ]] && node_cmd=(ao-heavy node)
"$script_dir/with-site-token.sh" "$SITE_ENV" -- "${node_cmd[@]}" "$script_dir/walk-smoke.mjs" "$out"
