#!/usr/bin/env bash
# fetch.sh <staging|production> [--dir DIR] [--home ID] [--grid] [--size PX] (<photo-id>... | -- <photos.sh list filters>)
#
# Downloads photos with my-home-environments' photos.sh into a temp directory OUTSIDE the repository (default:
# a new mktemp -d), converts each to a JPEG the image reader can open (<id>.jpg, long side --size, default 1600;
# with --grid also <id>.grid.png at full resolution, see grid.sh), and prints one line per photo: id, captured
# room, position, heading/pitch in degrees, the stored fovH and whether the heading was measured or set by hand.
# With "--" the remaining arguments are photos.sh list filters (e.g. -- --near 11,-8,3 --level souterrain).
# Never commit, upload or keep the files: delete the directory when done (it is printed last).
set -euo pipefail
script_dir=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
repo_root=$(cd "$script_dir/../../../.." && pwd)
photos_sh=${MY_HOME_PHOTOS_SH:-$script_dir/../../my-home-environments/scripts/photos.sh}
convert_bin=${MY_HOME_CONVERT:-convert}

die() {
  printf '%s: %s\n' "${0##*/}" "$*" >&2
  exit 1
}
usage() {
  sed -n '2,10s/^# \{0,1\}//p' "$0" >&2
  exit 2
}

[[ $# -ge 1 ]] || usage
env=$1
shift
dir='' home=() grid='' size=1600 ids=() filters=()
while [[ $# -gt 0 ]]; do
  case $1 in
    --dir) dir=${2:?--dir needs a directory} && shift 2 ;;
    --home) home=(--home "${2:?--home needs an id}") && shift 2 ;;
    --grid) grid=1 && shift ;;
    --size) size=${2:?--size needs pixels} && shift 2 ;;
    --) shift && filters=("$@") && break ;;
    -*) usage ;;
    *) ids+=("$1") && shift ;;
  esac
done
[[ ${#ids[@]} -gt 0 || ${#filters[@]} -gt 0 ]] || die "give photo ids or -- <list filters>"
[[ $size =~ ^[1-9][0-9]*$ ]] || die "--size must be a positive integer"
for tool in jq "$convert_bin"; do
  command -v "$tool" >/dev/null 2>&1 || die "missing dependency: $tool"
done

if [[ -n $dir ]]; then
  dir=$(realpath -m "$dir")
  case "$dir/" in
    "$(realpath -m "$repo_root")"/*) die "refusing to download photos into the repository ($dir): use a temp directory" ;;
  esac
  mkdir -p "$dir"
else
  dir=$(mktemp -d "${TMPDIR:-/tmp}/my-home-photos.XXXXXX")
fi

if [[ ${#filters[@]} -gt 0 ]]; then
  mapfile -t listed < <("$photos_sh" "$env" list "${home[@]}" "${filters[@]}" | jq -r '.[].id')
  ids+=("${listed[@]}")
  [[ ${#ids[@]} -gt 0 ]] || die "no photo matches the filters"
fi
"$photos_sh" "$env" download "${home[@]}" --dir "$dir" "${ids[@]}" >/dev/null

printf 'id\troom\tx\tz\theading\tpitch\tfovH\theading-source\tsize\n'
for id in "${ids[@]}"; do
  meta="$dir/$id.json" image="$dir/$id.webp"
  [[ -f $meta && -f $image ]] || die "download of $id is incomplete"
  "$convert_bin" "$image" -resize "${size}x${size}>" -quality 85 "$dir/$id.jpg"
  [[ -z $grid ]] || "$script_dir/grid.sh" "$image" "$dir/$id.grid.png" >/dev/null
  # heading = degrees clockwise from plan north = -yaw (docs/home-model.md § Orientation)
  jq -r 'def deg: . * 180 / 3.141592653589793;
    [(.id[0:8]), (.capturedRoomName // .room.name // "-"),
      ((.pose.position.x * 100 | round) / 100), ((.pose.position.z * 100 | round) / 100),
      ((((-.pose.yaw | deg | round) % 360) + 360) % 360),
      (.pose.pitch | deg | round),
      ((.pose.fovH // 0) | deg | round),
      (.sensors.source // "unknown"),
      ("\(.image.width // "?")x\(.image.height // "?")")] | @tsv' "$meta"
done
printf 'photos in %s (delete when done: rm -rf %s)\n' "$dir" "$dir"
