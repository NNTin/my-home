#!/usr/bin/env bash
# seed.sh <staging|production> <command> [options]
#
# The home's seed (docs/deployment.md § The seed comes from git): its placements with their params, the opening
# overrides and the notes, in the canonical format of data/homes/<home>.seed.json. Git is authoritative: every
# deploy makes the environment match the seed of the deployed commit, so an edit in the app or by an agent is a
# draft until it is exported into a pull request.
#
#   export                  the environment's state as a seed file, on stdout:
#                           seed.sh staging export > data/homes/home.seed.json
#   diff [--file PATH]      the drift between git (default data/homes/<home>.seed.json) and the environment, as a
#                           unified diff ("-" git, "+" environment); exit 0 none, 5 drift
#   import [--file PATH]    applies a seed to the environment now (history by "seed"), as the next deploy would;
#                           needs --allow-write (the owner's real data). The deploy after it applies git's seed again.
#
# --home ID (default: the first home). Run from the repository root.
set -euo pipefail
# shellcheck source=photos-lib.sh
source "$(dirname "${BASH_SOURCE[0]}")/photos-lib.sh"

usage() {
  sed -n '2,17s/^# \{0,1\}//p' "$0" >&2
  exit 2
}

[[ $# -ge 2 ]] || usage
env=$1
shift
resolve_env "$env"
require_tools curl jq diff

allow_write='' home='' file='' args=()
while [[ $# -gt 0 ]]; do
  case "$1" in
    --allow-write) allow_write=1 && shift ;;
    --home) home=${2:?} && shift 2 ;;
    --file) file=${2:?} && shift 2 ;;
    -*) die "unknown option $1" ;;
    *) args+=("$1") && shift ;;
  esac
done
[[ ${#args[@]} -eq 1 ]] || usage
command=${args[0]}
case "$command" in export | diff | import) ;; *) usage ;; esac
if [[ $command == import && -z $allow_write ]]; then
  die "import overwrites the $env environment's placements, overrides and notes: refused. Add --allow-write only when the owner asked for it"
fi

[[ -n $home ]] || home=$(default_home "$env")
[[ -n $file ]] || file="data/homes/$home.seed.json"

# The seed as the environment has it; the api answers the canonical text, byte for byte the file's format.
exported() {
  api "$env" "/api/homes/$home/seed" -H 'X-My-Home-Actor: agent'
}

case "$command" in
  export)
    exported
    ;;
  diff)
    [[ -f $file ]] || die "no seed file $file (run from the repository root, or pass --file)"
    current=$(mktemp)
    trap 'rm -f "$current"' EXIT
    exported >"$current" || die "cannot export the seed of $env (a build without the seed api answers 404)"
    if diff -u --label "git: $file" --label "$env: /api/homes/$home/seed" "$file" "$current"; then
      printf 'no drift: %s matches %s\n' "$env" "$file" >&2
    else
      printf 'drift: %s differs from %s (- git, + %s)\n' "$env" "$file" "$env" >&2
      exit 5
    fi
    ;;
  import)
    [[ -f $file ]] || die "no seed file $file (run from the repository root, or pass --file)"
    jq -e . "$file" >/dev/null || die "$file is not JSON"
    api "$env" "/api/homes/$home/seed" -H 'X-My-Home-Actor: agent' -X PUT --json "@$file" | jq .
    ;;
esac
