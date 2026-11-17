#!/usr/bin/env bash
# compass-smoke.sh <staging|production> [--out file.png]
#
# Smoke test of the camera modes of walk mode (Sensors / Manual) on a phone-sized screen (390x844) in
# headless Chromium, with MOCKED orientation events, on the Android path (absolute alpha) and the iOS path
# (permission tap, webkitCompassHeading). Manual: orientation events change nothing, drag and ▲ do. Sensors:
# the mocked phone turns and tilts the figure (north crossed smoothly, jitter ignored, landscape), drags
# change nothing, ▲▼ are hidden, the pad sidesteps; refusal and silence fall back to Manual; the mode
# survives a reload; a captured photo stores the sensor snapshot. Exit 0 when every check passes.
# Read-only, like walk-smoke.sh: the photo it "takes" is synthetic and its upload is intercepted in the
# browser, so nothing is stored, changed or deleted on the environment.
# A real phone is still needed for what mocks cannot show: see the checklist in docs/walking.md.
set -euo pipefail
script_dir=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
# shellcheck source=lib.sh
source "$script_dir/lib.sh"

usage() {
  sed -n '2,12s/^# \{0,1\}//p' "$0" >&2
  exit 2
}

[[ $# -ge 1 ]] || usage
resolve_env "$1"
shift
out=''
while [[ $# -gt 0 ]]; do
  [[ $# -ge 2 && $1 == --out ]] || usage
  out=$2
  shift 2
done
out=${out:-${TMPDIR:-/tmp}/my-home-$SITE_ENV-compass-$(date +%Y%m%d-%H%M%S).png}
[[ $out == /* ]] || out="$PWD/$out"
[[ $out == *.png ]] || die "--out must end in .png"

# Installs the pinned Playwright and Chromium if they are missing.
"$script_dir/screenshot.sh" --check >/dev/null
export MY_HOME_PLAYWRIGHT_DIR=${MY_HOME_PLAYWRIGHT_DIR:-${XDG_CACHE_HOME:-$HOME/.cache}/my-home-environments/playwright}

# A synthetic photo to capture: a small grey PNG, made here so that no image file lives in the repository.
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT
node -e '
  const zlib = require("zlib"), fs = require("fs");
  const [w, h] = [320, 240];
  const crcTable = Array.from({ length: 256 }, (_, n) => { for (let k = 0; k < 8; k++) n = n & 1 ? 0xedb88320 ^ (n >>> 1) : n >>> 1; return n >>> 0; });
  const crc = (b) => { let c = ~0; for (const x of b) c = crcTable[(c ^ x) & 255] ^ (c >>> 8); return ~c >>> 0; };
  const chunk = (type, data) => { const body = Buffer.concat([Buffer.from(type), data]); const out = Buffer.alloc(body.length + 8); out.writeUInt32BE(data.length); body.copy(out, 4); out.writeUInt32BE(crc(body), body.length + 4); return out; };
  const header = Buffer.alloc(13); header.writeUInt32BE(w); header.writeUInt32BE(h, 4); header.set([8, 2, 0, 0, 0], 8);
  const rows = Buffer.alloc(h * (1 + w * 3), 150); for (let y = 0; y < h; y++) rows[y * (1 + w * 3)] = 0;
  fs.writeFileSync(process.argv[1], Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", header), chunk("IDAT", zlib.deflateSync(rows)), chunk("IEND", Buffer.alloc(0))]));
' "$work/photo.png"

node_cmd=(node)
command -v ao-heavy >/dev/null 2>&1 && [[ ${AO_HEAVY_ACTIVE:-} != 1 ]] && node_cmd=(ao-heavy node)
"$script_dir/with-site-token.sh" "$SITE_ENV" -- "${node_cmd[@]}" "$script_dir/compass-smoke.mjs" "$out" "$work/photo.png"
