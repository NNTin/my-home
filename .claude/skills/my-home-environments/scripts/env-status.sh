#!/usr/bin/env bash
# env-status.sh [staging|production|all]   (default: all)
#
# Checks each environment: public /api/health/live (deployed commit), authenticated /api/health and /, and
# whether the deployed commit has caught up. Expected commit: production = origin/main HEAD; staging = the
# newest same-repo PR push, v* tag or dispatch whose CI publish job succeeded.
#   OK         runs the expected commit
#   DEPLOYING  image published less than STALE_MINUTES (default 60) ago, even if the deploy job failed
#   PENDING    image not published yet (CI still running); CI_FAILED: publish failed. CI issues, not BROKEN
#   BROKEN     down or unhealthy on every probe (ENV_STATUS_PROBES, default 4, every ENV_STATUS_PROBE_INTERVAL
#              seconds, default 40), or the image was published more than STALE_MINUTES ago and the
#              environment still runs another commit
# Exits 4 when any environment is BROKEN, 0 when none is, 2 on usage errors and 1 on script or tool errors.
# Prints no tokens.
set -euo pipefail
# shellcheck source=lib.sh
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

STALE_MINUTES=${STALE_MINUTES:-60}
PROBES=${ENV_STATUS_PROBES:-4}
PROBE_INTERVAL=${ENV_STATUS_PROBE_INTERVAL:-40}
RUN_FIELDS=databaseId,event,headBranch,headSha,status,conclusion,createdAt,url

usage() {
  sed -n '2,14s/^# \{0,1\}//p' "$0" >&2
  exit 2
}

line() { printf '  %-8s %s\n' "$1" "$2"; }

# minutes_since <ISO-8601 time>
minutes_since() { echo $((($(date +%s) - $(date -d "$1" +%s)) / 60)); }

# fields <jq paths...>: one line of the given fields joined by \x1f, a non-whitespace IFS character, so that
# empty fields (a null .conclusion while a run is in progress) do not collapse the way tabs do under read.
fields() { jq -r "[$(IFS=, && echo "$*")] | map(. // \"\" | tostring) | join(\"\\u001f\")"; }

# GitHub lookups. They return raw JSON so the tests can stub gh.
main_head() { gh api "repos/$MY_HOME_REPO/commits/main" | jq -r '.sha // empty'; }
runs_list() { gh run list -R "$MY_HOME_REPO" -w ci.yml --json "$RUN_FIELDS" "$@"; }
run_jobs() { gh run view "$1" -R "$MY_HOME_REPO" --json jobs; }

# publish_info <run id>: sets pub_state (pending|failed|skipped|success), pub_done (completion time), pub_note
# (publish/deploy job outcome) and failed (failed job names) for one CI run.
publish_info() {
  local jobs
  jobs=$(run_jobs "$1") || jobs='{"jobs":[]}'
  local pub_status pub_conclusion dep_status dep_conclusion
  IFS=$'\x1f' read -r pub_status pub_conclusion pub_done < <(jq '[.jobs[] | select(.name == "publish")][0] // {}' \
    <<<"$jobs" | fields .status .conclusion .completedAt)
  IFS=$'\x1f' read -r dep_status dep_conclusion < <(jq '[.jobs[] | select(.name == "deploy")][0] // {}' \
    <<<"$jobs" | fields .status .conclusion)
  failed=$(jq -r '[.jobs[] | select(.conclusion == "failure" or .conclusion == "timed_out") | .name]
    | join(", ")' <<<"$jobs")
  if [[ $pub_status == completed && $pub_conclusion == success ]]; then
    pub_state=success
  elif [[ -z $failed && $pub_status == completed && $pub_conclusion =~ ^(skipped|cancelled)$ ]]; then
    # Fork pull requests skip publishing; superseded pushes are cancelled. Neither is a failure.
    pub_state=skipped
  elif [[ $pub_status == completed || -n $failed ]]; then
    pub_state=failed
  else
    pub_state=pending
  fi
  pub_note="publish ${pub_conclusion:-${pub_status:-not started}}, deploy ${dep_conclusion:-${dep_status:-not started}}"
}

# classify <live sha> <expected sha> <label> <run json or empty>: sets fresh_state and fresh_msg.
classify() {
  local live=$1 expected=$2 label=$3 run=$4 id url age
  if [[ $live == "$expected" ]]; then
    fresh_state=OK fresh_msg="runs $label"
    return
  fi
  if [[ -z $run ]]; then
    fresh_state=PENDING fresh_msg="no CI run for $label yet; runs ${live:0:7}"
    return
  fi
  IFS=$'\x1f' read -r id url < <(fields .databaseId .url <<<"$run")
  publish_info "$id"
  case "$pub_state" in
    pending) fresh_state=PENDING fresh_msg="CI for $label is still running, image not published yet ($pub_note)" ;;
    failed | skipped)
      fresh_state=CI_FAILED fresh_msg="image for $label was not published (${failed:+failed: }${failed:-$pub_note}); a CI issue"
      ;;
    success)
      age=$(minutes_since "$pub_done")
      if ((age < STALE_MINUTES)); then
        fresh_state=DEPLOYING fresh_msg="image for $label published ${age} min ago ($pub_note); BROKEN after"
        fresh_msg+=" ${STALE_MINUTES} min"
      else
        fresh_state=BROKEN fresh_msg="image for $label published ${age} min ago (> ${STALE_MINUTES} min) but it"
        fresh_msg+=" still runs ${live:0:7} ($pub_note)"
      fi
      ;;
  esac
  fresh_msg+=": $url"
}

