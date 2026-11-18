#!/usr/bin/env bash
# uses.sh <staging|production> <command> [options]
#
# Uses of the piece catalogue (docs/userdata.md): the openings in git with their per-use overrides, and the
# furniture placements. Every change is recorded in the use's history (actor: agent) and can be undone.
#
#   whoami                              the actor the api records for this token
#   types                               the catalogue types with their parameters
#   list [--type TYPEID] [--status ok|needs-attention] [--include removed]
#                                       where-used: git uses, placements and orphans (+ placements in the trash)
#   place --type TYPEID --level ID --at X,Z [--rotation-deg D] [--param k=v]... [--name TEXT]
#   set <useId> [--param k=v]... [--clear k]...      placement params, or an opening's override
#   move <placementId> --at X,Z [--rotation-deg D]
#   rename <placementId> TEXT
#   remove|restore <placementId>        to the trash (purged after 30 days) and back
#   history <useId>                     newest first
#   undo <useId> <entryId>
#   notes <useId|typeId>                the notes on a use (of --home) or a type (environment-wide), oldest first
#   note-add <useId|typeId> TEXT        a new note; ids with a "." are types (window.casement), others uses
#   note-edit <noteId> TEXT             replaces a note's text
#   note-delete <noteId>                deletes a note (soft); notes only, never photos
#
# --home ID (default: the first home; options may come before or after the command). --rotation-deg is rotationY in degrees (counter-clockwise from above).
# Every write first reads the current version. Test data only on mock-home, cleaned up by undo or remove.
set -euo pipefail
# shellcheck source=photos-lib.sh
source "$(dirname "${BASH_SOURCE[0]}")/photos-lib.sh"

usage() {
  sed -n '2,25s/^# \{0,1\}//p' "$0" >&2
  exit 2
}

[[ $# -ge 2 ]] || usage
env=$1
shift
resolve_env "$env"
require_tools curl jq

home='' query='' at='' rotation='' name='' include='' type='' level=''
args=() params=() clears=()
add_query() { query+="${query:+&}$1=$(uri "$2")"; }
while [[ $# -gt 0 ]]; do
  case "$1" in
    --home) home=${2:?} && shift 2 ;;
    --type) type=${2:?} && add_query typeId "$2" && shift 2 ;;
    --status) add_query status "${2:?}" && shift 2 ;;
    --include) include=${2:?} && shift 2 ;;
    --level) level=${2:?} && shift 2 ;;
    --at) at=${2:?} && shift 2 ;;
    --rotation-deg) rotation=${2:?} && shift 2 ;;
    --param) params+=("${2:?}") && shift 2 ;;
    --clear) clears+=("${2:?}") && shift 2 ;;
    --name) name=${2:?} && shift 2 ;;
    -*) die "unknown option $1" ;;
    *) args+=("$1") && shift ;;
  esac
