#!/usr/bin/env bash
# pose.sh <staging|production> <command> ...
#
# Corrects the stored pose of a photo (docs/photos.md § Correcting a pose), e.g. from a measure.py calibration.
# Every change is recorded in the photo's pose history as the token's actor (agent) and can be undone; the
# sensor snapshot is never sent, so it keeps what the phone measured. There is no delete: photos stay.
#
#   set <photo-id> [--from FILE] [--yaw RAD | --heading-deg DEG] [--pitch RAD | --pitch-deg DEG]
#       [--fovh RAD | --fovh-deg DEG] [--x X] [--z Z] --reason TEXT [--dry-run]
#                         --from takes measure.py output (its camera.pose) or a {"yaw","pitch","fovH"} object;
#                         flags override it. --x/--z move the position on the plan (metres; the eye height y
#                         stays), e.g. onto a refitted layout; without them the position stays. --dry-run prints
#                         the change and sends nothing.
#   history <photo-id>    the pose changes, newest first: when, who, before -> after, reason, change id
#   undo <photo-id> <change-id>
#                         puts the pose back as it was before that change (409 if it changed since)
set -euo pipefail
skill_scripts=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
# shellcheck source=../../my-home-environments/scripts/photos-lib.sh
source "${MY_HOME_PHOTOS_LIB:-$skill_scripts/../../my-home-environments/scripts/photos-lib.sh}"

usage() {
  sed -n '2,17s/^# \{0,1\}//p' "$0" >&2
  exit 2
}

[[ $# -ge 3 ]] || usage
env=$1 command=$2 id=$3
shift 3
resolve_env "$env"
require_tools jq awk
[[ $id =~ ^[A-Za-z0-9-]+$ ]] || die "not a photo id: $id"

# Pose fields as jq expressions on the current pose; numbers are checked before use.
number() { [[ $2 =~ ^-?[0-9]+([.][0-9]+)?$ ]] || die "$1 needs a number, not '$2'"; }
# rad <degrees> [sign]: radians, times sign (-1 turns a heading, clockwise, into a yaw).
rad() { awk -v d="$1" -v s="${2:-1}" 'BEGIN { printf "%.6f", s * d * atan2(0, -1) / 180 }'; }
# pose_line <pose JSON>: heading (degrees clockwise from plan north), pitch and fovH in degrees.
pose_line() {
  jq -r '(1 | atan * 4) as $pi | def d: . * 180 / $pi * 10 | round / 10;
    "x \(.position.x * 100 | round / 100) z \(.position.z * 100 | round / 100) heading \(-.yaw | d | . - 360 * (. / 360 | floor))° pitch \(.pitch | d)° fovH \(if .fovH then (.fovH | d | tostring) + "°" else "-" end)"' <<<"$1"
}

case $command in
  set)
    from='' yaw='' pitch='' fovh='' x='' z='' reason='' dry=0
    while [[ $# -gt 0 ]]; do
      case $1 in
        --from) from=${2:?--from needs a file} && shift 2 ;;
        --yaw) number "$1" "${2:-}" && yaw=$2 && shift 2 ;;
        --heading-deg) number "$1" "${2:-}" && yaw=$(rad "$2" -1) && shift 2 ;;
        --pitch) number "$1" "${2:-}" && pitch=$2 && shift 2 ;;
        --pitch-deg) number "$1" "${2:-}" && pitch=$(rad "$2") && shift 2 ;;
        --fovh) number "$1" "${2:-}" && fovh=$2 && shift 2 ;;
        --fovh-deg) number "$1" "${2:-}" && fovh=$(rad "$2") && shift 2 ;;
        --x) number "$1" "${2:-}" && x=$2 && shift 2 ;;
        --z) number "$1" "${2:-}" && z=$2 && shift 2 ;;
        --reason) reason=${2:?--reason needs a text} && shift 2 ;;
        --dry-run) dry=1 && shift ;;
        *) usage ;;
      esac
    done
    [[ -n $reason ]] || die "--reason is required: say where the pose comes from (e.g. 'measure.py: corridor VP + verticals')"
    given='{}'
    if [[ -n $from ]]; then
      [[ -r $from ]] || die "cannot read $from"
      given=$(jq -ce '(.camera.pose // .pose // .) | {yaw, pitch, fovH} | with_entries(select(.value != null))
        | if (map(type == "number") | all) and length > 0 then . else error("no yaw, pitch or fovH") end' "$from") ||
        die "$from has no pose: use measure.py output or {\"yaw\":…,\"pitch\":…,\"fovH\":…}"
    fi
    given=$(jq -c --arg yaw "$yaw" --arg pitch "$pitch" --arg fovh "$fovh" '. +
      ({yaw: $yaw, pitch: $pitch, fovH: $fovh} | with_entries(select(.value != "")) | map_values(tonumber))' <<<"$given")
    [[ $given != '{}' || -n $x || -n $z ]] ||
      die "nothing to set: give --from, --yaw/--heading-deg, --pitch/--pitch-deg, --fovh, --x or --z"
    photo=$(api "$env" "/api/photos/$id")
    before=$(jq -c '.pose' <<<"$photo")
    after=$(jq -c --argjson g "$given" --arg x "$x" --arg z "$z" '.pose + $g | .yaw |= (atan2(sin; cos))
      | if $x != "" then .position.x = ($x | tonumber) else . end
      | if $z != "" then .position.z = ($z | tonumber) else . end' <<<"$photo")
    jq -e '(.pitch | fabs) <= (1 | atan * 2) and (.fovH == null or (.fovH > 0 and .fovH < (1 | atan * 4)))' \
      <<<"$after" >/dev/null || die "pitch must be within ±π/2 and fovH within (0, π): $after"
    printf '%s\nbefore: %s\nafter:  %s\n' "$id" "$(pose_line "$before")" "$(pose_line "$after")"
    body=$(jq -c --argjson pose "$after" --arg reason "$reason" -n '{pose: $pose, poseReason: $reason}')
    if ((dry)); then
      printf 'dry run, would PATCH /api/photos/%s %s\n' "$id" "$body"
      exit 0
    fi
    api "$env" "/api/photos/$id" -X PATCH --json "$body" >/dev/null
    api "$env" "/api/photos/$id/pose-history" | jq -r '.items[0] | "recorded change \(.id) as \(.actor)"'
    ;;
  history)
    api "$env" "/api/photos/$id/pose-history" | jq -r '(1 | atan * 4) as $pi | def d: . * 180 / $pi * 10 | round / 10;
      def line: "x \(.position.x * 100 | round / 100) z \(.position.z * 100 | round / 100) h \(-.yaw | d | . - 360 * (. / 360 | floor)) p \(.pitch | d) f \(if .fovH then .fovH | d else "-" end)";
      .items[] | [.at, .actor, (.before | line) + " -> " + (.after | line), (.reason // (if .undoesId then "undo" else "" end)),
        (if .canUndo then "can undo" else "" end), .id] | @tsv'
    ;;
  undo)
    [[ $# -eq 1 && $1 =~ ^[0-9a-f-]{36}$ ]] || die "undo needs the change id (pose.sh $env history $id)"
    api "$env" "/api/photos/$id/pose-history/$1/undo" -X POST |
      jq -r '"undone: pose is back to yaw \(.photo.pose.yaw) pitch \(.photo.pose.pitch) fovH \(.photo.pose.fovH // "-") (change \(.change.id))"'
    ;;
  *) usage ;;
esac
