#!/usr/bin/env bash
# staging-checks-result.sh
#
# The one result of a CI run's browser checks on staging (the job `staging-checks-result` of
# .github/workflows/ci.yml), from the results of the jobs before it, in the environment:
#   CHANNEL   publish's channel (staging, main or empty)    PUBLISH, DEPLOY, CHECKS  their jobs' results
#   FORK      true for a pull request from a fork             TOKEN_SET  true when NNTIN_BOT_TOKEN is set
#   RUN_ID, GITHUB_REPOSITORY  to list the run's staging-checks jobs (gh api; GH_TOKEN)
# Writes the verdict, then a table of every staging-checks job (shard) and its conclusion, to
# GITHUB_STEP_SUMMARY (stdout without it). Exit 0 when every shard passed, or when there was nothing to check
# (a push to main, a fork's pull request, or no token: said so, never as "passed"); 1 when a shard failed, was
# cancelled or skipped though staging was deployed, or the deploy did not happen.
set -uo pipefail

summary() {
  if [[ -n ${GITHUB_STEP_SUMMARY:-} ]]; then cat >>"$GITHUB_STEP_SUMMARY"; else cat; fi
}

# verdict <exit> <heading> [text]: the first lines of the summary, then the table of shards (if any), and the exit.
table=''
verdict() {
  {
    printf '### Browser checks on staging: %s\n\n' "$2"
    [[ -z ${3:-} ]] || printf '%s\n\n' "$3"
    printf '%s' "$table"
  } | summary
  [[ $1 -eq 0 ]] || echo "::error::browser checks on staging: $2"
  exit "$1"
}

# shards: sets `table` to the run's staging-checks jobs and their conclusions; fails unless every one passed.
shards() {
  local jobs
  jobs=$(gh api "repos/$GITHUB_REPOSITORY/actions/runs/$RUN_ID/jobs?filter=latest&per_page=100" \
    --jq '[.jobs[] | select(.name | startswith("staging-checks (")) | {name, conclusion}]') || {
    table=$'The jobs of this run could not be listed.\n'
    return 1
  }
  table=$(
    printf '%s jobs:\n\n| Job | Conclusion |\n| --- | --- |\n' "$(jq length <<<"$jobs")"
    jq -r '.[] | "| \(.name) | \(.conclusion // "not finished") |"' <<<"$jobs"
  )$'\n'
  jq -e 'length > 0 and all(.conclusion == "success")' <<<"$jobs" >/dev/null
}

if [[ ${FORK:-} == true ]]; then
  verdict 0 'not run' 'A pull request from a fork is not deployed, so nothing was checked on staging.'
fi
if [[ ${CHANNEL:-} == main ]]; then
  verdict 0 'not run' 'A push to main deploys production; the browser checks run on staging only.'
fi
if [[ ${PUBLISH:-} != success || ${DEPLOY:-} != success ]]; then
  verdict 1 'not run, the deploy did not happen' "publish: ${PUBLISH:-none}, deploy: ${DEPLOY:-none}."
fi
if [[ ${TOKEN_SET:-} != true ]]; then
  echo '::warning::The secret NNTIN_BOT_TOKEN is not set: the checks on staging were skipped (docs/deployment.md § Checks on staging).'
  verdict 0 'skipped, the secret NNTIN_BOT_TOKEN is not set' 'Nothing was checked: this is no pass.'
fi
listed=0
shards || listed=1
if [[ ${CHECKS:-} != success || $listed -ne 0 ]]; then
  verdict 1 'FAILED' "A shard failed, was cancelled or skipped (staging-checks: ${CHECKS:-none}): see the table and that job's summary."
fi
verdict 0 'passed' 'Every shard passed.'
