#!/usr/bin/env bash
# staging-checks.sh <walk|mobile|catalog|visual-diff> <commit> [--out DIR] [--shard I/N]
#
# One of the browser checks of a pull request on staging, as CI runs them after the deploy (the `staging-checks`
# job of .github/workflows/ci.yml). Read-only. Staging is shared and the latest deploy wins, so the check only
# counts when staging ran <commit> (the full sha) before and after it:
#   walk         walk-smoke.sh
#   mobile       mobile-smoke.sh (phone layout, frame loop and budgets, named views, section, "Save image")
#   catalog      catalog-smoke.sh (the catalogue, every piece page in 3D with its dimensions, sections, thumbnails,
#                the playground; its screenshots can show photos and stay on the runner)
#   visual-diff  visual-diff.sh shoot, twice, and compare: every view must come out byte-identical both times,
#                except orbit-180 (a drag view whose camera angle is known to vary now and then). It counts only
#                if the placements, overrides and notes on staging (the seed export) stayed the same meanwhile
# --shard I/N runs one shard of mobile, catalog or visual-diff (parts.mjs balances them by shard-weights.json; each
# part is in exactly one shard), with its own reads of the commit and the data before and after.
# The canvas shots and the smoke's screenshot go to DIR (default: a new temp directory), and the result and name
# of every check to DIR/<check>.names; with GITHUB_STEP_SUMMARY set, the result is appended to it as Markdown.
# Exit 0 passed, 1 the check failed or a tool is missing, 6 not counted: staging ran another commit before or
# after, or its data was edited during a visual-diff.
set -euo pipefail
script_dir=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
# shellcheck source=lib.sh
source "$script_dir/lib.sh"

usage() {
  sed -n '2,20s/^# \{0,1\}//p' "$0" >&2
  exit 1
}

[[ $# -ge 2 ]] || usage
check=$1 commit=$2
shift 2
out='' shard=''
while [[ $# -gt 0 ]]; do
  [[ $# -ge 2 ]] || usage
  case "$1" in
    --out) out=$2 ;;
    --shard) shard=$2 ;;
    *) usage ;;
  esac
  shift 2
done
case "$check" in
  walk | mobile | catalog | visual-diff) ;;
  *) usage ;;
esac
if [[ -n $shard ]]; then
  [[ $check != walk ]] || die "walk is not sharded"
  if ! [[ $shard =~ ^([0-9]+)/([0-9]+)$ ]] || ((BASH_REMATCH[1] < 1 || BASH_REMATCH[1] > BASH_REMATCH[2])); then
    die "--shard must be I/N with 1 <= I <= N, e.g. 2/4"
  fi
fi
# The check's name in the summary: with its shard.
name=$check${shard:+ $shard}
shard_args=()
[[ -z $shard ]] || shard_args=(--shard "$shard")
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
    "$name" "${now:-an unknown commit}" "$1" "$commit" | summary
  warn "staging runs ${now:-unknown} $1 the check, not $commit: another deploy came first, run it again"
  exit 6
}

# data_mark: a fingerprint of what the environment draws besides the commit: the placements, overrides and notes.
# The owner and agents edit them on staging; a shot before and one after such an edit differ, and not by the code.
data_mark() {
  "$checks_dir/seed.sh" staging export | sha256sum | cut -d' ' -f1
}

# same_data <mark>: exits 6 when the environment's data changed since <mark> was taken.
same_data() {
  local now
  now=$(data_mark) || now=
  [[ -n $now && $now == "$1" ]] && return 0
  printf '### %s on staging: not counted\n\nThe placements, overrides or notes on staging were changed while the views were shot (someone edited them there), so the two shoots show different data. Run the job again.\n' \
    "$name" | summary
  warn "the placements, overrides or notes on staging changed during the check: not counted, run it again"
  exit 6
}

same_commit before
mark=''
if [[ $check == visual-diff ]]; then
  mark=$(data_mark) || die "could not read the seed of staging"
fi
log="$out/$check.log"
# Every check's result and name (parts.mjs recordCheck): shards together must name the same checks as one run.
export CHECK_NAMES="$out/$check.names"
: >"$CHECK_NAMES"
status=0
started=$(date +%s.%N)
case "$check" in
  walk) "$checks_dir/walk-smoke.sh" staging --out "$out/walk.png" >"$log" 2>&1 || status=$? ;;
  mobile) "$checks_dir/mobile-smoke.sh" staging --out "$out/mobile.png" "${shard_args[@]}" >"$log" 2>&1 || status=$? ;;
  catalog)
    # Every piece page is opened twice (desktop and phone): the site token must outlive that.
    SITE_TOKEN_MIN_TTL=${SITE_TOKEN_MIN_TTL:-2700} \
      "$checks_dir/catalog-smoke.sh" staging --out "$out/catalog.png" "${shard_args[@]}" >"$log" 2>&1 || status=$?
    ;;
  visual-diff)
    # The time lines of each shoot are named after it.
    {
      "$checks_dir/visual-diff.sh" staging shoot --out "$out/first" "${shard_args[@]}" | sed 's|^time  |time  first/|' &&
        "$checks_dir/visual-diff.sh" staging shoot --out "$out/second" "${shard_args[@]}" | sed 's|^time  |time  second/|'
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
awk -v a="$started" -v b="$(date +%s.%N)" -v c="$check${shard:+/$shard}" 'BEGIN { printf "time  %s %.1f s\n", c, b - a }' >>"$log"
cat "$log"
same_commit after
[[ -z $mark ]] || same_data "$mark"

verdict=passed
[[ $status -eq 0 ]] || verdict=FAILED
{
  printf '### %s on staging at %s: %s\n\n' "$name" "${commit:0:7}" "$verdict"
  # What the shard ran: a shard that is missing, or ran nothing, shows here.
  grep -m1 '^shard  ' "$log" | sed 's/^shard  /Shard: /; s/$/\n/' || true
  if [[ $check == visual-diff && -s $out/compare.md ]]; then
    printf 'Two shoots of every view, compared (orbit-180 may differ):\n\n'
    cat "$out/compare.md"
  else
    printf '%s checks passed.\n\n' "$(grep -c '^ok ' "$log" || true)"
    grep -E '^(FAIL|FAILED|skip) ' "$log" | sed 's/^/- /' || true
  fi
  printf '\n'
  # What each part took (the `time` lines of the scripts), to balance the checks over runners.
  printf '<details><summary>Time per part</summary>\n\n| Part | Seconds |\n| --- | --- |\n'
  awk '$1 == "time" { printf "| %s | %s |\n", $2, $3 }' "$log"
  printf '\n</details>\n\n'
} | summary
exit "$status"
