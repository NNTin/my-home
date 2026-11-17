#!/usr/bin/env bash
# camera-smoke.sh <staging|production> [--out file.png]
#
# Smoke test of taking a photo in walk mode on a phone-sized screen (390x844, touch) in headless Chromium with
# a FAKE camera: the camera inside the page (viewfinder, shutter, full-size frame), the fallback to the phone's
# camera app and gallery when the camera is not allowed, and the way back into walk mode after the browser
# reloaded the page while the camera app was open. Every upload is checked to be a valid request (multipart
# "meta" JSON with a pose, a JPEG "image") and is then answered in the browser. Exit 0 when every check passes.
# Read-only: nothing is stored, changed or deleted on the environment.
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
out=${out:-${TMPDIR:-/tmp}/my-home-$SITE_ENV-camera-$(date +%Y%m%d-%H%M%S).png}
[[ $out == /* ]] || out="$PWD/$out"
[[ $out == *.png ]] || die "--out must end in .png"

# Installs the pinned Playwright and Chromium if they are missing.
"$script_dir/screenshot.sh" --check >/dev/null
export MY_HOME_PLAYWRIGHT_DIR=${MY_HOME_PLAYWRIGHT_DIR:-${XDG_CACHE_HOME:-$HOME/.cache}/my-home-environments/playwright}
node_cmd=(node)
command -v ao-heavy >/dev/null 2>&1 && [[ ${AO_HEAVY_ACTIVE:-} != 1 ]] && node_cmd=(ao-heavy node)
"$script_dir/with-site-token.sh" "$SITE_ENV" -- "${node_cmd[@]}" "$script_dir/camera-smoke.mjs" "$out"
