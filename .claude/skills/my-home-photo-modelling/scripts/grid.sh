#!/usr/bin/env bash
# grid.sh <in-image> <out.png> [--step PX] [--crop WxH+X+Y] [--zoom PERCENT]
#
# Draws a labelled pixel grid over a photo so coordinates can be read off it: a line every --step pixels
# (default 100; yellow, every 5th red) and labels "x,y" in ORIGINAL image pixels (also inside a crop), so the
# numbers can go straight into measure.py. --crop cuts a region first (full resolution) and --zoom enlarges it
# for small details (hinges, handles, unit joints). Needs ImageMagick (convert); MY_HOME_CONVERT overrides it.
set -euo pipefail

die() {
  printf '%s: %s\n' "${0##*/}" "$*" >&2
  exit 1
}
usage() {
  sed -n '2,9s/^# \{0,1\}//p' "$0" >&2
  exit 2
}

convert_bin=${MY_HOME_CONVERT:-convert}
[[ $# -ge 2 ]] || usage
in=$1 out=$2
shift 2
step=100 crop='' zoom=100
while [[ $# -gt 0 ]]; do
  case $1 in
    --step) step=${2:?--step needs a value} && shift 2 ;;
    --crop) crop=${2:?--crop needs WxH+X+Y} && shift 2 ;;
    --zoom) zoom=${2:?--zoom needs a percentage} && shift 2 ;;
    *) usage ;;
  esac
done
[[ -f $in ]] || die "no such image: $in"
[[ $step =~ ^[1-9][0-9]*$ ]] || die "--step must be a positive integer"
[[ $zoom =~ ^[1-9][0-9]*$ ]] || die "--zoom must be a positive integer (percent)"
command -v "$convert_bin" >/dev/null 2>&1 || die "missing dependency: $convert_bin (ImageMagick)"

ox=0 oy=0
if [[ -n $crop ]]; then
  [[ $crop =~ ^([0-9]+)x([0-9]+)\+([0-9]+)\+([0-9]+)$ ]] || die "--crop must look like 800x600+100+200"
  w=${BASH_REMATCH[1]} h=${BASH_REMATCH[2]} ox=${BASH_REMATCH[3]} oy=${BASH_REMATCH[4]}
else
  dims=$("${MY_HOME_IDENTIFY:-identify}" -format '%w %h' "$in") || die "cannot read the image size of $in"
  read -r w h <<<"$dims"
fi

# ImageMagick has no default font on the NUC: pick a TrueType font explicitly.
font=${MY_HOME_GRID_FONT:-}
if [[ -z $font ]] && command -v fc-match >/dev/null 2>&1; then
  font=$(fc-match -f '%{file}' 'Liberation Sans:bold' 2>/dev/null || true)
fi
[[ -n $font && -f $font ]] || font=/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf

z=$((zoom))
size=$((w > h ? w : h))
point=$((size / 60 > 14 ? size / 60 : 14))
draw=()
for ((x = 0; x <= w; x += step)); do
  colour=yellow
  ((x / step % 5 == 0)) && colour=red
  draw+=(-stroke "$colour" -draw "line $((x * z / 100)),0 $((x * z / 100)),$((h * z / 100))")
done
for ((y = 0; y <= h; y += step)); do
  colour=yellow
  ((y / step % 5 == 0)) && colour=red
  draw+=(-stroke "$colour" -draw "line 0,$((y * z / 100)) $((w * z / 100)),$((y * z / 100))")
done
labels=()
for ((x = 0; x < w; x += step * 5)); do
  for ((y = 0; y < h; y += step * 5)); do
    labels+=(-draw "text $((x * z / 100 + 4)),$((y * z / 100 + point + 4)) '$((x + ox)),$((y + oy))'")
  done
done

args=("$in")
[[ -z $crop ]] || args+=(-crop "$crop" +repage)
[[ $zoom == 100 ]] || args+=(-resize "${zoom}%")
args+=(-fill none -strokewidth 1 "${draw[@]}" -stroke none -fill cyan)
[[ -f $font ]] && args+=(-font "$font")
args+=(-pointsize "$point" "${labels[@]}" "$out")
"$convert_bin" "${args[@]}"
printf '%s\n' "$out"
