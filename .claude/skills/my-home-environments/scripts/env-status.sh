#!/usr/bin/env bash
# env-status.sh [staging|production|all]   (default: all)
#
# Checks each environment: public /api/health/live (deployed commit), authenticated /api/health and /, and
# whether the deployed commit is current. Production must run origin/main HEAD; staging must run its latest
# GitHub deployment (the newest same-repo PR push, v* tag or dispatch). While CI/deploy for the newer commit
# is still running, and for up to ENV_STATUS_GRACE_MINUTES (default 45) after it started, that is DEPLOYING.
# Exits 0 when every environment is OK or DEPLOYING, 1 when any is BROKEN or STALE, 2 on usage errors.
# Prints no tokens; the output is safe to paste into an issue.
set -euo pipefail
# shellcheck source=lib.sh
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

GRACE_MINUTES=${ENV_STATUS_GRACE_MINUTES:-45}

usage() {
  sed -n '2,9s/^# \{0,1\}//p' "$0" >&2
  exit 2
}

case "${1:-all}" in
  all) envs=(staging production) ;;
  staging | stg | production | prod) envs=("$1") ;;
  *) usage ;;
esac
require_tools curl jq

SITE_RESPONSE_BODY=$(mktemp)
SITE_RESPONSE_HEADERS=$(mktemp)
trap 'rm -f "$SITE_RESPONSE_BODY" "$SITE_RESPONSE_HEADERS"' EXIT

have_gh=0
command -v gh >/dev/null 2>&1 && gh auth status >/dev/null 2>&1 && have_gh=1

line() { printf '  %-8s %s\n' "$1" "$2"; }

# minutes_since <ISO-8601 time>
minutes_since() { echo $((($(date +%s) - $(date -d "$1" +%s)) / 60)); }

# failed_jobs <run id>: names of failed jobs, comma separated.
failed_jobs() {
  gh run view "$1" -R "$MY_HOME_REPO" --json jobs \
    --jq '[.jobs[] | select(.conclusion == "failure" or .conclusion == "timed_out") | .name] | join(", ")'
}

# describe_ref <ref>: "PR #N" / "tag vX" / "branch X" for a staging deployment ref.
describe_ref() {
  local ref=$1 pr
  [[ $ref == v* ]] && gh api "repos/$MY_HOME_REPO/git/ref/tags/$ref" >/dev/null 2>&1 && {
    echo "tag $ref"
    return
  }
  pr=$(gh pr list -R "$MY_HOME_REPO" --head "$ref" --state all -L 1 --json number --jq '.[0].number // empty' \
    2>/dev/null || true)
  if [[ -n $pr ]]; then echo "PR #$pr ($ref)"; else echo "branch $ref"; fi
}

# check_production <live commit>: sets fresh_state and fresh_msg.
check_production() {
  local live=$1 head run status conclusion created url id jobs
  head=$(gh api "repos/$MY_HOME_REPO/commits/main" --jq .sha 2>/dev/null) ||
    head=$(git ls-remote "https://github.com/$MY_HOME_REPO.git" refs/heads/main 2>/dev/null | cut -f1) || head=
  if [[ -z $head ]]; then
    fresh_state=UNKNOWN fresh_msg="could not read origin/main HEAD"
    return
  fi
  if [[ $live == "$head" ]]; then
    fresh_state=OK fresh_msg="runs origin/main HEAD ${head:0:7}"
    return
  fi
  run=$(gh run list -R "$MY_HOME_REPO" -w ci.yml -b main -e push -c "$head" -L 1 \
    --json databaseId,status,conclusion,createdAt,url --jq '.[0] // empty' 2>/dev/null || true)
  if [[ -z $run ]]; then
    created=$(gh api "repos/$MY_HOME_REPO/commits/$head" --jq .commit.committer.date 2>/dev/null || date -u +%FT%TZ)
    if (($(minutes_since "$created") < GRACE_MINUTES)); then
      fresh_state=DEPLOYING fresh_msg="main HEAD ${head:0:7} has no CI run yet"
    else
      fresh_state=STALE fresh_msg="main HEAD ${head:0:7} has no CI run after $(minutes_since "$created") min"
    fi
    return
  fi
  IFS=$'\t' read -r id status conclusion created url < <(jq -r '[.databaseId, .status, .conclusion, .createdAt,
    .url] | @tsv' <<<"$run")
  if [[ $status != completed ]]; then
    if (($(minutes_since "$created") < GRACE_MINUTES)); then
      fresh_state=DEPLOYING fresh_msg="CI for main HEAD ${head:0:7} is $status: $url"
    else
      fresh_state=STALE fresh_msg="CI for main HEAD ${head:0:7} is still $status after $(minutes_since "$created") min: $url"
    fi
    return
  fi
  if [[ $conclusion == success ]]; then
    fresh_state=STALE fresh_msg="CI for main HEAD ${head:0:7} succeeded but production runs ${live:0:7}: $url"
    return
  fi
  jobs=$(failed_jobs "$id" 2>/dev/null || true)
  if [[ -z $jobs || $jobs == *publish* || $jobs == *deploy* ]]; then
    fresh_state=STALE fresh_msg="deploy of main HEAD ${head:0:7} failed (${jobs:-$conclusion}): $url"
  else
    # Checks failed before publishing: a code problem on main, not an environment problem.
    fresh_state=WARN fresh_msg="runs ${live:0:7}; CI for main HEAD ${head:0:7} failed in $jobs before deploying: $url"
  fi
}

