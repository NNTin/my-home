#!/usr/bin/env bash
# Offline tests for photos.sh, photo-requests.sh and photos-copy.sh: site-curl.sh is stubbed, nothing touches
# the network. Run: .claude/skills/my-home-environments/tests/photos.test.sh
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
env=$1 path=$2
photo() { jq -nc --arg id "$1" --arg note "$2" '{id: $id, levelId: "souterrain", takenAt: "2026-01-02T03:04:05.000Z",
  pose: {position: {x: 1, y: -1, z: 2}, yaw: 0.5, pitch: 0}, note: $note, tags: ["wall"], requestId: null,
  capturedRoomId: "souterrain-kitchen", capturedRoomName: "Kitchen", room: null, deletedAt: null}'; }
case "$env $path" in
  *" /api/homes") echo '{"items":[{"id":"home"},{"id":"mock-home"}]}' ;;
  "staging /api/homes/home/photos?"*) jq -nc --argjson a "$(photo aaa first)" --argjson b "$(photo bbb second)" \
    --argjson c "$(photo ccc third)" '{items: [$c, $b, $a], total: 3}' ;;
  "production /api/homes/home/photos?"*) jq -nc --argjson a "$(photo aaa first)" '{items: [$a], total: 1}' ;;
  "production /api/homes/home/trash") jq -nc --argjson b "$(photo bbb second)" '{photos: [$b], requests: []}' ;;
  "production /api/homes/home/photos") echo '{}' ;;
  *"/image" | *"/thumbnail") printf 'image-bytes-of-%s' "$path" ;;
  *"/api/photos/"*) photo "${path##*/}" "a note" ;;
  *"/photo-requests"*) echo '{"items":[{"id":"r1","status":"open"}],"id":"r1"}' ;;
  *) echo "unexpected request: $*" >&2 && exit 1 ;;
esac
STUB
chmod +x "$work/site-curl"
export SITE_CURL="$work/site-curl" STUB_LOG="$work/log" TMPDIR="$work"

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
not_logged() { ! logged "$1"; }
fails() { ! "$@" 2>/dev/null; }
reset() { : >"$STUB_LOG"; }

reset
out=$("$scripts/photos.sh" staging list --room souterrain-kitchen --near 4.5,-6,2 --tag wall)
check "list prints the photos" test "$(jq -r 'map(.id) | join(",")' <<<"$out")" = ccc,bbb,aaa
check "list uses the first home and encodes the filters" \
  logged "staging /api/homes/home/photos?limit=500&offset=0&roomId=souterrain-kitchen&near=4.5%2C-6%2C2&tag=wall"

reset
"$scripts/photos.sh" staging download --dir "$work/out" --level souterrain >/dev/null 2>&1
check "download saves every listed photo and its metadata" test "$(find "$work/out" -type f | wc -l)" = 6
reset
out=$("$scripts/photos.sh" staging sensors aaa)
check "sensors shows where a photo's heading came from" \
  test "$(jq -r '.heading' <<<"$out")" = "not recorded"
check "download writes the image bytes" grep -q 'image-bytes-of-/api/photos/bbb/image' "$work/out/bbb.webp"

reset
"$scripts/photos.sh" staging annotate aaa --note 'Sink on the left' --tag window >/dev/null
check "annotate patches the note and merges tags" \
  logged 'staging /api/photos/aaa -X PATCH --json {"tags":["wall","window"],"note":"Sink on the left"}'

# Agents never remove photos: the scripts offer no way to.
for command in delete purge restore; do
  check "photos.sh has no $command command" fails "$scripts/photos.sh" staging "$command" aaa
done
# That holds for every script of the skill, the browser-driven smoke tests included.
check "no script sends a DELETE" fails grep -lE -- "-X +DELETE|method: *'DELETE'" "$scripts"/*.sh "$scripts"/*.mjs
check "no script purges or empties the trash" fails grep -lE -- '/purge|trash/empty' "$scripts"/*.sh "$scripts"/*.mjs

reset
"$scripts/photo-requests.sh" staging create --room souterrain-kitchen --at 4.5,-6 --heading-deg 90 \
  --reason 'Which wall has the window?' >/dev/null
check "create posts an agent request" logged 'staging /api/homes/home/photo-requests -X POST --json {"reason":"Which wall has the window?","requester":"agent","roomId":"souterrain-kitchen","position":{"x":4.5,"z":-6},"yaw":-1.5707963267948966}'
check "create needs a target" fails "$scripts/photo-requests.sh" staging create --reason x
"$scripts/photo-requests.sh" staging list --status all >/dev/null
check "list passes the status" logged "staging /api/homes/home/photo-requests?status=all"
"$scripts/photo-requests.sh" staging close r1 >/dev/null
check "close cancels" logged "staging /api/photo-requests/r1/cancel -X POST"
"$scripts/photo-requests.sh" staging close r1 --photo aaa >/dev/null
check "close --photo fulfils" logged 'staging /api/photo-requests/r1/fulfil -X POST --json {"photoId":"aaa"}'

reset
out=$("$scripts/photos-copy.sh" staging production --dry-run 2>"$work/err")
check "dry run lists only photos missing on the destination (not in its trash either)" \
  test "$(cut -f1 <<<"$out")" = ccc
check "dry run reports the counts" grep -q '1 of 3 photo(s) to copy, 2 already there' "$work/err"
check "dry run uploads nothing" not_logged "-X POST"
check "dry run downloads nothing" not_logged "/image"

reset
"$scripts/photos-copy.sh" staging production --since 2026-01-01T00:00:00Z >/dev/null 2>&1
check "copy passes --since to the source" \
  logged "staging /api/homes/home/photos?limit=500&offset=0&since=2026-01-01T00%3A00%3A00Z"
check "copy downloads the missing photo" logged "staging /api/photos/ccc/image"
check "copy uploads it to the destination" logged "production /api/homes/home/photos -X POST -F meta=<"
check "copy uploads exactly one photo" test "$(grep -c -- '-X POST' "$STUB_LOG")" = 1
check "copy never writes to the source" fails grep -E '^staging .* -X ' "$STUB_LOG"
check "copy refuses to copy an environment onto itself" fails "$scripts/photos-copy.sh" staging stg --dry-run

printf '%d passed, %d failed\n' "$pass" "$fail"
[[ $fail -eq 0 ]]
