#!/usr/bin/env bash
# Offline tests for the raise-env-issue.sh gate: env-status.sh and gh are stubbed, nothing is posted.
# Run: .claude/skills/my-home-environments/tests/raise-env-issue.test.sh
set -euo pipefail
scripts="$(cd "$(dirname "${BASH_SOURCE[0]}")/../scripts" && pwd)"
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT
mkdir -p "$work/scripts" "$work/bin"
cp "$scripts/lib.sh" "$scripts/raise-env-issue.sh" "$work/scripts/"
cat >"$work/bin/gh" <<'EOF'
#!/usr/bin/env bash
case "$1 $2" in
  "auth status") exit 0 ;;
  "issue list" | "label list") echo '[]' ;;
  *) echo "unexpected gh call: $*" >&2; exit 1 ;;
esac
EOF
chmod +x "$work/bin/gh"

pass=0 fail=0
# case <name> <stub exit code> <stub result line> <want exit code> [raise-env-issue args...]
case_() {
  local name=$1 stub_rc=$2 result=$3 want=$4 rc=0
  shift 4
  printf '#!/usr/bin/env bash\necho "staging  https://home-staging.nntin.xyz"\necho "  result   %s"\nexit %s\n' \
    "$result" "$stub_rc" >"$work/scripts/env-status.sh"
  chmod +x "$work/scripts/env-status.sh"
  PATH="$work/bin:$PATH" "$work/scripts/raise-env-issue.sh" --dry-run "$@" staging "test" >/dev/null 2>&1 || rc=$?
  if [[ $rc == "$want" ]]; then
    pass=$((pass + 1))
    printf 'ok    %s: exit %s\n' "$name" "$rc"
  else
    fail=$((fail + 1))
    printf 'FAIL  %s: want exit %s, got %s\n' "$name" "$want" "$rc"
  fi
}

case_ "BROKEN (exit 4 + result line) raises" 4 BROKEN 0
case_ "not broken (exit 0) refuses" 0 DEPLOYING 3
case_ "script error (exit 1) refuses even with a BROKEN line" 1 BROKEN 3
case_ "exit 4 without a BROKEN result line refuses" 4 OK 3
case_ "--force overrides a script error" 1 OK 0 --force

echo "$pass passed, $fail failed"
((fail == 0))
