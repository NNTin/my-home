#!/usr/bin/env bash
# Offline tests for seed.sh: site-curl.sh is stubbed, nothing touches the network.
# Run: .claude/skills/my-home-environments/tests/seed.test.sh
# shellcheck disable=SC2317,SC2329 # the helpers below are invoked through check()
set -euo pipefail
scripts=$(cd "$(dirname "${BASH_SOURCE[0]}")/../scripts" && pwd)
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT

# The stub logs every call as "<env> <path> <args...>" and answers the seed in $STUB_SEED.
cat >"$work/site-curl" <<'STUB'
#!/usr/bin/env bash
set -euo pipefail
printf '%s\n' "$*" >>"$STUB_LOG"
case "$2" in
  /api/homes) echo '{"items":[{"id":"home"}]}' ;;
  */seed) if [[ " $* " == *" -X PUT "* ]]; then echo '{"homes":[],"typeNotes":{}}'; else cat "$STUB_SEED"; fi ;;
  *) echo '{}' ;;
esac
STUB
chmod +x "$work/site-curl"
printf '{\n  "schemaVersion": 1,\n  "homeId": "home",\n  "placements": []\n}\n' >"$work/git.json"
cp "$work/git.json" "$work/env.json"
export SITE_CURL="$work/site-curl" STUB_LOG="$work/log" STUB_SEED="$work/env.json"

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
fails() { ! "$@" 2>/dev/null; }
reset() { : >"$STUB_LOG"; }
s="$scripts/seed.sh"

reset
out=$("$s" staging export)
check "export prints the environment's seed as is" test "$out" = "$(cat "$work/env.json")"
check "export reads the first home's seed" logged 'staging /api/homes/home/seed -H X-My-Home-Actor: agent'

reset
"$s" staging diff --file "$work/git.json" 2>"$work/err"
check "diff: no drift exits 0" grep -q 'no drift' "$work/err"
printf '{\n  "schemaVersion": 1,\n  "homeId": "home",\n  "placements": [1]\n}\n' >"$work/env.json"
code=0
"$s" production diff --home home --file "$work/git.json" >"$work/out" 2>&1 || code=$?
check "diff: drift exits 5" test "$code" = 5
check "diff shows the environment's lines with +" grep -qF '+  "placements": [1]' "$work/out"
check "diff names the environment" grep -qF '+++ production: /api/homes/home/seed' "$work/out"
check "diff needs the git file" fails "$s" staging diff --file "$work/nope.json"

reset
check "import is refused without --allow-write" fails "$s" staging import --file "$work/git.json"
check "a refused import sends nothing" test ! -s "$STUB_LOG"
"$s" staging import --allow-write --file "$work/git.json" >/dev/null
check "import puts the file" logged "staging /api/homes/home/seed -H X-My-Home-Actor: agent -X PUT --json @$work/git.json"
check "a command is required" fails "$s" staging --home home
check "unknown commands are refused" fails "$s" staging purge

# seed.sh reads and imports seeds; it never deletes anything and never touches photos.
check "seed.sh sends no DELETE" fails grep -qE -- '-X +DELETE' "$s"
check "seed.sh never touches photos" fails grep -qE -- '/photos[/?"]|/photo-requests|/purge' "$s"

printf '%d passed, %d failed\n' "$pass" "$fail"
[[ $fail -eq 0 ]]
