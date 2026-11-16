#!/usr/bin/env bash
# site-curl.sh <staging|production> <path> [curl args...]
#
# One authenticated request to a my-home environment. Exchanges the nntin-bot GitHub token for a cached site
# token, never follows redirects, and on a redirect to auth.nntin.xyz exchanges again and retries once.
# Prints the response body to stdout. Exits 0 on 1xx-3xx, 22 on HTTP >= 400 (status on stderr), 1 on errors.
# Extra args go to curl (-X, -H, -d, --json, ...); -L, -f, -o, -D and -w are not supported.
# SITE_CURL_VERBOSE=1 prints the status line to stderr for every response.
set -euo pipefail
# shellcheck source=lib.sh
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

usage() {
  sed -n '2,9s/^# \{0,1\}//p' "$0" >&2
  exit 2
}

[[ $# -ge 2 ]] || usage
resolve_env "$1"
path=$2
shift 2
for arg in "$@"; do
  case "$arg" in
    -L | --location | --location-trusted | -f | --fail | --fail-with-body | -o | --output | -D | --dump-header | \
      -w | --write-out)
      die "$arg is not supported: the script handles redirects, errors (exit 22 on HTTP >= 400) and output itself"
      ;;
  esac
done
require_tools curl jq

SITE_RESPONSE_BODY=$(mktemp)
SITE_RESPONSE_HEADERS=$(mktemp)
trap 'rm -f "$SITE_RESPONSE_BODY" "$SITE_RESPONSE_HEADERS"' EXIT

authed_request "$path" "$@" || die "request to $SITE_HOST failed (network error)"
cat "$SITE_RESPONSE_BODY"
[[ ${SITE_CURL_VERBOSE:-0} == 1 ]] && printf 'HTTP %s %s/%s\n' "$SITE_STATUS" "$SITE_BASE" "${path#/}" >&2
if [[ $SITE_STATUS -ge 400 ]]; then
  printf '%s: HTTP %s from %s%s\n' "${0##*/}" "$SITE_STATUS" "$SITE_HOST" "/${path#/}" >&2
  exit 22
fi
if [[ $SITE_STATUS == 3* ]]; then
  printf '%s: HTTP %s redirect to %s (not followed)\n' "${0##*/}" "$SITE_STATUS" "${SITE_LOCATION%%\?*}" >&2
fi
