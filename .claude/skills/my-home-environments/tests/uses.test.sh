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
  /api/homes) echo '{"items":[{"id":"home"}]}' ;;
  /api/whoami) echo '{"username":"nntin-bot","actor":"agent","actorSource":"identity"}' ;;
  /api/catalog/types) echo '{"items":[{"id":"furniture.bed"}]}' ;;
  */uses | */uses\?*) jq -nc --argjson b "$bed" --argjson w "$window" '{items: [$w, $b]}' ;;
  */placements\?include=removed) jq -nc --argjson b "$bed" \
    '{items: [($b | del(.source, .overrides)), {id: "souterrain-chair-1", removedAt: "2026-11-17T00:00:00Z",
      purgeAt: "2026-12-17T00:00:00Z", version: 2}]}' ;;
  /api/notes\?*) echo '{"items":[{"id":"n1","body":"Sticks"}]}' ;;
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
out=$("$u" staging list --home home --include removed)
check "list --include removed adds the trash" test "$(jq -r 'map(.id) | join(",")' <<<"$out")" = \
  souterrain-kitchen-window,souterrain-bed-1,souterrain-chair-1

reset
"$u" staging --allow-write place --home home --type furniture.bed --level souterrain --at -3,2.5 --rotation-deg 90 \
  --param width=1.8 --param color=#AABBCC --name 'Guest bed' >/dev/null
check "place posts the placement" logged 'staging /api/homes/home/placements -H X-My-Home-Actor: agent -X POST --json {"typeId":"furniture.bed","levelId":"souterrain","position":{"x":-3,"z":2.5},"rotationY":1.5707963267948966,"params":{"width":1.8,"color":"#AABBCC"},"name":"Guest bed"}'
check "place needs a type and a level" fails "$u" staging --allow-write place --at 1,2 --type furniture.bed
check "place needs X,Z" fails "$u" staging --allow-write place --type furniture.bed --level souterrain --at north

reset
"$u" staging --allow-write set souterrain-bed-1 --home home --param width=2 --clear color >/dev/null
check "set patches a placement's params from its current version" \
  logged 'staging /api/homes/home/placements/souterrain-bed-1 -H X-My-Home-Actor: agent -X PATCH --json {"version":3,"params":{"width":2}}'
"$u" staging --allow-write set souterrain-kitchen-window --home home --param sashes=2 >/dev/null
check "set puts an opening's override (version 0 creates it)" \
  logged 'staging /api/homes/home/opening-overrides/souterrain-kitchen-window -H X-My-Home-Actor: agent -X PUT --json {"version":0,"params":{"sashes":2}}'
check "set needs a change" fails "$u" staging --allow-write set souterrain-bed-1
check "set refuses an unknown use" fails "$u" staging --allow-write set nope --param a=1

reset
"$u" staging --allow-write move souterrain-bed-1 --home home --at 1.5,-2 >/dev/null
check "move patches the position" \
  logged 'staging /api/homes/home/placements/souterrain-bed-1 -H X-My-Home-Actor: agent -X PATCH --json {"version":3,"position":{"x":1.5,"z":-2}}'
"$u" staging --allow-write rename souterrain-bed-1 'Spare bed' --home home >/dev/null
check "rename patches the name" \
  logged 'staging /api/homes/home/placements/souterrain-bed-1 -H X-My-Home-Actor: agent -X PATCH --json {"version":3,"name":"Spare bed"}'

reset
"$u" staging --allow-write remove souterrain-bed-1 --home home >/dev/null
check "remove sends the current version" \
  logged 'staging /api/homes/home/placements/souterrain-bed-1?version=3 -H X-My-Home-Actor: agent -X DELETE'
"$u" staging --allow-write restore souterrain-chair-1 --home home >/dev/null
check "restore posts" logged 'staging /api/homes/home/placements/souterrain-chair-1/restore -H X-My-Home-Actor: agent -X POST'
check "remove refuses an unknown placement" fails "$u" staging --allow-write remove nope --home home

