#!/usr/bin/env bash
# Offline tests for uses.sh: site-curl.sh is stubbed, nothing touches the network.
# Run: .claude/skills/my-home-environments/tests/uses.test.sh
# shellcheck disable=SC2317,SC2329 # the helpers below are invoked through check()
set -euo pipefail
scripts=$(cd "$(dirname "${BASH_SOURCE[0]}")/../scripts" && pwd)
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT

# The stub logs every call as "<env> <path> <args...>" and answers from canned JSON.
cat >"$work/site-curl" <<'STUB'
#!/usr/bin/env bash
set -euo pipefail
printf '%s\n' "$*" >>"$STUB_LOG"
path=$2
bed='{"id":"souterrain-bed-1","typeId":"furniture.bed","name":"Bedroom · Bed","source":"db","version":3,
  "overrides":{"color":"#112233","width":1.8},"removedAt":null}'
window='{"id":"souterrain-kitchen-window","typeId":"window.casement","source":"git","version":0,"overrides":{}}'
case "$path" in
  /api/homes) echo '{"items":[{"id":"home"},{"id":"mock-home"}]}' ;;
  /api/whoami) echo '{"username":"nntin-bot","actor":"agent","actorSource":"identity"}' ;;
  /api/catalog/types) echo '{"items":[{"id":"furniture.bed"}]}' ;;
  */uses | */uses\?*) jq -nc --argjson b "$bed" --argjson w "$window" '{items: [$w, $b]}' ;;
  */placements\?include=removed) jq -nc --argjson b "$bed" \
    '{items: [($b | del(.source, .overrides)), {id: "souterrain-chair-1", removedAt: "2026-11-17T00:00:00Z",
      purgeAt: "2026-12-17T00:00:00Z", version: 2}]}' ;;
  */history) echo '{"items":[{"id":"e1","action":"update","changes":[{"text":"width 160.0 cm → 180.0 cm"}],"canUndo":true}]}' ;;
  *) echo '{"ok":true}' ;;
esac
STUB
chmod +x "$work/site-curl"
export SITE_CURL="$work/site-curl" STUB_LOG="$work/log"

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
logged() { grep -qF -- "$1" "$STUB_LOG"; }
fails() { ! "$@" 2>/dev/null; }
reset() { : >"$STUB_LOG"; }
u="$scripts/uses.sh"

reset
out=$("$u" staging whoami)
check "whoami prints the recorded actor" test "$(jq -r .actor <<<"$out")" = agent
check "requests declare the agent" logged 'staging /api/whoami -H X-My-Home-Actor: agent'

reset
"$u" staging list --type window.casement --status needs-attention >/dev/null
check "list uses the first home and passes the filters" \
  logged 'staging /api/homes/home/uses?typeId=window.casement&status=needs-attention'
out=$("$u" staging list --home mock-home --include removed)
check "list --include removed adds the trash" test "$(jq -r 'map(.id) | join(",")' <<<"$out")" = \
  souterrain-kitchen-window,souterrain-bed-1,souterrain-chair-1

reset
"$u" staging place --home mock-home --type furniture.bed --level souterrain --at -3,2.5 --rotation-deg 90 \
  --param width=1.8 --param color=#AABBCC --name 'Guest bed' >/dev/null
check "place posts the placement" logged 'staging /api/homes/mock-home/placements -H X-My-Home-Actor: agent -X POST --json {"typeId":"furniture.bed","levelId":"souterrain","position":{"x":-3,"z":2.5},"rotationY":1.5707963267948966,"params":{"width":1.8,"color":"#AABBCC"},"name":"Guest bed"}'
check "place needs a type and a level" fails "$u" staging place --at 1,2 --type furniture.bed
check "place needs X,Z" fails "$u" staging place --type furniture.bed --level souterrain --at north

reset
"$u" staging set souterrain-bed-1 --home mock-home --param width=2 --clear color >/dev/null
check "set patches a placement's params from its current version" \
  logged 'staging /api/homes/mock-home/placements/souterrain-bed-1 -H X-My-Home-Actor: agent -X PATCH --json {"version":3,"params":{"width":2}}'
"$u" staging set souterrain-kitchen-window --home mock-home --param sashes=2 >/dev/null
check "set puts an opening's override (version 0 creates it)" \
  logged 'staging /api/homes/mock-home/opening-overrides/souterrain-kitchen-window -H X-My-Home-Actor: agent -X PUT --json {"version":0,"params":{"sashes":2}}'
check "set needs a change" fails "$u" staging set souterrain-bed-1
check "set refuses an unknown use" fails "$u" staging set nope --param a=1

reset
"$u" staging move souterrain-bed-1 --home mock-home --at 1.5,-2 >/dev/null
check "move patches the position" \
  logged 'staging /api/homes/mock-home/placements/souterrain-bed-1 -H X-My-Home-Actor: agent -X PATCH --json {"version":3,"position":{"x":1.5,"z":-2}}'
"$u" staging rename souterrain-bed-1 'Spare bed' --home mock-home >/dev/null
check "rename patches the name" \
  logged 'staging /api/homes/mock-home/placements/souterrain-bed-1 -H X-My-Home-Actor: agent -X PATCH --json {"version":3,"name":"Spare bed"}'

reset
"$u" staging remove souterrain-bed-1 --home mock-home >/dev/null
check "remove sends the current version" \
  logged 'staging /api/homes/mock-home/placements/souterrain-bed-1?version=3 -H X-My-Home-Actor: agent -X DELETE'
"$u" staging restore souterrain-chair-1 --home mock-home >/dev/null
check "restore posts" logged 'staging /api/homes/mock-home/placements/souterrain-chair-1/restore -H X-My-Home-Actor: agent -X POST'
check "remove refuses an unknown placement" fails "$u" staging remove nope --home mock-home

reset
out=$("$u" staging history souterrain-bed-1 --home mock-home)
check "history lists the change texts" test "$(jq -r '.[0].changes[0]' <<<"$out")" = 'width 160.0 cm → 180.0 cm'
"$u" staging undo souterrain-bed-1 e1 --home mock-home >/dev/null
check "undo posts" logged 'staging /api/homes/mock-home/uses/souterrain-bed-1/history/e1/undo -H X-My-Home-Actor: agent -X POST'

# The only DELETE in uses.sh moves a placement to the trash; nothing touches photos.
check "uses.sh deletes nothing but placements (soft)" \
  test "$(grep -cE -- '-X +DELETE' "$u")" = "$(grep -cE -- '/placements/.*-X DELETE' "$u")"
check "uses.sh never touches photos or purges" fails grep -qE -- '/photos[/?"]|/photo-requests|/purge|trash/empty' "$u"

printf '%d passed, %d failed\n' "$pass" "$fail"
[[ $fail -eq 0 ]]
