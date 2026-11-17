#!/usr/bin/env bash
# screenshot.sh <staging|production> [--path /?home=...] [--out file.png] [--wait ms] [--viewport WxH] [--touch]
#               [--canvas] [--click <playwright selector>]... [--drag DX,DY]... [--pad DX,DY,MS]... [--key KEY,MS]...
# screenshot.sh --check
#
# Screenshots the 3D viewer in headless Chromium (Playwright, kept outside the repository in
# MY_HOME_PLAYWRIGHT_DIR, default ${XDG_CACHE_HOME:-$HOME/.cache}/my-home-environments/playwright; browsers in
# ~/.cache/ms-playwright). Waits for the canvas plus --wait ms (default 6000), then prints the final host,
# status, title and console/page errors. Default --out: ${TMPDIR:-/tmp}/my-home-<env>-<time>.png.
# --click and --drag run in the given order after the wait, each followed by a short settle: --click clicks a
# Playwright selector (e.g. 'label:has-text("Souterrain")'), --drag drags DX,DY pixels from the canvas centre
# (orbits the camera). For walk mode (--path '/?walk=first' or '/?walk=third'): --pad holds the movement pad
# deflected by DX,DY pixels (up to 44; up is negative DY and walks forward, left turns left) for MS
# milliseconds, and --key holds a key (w, a, s, d, q, e, ArrowUp, ...) for MS milliseconds.
# --touch emulates a phone (touch screen, coarse pointer); the phone layout also shows without it at phone
# sizes such as 390x844 or 844x390. Open a panel with --path '/?panel=furniture&sheet=full' (docs/mobile.md).
# --canvas shoots only the 3D canvas: every other element is hidden and the shot is clipped to the canvas, so UI
# text (photo count, room names, panels) is left out; after a --drag page time is paused and advanced by a fixed
# amount, so the shot does not depend on the frame rate. visual-diff.sh uses it.
# The site token is attached only to requests for the environment's own host and is never printed.
# --check installs Playwright if missing and reports its version, the Chromium path and a headless launch.
set -euo pipefail
script_dir=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
# shellcheck source=lib.sh
source "$script_dir/lib.sh"

PLAYWRIGHT_VERSION=1.65.1
MY_HOME_PLAYWRIGHT_DIR=${MY_HOME_PLAYWRIGHT_DIR:-${XDG_CACHE_HOME:-$HOME/.cache}/my-home-environments/playwright}
export MY_HOME_PLAYWRIGHT_DIR

usage() {
  sed -n '2,21s/^# \{0,1\}//p' "$0" >&2
  exit 2
}

# Node and npm are heavy here: run them in the shared AO queue when it exists (ao-heavy is reentrant).
heavy() {
  if command -v ao-heavy >/dev/null 2>&1 && [[ ${AO_HEAVY_ACTIVE:-} != 1 ]]; then
    ao-heavy "$@"
  else
    "$@"
  fi
}

# ensure_playwright: the pinned playwright package and its Chromium; installs them only when missing.
ensure_playwright() {
  local pkg="$MY_HOME_PLAYWRIGHT_DIR/node_modules/playwright/package.json" installed
  installed=$(jq -r '.version // empty' "$pkg" 2>/dev/null || true)
  if [[ $installed != "$PLAYWRIGHT_VERSION" ]]; then
    warn "installing playwright $PLAYWRIGHT_VERSION into $MY_HOME_PLAYWRIGHT_DIR (found: ${installed:-none})"
    mkdir -p "$MY_HOME_PLAYWRIGHT_DIR"
    [[ -f $MY_HOME_PLAYWRIGHT_DIR/package.json ]] || printf '{ "private": true }\n' >"$MY_HOME_PLAYWRIGHT_DIR/package.json"
    (cd "$MY_HOME_PLAYWRIGHT_DIR" &&
      heavy npm install --save-exact --no-audit --no-fund "playwright@$PLAYWRIGHT_VERSION" >&2)
  fi
  if ! (cd "$MY_HOME_PLAYWRIGHT_DIR" &&
    node -e 'process.exit(require("fs").existsSync(require("playwright").chromium.executablePath()) ? 0 : 1)'); then
    warn "installing Chromium for playwright $PLAYWRIGHT_VERSION into ~/.cache/ms-playwright"
    (cd "$MY_HOME_PLAYWRIGHT_DIR" && heavy node_modules/.bin/playwright install chromium >&2)
  fi
}

require_tools node jq
if [[ ${1:-} == --check ]]; then
  ensure_playwright
  heavy node "$script_dir/screenshot.mjs" --check
  exit
fi

[[ $# -ge 1 ]] || usage
resolve_env "$1"
shift
target=/ out='' wait_ms=6000 viewport=1440x900 actions='[]' touch='' canvas=''
while [[ $# -gt 0 ]]; do
  if [[ $1 == --touch ]]; then
    touch='touch'
    shift
    continue
  fi
  if [[ $1 == --canvas ]]; then
    canvas='canvas'
    shift
    continue
  fi
  [[ $# -ge 2 ]] || usage
  case "$1" in
    --path) target=$2 ;;
    --out) out=$2 ;;
    --wait) wait_ms=$2 ;;
    --viewport) viewport=$2 ;;
    --click) actions=$(jq -c --arg s "$2" '. + [{click: $s}]' <<<"$actions") ;;
    --drag)
      [[ $2 =~ ^-?[0-9]+,-?[0-9]+$ ]] || die "--drag must be DX,DY in pixels, e.g. -300,0"
      actions=$(jq -c --arg d "$2" '. + [{drag: ($d | split(",") | map(tonumber))}]' <<<"$actions")
      ;;
    --pad)
      [[ $2 =~ ^-?[0-9]+,-?[0-9]+,[0-9]+$ ]] || die "--pad must be DX,DY,MS, e.g. 0,-44,2000"
      actions=$(jq -c --arg d "$2" '. + [{pad: ($d | split(",") | map(tonumber))}]' <<<"$actions")
      ;;
    --key)
      [[ $2 =~ ^[A-Za-z]+,[0-9]+$ ]] || die "--key must be KEY,MS, e.g. w,1500"
      actions=$(jq -c --arg d "$2" '. + [{key: ($d | split(",") | [.[0], (.[1] | tonumber)])}]' <<<"$actions")
      ;;
    *) usage ;;
  esac
  shift 2
done
[[ $target == /* ]] || target="/$target"
[[ $wait_ms =~ ^[0-9]+$ ]] || die "--wait must be milliseconds"
[[ $viewport =~ ^([0-9]+)x([0-9]+)$ ]] || die "--viewport must be WxH, e.g. 1440x900"
width=${BASH_REMATCH[1]} height=${BASH_REMATCH[2]}
out=${out:-${TMPDIR:-/tmp}/my-home-$SITE_ENV-$(date +%Y%m%d-%H%M%S).png}
[[ $out == /* ]] || out="$PWD/$out"

ensure_playwright
node_cmd=(node)
command -v ao-heavy >/dev/null 2>&1 && [[ ${AO_HEAVY_ACTIVE:-} != 1 ]] && node_cmd=(ao-heavy node)
"$script_dir/with-site-token.sh" "$SITE_ENV" -- \
  "${node_cmd[@]}" "$script_dir/screenshot.mjs" "$out" "$target" "$wait_ms" "$width" "$height" "$actions" "$touch" "$canvas"
