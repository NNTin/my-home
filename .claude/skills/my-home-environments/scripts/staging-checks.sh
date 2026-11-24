#!/usr/bin/env bash
# staging-checks.sh <walk|mobile|visual-diff> <commit> [--out DIR]
#
# One of the browser checks of a pull request on staging, as CI runs them after the deploy (the `staging-checks`
# job of .github/workflows/ci.yml). Read-only. Staging is shared and the latest deploy wins, so the check only
# counts when staging ran <commit> (the full sha) before and after it:
#   walk         walk-smoke.sh
#   mobile       mobile-smoke.sh (phone layout, frame loop and budgets, named views, section, "Save image")
#   visual-diff  visual-diff.sh shoot, twice, and compare: every view must come out byte-identical both times,
#                except orbit-180 (a drag view whose camera angle is known to vary now and then)
# The canvas shots and the smoke's screenshot go to DIR (default: a new temp directory); with GITHUB_STEP_SUMMARY
# set, the result is appended to it as Markdown.
# Exit 0 passed, 1 the check failed or a tool is missing, 6 staging ran another commit before or after.
set -euo pipefail
script_dir=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
# shellcheck source=lib.sh
source "$script_dir/lib.sh"

usage() {
  sed -n '2,13s/^# \{0,1\}//p' "$0" >&2
  exit 1
}

[[ $# -ge 2 ]] || usage
check=$1 commit=$2
shift 2
out=''
while [[ $# -gt 0 ]]; do
  [[ $# -ge 2 && $1 == --out ]] || usage
  out=$2
  shift 2
done
case "$check" in
  walk | mobile | visual-diff) ;;
  *) usage ;;
esac
require_tools jq node
out=${out:-$(mktemp -d)}
mkdir -p "$out"
[[ $out == /* ]] || out="$PWD/$out"

summary() {
  [[ -n ${GITHUB_STEP_SUMMARY:-} ]] || return 0
  cat >>"$GITHUB_STEP_SUMMARY"
}

# The scripts it runs; the offline tests put stubs here.
site_curl=${SITE_CURL:-$script_dir/site-curl.sh}
checks_dir=${STAGING_CHECKS_SCRIPTS:-$script_dir}

deployed() {
  "$site_curl" staging /api/health/live | jq -r '.commit // empty'
}

# same_commit <when>: exits 6 unless staging runs the commit under test.
same_commit() {
  local now
  now=$(deployed) || now=
  [[ $now == "$commit" ]] && return 0
  printf '### %s on staging: not counted\n\nStaging ran %s %s the check, not %s: another deploy came first. Run the job again once this commit is deployed.\n' \
    "$check" "${now:-an unknown commit}" "$1" "$commit" | summary
  warn "staging runs ${now:-unknown} $1 the check, not $commit: another deploy came first, run it again"
  exit 6
}

same_commit before
log="$out/$check.log"
status=0
case "$check" in
  walk) "$checks_dir/walk-smoke.sh" staging --out "$out/walk.png" >"$log" 2>&1 || status=$? ;;
  mobile) "$checks_dir/mobile-smoke.sh" staging --out "$out/mobile.png" >"$log" 2>&1 || status=$? ;;
  visual-diff)
    {
      "$checks_dir/visual-diff.sh" staging shoot --out "$out/first" &&
        "$checks_dir/visual-diff.sh" staging shoot --out "$out/second"
    } >"$log" 2>&1 || status=$?
    if [[ $status -eq 0 ]]; then
      # compare exits 5 when views differ: which ones decides.
      "$checks_dir/visual-diff.sh" compare "$out/first" "$out/second" >"$out/compare.md" 2>>"$log" || true
      cat "$out/compare.md" >>"$log"
      grep -q '^| ' "$out/compare.md" || status=1
      if grep '| DIFFERS |' "$out/compare.md" | grep -qv '^| orbit-180 |'; then status=1; fi
    fi
    ;;
esac
cat "$log"
same_commit after

verdict=passed
[[ $status -eq 0 ]] || verdict=FAILED
{
  printf '### %s on staging at %s: %s\n\n' "$check" "${commit:0:7}" "$verdict"
  if [[ $check == visual-diff && -s $out/compare.md ]]; then
    printf 'Two shoots of every view, compared (orbit-180 may differ):\n\n'
    cat "$out/compare.md"
  else
    printf '%s checks passed.\n\n' "$(grep -c '^ok ' "$log" || true)"
    grep -E '^(FAIL|FAILED|skip) ' "$log" | sed 's/^/- /' || true
  fi
  printf '\n'
} | summary
exit "$status"
