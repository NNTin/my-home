#!/usr/bin/env bash
# with-site-token.sh <staging|production> -- <command...>
#
# Runs the command with SITE_TOKEN, SITE_BASE, SITE_HOST and SITE_TOKEN_EXPIRES_AT (unix seconds) in its
# environment only. The token is never printed. It is valid for this host only and lives at least
# SITE_TOKEN_MIN_TTL seconds (default 600) after start; long jobs should handle the 302 to auth.nntin.xyz.
# Example: with-site-token.sh staging -- sh -c 'curl -fsS -H "Authorization: Bearer $SITE_TOKEN" "$SITE_BASE/api/homes"'
set -euo pipefail
# shellcheck source=lib.sh
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

usage() {
  sed -n '2,7s/^# \{0,1\}//p' "$0" >&2
  exit 2
}

[[ $# -ge 3 && $2 == -- ]] || usage
resolve_env "$1"
shift 2
require_tools curl jq

min_ttl=${SITE_TOKEN_MIN_TTL:-600}
((min_ttl > SITE_TOKEN_REFRESH_SECONDS)) && SITE_TOKEN_REFRESH_SECONDS=$min_ttl
site_token
SITE_TOKEN=$SITE_TOKEN SITE_BASE=$SITE_BASE SITE_HOST=$SITE_HOST SITE_TOKEN_EXPIRES_AT=$SITE_TOKEN_EXPIRES_AT exec "$@"
