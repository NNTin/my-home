#!/usr/bin/env bash
# Offline tests for measure.py: a synthetic camera (pose mode) projects known room edges, then the calibration
# modes must recover the camera and the points from those pixels. Run:
#   .claude/skills/my-home-photo-modelling/tests/measure.test.sh
# shellcheck disable=SC2317,SC2329 # the helpers below are invoked through check()
set -euo pipefail
scripts=$(cd "$(dirname "${BASH_SOURCE[0]}")/../scripts" && pwd)
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT
measure() { python3 -I "$scripts/measure.py" "$@"; }

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
# near <actual> <expected> <tolerance>
near() { awk -v a="$1" -v e="$2" -v t="$3" 'BEGIN { d = a - e; if (d < 0) d = -d; exit !(d <= t) }'; }
fails() { ! "$@" >/dev/null 2>&1; }

# Ground truth: camera at plan (5, -6), 1.45 m above the floor, heading 300, pitch -10, fovH 1.30 rad, portrait.
truth='{"image": {"width": 1920, "height": 2560}, "camera": {"heading": 300, "pitch": -10, "fovH": 1.30},
  "height": 1.45, "at": {"x": 5, "z": -6}}'
# Room edges: lines running north (x = 1, 2) and west (z = -9, -8), on the floor and at 2.4 m; a 2.0 m vertical
# edge at (2, -9); a floor point and a wall point to measure back.
jq -n --argjson t "$truth" '$t + {project: [
  ({x: 1, z: -7}, {x: 1, z: -9}, {x: 2, z: -7}, {x: 2, z: -9}) as $p | (0, 2.4) as $y | ($p + {y: $y, name: "n"}),
  ({x: 3, z: -9}, {x: 1, z: -9}, {x: 3, z: -8}, {x: 1, z: -8}) as $p | (0, 2.4) as $y | ($p + {y: $y, name: "w"}),
  {name: "edge-bottom", x: 2, y: 0, z: -9}, {name: "edge-top", x: 2, y: 2.0, z: -9},
  {name: "floor", x: 2, y: 0, z: -8}, {name: "wall", x: 1, y: 1.2, z: -8.5}]}' >"$work/truth.json"
measure "$work/truth.json" >"$work/projected.json"
px() { jq -c --arg n "$1" --argjson i "$2" '[.projected[] | select(.name == $n)][$i].px' "$work/projected.json"; }
# Projected order per direction: (end1, y0) (end1, y2.4) (end2, y0) (end2, y2.4) for each of the two edges.
seg() { # the four image segments of direction $1, each joining an edge's two ends
  jq -c --arg n "$1" '[.projected[] | select(.name == $n) | .px] as $a | [[$a[0], $a[2]], [$a[1], $a[3]], [$a[4], $a[6]], [$a[5], $a[7]]]' "$work/projected.json"
}
check "projection puts every point in front of the camera" \
  test "$(jq '[.projected[] | select(.px == null)] | length' "$work/projected.json")" = 0

points='[{"name": "floor", "px": '"$(px floor 0)"', "on": "floor"}, {"name": "wall", "px": '"$(px wall 0)"', "on": {"x": 1}}]'
fit='{"bottom": '"$(px edge-bottom 0)"', "top": '"$(px edge-top 0)"', "size": 2.0}'

# Two vanishing points from lines: focal length, heading, pitch, roll and the camera height.
jq -n --argjson n "$(seg n)" --argjson w "$(seg w)" --argjson pts "$points" --argjson fit "$fit" '{
  image: {width: 1920, height: 2560}, at: {x: 5, z: -6}, fitHeight: $fit, points: $pts,
  camera: {vps: [{lines: $n, heading: 0}, {lines: $w, heading: 270}]}}' >"$work/vps.json"
out=$(measure "$work/vps.json")
expected_f=$(awk 'BEGIN { printf "%.3f", 960 / (sin(0.65) / cos(0.65)) }')
check "two VPs recover the focal length" near "$(jq .camera.f <<<"$out")" "$expected_f" 1
check "two VPs recover fovH" near "$(jq .camera.fovHrad <<<"$out")" 1.30 0.001
check "two VPs recover the heading" near "$(jq .camera.heading <<<"$out")" 300 0.05
check "two VPs recover the pitch" near "$(jq .camera.pitch <<<"$out")" -10 0.05
check "two VPs: no roll" near "$(jq .camera.roll <<<"$out")" 0 0.05
check "fitHeight recovers the camera height" near "$(jq .height <<<"$out")" 1.45 0.002
check "a floor point lands at its plan position (x)" near "$(jq '.points[0].x' <<<"$out")" 2 0.005
check "a floor point lands at its plan position (z)" near "$(jq '.points[0].z' <<<"$out")" -8 0.005
check "a wall point gets its height" near "$(jq '.points[1].height' <<<"$out")" 1.2 0.005
check "a wall point gets its z" near "$(jq '.points[1].z' <<<"$out")" -8.5 0.005

# One vanishing point plus the known focal length (zero roll), and a fixed camera height.
jq -n --argjson w "$(seg w)" --argjson pts "$points" '{
  image: {width: 1920, height: 2560}, at: {x: 5, z: -6}, height: 1.45, points: $pts,
  camera: {vp: {lines: $w, heading: 270}, fovH: 1.30}}' >"$work/vp.json"
out=$(measure "$work/vp.json")
check "one VP + fovH recovers the heading" near "$(jq .camera.heading <<<"$out")" 300 0.05
check "one VP + fovH recovers the pitch" near "$(jq .camera.pitch <<<"$out")" -10 0.05
check "one VP: floor point" near "$(jq '.points[0].x' <<<"$out")" 2 0.005

# Errors: parallel lines, planes behind the camera, missing height.
jq -n '{image: {width: 100, height: 100}, height: 1, camera: {vp: {lines: [[[0, 0], [10, 0]], [[0, 5], [10, 5]]], heading: 0}, f: 50}}' >"$work/parallel.json"
check "parallel lines are an error" fails measure "$work/parallel.json"
jq -n '{image: {width: 100, height: 100}, height: 1.5, camera: {heading: 0, pitch: 0, fovH: 1.2},
  points: [{name: "sky", px: [50, 10], on: "floor"}]}' >"$work/behind.json"
check "a floor point above the horizon reports an error" test "$(measure "$work/behind.json" | jq -r '.points[0].error')" != null
jq -n '{image: {width: 100, height: 100}, camera: {heading: 0, pitch: 0, fovH: 1.2}, points: [{px: [50, 90]}]}' >"$work/noh.json"
check "points without a height fail" fails measure "$work/noh.json"
check "usage without a spec" fails measure

printf '\n%d passed, %d failed\n' "$pass" "$fail"
[[ $fail -eq 0 ]]