# check_staging <live commit>: sets fresh_state, fresh_msg and staging_ref.
check_staging() {
  local live=$1 deployments latest_sha latest_ref latest_created latest_id dep_state run id jobs url
  deployments=$(gh api "repos/$MY_HOME_REPO/deployments?environment=staging&per_page=30" 2>/dev/null) || {
    fresh_state=UNKNOWN fresh_msg="could not list staging deployments"
    return
  }
  staging_ref=$(jq -r --arg sha "$live" '[.[] | select(.sha == $sha)][0].ref // empty' <<<"$deployments")
  [[ -n $staging_ref ]] && staging_ref=$(describe_ref "$staging_ref")
  IFS=$'\t' read -r latest_id latest_sha latest_ref latest_created < <(jq -r '.[0] | [.id, .sha, .ref,
    .created_at] | @tsv' <<<"$deployments")
  dep_state=$(gh api "repos/$MY_HOME_REPO/deployments/$latest_id/statuses" --jq '.[0].state // "pending"' \
    2>/dev/null || echo unknown)
  if [[ $live == "$latest_sha" ]]; then
    fresh_state=OK fresh_msg="runs the latest staging deployment ($latest_ref, $latest_created)"
  else
    case "$dep_state" in
      queued | pending | in_progress | waiting)
        if (($(minutes_since "$latest_created") < GRACE_MINUTES)); then
          fresh_state=DEPLOYING fresh_msg="deploying ${latest_sha:0:7} ($latest_ref), state $dep_state"
        else
          fresh_state=STALE fresh_msg="deploy of ${latest_sha:0:7} ($latest_ref) still $dep_state after" \
            "$(minutes_since "$latest_created") min"
        fi
        ;;
      *) fresh_state=STALE fresh_msg="latest deployment ${latest_sha:0:7} ($latest_ref) is $dep_state but staging runs ${live:0:7}" ;;
    esac
    return
  fi
  # A newer staging CI run whose publish or deploy failed never shows up as a deployment.
  run=$(gh run list -R "$MY_HOME_REPO" -w ci.yml -L 20 \
    --json databaseId,event,headBranch,status,conclusion,createdAt,url 2>/dev/null |
    jq -c --arg after "$latest_created" '[.[] | select(.createdAt > $after and .status == "completed"
      and .conclusion == "failure" and (.event == "pull_request" or .event == "workflow_dispatch"
      or (.event == "push" and .headBranch != "main")))][0] // empty' 2>/dev/null || true)
  if [[ -n $run ]]; then
    IFS=$'\t' read -r id url < <(jq -r '[.databaseId, .url] | @tsv' <<<"$run")
    jobs=$(failed_jobs "$id" 2>/dev/null || true)
    if [[ $jobs == *publish* || $jobs == *deploy* ]]; then
      fresh_state=STALE fresh_msg="a newer staging deploy failed ($jobs): $url"
    fi
  fi
}

failures=()
for env in "${envs[@]}"; do
  resolve_env "$env"
  state=OK
  printf '%s  %s\n' "$SITE_ENV" "$SITE_BASE"

  live_json=$(curl -sS --max-time 20 "$SITE_BASE/api/health/live" 2>&1) || live_json=
  commit=$(jq -r 'select(.status == "ok") | .commit // empty' <<<"$live_json" 2>/dev/null || true)
  if [[ -n $commit ]]; then
    line live "ok, commit $commit"
  else
    line live "FAILED: $(printf '%s' "${live_json:-no response}" | head -c 200 | redact)"
    state=BROKEN
  fi

  # A failed exchange exits, so try it in a subshell first; authed_request then reuses the cached token.
  if auth_err=$(site_token 2>&1 >/dev/null) && authed_request /api/health; then
    if [[ $SITE_STATUS == 200 ]] && jq -e '.status == "ok"' "$SITE_RESPONSE_BODY" >/dev/null 2>&1; then
      line health "ok (db $(jq -r '.db.status // "?"' "$SITE_RESPONSE_BODY"))"
    else
      line health "FAILED: HTTP $SITE_STATUS $(head -c 200 "$SITE_RESPONSE_BODY" | redact)"
      state=BROKEN
    fi
    if authed_request / && [[ $SITE_STATUS == 200 ]] && grep -qi '<html' "$SITE_RESPONSE_BODY"; then
      line web "ok (HTTP 200)"
    else
      line web "FAILED: HTTP ${SITE_STATUS:-none}"
      state=BROKEN
    fi
  else
    line auth "FAILED: $(printf '%s' "${auth_err:-request failed}" | redact)"
    state=BROKEN
  fi

  if [[ -n $commit && $have_gh == 1 ]]; then
    staging_ref=
    if [[ $SITE_ENV == production ]]; then check_production "$commit"; else check_staging "$commit"; fi
    [[ -n $staging_ref ]] && line runs "$staging_ref"
    line deploy "$fresh_state: $fresh_msg"
    [[ $state == OK && $fresh_state != OK && $fresh_state != WARN && $fresh_state != UNKNOWN ]] &&
      state=$fresh_state
  elif [[ -n $commit ]]; then
    line deploy "UNKNOWN: gh is not logged in, cannot compare with GitHub"
  fi

  line result "$state"
  [[ $state == OK || $state == DEPLOYING ]] || failures+=("$SITE_ENV: $state")
done

if ((${#failures[@]})); then
  printf '\nNOT OK: %s\n' "$(IFS=';' && echo "${failures[*]}")"
  exit 1
fi
printf '\nall checked environments OK\n'