reset
out=$("$u" staging history souterrain-bed-1 --home home)
check "history lists the change texts" test "$(jq -r '.[0].changes[0]' <<<"$out")" = 'width 160.0 cm → 180.0 cm'
"$u" staging --allow-write undo souterrain-bed-1 e1 --home home >/dev/null
check "undo posts" logged 'staging /api/homes/home/uses/souterrain-bed-1/history/e1/undo -H X-My-Home-Actor: agent -X POST'

reset
out=$("$u" staging notes souterrain-kitchen-window --home home)
check "notes lists a use's notes in its home" \
  logged 'staging /api/notes?subject=use%3Asouterrain-kitchen-window&homeId=home -H X-My-Home-Actor: agent'
check "notes prints the items" test "$(jq -r '.[0].body' <<<"$out")" = Sticks
reset
"$u" staging notes window.casement >/dev/null
check "type notes are environment-wide (no home lookup)" \
  test "$(cat "$STUB_LOG")" = 'staging /api/notes?subject=type%3Awindow.casement -H X-My-Home-Actor: agent'
reset
"$u" staging --allow-write note-add souterrain-kitchen-window 'Sticks in winter' >/dev/null
check "note-add posts a use note in the first home" \
  logged 'staging /api/notes -H X-My-Home-Actor: agent -X POST --json {"subject":{"kind":"use","id":"souterrain-kitchen-window"},"body":"Sticks in winter","homeId":"home"}'
"$u" staging --allow-write note-add window.casement 'Replaced in 2019' >/dev/null
check "note-add posts a type note without a home" \
  logged 'staging /api/notes -H X-My-Home-Actor: agent -X POST --json {"subject":{"kind":"type","id":"window.casement"},"body":"Replaced in 2019"}'
"$u" staging --allow-write note-edit n1 'Fixed' >/dev/null
check "note-edit patches the body" logged 'staging /api/notes/n1 -H X-My-Home-Actor: agent -X PATCH --json {"body":"Fixed"}'
"$u" staging --allow-write note-delete n1 >/dev/null 2>&1
check "note-delete deletes the note" logged 'staging /api/notes/n1 -H X-My-Home-Actor: agent -X DELETE'
check "note-add needs a text" fails "$u" staging --allow-write note-add window.casement
reset
"$u" staging --allow-write --home home note-add souterrain-kitchen-window 'Before the command' >/dev/null
check "options may come before the command" \
  logged 'staging /api/notes -H X-My-Home-Actor: agent -X POST --json {"subject":{"kind":"use","id":"souterrain-kitchen-window"},"body":"Before the command","homeId":"home"}'
reset
for write in "place --type furniture.bed --level souterrain --at 1,2" "set souterrain-bed-1 --param a=1" \
  "move souterrain-bed-1 --at 1,2" "rename souterrain-bed-1 x" "remove souterrain-bed-1" \
  "restore souterrain-chair-1" "undo souterrain-bed-1 e1" "note-add window.casement x" "note-edit n1 x" "note-delete n1"; do
  # shellcheck disable=SC2086 # the words are the command line
  check "${write%% *} is refused without --allow-write" fails "$u" staging $write
done
check "a refused write sends nothing" test ! -s "$STUB_LOG"
check "a command is required" fails "$u" staging --home home

# The only DELETEs in uses.sh move a placement to the trash and soft-delete a note; nothing touches photos.
check "uses.sh deletes nothing but placements and notes (soft)" \
  test "$(grep -cE -- '-X +DELETE' "$u")" = "$(grep -cE -- '/(placements|notes)/.*-X DELETE' "$u")"
check "uses.sh never touches photos or purges" fails grep -qE -- '/photos[/?"]|/photo-requests|/purge|trash/empty' "$u"

printf '%d passed, %d failed\n' "$pass" "$fail"
[[ $fail -eq 0 ]]
