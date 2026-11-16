#!/usr/bin/env bash
# raise-env-issue.sh [--dry-run] <staging|production> <summary> [details-file]
#
# Reports a broken or stale environment in NNTin/my-home. Looks for an open issue labelled 'environment'
# whose title starts with '[env] <env>:' and comments there; otherwise creates '[env] <env>: <summary>'
# (and the label if it is missing). The body is the summary plus the details file, or the env-status.sh
# output when no file is given. Everything token-shaped is redacted. --dry-run only prints what it would do.
set -euo pipefail
# shellcheck source=lib.sh
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

LABEL=environment

usage() {
  sed -n '2,8s/^# \{0,1\}//p' "$0" >&2
  exit 2
}

dry_run=0
if [[ ${1:-} == --dry-run ]]; then
  dry_run=1
  shift
fi
[[ $# -ge 2 && $# -le 3 && -n $2 ]] || usage
resolve_env "$1"
summary=$2
details_file=${3:-}
require_tools gh jq curl
gh auth status >/dev/null 2>&1 || die "gh is not logged in"

if [[ -n $details_file ]]; then
  [[ -r $details_file ]] || die "cannot read $details_file"
  details=$(<"$details_file")
else
  details=$("$(dirname "${BASH_SOURCE[0]}")/env-status.sh" "$SITE_ENV" 2>&1 || true)
fi

prefix="[env] $SITE_ENV:"
body=$(
  cat <<EOF
$summary

Environment: $SITE_ENV ($SITE_BASE), checked $(date -u +%FT%TZ).

\`\`\`text
$details
\`\`\`

Raised by \`.claude/skills/my-home-environments/scripts/raise-env-issue.sh\`.
EOF
)
body=$(redact <<<"$body")
summary=$(redact <<<"$summary")

existing=$(gh issue list -R "$MY_HOME_REPO" --state open --label "$LABEL" -L 50 --json number,title,url |
  jq -r --arg p "$prefix" '[.[] | select(.title | startswith($p))] | sort_by(.number) | .[0] // empty
    | "\(.number)\t\(.url)"')

if [[ -n $existing ]]; then
  IFS=$'\t' read -r number url <<<"$existing"
  if ((dry_run)); then
    printf 'dry run: would comment on #%s (%s):\n\n%s\n' "$number" "$url" "$body"
    exit 0
  fi
  gh issue comment "$number" -R "$MY_HOME_REPO" --body-file - <<<"$body"
  exit 0
fi

title="$prefix $summary"
if ((dry_run)); then
  if ! gh label list -R "$MY_HOME_REPO" --search "$LABEL" --json name --jq '.[].name' | grep -qx "$LABEL"; then
    printf "dry run: would create label '%s'\n" "$LABEL"
  fi
  printf "dry run: would create issue '%s' with label '%s':\n\n%s\n" "$title" "$LABEL" "$body"
  exit 0
fi
if ! gh label list -R "$MY_HOME_REPO" --search "$LABEL" --json name --jq '.[].name' | grep -qx "$LABEL"; then
  gh label create "$LABEL" -R "$MY_HOME_REPO" --color d93f0b \
    --description 'A deployed environment is broken or no longer deploys'
fi
gh issue create -R "$MY_HOME_REPO" --title "$title" --label "$LABEL" --body-file - <<<"$body"
