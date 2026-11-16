# shellcheck shell=bash
# Shared helpers for photos.sh, photo-requests.sh and photos-copy.sh. Source it; do not run it.
# shellcheck source=lib.sh
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

# Overridable so the offline tests can stub the network.
SITE_CURL=${SITE_CURL:-$(dirname "${BASH_SOURCE[0]}")/site-curl.sh}

# api <env> <path> [curl args...]: one authenticated request; the body goes to stdout.
api() {
  "$SITE_CURL" "$@"
}

# uri <text>: percent-encodes a query value.
uri() {
  jq -rn --arg v "$1" '$v | @uri'
}

# default_home <env>: the id of the oldest home, which is the one the viewer opens.
default_home() {
  local id
  id=$(api "$1" /api/homes | jq -er '.items[0].id') || die "no home found on $1"
  printf '%s\n' "$id"
}

# list_photos <env> <home> [query]: every matching photo (all pages) as one JSON array, newest first.
# query is "key=value&..." (already encoded) or empty.
list_photos() {
  local env=$1 home=$2 query=${3:-} offset=0 page total all='[]'
  while :; do
    page=$(api "$env" "/api/homes/$home/photos?limit=500&offset=$offset${query:+&$query}") || return
    all=$(jq -c --argjson all "$all" '$all + .items' <<<"$page")
    total=$(jq -r '.total' <<<"$page")
    offset=$((offset + 500))
    ((offset >= total)) && break
  done
  printf '%s\n' "$all"
}
