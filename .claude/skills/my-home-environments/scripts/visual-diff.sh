#!/usr/bin/env bash
# visual-diff.sh <staging|production> shoot --out DIR [--only VIEW]...
# visual-diff.sh compare DIR_A DIR_B
#
# Pixel-exact visual regression of the 3D view, read-only. `shoot` takes canvas-only screenshots
# (screenshot.sh --canvas) of a fixed set of views and writes DIR/<view>.png plus DIR/manifest.json (deployed
# commit, view arguments). `--only` shoots just the named views. Desktop 1440x900: default, the cutaway to each
# level, the default view orbited 180 degrees, a steep view; phone 390x844: default. Those pin ?quality=fast.
# The tiers (docs/design/realistic-render.md §11.3): default-beautiful (desktop) and phone-auto (the refined
# frame). The named views (§7.1), each in fast and in beautiful: cutaway-fast and cutaway-beautiful
# (?view=cutaway), section-fast and section-beautiful (?view=section, looking north through the middle),
# eye-fast and eye-beautiful (?view=eye in the kitchen, or the first room of a home without
# one). walk-fast is eye level in the first room of walk mode. All of these turn stepping down off
# (?stepdown=off): a software renderer is slow, and the tier asked for must be the tier shot. Every shot waits
# for the settled frame.
# The deployed commit is read before and after: a deploy in between fails the shoot (exit 1), shoot again.
# `compare` reports per view whether the PNGs are identical (sha256) or how many pixels differ, and writes
# DIR_B/diff-<view>.png for those (differing pixels red over a faded copy of A). The diff runs in headless
# Chromium, so no npm package is needed. Exit 0 all identical, 5 some differ, 1 on an error.
set -euo pipefail
script_dir=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
# shellcheck source=lib.sh
source "$script_dir/lib.sh"

usage() {
  sed -n '2,19s/^# \{0,1\}//p' "$0" >&2
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
phone
default-beautiful
walk-fast
phone-auto
cutaway-fast
cutaway-beautiful
section-fast
section-beautiful
eye-fast
eye-beautiful
EOF
}

# view_args <view>: sets the array ARGS for screenshot.sh.
view_args() {
  local base=(--viewport 1440x900 --path '/?hints=off&quality=fast')
  case "$1" in
    default) ARGS=("${base[@]}") ;;
    # Older deployments expose the level radios directly. With the compact HUD, open the picker first.
    souterrain) ARGS=("${base[@]}" --click-if-present '.hud-level-trigger' --click 'role=radio[name="Souterrain"s]') ;;
    ground-floor) ARGS=("${base[@]}" --click-if-present '.hud-level-trigger' --click 'role=radio[name="Ground floor"s]') ;;
    first-floor) ARGS=("${base[@]}" --click-if-present '.hud-level-trigger' --click 'role=radio[name="First floor (attic)"s]') ;;
    orbit-180) ARGS=("${base[@]}" --drag '600,0') ;;
    steep) ARGS=("${base[@]}" --drag '0,250') ;;
    phone) ARGS=(--viewport 390x844 --touch --path '/?hints=off&quality=fast') ;;
    default-beautiful) ARGS=(--viewport 1440x900 --path '/?hints=off&quality=beautiful&stepdown=off') ;;
    walk-fast) ARGS=(--viewport 1440x900 --path '/?walk=first&hints=off&quality=fast&stepdown=off') ;;
    phone-auto) ARGS=(--viewport 390x844 --touch --path '/?hints=off&quality=auto&stepdown=off') ;;
    cutaway-fast | cutaway-beautiful | section-fast | section-beautiful | eye-fast | eye-beautiful)
      local named=${1%-*}
      [[ $1 == eye-* ]] && named='eye&room=souterrain-kitchen'
      ARGS=(--viewport 1440x900 --path "/?view=$named&hints=off&quality=${1#*-}&stepdown=off")
      ;;
    *) die "unknown view '$1' (views: $(views | tr '\n' ' '))" ;;
  esac
}

# elapsed <start>: the seconds since <start> (from `date +%s.%N`), to a tenth.
elapsed() {
  awk -v a="$1" -v b="$(date +%s.%N)" 'BEGIN { printf "%.1f", b - a }'
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
  local start
  for view in "${selected[@]}"; do
    view_args "$view"
    start=$(date +%s.%N)
    log=$("$script_dir/screenshot.sh" "$SITE_ENV" --canvas --out "$out/$view.png" "${ARGS[@]}" 2>&1) ||
      die "screenshot of $view failed: $log"
    if ! grep -q '^errors none' <<<"$log"; then
      warn "$view logged errors:"
      sed -n '/^errors/,/^screenshot/p' <<<"$log" >&2
    fi
    manifest=$(jq -c --arg v "$view" --arg sha "$(sha256sum "$out/$view.png" | cut -d' ' -f1)" \
      '. + [{view: $v, args: $ARGS.positional, sha256: $sha}]' --args -- "${ARGS[@]}" <<<"$manifest")
    echo "  $view"
    # What the shot cost, and its parts (screenshot.mjs: launch, load, wait, settle, actions, shot).
    printf 'time  %s %s s\n' "$view" "$(elapsed "$start")"
    sed -n "s|^time  |time  $view/|p" <<<"$log"
  done
  after=$(deployed_commit)
  [[ $before == "$after" ]] || die "$SITE_ENV changed from $before to $after during the shoot; shoot again"
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
