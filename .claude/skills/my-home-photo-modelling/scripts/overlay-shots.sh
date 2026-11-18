#!/usr/bin/env bash
# overlay-shots.sh <staging|production> [--out DIR] [--home ID] [--viewport WxH] [--opacity 0.1-1] <photo-id>...
#
# "View from here" for each photo, shot twice in headless Chromium: the model alone (<id8>-model.png) and with
# the photo laid over it (<id8>-overlay.png, default opacity 0.5). Read-only. Default viewport 1440x1080: below
# about 900 px wide the phone layout's sheet covers half the view. The shots go to --out (default: a new
# mktemp -d; never the repository) and contain the photo, so delete them when done like the photos themselves.
# Uses my-home-environments' Playwright install (screenshot.sh --check installs it) and runs in ao-heavy.
set -euo pipefail
script_dir=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
env_scripts=$script_dir/../../my-home-environments/scripts
repo_root=$(cd "$script_dir/../../../.." && pwd -P)
MY_HOME_PLAYWRIGHT_DIR=${MY_HOME_PLAYWRIGHT_DIR:-${XDG_CACHE_HOME:-$HOME/.cache}/my-home-environments/playwright}
export MY_HOME_PLAYWRIGHT_DIR

die() {
  printf '%s: %s\n' "${0##*/}" "$*" >&2
  exit 1
}
usage() {
  sed -n '2,8s/^# \{0,1\}//p' "$0" >&2
  exit 2
}

[[ $# -ge 1 ]] || usage
env=$1
shift
out='' home=home viewport=1440x1080 opacity=0.5 ids=()
while [[ $# -gt 0 ]]; do
  case $1 in
    --out) out=${2:?--out needs a directory} && shift 2 ;;
    --home) home=${2:?--home needs an id} && shift 2 ;;
    --viewport) viewport=${2:?--viewport needs WxH} && shift 2 ;;
    --opacity) opacity=${2:?--opacity needs a value} && shift 2 ;;
    -*) usage ;;
    *) ids+=("$1") && shift ;;
  esac
done
[[ ${#ids[@]} -gt 0 ]] || die "give at least one photo id"
[[ $viewport =~ ^([0-9]+)x([0-9]+)$ ]] || die "--viewport must look like 1440x1080"
width=${BASH_REMATCH[1]} height=${BASH_REMATCH[2]}
[[ $opacity =~ ^(0\.[1-9][0-9]*|1(\.0+)?)$ ]] || die "--opacity must be between 0.1 and 1"
[[ -f $MY_HOME_PLAYWRIGHT_DIR/node_modules/playwright/package.json ]] ||
  die "Playwright is not installed: run $env_scripts/screenshot.sh --check first"
command -v node >/dev/null 2>&1 || die "missing dependency: node"

if [[ -n $out ]]; then
  out=$(realpath -m "$out")
  case "$out/" in
    "$(realpath -m "$repo_root")"/*) die "refusing to write photo overlays into the repository ($out)" ;;
  esac
  mkdir -p "$out"
else
  out=$(mktemp -d "${TMPDIR:-/tmp}/my-home-overlay.XXXXXX")
fi

run=(node "$script_dir/overlay-shots.mjs" "$out" "$home" "$width" "$height" "$opacity" "${ids[@]}")
# Chromium with SwiftShader is heavy: share the AO queue when it exists (ao-heavy is reentrant).
if command -v ao-heavy >/dev/null 2>&1 && [[ ${AO_HEAVY_ACTIVE:-} != 1 ]]; then
  run=(ao-heavy "${run[@]}")
fi
"$env_scripts/with-site-token.sh" "$env" -- "${run[@]}"
printf 'shots in %s (they contain the photos: rm -rf %s when done)\n' "$out" "$out"
