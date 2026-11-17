#!/usr/bin/env bash
# visual-diff.sh <staging|production> shoot --out DIR [--only VIEW]...
# visual-diff.sh compare DIR_A DIR_B
#
# Pixel-exact visual regression of the 3D view, read-only. `shoot` takes canvas-only screenshots
# (screenshot.sh --canvas) of a fixed set of views and writes DIR/<view>.png plus DIR/manifest.json (deployed
# commit, view arguments). `--only` shoots just the named views. Desktop 1440x900: default, the cutaway to each
# level, the default view orbited 180 degrees, a steep view and the mock home; phone 390x844: default.
# The deployed commit is read before and after: a deploy in between fails the shoot (exit 1), shoot again.
# `compare` reports per view whether the PNGs are identical (sha256) or how many pixels differ, and writes
# DIR_B/diff-<view>.png for those (differing pixels red over a faded copy of A). The diff runs in headless
# Chromium, so no npm package is needed. Exit 0 all identical, 5 some differ, 1 on an error.
set -euo pipefail
script_dir=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
# shellcheck source=lib.sh
source "$script_dir/lib.sh"

usage() {
  sed -n '2,12s/^# \{0,1\}//p' "$0" >&2
  exit 1
}

# The view names, in shooting order; view_args gives each one's screenshot.sh arguments.
views() {
  cat <<'EOF'
default
souterrain
ground-floor
first-floor
orbit-180
steep
mock-home
phone
EOF
}

# view_args <view>: sets the array ARGS for screenshot.sh.
view_args() {
  local base=(--viewport 1440x900 --path '/?hints=off')
  case "$1" in
    default) ARGS=("${base[@]}") ;;
    souterrain) ARGS=("${base[@]}" --click 'label:has-text("Souterrain")') ;;
    ground-floor) ARGS=("${base[@]}" --click 'label:has-text("Ground floor")') ;;
    first-floor) ARGS=("${base[@]}" --click 'label:has-text("First floor")') ;;
    orbit-180) ARGS=("${base[@]}" --drag '600,0') ;;
    steep) ARGS=("${base[@]}" --drag '0,250') ;;
    mock-home) ARGS=(--viewport 1440x900 --path '/?home=mock-home&hints=off') ;;
    phone) ARGS=(--viewport 390x844 --touch --path '/?hints=off') ;;
    *) die "unknown view '$1' (views: $(views | tr '\n' ' '))" ;;
  esac
}

deployed_commit() {
  "$script_dir/site-curl.sh" "$SITE_ENV" /api/health/live | jq -r '.commit // empty'
}

shoot() {
  local out='' only=()
  while [[ $# -gt 0 ]]; do
    [[ $# -ge 2 ]] || usage
    case "$1" in
      --out) out=$2 ;;
      --only) only+=("$2") ;;
      *) usage ;;
    esac
    shift 2
  done
  [[ -n $out ]] || usage
  mkdir -p "$out"
  local selected=() view
  if [[ ${#only[@]} -gt 0 ]]; then
    for view in "${only[@]}"; do
      view_args "$view"
      selected+=("$view")
    done
  else
    mapfile -t selected < <(views)
  fi

  local before after manifest='[]' log
  before=$(deployed_commit)
  [[ -n $before ]] || die "no commit from /api/health/live on $SITE_ENV"
  echo "shooting ${#selected[@]} views of $SITE_ENV at commit $before into $out"
  for view in "${selected[@]}"; do
    view_args "$view"
    log=$("$script_dir/screenshot.sh" "$SITE_ENV" --canvas --out "$out/$view.png" "${ARGS[@]}" 2>&1) ||
      die "screenshot of $view failed: $log"
    if ! grep -q '^errors none' <<<"$log"; then
      warn "$view logged errors:"
      sed -n '/^errors/,/^screenshot/p' <<<"$log" >&2
    fi
    manifest=$(jq -c --arg v "$view" --arg sha "$(sha256sum "$out/$view.png" | cut -d' ' -f1)" \
      '. + [{view: $v, args: $ARGS.positional, sha256: $sha}]' --args -- "${ARGS[@]}" <<<"$manifest")
    echo "  $view"
  done
  after=$(deployed_commit)
  [[ $before == "$after" ]] || die "staging changed from $before to $after during the shoot; shoot again"
  jq -n --arg env "$SITE_ENV" --arg commit "$before" --arg at "$(date -u +%FT%TZ)" --argjson views "$manifest" \
    '{env: $env, commit: $commit, shotAt: $at, views: $views}' >"$out/manifest.json"
  echo "manifest $out/manifest.json"
}

compare() {
  [[ $# -eq 2 ]] || usage
  local a=$1 b=$2
  [[ -f $a/manifest.json && -f $b/manifest.json ]] || die "both directories need a manifest.json (shoot first)"
  # shellcheck disable=SC2016 # jq program
  jq -r '"A: \(.env) \(.commit) (\(.shotAt))"' "$a/manifest.json"
  # shellcheck disable=SC2016
  jq -r '"B: \(.env) \(.commit) (\(.shotAt))"' "$b/manifest.json"
  local pairs='[]' view
  while read -r view; do
    [[ -f $a/$view.png && -f $b/$view.png ]] || die "$view.png is missing in $a or $b"
    pairs=$(jq -c --arg v "$view" --arg a "$a/$view.png" --arg b "$b/$view.png" --arg d "$b/diff-$view.png" \
      '. + [{view: $v, a: $a, b: $b, diff: $d}]' <<<"$pairs")
  done < <(jq -r '.views[].view' "$a/manifest.json")
  ensure_playwright_from_screenshot
  local node_cmd=(node)
  command -v ao-heavy >/dev/null 2>&1 && [[ ${AO_HEAVY_ACTIVE:-} != 1 ]] && node_cmd=(ao-heavy node)
  MY_HOME_PLAYWRIGHT_DIR=${MY_HOME_PLAYWRIGHT_DIR:-${XDG_CACHE_HOME:-$HOME/.cache}/my-home-environments/playwright} \
    "${node_cmd[@]}" "$script_dir/visual-diff.mjs" "$pairs"
}

# Playwright is installed by screenshot.sh (--check installs it when missing).
ensure_playwright_from_screenshot() {
  "$script_dir/screenshot.sh" --check >/dev/null || die "playwright is not usable (screenshot.sh --check)"
}

require_tools jq sha256sum
case "${1:-}" in
  compare)
    shift
    require_tools node
    compare "$@"
    ;;
  staging | stg | production | prod)
    resolve_env "$1"
    [[ ${2:-} == shoot ]] || usage
    shift 2
    shoot "$@"
    ;;
  *) usage ;;
esac
