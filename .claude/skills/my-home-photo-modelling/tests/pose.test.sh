#!/usr/bin/env bash
# Offline tests for pose.sh: site-curl.sh is stubbed (it answers one photo and its pose history and logs every
# request), nothing touches the network. Run:
#   .claude/skills/my-home-photo-modelling/tests/pose.test.sh
# shellcheck disable=SC2317,SC2329 # the helpers below are invoked through check()
set -euo pipefail
scripts=$(cd "$(dirname "${BASH_SOURCE[0]}")/../scripts" && pwd)
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT
pose() { "$scripts/pose.sh" "$@"; }

id=3f24cf70-ec02-4724-bb2c-c02dcb21c046
change=11111111-2222-4333-8444-555555555555
cat >"$work/site-curl" <<'STUB'
#!/usr/bin/env bash
set -euo pipefail
printf '%s\n' "$*" >>"$STUB_LOG"
path=$2
shift 2
method=GET body=''
while [[ $# -gt 0 ]]; do
  case $1 in
    -X) method=$2 && shift 2 ;;
    --json) body=$2 && shift 2 ;;
    *) shift ;;
  esac
done
[[ -z $body ]] || printf '%s\n' "$body" >"$STUB_BODY"
case "$method $path" in
  "GET /api/photos/"*/pose-history)
    echo '{"items":[{"id":"11111111-2222-4333-8444-555555555555","at":"2026-11-18T17:00:00.000Z","actor":"agent",
      "before":{"position":{"x":1,"y":-1,"z":2},"yaw":-1.5,"pitch":-0.25,"fovH":0.9617},
      "after":{"position":{"x":1,"y":-1,"z":2},"yaw":-1.59,"pitch":-0.22,"fovH":1.0614},
      "reason":"test","undoesId":null,"canUndo":true}]}' ;;
  "GET /api/photos/"*)
    echo '{"id":"x","pose":{"position":{"x":1,"y":-1,"z":2},"yaw":-1.5,"pitch":-0.25,"fovH":0.9617},
      "sensors":{"source":"manual"}}' ;;
  "PATCH /api/photos/"*) echo '{}' ;;
  "POST /api/photos/"*/undo)
    echo '{"change":{"id":"99999999-2222-4333-8444-555555555555"},"photo":{"pose":{"yaw":-1.5,"pitch":-0.25,"fovH":0.9617}}}' ;;
  *) exit 22 ;;
esac
STUB
chmod +x "$work/site-curl"
export SITE_CURL="$work/site-curl" STUB_LOG="$work/log" STUB_BODY="$work/body"

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
near() { awk -v a="$1" -v e="$2" -v t="$3" 'BEGIN { d = a - e; if (d < 0) d = -d; exit !(d <= t) }'; }
fails() { ! "$@" >/dev/null 2>&1; }
sent() { jq -r "$1" "$STUB_BODY"; }
reset() { : >"$STUB_LOG" && rm -f "$STUB_BODY"; }

# From measure.py output: yaw, pitch and fovH of camera.pose; the position stays, the sensors are never sent.
jq -n '{camera: {f: 1628, pose: {yaw: -1.5892, pitch: -0.2202, fovH: 1.0656}}}' >"$work/measure.json"
reset
out=$(pose staging set "$id" --from "$work/measure.json" --reason "measure.py: corridor VP + verticals")
check "set PATCHes the photo" grep -q "^staging /api/photos/$id -X PATCH --json" "$STUB_LOG"
check "set sends only the pose and the reason" test "$(sent 'keys | join(",")')" = "pose,poseReason"
check "set takes yaw from measure.py" near "$(sent .pose.yaw)" -1.5892 1e-9
check "set takes pitch from measure.py" near "$(sent .pose.pitch)" -0.2202 1e-9
check "set takes fovH from measure.py" near "$(sent .pose.fovH)" 1.0656 1e-9
check "set keeps the position" test "$(jq -c .pose.position "$STUB_BODY")" = '{"x":1,"y":-1,"z":2}'
check "set records the reason" test "$(sent .poseReason)" = "measure.py: corridor VP + verticals"
check "set prints before and after" grep -q "before: x 1 z 2 heading 85.9° pitch -14.3° fovH 55.1°" <<<"$out"
check "set names the recorded change" grep -q "recorded change $change as agent" <<<"$out"