done
# The command is the first word that is not an option, so options may also come before it
# (uses.sh staging --home mock-home notes <id>).
[[ ${#args[@]} -gt 0 ]] || usage
command=${args[0]}
args=("${args[@]:1}")
[[ -z $include || $include == removed ]] || die "--include takes only 'removed'"

# uapi <path> [curl args...]: an api request that declares the agent (the SSO identity wins where present).
uapi() {
  local path=$1
  shift
  api "$env" "$path" -H 'X-My-Home-Actor: agent' "$@"
}
base() { printf '/api/homes/%s' "$home"; }

# The k=v pairs as a JSON object: numbers stay numbers, anything else is a string.
params_json() {
  local pair out='{}'
  for pair in "${params[@]}"; do
    [[ $pair == *=* ]] || die "--param takes k=v, not '$pair'"
    out=$(jq -c --arg k "${pair%%=*}" --arg v "${pair#*=}" '. + {($k): ($v | tonumber? // $v)}' <<<"$out")
  done
  printf '%s\n' "$out"
}
position_json() {
  [[ $1 =~ ^(-?[0-9.]+),(-?[0-9.]+)$ ]] || die "--at takes X,Z in metres, not '$1'"
  jq -nc --argjson x "${BASH_REMATCH[1]}" --argjson z "${BASH_REMATCH[2]}" '{x: $x, z: $z}'
}
radians() { jq -n --argjson d "$1" '$d * 3.141592653589793 / 180'; }

# placement <id>: the placement, in the trash or not.
placement() {
  uapi "$(base)/placements?include=removed" | jq -e --arg id "$1" '.items[] | select(.id == $id)' ||
    die "no placement '$1' in home '$home'"
}

# subject_json <useId|typeId>: the note subject; type ids have a dot, use ids never do.
subject_json() {
  local kind=use
  if [[ $1 == *.* ]]; then kind='type'; fi
  jq -nc --arg kind "$kind" --arg id "$1" '{kind: $kind, id: $id}'
}

case "$command" in
  whoami | types | note-edit | note-delete) ;;
  notes | note-add) [[ ${#args[@]} -eq 0 || ${args[0]} == *.* || -n $home ]] || home=$(default_home "$env") ;;
  *) [[ -n $home ]] || home=$(default_home "$env") ;;
esac

case "$command" in
  whoami)
    uapi /api/whoami | jq .
    ;;
  types)
    uapi /api/catalog/types | jq '.items'
    ;;
  list)
    uses=$(uapi "$(base)/uses${query:+?$query}")
    if [[ $include == removed ]]; then
      removed=$(uapi "$(base)/placements?include=removed")
      jq --argjson p "$removed" '.items + ($p.items | map(select(.removedAt != null)
        | {id, typeId, name, source: "db", levelId, removedAt, purgeAt, version}))' <<<"$uses"
    else
      jq '.items' <<<"$uses"
    fi
    ;;
  place)
    [[ ${#args[@]} -eq 0 && -n $at ]] || usage
    [[ -n $type && -n $level ]] || die "place needs --type and --level"
    body=$(jq -nc --arg typeId "$type" --arg levelId "$level" --argjson position "$(position_json "$at")" \
      --argjson rotationY "$(radians "${rotation:-0}")" --argjson params "$(params_json)" --arg name "$name" \
      '{typeId: $typeId, levelId: $levelId, position: $position, rotationY: $rotationY, params: $params}
        + (if $name == "" then {} else {name: $name} end)')
    uapi "$(base)/placements" -X POST --json "$body" | jq .
    ;;
  set)
    [[ ${#args[@]} -eq 1 ]] || usage
    [[ ${#params[@]} -gt 0 || ${#clears[@]} -gt 0 ]] || die "set needs --param and/or --clear"
    id=${args[0]}
    use=$(uapi "$(base)/uses" | jq -e --arg id "$id" '.items[] | select(.id == $id)') ||
      die "no use '$id' in home '$home' (a placement in the trash must be restored first)"
    next=$(jq -c --argjson add "$(params_json)" '.overrides + $add | del(.[$ARGS.positional[]])' \
      --args "${clears[@]}" <<<"$use")
    version=$(jq -r '.version' <<<"$use")
    if [[ $(jq -r '.source' <<<"$use") == db ]]; then
      uapi "$(base)/placements/$id" -X PATCH --json "$(jq -nc --argjson v "$version" --argjson p "$next" \
        '{version: $v, params: $p}')" | jq .
    else
      uapi "$(base)/opening-overrides/$id" -X PUT --json "$(jq -nc --argjson v "$version" --argjson p "$next" \
        '{version: $v, params: $p}')" | jq .
    fi
    ;;
  move)
    [[ ${#args[@]} -eq 1 && -n $at ]] || usage
    current=$(placement "${args[0]}")
    rad=null
    [[ -z $rotation ]] || rad=$(radians "$rotation")
    body=$(jq -c --argjson position "$(position_json "$at")" --argjson rad "$rad" \
      '{version, position: $position} + (if $rad == null then {} else {rotationY: $rad} end)' <<<"$current")
    uapi "$(base)/placements/${args[0]}" -X PATCH --json "$body" | jq .
    ;;
  rename)
    [[ ${#args[@]} -eq 2 ]] || usage
    current=$(placement "${args[0]}")
    body=$(jq -c --arg name "${args[1]}" '{version, name: $name}' <<<"$current")
    uapi "$(base)/placements/${args[0]}" -X PATCH --json "$body" | jq .
    ;;
  remove)
    [[ ${#args[@]} -eq 1 ]] || usage
    version=$(placement "${args[0]}" | jq -r '.version')
    # A soft delete: the placement goes to the trash (restorable, undoable). Never photos.
    uapi "$(base)/placements/${args[0]}?version=$version" -X DELETE | jq .
    ;;
  restore)
    [[ ${#args[@]} -eq 1 ]] || usage
    uapi "$(base)/placements/${args[0]}/restore" -X POST | jq .
    ;;
  history)
    [[ ${#args[@]} -eq 1 ]] || usage
    uapi "$(base)/uses/${args[0]}/history" | jq '.items | map({id, at, action, actor, actorSource, actorName,
      changes: (.changes | map(.text)), undoesId, undoneById, canUndo})'
    ;;
  undo)
    [[ ${#args[@]} -eq 2 ]] || usage
    uapi "$(base)/uses/${args[0]}/history/${args[1]}/undo" -X POST | jq .
    ;;
  notes)
    [[ ${#args[@]} -eq 1 ]] || usage
    subject=$(subject_json "${args[0]}")
    query="subject=$(uri "$(jq -r '"\(.kind):\(.id)"' <<<"$subject")")"
    [[ $(jq -r .kind <<<"$subject") == type ]] || query+="&homeId=$(uri "$home")"
    uapi "/api/notes?$query" | jq '.items'
    ;;
  note-add)
    [[ ${#args[@]} -eq 2 ]] || usage
    subject=$(subject_json "${args[0]}")
    body=$(jq -c --arg body "${args[1]}" --arg home "$home" \
      '{subject: ., body: $body} + (if .kind == "use" then {homeId: $home} else {} end)' <<<"$subject")
    uapi /api/notes -X POST --json "$body" | jq .
    ;;
  note-edit)
    [[ ${#args[@]} -eq 2 ]] || usage
    uapi "/api/notes/${args[0]}" -X PATCH --json "$(jq -nc --arg body "${args[1]}" '{body: $body}')" | jq .
    ;;
  note-delete)
    [[ ${#args[@]} -eq 1 ]] || usage
    # A soft delete of a note. Never photos.
    uapi "/api/notes/${args[0]}" -X DELETE
    printf 'deleted note %s\n' "${args[0]}" >&2
    ;;
  *) usage ;;
esac
