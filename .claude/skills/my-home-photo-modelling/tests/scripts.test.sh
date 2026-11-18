#!/usr/bin/env bash
# Offline tests for fetch.sh, grid.sh, overlay-shots.sh (argument checks only) and tools.sh: photos.sh and
# ImageMagick are stubbed, nothing touches the network. Run:
#   .claude/skills/my-home-photo-modelling/tests/scripts.test.sh
# shellcheck disable=SC2317,SC2329 # the helpers below are invoked through check()
set -euo pipefail
scripts=$(cd "$(dirname "${BASH_SOURCE[0]}")/../scripts" && pwd)
repo=$(cd "$scripts/../../../.." && pwd)
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT

# photos.sh stub: list answers two photos, download writes <id>.webp and <id>.json into --dir.
cat >"$work/photos.sh" <<'STUB'
#!/usr/bin/env bash
set -euo pipefail
printf '%s\n' "$*" >>"$STUB_LOG"
shift # env
cmd=$1
shift
case $cmd in
  list) echo '[{"id":"aaaaaaaa-1"},{"id":"bbbbbbbb-2"}]' ;;
  download)
    dir=''
    ids=()
    while [[ $# -gt 0 ]]; do
      case $1 in
        --dir) dir=$2 && shift 2 ;;
        --home) shift 2 ;;
        *) ids+=("$1") && shift ;;
      esac
    done
    for id in "${ids[@]}"; do
      printf 'webp' >"$dir/$id.webp"
      jq -n --arg id "$id" '{id: $id, capturedRoomName: "Corridor",
        pose: {position: {x: 3.8595, y: -1, z: -6.109}, yaw: -1.5707963, pitch: -0.2475, fovH: 0.9617745},
        sensors: {source: "manual"}, image: {width: 1920, height: 2560}}' >"$dir/$id.json"
    done
    ;;
  *) exit 9 ;;
esac
STUB
# convert stub: logs its arguments and creates the output file (the last argument).
cat >"$work/convert" <<'STUB'
#!/usr/bin/env bash
printf '%s\n' "$*" >>"$CONVERT_LOG"
for last; do :; done
printf 'img' >"$last"
STUB
printf '#!/usr/bin/env bash\necho "400 300"\n' >"$work/identify"
chmod +x "$work/photos.sh" "$work/convert" "$work/identify"
export MY_HOME_PHOTOS_SH="$work/photos.sh" MY_HOME_CONVERT="$work/convert" MY_HOME_IDENTIFY="$work/identify"
export STUB_LOG="$work/log" CONVERT_LOG="$work/convert.log" TMPDIR="$work" MY_HOME_GRID_FONT="$work/font.ttf"
: >"$MY_HOME_GRID_FONT"

pass=0 fail=0
check() {
  local name=$1
  shift
  if "$@"; then
    pass=$((pass + 1))
    printf 'ok    %s\n' "$name"
  else
    fail=$((fail + 1))
    printf 'FAIL  %s\n' "$name"
  fi
}
fails() { ! "$@" >/dev/null 2>&1; }
has() { grep -qF -- "$2" <<<"$1"; }

# fetch.sh
out=$("$scripts/fetch.sh" staging --dir "$work/p" --grid aaaaaaaa-1)
check "fetch downloads into the given directory" test -f "$work/p/aaaaaaaa-1.webp"
check "fetch converts to JPEG" test -f "$work/p/aaaaaaaa-1.jpg"
check "fetch draws the grid with --grid" test -f "$work/p/aaaaaaaa-1.grid.png"
check "fetch prints heading in degrees clockwise from north" has "$out" $'aaaaaaaa\tCorridor\t3.86\t-6.11\t90\t-14\t55\tmanual\t1920x2560'
check "fetch says where the photos are and to delete them" has "$out" "rm -rf $work/p"
out=$("$scripts/fetch.sh" staging -- --near 3,-6,2)
check "fetch with filters lists, then downloads every match" has "$(cat "$STUB_LOG")" "staging list --near 3,-6,2"
check "fetch with filters prints both photos" has "$out" $'bbbbbbbb\tCorridor'
check "fetch defaults to a new temp dir" has "$out" "photos in $work/my-home-photos."
check "fetch refuses a directory inside the repository" fails "$scripts/fetch.sh" staging --dir "$repo/tmp-photos" aaaaaaaa-1
check "fetch refused before creating anything in the repository" test ! -e "$repo/tmp-photos"
check "fetch needs ids or filters" fails "$scripts/fetch.sh" staging
check "fetch rejects a bad --size" fails "$scripts/fetch.sh" staging --size big aaaaaaaa-1

# grid.sh
: >"$CONVERT_LOG"
printf 'x' >"$work/in.webp"
"$scripts/grid.sh" "$work/in.webp" "$work/g.png" --step 100 >/dev/null
log=$(cat "$CONVERT_LOG")
check "grid draws a line every step" has "$log" "line 100,0 100,300"
check "grid draws every fifth line red" has "$log" "-stroke red -draw line 0,0 0,300"
check "grid labels in original pixels" has "$log" "text 4,18 '0,0'"
check "grid uses the explicit font" has "$log" "-font $work/font.ttf"
: >"$CONVERT_LOG"
"$scripts/grid.sh" "$work/in.webp" "$work/c.png" --crop 200x100+700+1200 --zoom 200 >/dev/null
log=$(cat "$CONVERT_LOG")
check "grid crops before drawing" has "$log" "-crop 200x100+700+1200 +repage -resize 200%"
check "grid labels a crop with original coordinates" has "$log" "'700,1200'"
check "grid scales lines with the zoom" has "$log" "line 200,0 200,200"
check "grid rejects a malformed crop" fails "$scripts/grid.sh" "$work/in.webp" "$work/x.png" --crop 10x10
check "grid needs an existing image" fails "$scripts/grid.sh" "$work/missing.webp" "$work/x.png"

# overlay-shots.sh: argument checks only (no browser in this test)
check "overlay-shots needs photo ids" fails "$scripts/overlay-shots.sh" staging
check "overlay-shots rejects a bad viewport" fails "$scripts/overlay-shots.sh" staging --viewport big abc
check "overlay-shots rejects an opacity out of range" fails "$scripts/overlay-shots.sh" staging --opacity 2 abc
missing=$(MY_HOME_PLAYWRIGHT_DIR="$work/none" "$scripts/overlay-shots.sh" staging abc 2>&1 || true)
check "overlay-shots explains a missing Playwright" has "$missing" "screenshot.sh --check"

# tools.sh
check "tools.sh without a command prints its usage" fails "$scripts/tools.sh"

printf '\n%d passed, %d failed\n' "$pass" "$fail"
[[ $fail -eq 0 ]]
