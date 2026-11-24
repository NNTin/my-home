#!/usr/bin/env bash
# Offline tests for staging-checks.sh: site-curl.sh and the checks it runs are stubbed, nothing touches the
# network or a browser.
# Run: .claude/skills/my-home-environments/tests/staging-checks.test.sh
# shellcheck disable=SC2317,SC2329 # the helpers below are invoked through check()
set -euo pipefail
scripts=$(cd "$(dirname "${BASH_SOURCE[0]}")/../scripts" && pwd)
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT

# Staging answers the commits in $STUB_COMMITS, one per call (the last one from then on).
cat >"$work/site-curl" <<'STUB'
#!/usr/bin/env bash
set -euo pipefail
calls=$(cat "$STUB_DIR/calls" 2>/dev/null || echo 0)
echo $((calls + 1)) >"$STUB_DIR/calls"
read -r -a commits <<<"$STUB_COMMITS"
at=$((calls < ${#commits[@]} ? calls : ${#commits[@]} - 1))
printf '{"commit":"%s"}\n' "${commits[$at]}"
STUB
# A smoke prints its checks and exits as $STUB_SMOKE_EXIT says.
cat >"$work/smoke" <<'STUB'
#!/usr/bin/env bash
echo "ok    the view is on screen"
echo "ok    nothing is drawn while idle"
[[ ${STUB_SMOKE_EXIT:-0} -eq 0 ]] || echo "FAIL  the sheet opens"
exit "${STUB_SMOKE_EXIT:-0}"
STUB
# visual-diff: shoot writes nothing; compare prints the table in $STUB_TABLE and exits 5 when it has a DIFFERS.
cat >"$work/visual-diff.sh" <<'STUB'
#!/usr/bin/env bash
[[ $1 == compare ]] || exit 0
cat "$STUB_TABLE"
grep -q DIFFERS "$STUB_TABLE" && exit 5
exit 0
STUB
cp "$work/smoke" "$work/walk-smoke.sh"
cp "$work/smoke" "$work/mobile-smoke.sh"
chmod +x "$work"/site-curl "$work"/*.sh
export SITE_CURL="$work/site-curl" STAGING_CHECKS_SCRIPTS="$work" STUB_DIR="$work" STUB_TABLE="$work/table.md"

pass=0 fail=0
check() {
  local name=$1
  shift
  if "$@"; then
    pass=$((pass + 1))
    echo "ok    $name"
  else
    fail=$((fail + 1))
    echo "FAIL  $name"
  fi
}

# run <commits staging answers> <args...>: the exit code in $code, the output in $work/out, the summary in $work/summary.
run() {
  local commits=$1
  shift
  rm -f "$work/calls" "$work/summary"
  code=0
  STUB_COMMITS=$commits GITHUB_STEP_SUMMARY="$work/summary" \
    "$scripts/staging-checks.sh" "$@" --out "$work/shots" >"$work/out" 2>&1 || code=$?
}

run 'abc abc' walk abc
check 'a smoke that passes on the commit passes' test "$code" -eq 0
check 'the summary says what passed and on which commit' grep -q 'walk on staging at abc: passed' "$work/summary"
check 'the summary counts the checks' grep -q '^2 checks passed' "$work/summary"
check 'the smoke output is printed' grep -q 'nothing is drawn while idle' "$work/out"

STUB_SMOKE_EXIT=1 run 'abc abc' mobile abc
check 'a smoke that fails fails the check' test "$code" -eq 1
check 'the summary names the failed check' grep -q -- '- FAIL  the sheet opens' "$work/summary"

run 'old old' walk abc
check 'staging on another commit before the check: not counted (exit 6)' test "$code" -eq 6
check 'the smoke did not run' test "$(grep -c 'the view is on screen' "$work/out")" -eq 0
check 'the summary says another deploy came first' grep -q 'another deploy came first' "$work/summary"

run 'abc new' mobile abc
check 'a deploy during the check: not counted (exit 6)' test "$code" -eq 6

printf '| View | Result | Detail |\n| --- | --- | --- |\n| default | identical | sha256 1 |\n| orbit-180 | DIFFERS | 9 pixels |\n' >"$work/table.md"
run 'abc abc' visual-diff abc
check 'two identical shoots pass, orbit-180 may differ' test "$code" -eq 0
check 'the summary holds the table' grep -q '^| default | identical' "$work/summary"

printf '| View | Result | Detail |\n| --- | --- | --- |\n| default | DIFFERS | 3 pixels |\n| orbit-180 | identical | sha256 2 |\n' >"$work/table.md"
run 'abc abc' visual-diff abc
check 'any other view that differs between the shoots fails' test "$code" -eq 1

: >"$work/table.md"
run 'abc abc' visual-diff abc
check 'a comparison without a table fails' test "$code" -eq 1

code=0
"$scripts/staging-checks.sh" catalog abc >/dev/null 2>&1 || code=$?
check 'an unknown check is a usage error' test "$code" -eq 1

echo "$pass passed, $fail failed"
[[ $fail -eq 0 ]]
