#!/usr/bin/env bash
# Offline tests for staging-checks-result.sh, the one result of a run's browser checks: gh is stubbed.
# Run: .claude/skills/my-home-environments/tests/staging-checks-result.test.sh
# shellcheck disable=SC2317,SC2329 # the helpers below are invoked through check()
set -euo pipefail
scripts=$(cd "$(dirname "${BASH_SOURCE[0]}")/../scripts" && pwd)
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT

# gh api prints the jobs in $STUB_JOBS (the --jq filter applied by jq), or fails when it is "error".
mkdir -p "$work/bin"
cat >"$work/bin/gh" <<'STUB'
#!/usr/bin/env bash
[[ $STUB_JOBS != error ]] || exit 1
[[ $1 == api && $2 == */actions/runs/42/jobs* && $3 == --jq ]] || exit 2
jq -c "$4" <<<"$STUB_JOBS"
STUB
chmod +x "$work/bin/gh"

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

job() { printf '{"name":"%s","conclusion":%s}' "$1" "$2"; }
passed_jobs="{\"jobs\":[$(job 'staging-checks (walk)' '"success"'),$(job 'staging-checks (mobile 1/4)' '"success"'),$(job 'staging-checks-result' null),$(job check '"success"')]}"

# run [VAR=value]...: the deployed, token-holding defaults overridden; exit in $code, summary in $work/summary.
run() {
  rm -f "$work/summary"
  code=0
  env PATH="$work/bin:$PATH" GITHUB_STEP_SUMMARY="$work/summary" GITHUB_REPOSITORY=o/r RUN_ID=42 \
    CHANNEL=staging PUBLISH=success DEPLOY=success CHECKS=success FORK=false TOKEN_SET=true \
    STUB_JOBS="$passed_jobs" "$@" "$scripts/staging-checks-result.sh" >"$work/out" 2>&1 || code=$?
}
first_line() { [[ $(head -n1 "$work/summary") == "$1" ]]; }
says() { grep -qF -- "$1" "$work/summary"; }

run
check 'every shard passed: passes' test "$code" -eq 0
check 'and says so in the first line' first_line '### Browser checks on staging: passed'
only_the_shards() {
  grep -q '^2 jobs:' "$1" && grep -qF '| staging-checks (mobile 1/4) | success |' "$1" &&
    ! grep -q 'staging-checks-result\|^| check ' "$1"
}
check 'with a table of the staging-checks jobs, the result job and others left out' only_the_shards "$work/summary"

run CHECKS=failure STUB_JOBS="{\"jobs\":[$(job 'staging-checks (walk)' '"success"'),$(job 'staging-checks (catalog 2/2)' '"failure"')]}"
check 'a failed shard fails' test "$code" -eq 1
check 'it says FAILED first' first_line '### Browser checks on staging: FAILED'
check 'and names the shard' says '| staging-checks (catalog 2/2) | failure |'

run STUB_JOBS="{\"jobs\":[$(job 'staging-checks (walk)' '"success"'),$(job 'staging-checks (visual-diff 3/4)' '"skipped"')]}"
check 'a shard skipped though staging was deployed fails, whatever the matrix says' test "$code" -eq 1
check 'it names the skipped shard' says '| staging-checks (visual-diff 3/4) | skipped |'

run CHECKS=cancelled
check 'cancelled checks fail' test "$code" -eq 1
run STUB_JOBS='{"jobs":[]}'
check 'no staging-checks job at all fails' test "$code" -eq 1
run STUB_JOBS=error
check 'jobs that cannot be listed fail' test "$code" -eq 1
check 'and it says so' says 'could not be listed'

run DEPLOY=failure CHECKS=skipped
check 'a failed deploy fails' test "$code" -eq 1
check 'saying the checks did not run' first_line '### Browser checks on staging: not run, the deploy did not happen'
run PUBLISH=skipped DEPLOY=skipped CHECKS=skipped
check 'publish skipped (an earlier job failed) fails' test "$code" -eq 1

run FORK=true PUBLISH=skipped DEPLOY=skipped CHECKS=skipped CHANNEL=
check "a fork's pull request is not deployed: passes" test "$code" -eq 0
check 'and says the checks did not run' first_line '### Browser checks on staging: not run'
run CHANNEL=main CHECKS=skipped
check 'a push to main (production) passes' test "$code" -eq 0
check 'saying the checks run on staging only' says 'on staging only'

run TOKEN_SET=false
check 'without the token: passes, as the shards do' test "$code" -eq 0
check 'saying skipped, not passed' first_line '### Browser checks on staging: skipped, the secret NNTIN_BOT_TOKEN is not set'
check 'with the warning' grep -q '::warning::The secret NNTIN_BOT_TOKEN is not set' "$work/out"

echo "$pass passed, $fail failed"
[[ $fail -eq 0 ]]