# check_production <live sha>
check_production() {
  local live=$1 head run
  head=$(main_head 2>/dev/null) || head=
  if [[ -z $head ]]; then
    fresh_state=UNKNOWN fresh_msg="could not read origin/main HEAD"
    return
  fi
  run=$(runs_list -b main -e push -L 10 2>/dev/null |
    jq -c --arg sha "$head" '[.[] | select(.headSha == $sha)][0] // empty') || run=
  classify "$live" "$head" "main HEAD ${head:0:7}" "$run"
}

# describe_run <run json>: "PR #N (branch)", "tag vX" or "dispatch of X".
describe_run() {
  local event branch pr
  IFS=$'\x1f' read -r event branch < <(fields .event .headBranch <<<"$1")
  case "$event" in
    pull_request)
      pr=$(gh pr list -R "$MY_HOME_REPO" --head "$branch" --state all -L 1 --json number 2>/dev/null |
        jq -r '.[0].number // empty') || pr=
      if [[ -n $pr ]]; then echo "PR #$pr ($branch)"; else echo "PR branch $branch"; fi
      ;;
    workflow_dispatch) echo "dispatch of $branch" ;;
    *) echo "tag $branch" ;;
  esac
}

# check_staging <live sha>: also sets staging_ref (what staging runs, when derivable).
check_staging() {
  local live=$1 runs candidates count i run expected="" label="" newer=""
  runs=$(runs_list -L 40 2>/dev/null) || {
    fresh_state=UNKNOWN fresh_msg="could not list CI runs"
    return
  }
  # Runs that deploy to staging, newest first. Fork pull requests never publish, so they drop out below.
  candidates=$(jq -c '[.[] | select(.event == "pull_request" or .event == "workflow_dispatch"
    or (.event == "push" and .headBranch != "main"))] | sort_by(.createdAt) | reverse' <<<"$runs")
  run=$(jq -c --arg sha "$live" '[.[] | select(.headSha == $sha)][0] // empty' <<<"$candidates")
  [[ -n $run ]] && staging_ref=$(describe_run "$run")
  count=$(jq length <<<"$candidates")
  for ((i = 0; i < count && i < 10; i++)); do
    run=$(jq -c ".[$i]" <<<"$candidates")
    publish_info "$(jq -r .databaseId <<<"$run")"
    if [[ $pub_state == success ]]; then
      expected=$(jq -r .headSha <<<"$run")
      label="${expected:0:7} ($(describe_run "$run"))"
      break
    fi
    # Name the newest run that has not published (yet), so a failing PR is visible here too.
    if [[ -z $newer ]]; then
      case "$pub_state" in
        pending) newer="$(describe_run "$run") is still publishing" ;;
        failed) newer="$(describe_run "$run") publish failed (${failed:-?})" ;;
      esac
    fi
  done
  if [[ -z $expected ]]; then
    fresh_state=UNKNOWN fresh_msg="no staging CI run with a published image among the latest runs"
  else
    classify "$live" "$expected" "$label" "$run"
  fi
  [[ -n $newer ]] && fresh_msg+="; newer: $newer"
  return 0
}

