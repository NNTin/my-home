#!/usr/bin/env bash
# photos-copy.sh <from-env> <to-env> [--home ID] [--to-home ID] [--since TIME] [--dry-run]
#
# Copies photos from one environment's photo store to the other's, e.g. photos the owner took on staging to
# production: photos-copy.sh staging production --dry-run. Never automatic; run it when the owner asks.
#
# - A photo keeps its id, pose, time, captured room, note, tags and request id. The destination re-encodes the
#   image like every upload, so a copy costs one more lossy generation. Photos whose id already exists on the
#   destination (also in its trash) are skipped, so the copy can be repeated.
# - Only adds photos: nothing is changed or deleted on either side. Photos in the source's trash are not copied.
# - --since TIME copies photos taken at or after that time (ISO 8601). --home defaults to the source's first
#   home; --to-home defaults to the same id.
# - --dry-run lists what would be copied and changes nothing.
set -euo pipefail
# shellcheck source=photos-lib.sh
source "$(dirname "${BASH_SOURCE[0]}")/photos-lib.sh"

usage() {
  sed -n '2,13s/^# \{0,1\}//p' "$0" >&2
  exit 2
}

[[ $# -ge 2 ]] || usage
from=$1 to=$2
shift 2
resolve_env "$to" && to_host=$SITE_HOST
resolve_env "$from" && from_host=$SITE_HOST
[[ $from_host != "$to_host" ]] || die "source and destination are the same environment"
require_tools curl jq

home='' to_home='' query='' dry_run=0
while [[ $# -gt 0 ]]; do
  case "$1" in
    --home) home=${2:?} && shift 2 ;;
    --to-home) to_home=${2:?} && shift 2 ;;
    --since) query="since=$(uri "${2:?}")" && shift 2 ;;
    --dry-run) dry_run=1 && shift ;;
    *) usage ;;
  esac
done
home=${home:-$(default_home "$from")}
to_home=${to_home:-$home}

source_photos=$(list_photos "$from" "$home" "$query")
existing=$(list_photos "$to" "$to_home" | jq -c 'map(.id)')
trashed=$(api "$to" "/api/homes/$to_home/trash" | jq -c '.photos | map(.id)')
pending=$(jq -c --argjson existing "$existing" --argjson trashed "$trashed" \
  'map(select(.id as $id | ($existing + $trashed) | index($id) | not)) | reverse' <<<"$source_photos")

total=$(jq length <<<"$source_photos")
count=$(jq length <<<"$pending")
printf '%s (%s) -> %s (%s): %d of %d photo(s) to copy, %d already there\n' \
  "$from" "$home" "$to" "$to_home" "$count" "$total" "$((total - count))" >&2
jq -r '.[] | "\(.id)\t\(.takenAt)\t\(.capturedRoomName // "no room")\t\(.note)"' <<<"$pending"
if [[ $dry_run == 1 ]]; then
  echo "dry run: nothing copied" >&2
  exit 0
fi

work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT
copied=0
while IFS= read -r photo; do
  id=$(jq -r .id <<<"$photo")
  api "$from" "/api/photos/$id/image" >"$work/image.webp"
  # The destination resolves the room against its own model; the captured room travels as recorded.
  # The sensor snapshot and the links to types and uses (subjects) travel along when there are any;
  # the destination resolves the subjects against its own model and placements.
  jq -c '{id, levelId, pose, takenAt, note, tags, requestId, capturedRoomId, capturedRoomName}
    + (if .sensors then {sensors} else {} end)
    + (if (.subjects // []) != [] then {subjects: (.subjects | map({kind, id}))} else {} end)' \
    <<<"$photo" >"$work/meta.json"
  api "$to" "/api/homes/$to_home/photos" -X POST -F "meta=<$work/meta.json" \
    -F "image=@$work/image.webp;type=image/webp" >/dev/null ||
    die "copying photo $id failed after $copied photo(s); fix the error and run the copy again"
  copied=$((copied + 1))
done < <(jq -c '.[]' <<<"$pending")
printf 'copied %d photo(s) to %s\n' "$copied" "$to" >&2
