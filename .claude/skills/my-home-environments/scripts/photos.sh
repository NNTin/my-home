#!/usr/bin/env bash
# photos.sh <staging|production> <command> [options]
#
# The owner's photos of the home, each with the pose it was taken from (docs/photos.md).
#
#   list [filters]                      photos as a JSON array, newest first
#   get <photo-id>                      one photo's metadata
#   download [--dir DIR] [--thumbnail] <photo-id>... | [filters]
#                                       saves <id>.webp and <id>.json into DIR (default: a new temp dir)
#   annotate <photo-id> [--note TEXT] [--tag TAG]... [--subject S]... [--no-subject S]...
#                                       sets the note, adds tags, links (--subject) or unlinks (--no-subject)
#                                       a type or use: S is type:<typeId> or use:<useId>
#   sensors <photo-id>                  the phone's sensor snapshot of a photo: whether its heading was
#                                       measured by the compass or set by hand, accuracy, tilt, declination
#
# Filters: --home ID (default: the first home), --level ID, --room ID, --near X,Z,RADIUS (metres on the plan),
#          --tag TAG, --request ID, --since TIME, --until TIME (ISO 8601, by the time the photo was taken),
#          --subject type:<typeId>|use:<useId> (photos linked to that type or use)
#
# There is no delete command on purpose: only the owner deletes photos, in the app.
set -euo pipefail
# shellcheck source=photos-lib.sh
source "$(dirname "${BASH_SOURCE[0]}")/photos-lib.sh"

usage() {
  sed -n '2,21s/^# \{0,1\}//p' "$0" >&2
  exit 2
}

[[ $# -ge 2 ]] || usage
env=$1 command=$2
shift 2
resolve_env "$env"
require_tools curl jq

home='' query='' dir='' kind=image note='' set_note=0
ids=() tags=() subjects=() unlinks=()
add_query() { query+="${query:+&}$1=$(uri "$2")"; }
while [[ $# -gt 0 ]]; do
  case "$1" in
    --home) home=${2:?} && shift 2 ;;
    --level) add_query levelId "${2:?}" && shift 2 ;;
    --room) add_query roomId "${2:?}" && shift 2 ;;
    --near) add_query near "${2:?}" && shift 2 ;;
    --request) add_query requestId "${2:?}" && shift 2 ;;
    --since) add_query since "${2:?}" && shift 2 ;;
    --until) add_query until "${2:?}" && shift 2 ;;
    --tag)
      tags+=("${2:?}")
      [[ $command == annotate ]] || add_query tag "$2"
      shift 2
      ;;
    --subject | --no-subject)
      [[ ${2:-} =~ ^(type|use):.+$ ]] || die "$1 takes type:<typeId> or use:<useId>, not '${2:-}'"
      if [[ $1 == --no-subject ]]; then
        [[ $command == annotate ]] || die "--no-subject is for annotate only (list filters with --subject)"
        unlinks+=("$2")
      elif [[ $command == annotate ]]; then
        subjects+=("$2")
      else
        add_query subject "$2"
      fi
      shift 2
      ;;
    --dir) dir=${2:?} && shift 2 ;;
    --thumbnail) kind=thumbnail && shift ;;
    --note) note=${2?} set_note=1 && shift 2 ;;
    -*) die "unknown option $1" ;;
    *) ids+=("$1") && shift ;;
  esac
done

case "$command" in
  list)
    [[ ${#ids[@]} -eq 0 ]] || usage
    list_photos "$env" "${home:-$(default_home "$env")}" "$query" | jq .
    ;;
  get)
    [[ ${#ids[@]} -eq 1 ]] || usage
    api "$env" "/api/photos/${ids[0]}" | jq .
    ;;
  download)
    if [[ ${#ids[@]} -eq 0 ]]; then
      mapfile -t ids < <(list_photos "$env" "${home:-$(default_home "$env")}" "$query" | jq -r '.[].id')
    fi
    [[ -n $dir ]] || dir=$(mktemp -d "${TMPDIR:-/tmp}/my-home-photos.XXXXXX")
    mkdir -p "$dir"
    for id in "${ids[@]}"; do
      api "$env" "/api/photos/$id" >"$dir/$id.json"
      api "$env" "/api/photos/$id/$kind" >"$dir/$id.webp"
      jq -r --arg file "$dir/$id.webp" \
        '"\($file)\t\(.capturedRoomName // .room.name // "no room")\t\(.takenAt)\theading: \(
          if .sensors.source == "sensor" then "measured" elif .sensors then "by hand" else "not recorded" end
        )\t\(.note)"' "$dir/$id.json"
    done
    printf '%d photo(s) in %s\n' "${#ids[@]}" "$dir" >&2
    ;;
  sensors)
    [[ ${#ids[@]} -eq 1 ]] || usage
    api "$env" "/api/photos/${ids[0]}" | jq '{id, pose, sensors, heading: (
      if .sensors.source == "sensor" then "measured by the phone" elif .sensors then "set by hand"
      else "not recorded" end)}'
    ;;
  annotate)
    [[ ${#ids[@]} -eq 1 ]] || usage
    [[ $set_note == 1 || ${#tags[@]} -gt 0 || ${#subjects[@]} -gt 0 || ${#unlinks[@]} -gt 0 ]] ||
      die "annotate needs --note, --tag, --subject and/or --no-subject"
    current=$(api "$env" "/api/photos/${ids[0]}")
    as_subjects() { jq -nc '$ARGS.positional | map(capture("^(?<kind>[a-z]+):(?<id>.+)$"))' --args "$@"; }
    body=$(jq -c --arg note "$note" --argjson setNote "$set_note" \
      --argjson add "$(as_subjects "${subjects[@]}")" --argjson drop "$(as_subjects "${unlinks[@]}")" '
      {tags: (.tags + $ARGS.positional | unique)}
      + (if $setNote == 1 then {note: $note} else {} end)
      + (if ($add | length) + ($drop | length) > 0 then
          {subjects: ((.subjects // []) | map({kind, id}) | . + ($add - .) | . - $drop)}
        else {} end)
    ' --args "${tags[@]}" <<<"$current")
    api "$env" "/api/photos/${ids[0]}" -X PATCH --json "$body" | jq .
    ;;
  *) usage ;;
esac
