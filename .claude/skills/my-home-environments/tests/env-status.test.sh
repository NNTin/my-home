#!/usr/bin/env bash
# Offline tests for the env-status.sh deploy policy: gh is stubbed, nothing touches the network.
# Run: .claude/skills/my-home-environments/tests/env-status.test.sh
set -euo pipefail
# shellcheck source=../scripts/env-status.sh
source "$(dirname "${BASH_SOURCE[0]}")/../scripts/env-status.sh"

ago() { date -u -d "-$1 min" +%FT%TZ; }

# Stub state: HEAD (main), RUNS (gh run list JSON), JOBS[run id] (gh run view --json jobs).
HEAD=
RUNS='[]'
declare -A JOBS=()
gh() {
  case "$1 $2" in
    "api repos/$MY_HOME_REPO/commits/main") jq -n --arg sha "$HEAD" '{sha: $sha}' ;;
    "run list") printf '%s\n' "$RUNS" ;;
    "run view") if [[ -n ${JOBS[$3]:-} ]]; then printf '%s\n' "${JOBS[$3]}"; else echo '{"jobs":[]}'; fi ;;
    "pr list") echo '[{"number":42}]' ;;
    *) return 1 ;;
  esac
}

# run_json <id> <event> <branch> <sha>
run_json() {
  jq -nc --argjson id "$1" --arg event "$2" --arg branch "$3" --arg sha "$4" --arg at "$(ago 120)" \
    '{databaseId: $id, event: $event, headBranch: $branch, headSha: $sha, status: "completed",
      conclusion: null, createdAt: $at, url: "https://example.test/run/\($id)"}'
}

# jobs_json <publish status> <publish conclusion|""> <publish completed minutes ago|""> <deploy conclusion|"">
jobs_json() {
  local completed=null
  [[ -n $3 ]] && completed="\"$(ago "$3")\""
  jq -nc --arg ps "$1" --arg pc "$2" --argjson completed "$completed" --arg dc "$4" '{jobs: [
      {name: "check", status: "completed", conclusion: "success"},
      {name: "publish", status: $ps, conclusion: (if $pc == "" then null else $pc end), completedAt: $completed},
      {name: "deploy", status: (if $dc == "" then "queued" else "completed" end),
       conclusion: (if $dc == "" then null else $dc end)}]}'
}

pass=0 fail=0
expect() {
  local name=$1 want=$2
  if [[ $fresh_state == "$want" ]]; then
    pass=$((pass + 1))
    printf 'ok    %s: %s\n' "$name" "$fresh_state"
  else
    fail=$((fail + 1))
    printf 'FAIL  %s: want %s, got %s (%s)\n' "$name" "$want" "$fresh_state" "$fresh_msg"
  fi
}

STALE_MINUTES=60
HEAD=new0000000000
RUNS="[$(run_json 1 push main "$HEAD")]"

check_production "$HEAD"
expect "production runs main HEAD" OK

JOBS[1]=$(jobs_json in_progress "" "" "")
check_production old0000000000
expect "production: publish still running (null conclusion)" PENDING

JOBS[1]=$(jobs_json completed failure 5 "")
check_production old0000000000
expect "production: publish failed" CI_FAILED

JOBS[1]=$(jobs_json completed success 10 failure)
check_production old0000000000
expect "production: published 10 min ago, deploy job failed" DEPLOYING
[[ $fresh_msg == *"deploy failure"* ]] || {
  fail=$((fail + 1))
  echo "FAIL  the failed deploy job is not mentioned: $fresh_msg"
}

JOBS[1]=$(jobs_json completed success 61 success)
check_production old0000000000
expect "production: published 61 min ago, not caught up" BROKEN

STALE_MINUTES=90
check_production old0000000000
expect "production: STALE_MINUTES=90 keeps 61 min in the window" DEPLOYING
STALE_MINUTES=60

RUNS="[]"
check_production old0000000000
expect "production: no CI run for HEAD yet" PENDING

# Staging: newest run is a PR still publishing, then a tag that published; a fork PR never publishes.
RUNS="[$(run_json 13 pull_request feat/x pr0000000000 | jq -c --arg at "$(ago 2)" '.createdAt = $at'),
  $(run_json 12 pull_request fork-branch fork00000000 | jq -c --arg at "$(ago 5)" '.createdAt = $at'),
  $(run_json 11 push v1.2.3 tag0000000000 | jq -c --arg at "$(ago 30)" '.createdAt = $at'),
  $(run_json 10 pull_request feat/old old0000000000 | jq -c --arg at "$(ago 200)" '.createdAt = $at')]"
JOBS[13]=$(jobs_json in_progress "" "" "")
JOBS[12]=$(jobs_json completed skipped "" "")
JOBS[11]=$(jobs_json completed success 20 failure)
JOBS[10]=$(jobs_json completed success 190 success)

check_staging tag0000000000
expect "staging runs the newest published image" OK
check_staging old0000000000
expect "staging: tag published 20 min ago, deploy failed" DEPLOYING
[[ $fresh_msg == *"still publishing"* && $staging_ref == "PR #42 (feat/old)" ]] || {
  fail=$((fail + 1))
  echo "FAIL  staging message or ref: $fresh_msg / $staging_ref"
}

JOBS[11]=$(jobs_json completed success 75 failure)
check_staging old0000000000
expect "staging: tag published 75 min ago, not caught up" BROKEN

echo "$pass passed, $fail failed"
((fail == 0))
