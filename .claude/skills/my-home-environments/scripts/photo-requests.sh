#!/usr/bin/env bash
# photo-requests.sh <staging|production> <command> [options]
#
# Ask the owner for a new photo instead of guessing (docs/photos.md). The owner sees open requests on the
# phone as a target marker, walks the figure there and takes the photo, which fulfils the request.
#
#   create --reason TEXT [--room ID] [--at X,Z] [--level ID] [--yaw RAD | --heading-deg DEG] [--pitch RAD]
#          [--subject use:<useId>|type:<typeId>] [--home ID]
#                                       needs --room, --at, both, or a use subject (the server then puts the
#                                       request in the use's first room); prints the request
#   list [--status open|fulfilled|cancelled|all] [--home ID]     default: open
#   get <request-id>
#   close <request-id> [--photo PHOTO_ID]
#                                       with --photo: fulfilled by that photo; without: cancelled
#
# --at is a plan position in metres (x east, z south). --yaw is radians, counter-clockwise seen from above,
# 0 looking along -z; --heading-deg is the same direction in degrees clockwise from -z (plan north).
set -euo pipefail
# shellcheck source=photos-lib.sh
source "$(dirname "${BASH_SOURCE[0]}")/photos-lib.sh"

usage() {
  sed -n '2,18s/^# \{0,1\}//p' "$0" >&2
  exit 2
}

[[ $# -ge 2 ]] || usage
env=$1 command=$2
shift 2
resolve_env "$env"
require_tools curl jq

home='' status=open reason='' room='' level='' at='' yaw='' pitch='' photo='' subject=''
ids=()
while [[ $# -gt 0 ]]; do
  case "$1" in
    --home) home=${2:?} && shift 2 ;;
    --status) status=${2:?} && shift 2 ;;
    --reason) reason=${2:?} && shift 2 ;;
    --room) room=${2:?} && shift 2 ;;
    --level) level=${2:?} && shift 2 ;;
    --at) at=${2:?} && shift 2 ;;
    --yaw) yaw=${2:?} && shift 2 ;;
    --heading-deg) yaw=$(jq -n --arg d "${2:?}" '-($d | tonumber) * 3.141592653589793 / 180') && shift 2 ;;
    --pitch) pitch=${2:?} && shift 2 ;;
    --photo) photo=${2:?} && shift 2 ;;
    --subject)
      [[ ${2:-} =~ ^(type|use):.+$ ]] || die "--subject takes use:<useId> or type:<typeId>, not '${2:-}'"
      subject=$2 && shift 2
      ;;
    -*) die "unknown option $1" ;;
    *) ids+=("$1") && shift ;;
  esac
done

case "$command" in
  create)
    [[ -n $reason ]] || die "create needs --reason"
    [[ -n $room || -n $at || $subject == use:* ]] || die "create needs --room, --at X,Z, both or --subject use:<id>"
    [[ -z $at || $at =~ ^-?[0-9.]+,-?[0-9.]+$ ]] || die "--at must be X,Z in metres, e.g. 4.5,-6"
    body=$(jq -nc --arg reason "$reason" --arg room "$room" --arg level "$level" --arg at "$at" \
      --arg yaw "$yaw" --arg pitch "$pitch" --arg subject "$subject" '
      {reason: $reason, requester: "agent"}
      + (if $room != "" then {roomId: $room} else {} end)
      + (if $level != "" then {levelId: $level} else {} end)
      + (if $at != "" then {position: ($at | split(",") | map(tonumber) | {x: .[0], z: .[1]})} else {} end)
      + (if $yaw != "" then {yaw: ($yaw | tonumber)} else {} end)
      + (if $pitch != "" then {pitch: ($pitch | tonumber)} else {} end)
      + (if $subject != "" then {subject: ($subject | capture("^(?<kind>[a-z]+):(?<id>.+)$"))} else {} end)')
    api "$env" "/api/homes/${home:-$(default_home "$env")}/photo-requests" -X POST --json "$body" | jq .
    ;;
  list)
    api "$env" "/api/homes/${home:-$(default_home "$env")}/photo-requests?status=$(uri "$status")" | jq .items
    ;;
  get)
    [[ ${#ids[@]} -eq 1 ]] || usage
    api "$env" "/api/photo-requests/${ids[0]}" | jq .
    ;;
  close)
    [[ ${#ids[@]} -eq 1 ]] || usage
    if [[ -n $photo ]]; then
      api "$env" "/api/photo-requests/${ids[0]}/fulfil" -X POST --json "$(jq -nc --arg id "$photo" '{photoId: $id}')" | jq .
    else
      api "$env" "/api/photo-requests/${ids[0]}/cancel" -X POST | jq .
    fi
    ;;
  *) usage ;;
esac
