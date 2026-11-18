#!/usr/bin/env bash
# tools.sh check | install
#
# check: reports the tools this skill uses and exits 1 when a required one is missing. Required: jq, python3,
#   ImageMagick (convert, identify) and a TrueType font for grid labels. Optional: node with
#   my-home-environments' Playwright (overlay-shots.sh), and a numpy + OpenCV venv (line detection, PnP) in
#   MY_HOME_PHOTO_TOOLS (default ~/.cache/my-home-photo-tools/venv-cv).
# install: creates that venv user-wide, outside the repository, without sudo. The NUC's python3 has no pip or
#   ensurepip, so it bootstraps pip with get-pip.py. Heavy steps run in ao-heavy. Idempotent.
set -euo pipefail
tools_dir=${MY_HOME_PHOTO_TOOLS_DIR:-${XDG_CACHE_HOME:-$HOME/.cache}/my-home-photo-tools}
venv=${MY_HOME_PHOTO_TOOLS:-$tools_dir/venv-cv}
playwright_dir=${MY_HOME_PLAYWRIGHT_DIR:-${XDG_CACHE_HOME:-$HOME/.cache}/my-home-environments/playwright}

usage() {
  sed -n '2,9s/^# \{0,1\}//p' "$0" >&2
  exit 2
}
heavy() {
  if command -v ao-heavy >/dev/null 2>&1 && [[ ${AO_HEAVY_ACTIVE:-} != 1 ]]; then
    ao-heavy "$@"
  else
    "$@"
  fi
}

check() {
  local missing=0 font
  for tool in jq python3 convert identify; do
    if command -v "$tool" >/dev/null 2>&1; then
      printf 'ok        %-10s %s\n' "$tool" "$(command -v "$tool")"
    else
      printf 'MISSING   %s (required)\n' "$tool"
      missing=1
    fi
  done
  font=$(fc-match -f '%{file}' 'Liberation Sans:bold' 2>/dev/null || true)
  [[ -n $font && -f $font ]] || font=/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf
  if [[ -f $font ]]; then
    printf 'ok        %-10s %s\n' font "$font"
  else
    printf 'MISSING   a TrueType font for grid labels (set MY_HOME_GRID_FONT)\n'
    missing=1
  fi
  if command -v node >/dev/null 2>&1 && [[ -f $playwright_dir/node_modules/playwright/package.json ]]; then
    printf 'ok        %-10s %s (playwright %s)\n' playwright "$playwright_dir" \
      "$(jq -r .version "$playwright_dir/node_modules/playwright/package.json")"
  else
    printf 'optional  playwright not installed: my-home-environments/scripts/screenshot.sh --check\n'
  fi
  if [[ -x $venv/bin/python ]] && "$venv/bin/python" -I -c 'import numpy, cv2' 2>/dev/null; then
    printf 'ok        %-10s %s (%s)\n' opencv "$venv" \
      "$("$venv/bin/python" -I -c 'import numpy, cv2; print("numpy", numpy.__version__, "opencv", cv2.__version__)')"
  else
    printf 'optional  numpy + OpenCV venv not installed: %s install\n' "$0"
  fi
  return "$missing"
}

install() {
  command -v python3 >/dev/null 2>&1 || {
    echo "python3 is required" >&2
    return 1
  }
  mkdir -p "$tools_dir/dl"
  if [[ ! -x $venv/bin/python ]]; then
    python3 -m venv --without-pip "$venv"
  fi
  if ! "$venv/bin/python" -I -m pip --version >/dev/null 2>&1; then
    curl -fsSL https://bootstrap.pypa.io/get-pip.py -o "$tools_dir/dl/get-pip.py"
    (cd "$tools_dir" && heavy "$venv/bin/python" -I "$tools_dir/dl/get-pip.py" -q)
  fi
  heavy "$venv/bin/python" -I -m pip install -q --upgrade numpy opencv-python-headless
  "$venv/bin/python" -I -c 'import numpy, cv2; print("numpy", numpy.__version__, "opencv", cv2.__version__)'
}

case ${1:-} in
  check) check ;;
  install) install ;;
  *) usage ;;
esac