# Flags alone, in degrees: heading 90 (east) is yaw -pi/2; only the given fields change.
reset
pose staging set "$id" --heading-deg 90 --reason "by hand" >/dev/null
check "--heading-deg turns clockwise into a yaw" near "$(sent .pose.yaw)" -1.570796 1e-6
check "fields not given stay" near "$(sent .pose.fovH)" 0.9617 1e-9
reset
pose staging set "$id" --fovh-deg 60.8 --pitch-deg -12.6 --reason "by hand" >/dev/null
check "--fovh-deg" near "$(sent .pose.fovH)" 1.061160 1e-6
check "--pitch-deg" near "$(sent .pose.pitch)" -0.219911 1e-6
reset
pose staging set "$id" --from "$work/measure.json" --fovh 1.0614 --reason "fovH recomputed" >/dev/null
check "flags override --from" near "$(sent .pose.fovH)" 1.0614 1e-9
pose staging set "$id" --x 3.25 --z -6.5 --reason "refitted layout" >/dev/null
check "--x/--z move the position, y stays" test "$(jq -c .pose.position "$STUB_BODY")" = '{"x":3.25,"y":-1,"z":-6.5}'
check "--x/--z keep the angles" near "$(sent .pose.yaw)" -1.5 1e-9
pose staging set "$id" --z -6.5 --reason "refitted layout" >/dev/null
check "--z alone keeps x" test "$(jq -c .pose.position "$STUB_BODY")" = '{"x":1,"y":-1,"z":-6.5}'
check "--x needs a number" bash -c "! '$scripts/pose.sh' staging set $id --x east --reason r 2>/dev/null"
check "a yaw beyond pi is normalised" bash -c "'$scripts/pose.sh' staging set $id --yaw 4 --reason r >/dev/null &&
  jq -e '.pose.yaw | . > -3.15 and . < -2.28' '$STUB_BODY' >/dev/null"

# --dry-run sends nothing.
reset
out=$(pose staging set "$id" --fovh 1.0614 --reason "dry" --dry-run)
check "--dry-run only reads" test "$(grep -c PATCH "$STUB_LOG" || true)" = 0
check "--dry-run prints the body" grep -q '"poseReason":"dry"' <<<"$out"

# History and undo.
out=$(pose staging history "$id")
check "history lists the change with its actor" grep -q $'agent\tx 1 z 2 h 85.9 p -14.3 f 55.1 -> x 1 z 2 h 91.1 p -12.6 f 60.8\ttest\tcan undo' <<<"$out"
reset
pose staging undo "$id" "$change" >/dev/null
check "undo POSTs to the change's undo" grep -q "^staging /api/photos/$id/pose-history/$change/undo -X POST" "$STUB_LOG"

# Refusals.
check "set needs a reason" fails pose staging set "$id" --fovh 1
check "set needs something to set" fails pose staging set "$id" --reason r
check "a pitch beyond the vertical is refused" fails pose staging set "$id" --pitch 2 --reason r
check "fovH must be below pi" fails pose staging set "$id" --fovh 3.2 --reason r
check "numbers only" fails pose staging set "$id" --yaw east --reason r
check "--from without a pose" bash -c "echo '{}' >'$work/empty.json'; ! '$scripts/pose.sh' staging set $id --from '$work/empty.json' --reason r 2>/dev/null"
check "undo needs a change id" fails pose staging undo "$id" not-an-id
check "unknown environment" fails pose dev set "$id" --fovh 1 --reason r
check "no delete command" fails pose staging delete "$id"
check "never a DELETE request" test "$(grep -c -- '-X DELETE' "$STUB_LOG" || true)" = 0

printf '\n%d passed, %d failed\n' "$pass" "$fail"
[[ $fail -eq 0 ]]