# probe_env <commit file>: one round of live/health/web checks. Prints its lines; exits non-zero on failure.
# Run it in a subshell: a failed token exchange or login redirect dies, and that only ends the subshell.
probe_env() {
  local ok=0 live_json commit
  live_json=$(curl -sS --max-time 20 "$SITE_BASE/api/health/live" 2>&1) || live_json=
  commit=$(jq -r 'select(.status == "ok") | .commit // empty' <<<"$live_json" 2>/dev/null || true)
  if [[ -n $commit ]]; then
    line live "ok, commit $commit"
    printf '%s' "$commit" >"$1"
  else
    line live "FAILED: $(printf '%s' "${live_json:-no response}" | head -c 200)"
    ok=1
  fi
  if ! authed_request /api/health; then
    line health "FAILED: request error"
    ok=1
  elif [[ $SITE_STATUS == 200 ]] && jq -e '.status == "ok"' "$SITE_RESPONSE_BODY" >/dev/null 2>&1; then
    line health "ok (db $(jq -r '.db.status // "?"' "$SITE_RESPONSE_BODY"))"
  else
    line health "FAILED: HTTP $SITE_STATUS $(head -c 200 "$SITE_RESPONSE_BODY")"
    ok=1
  fi
  if authed_request / && [[ $SITE_STATUS == 200 ]] && grep -qi '<html' "$SITE_RESPONSE_BODY"; then
    line web "ok (HTTP 200)"
  else
    line web "FAILED: HTTP ${SITE_STATUS:-none}"
    ok=1
  fi
  return "$ok"
}

main() {
  local envs env state attempt out commit have_gh=0 failures=()
  case "${1:-all}" in
    all) envs=(staging production) ;;
    staging | stg | production | prod) envs=("$1") ;;
    *) usage ;;
  esac
  require_tools curl jq
  command -v gh >/dev/null 2>&1 && gh auth status >/dev/null 2>&1 && have_gh=1

  SITE_RESPONSE_BODY=$(mktemp)
  SITE_RESPONSE_HEADERS=$(mktemp)
  COMMIT_FILE=$(mktemp)
  trap 'rm -f "$SITE_RESPONSE_BODY" "$SITE_RESPONSE_HEADERS" "$COMMIT_FILE"' EXIT

  for env in "${envs[@]}"; do
    resolve_env "$env"
    state=OK
    printf '%s  %s\n' "$SITE_ENV" "$SITE_BASE"
    for ((attempt = 1; ; attempt++)); do
      : >"$COMMIT_FILE"
      if out=$( (probe_env "$COMMIT_FILE") 2>&1); then
        ((attempt > 1)) && out+=$'\n'"$(line probes "passed on attempt $attempt of $PROBES")"
        break
      fi
      if ((attempt >= PROBES)); then
        out+=$'\n'"$(line probes "failed $PROBES of $PROBES over $(((PROBES - 1) * PROBE_INTERVAL))s")"
        state=BROKEN
        break
      fi
      printf '  (probe %s of %s failed, retrying in %ss)\n' "$attempt" "$PROBES" "$PROBE_INTERVAL" >&2
      sleep "$PROBE_INTERVAL"
    done
    # A died exchange or login redirect leaves "env-status.sh: <message>"; show it as an auth line.
    out=$'\n'"$out"
    out=${out//$'\n'"${0##*/}: "/$'\n'"  auth     FAILED: "}
    redact <<<"${out#$'\n'}"
    commit=$(<"$COMMIT_FILE")

    if [[ -n $commit && $have_gh == 1 ]]; then
      staging_ref=
      if [[ $SITE_ENV == production ]]; then check_production "$commit"; else check_staging "$commit"; fi
      [[ -n $staging_ref ]] && line runs "$staging_ref"
      line deploy "$fresh_state: $fresh_msg"
      [[ $state == OK && $fresh_state != UNKNOWN ]] && state=$fresh_state
    elif [[ -n $commit ]]; then
      line deploy "UNKNOWN: gh is not logged in, cannot compare with GitHub"
    fi

    line result "$state"
    [[ $state == BROKEN ]] && failures+=("$SITE_ENV")
  done

  if ((${#failures[@]})); then
    printf '\nBROKEN: %s\n' "${failures[*]}"
    return 4
  fi
  printf '\nnot broken (see each result line)\n'
}

if [[ ${BASH_SOURCE[0]} == "$0" ]]; then
  main "$@"
fi
