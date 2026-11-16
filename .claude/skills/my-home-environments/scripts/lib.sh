# shellcheck shell=bash disable=SC2034 # variables here are used by the sourcing scripts
# Shared helpers for the my-home environment scripts. Source it; do not run it.
#
# Tokens never reach stdout, argv or a log: curl reads the Authorization header from a process substitution
# (-H @file), and the site token cache is a 0600 file in a 0700 directory.

MY_HOME_REPO=${MY_HOME_REPO:-NNTin/my-home}
MY_HOME_BOT_LOGIN=${MY_HOME_BOT_LOGIN:-nntin-bot}
AUTH_HOST=auth.nntin.xyz
# Exchange again when the cached site token has less than this many seconds left.
SITE_TOKEN_REFRESH_SECONDS=${SITE_TOKEN_REFRESH_SECONDS:-300}
# Longest retry_after_seconds a 429 may ask for before we give up instead of waiting.
SITE_AUTH_MAX_WAIT_SECONDS=${SITE_AUTH_MAX_WAIT_SECONDS:-90}
SITE_AUTH_CACHE_DIR=${SITE_AUTH_CACHE_DIR:-${XDG_RUNTIME_DIR:-$HOME/.cache}/my-home-agent-auth}

die() {
  printf '%s: %s\n' "${0##*/}" "$*" >&2
  exit 1
}

warn() {
  printf '%s: %s\n' "${0##*/}" "$*" >&2
}

require_tools() {
  local tool
  for tool in "$@"; do
    command -v "$tool" >/dev/null 2>&1 || die "missing dependency: $tool"
  done
}

# resolve_env <staging|production>: sets SITE_ENV, SITE_HOST and SITE_BASE.
resolve_env() {
  case "${1:-}" in
    staging | stg) SITE_ENV=staging SITE_HOST=home-staging.nntin.xyz ;;
    production | prod) SITE_ENV=production SITE_HOST=home.nntin.xyz ;;
    *) die "unknown environment '${1:-}' (use staging or production)" ;;
  esac
  SITE_BASE="https://$SITE_HOST"
}

# github_token: sets GITHUB_AUTH_TOKEN from GH_TOKEN, GITHUB_TOKEN or `gh auth token`.
github_token() {
  GITHUB_AUTH_TOKEN=${GH_TOKEN:-${GITHUB_TOKEN:-}}
  if [[ -z $GITHUB_AUTH_TOKEN ]] && command -v gh >/dev/null 2>&1; then
    GITHUB_AUTH_TOKEN=$(gh auth token 2>/dev/null) || GITHUB_AUTH_TOKEN=
  fi
  [[ -n $GITHUB_AUTH_TOKEN ]] || die "no GitHub token: set GH_TOKEN or log gh in as $MY_HOME_BOT_LOGIN"
}

auth_header() {
  printf 'Authorization: Bearer %s\n' "$1"
}

ensure_cache_dir() {
  (umask 077 && mkdir -p "$SITE_AUTH_CACHE_DIR") || die "cannot create $SITE_AUTH_CACHE_DIR"
  chmod 700 "$SITE_AUTH_CACHE_DIR"
}

# check_bot_login: verifies once per GitHub token (cached by its sha256, never the token) that it is nntin-bot.
check_bot_login() {
  local digest marker login
  digest=$(printf '%s' "$GITHUB_AUTH_TOKEN" | sha256sum | cut -c1-32)
  marker="$SITE_AUTH_CACHE_DIR/github-login-$digest"
  [[ -f $marker && $(<"$marker") == "$MY_HOME_BOT_LOGIN" ]] && return 0
  local body status
  body=$(mktemp "$SITE_AUTH_CACHE_DIR/.user.XXXXXX")
  status=$(curl -sS --max-time 20 -o "$body" -w '%{http_code}' -H @<(auth_header "$GITHUB_AUTH_TOKEN") \
    https://api.github.com/user) || status=000
  login=$(jq -r '.login // empty' "$body" 2>/dev/null) || login=
  rm -f "$body"
  case "$status" in
    200) ;;
    401) die "GitHub rejected the token (401): it is invalid or expired; get a valid $MY_HOME_BOT_LOGIN token" ;;
    *) die "could not check the GitHub token's account on api.github.com (HTTP $status)" ;;
  esac
  [[ $login == "$MY_HOME_BOT_LOGIN" ]] ||
    die "the GitHub token belongs to '${login:-unknown}', not $MY_HOME_BOT_LOGIN; use the $MY_HOME_BOT_LOGIN token"
  (umask 077 && printf '%s' "$login" >"$marker")
}

# exchange_site_token: POST $SITE_BASE/agent-auth/token and cache the result. Retries once after a short 429.
exchange_site_token() {
  local attempt body status error wait cache tmp
  github_token
  ensure_cache_dir
  check_bot_login
  cache="$SITE_AUTH_CACHE_DIR/$SITE_HOST.json"
  for attempt in 1 2; do
    body=$(mktemp "$SITE_AUTH_CACHE_DIR/.exchange.XXXXXX")
    status=$(curl -sS --max-time 30 -o "$body" -w '%{http_code}' -X POST \
      -H @<(auth_header "$GITHUB_AUTH_TOKEN") "$SITE_BASE/agent-auth/token") || {
      rm -f "$body"
      die "token exchange on $SITE_HOST failed: network error"
    }
    if [[ $status == 200 ]]; then
      tmp=$(mktemp "$SITE_AUTH_CACHE_DIR/.token.XXXXXX")
      if ! jq -e --argjson now "$(date +%s)" \
        'select(.access_token | type == "string" and length > 0)
          | {access_token, expires_at: ($now + (.expires_in // 3600)), host}' "$body" >"$tmp" 2>/dev/null; then
        rm -f "$body" "$tmp"
        die "token exchange on $SITE_HOST returned an unexpected response"
      fi
      rm -f "$body"
      chmod 600 "$tmp"
      mv -f "$tmp" "$cache"
      return 0
    fi
    error=$(jq -r '.error // empty' "$body" 2>/dev/null)
    wait=$(jq -r '.retry_after_seconds // empty' "$body" 2>/dev/null)
    rm -f "$body"
    case "$status:$error" in
      401:missing_token) die "exchange on $SITE_HOST: 401 missing_token (no GitHub token was sent)" ;;
      401:*)
        rm -f "$SITE_AUTH_CACHE_DIR"/github-login-*
        die "exchange on $SITE_HOST: 401 ${error:-invalid_token}: the GitHub token is invalid, expired or not" \
          "$MY_HOME_BOT_LOGIN's. Get a valid $MY_HOME_BOT_LOGIN token; do not retry in a loop."
        ;;
      400:*) die "exchange on $SITE_HOST: 400 ${error:-bad_request}: call /agent-auth/token on the site host itself" ;;
      429:*)
        [[ $wait =~ ^[0-9]+$ ]] || wait=60
        if [[ $attempt == 1 && $wait -le $SITE_AUTH_MAX_WAIT_SECONDS ]]; then
          warn "exchange on $SITE_HOST: 429 ${error:-rate_limited}, waiting ${wait}s as asked"
          sleep "$wait"
          continue
        fi
        die "exchange on $SITE_HOST: 429 ${error:-rate_limited}: retry after ${wait}s and reuse the cached site token"
        ;;
      502:*) die "exchange on $SITE_HOST: 502 ${error:-bad_gateway}: GitHub or authentik is unreachable; retry later" \
        "and raise an environment issue if it persists" ;;
      *) die "exchange on $SITE_HOST: unexpected HTTP $status ${error}" ;;
    esac
  done
}

# site_token [--force]: sets SITE_TOKEN and SITE_TOKEN_EXPIRES_AT for $SITE_HOST, exchanging only when needed.
site_token() {
  local cache="$SITE_AUTH_CACHE_DIR/$SITE_HOST.json" expires
  if [[ ${1:-} != --force && -f $cache ]]; then
    expires=$(jq -r '.expires_at // 0' "$cache" 2>/dev/null) || expires=0
    if ((expires - SITE_TOKEN_REFRESH_SECONDS > $(date +%s))); then
      SITE_TOKEN=$(jq -r '.access_token // empty' "$cache")
      SITE_TOKEN_EXPIRES_AT=$expires
      [[ -n $SITE_TOKEN ]] && return 0
    fi
  fi
  exchange_site_token
  SITE_TOKEN=$(jq -r .access_token "$cache")
  SITE_TOKEN_EXPIRES_AT=$(jq -r .expires_at "$cache")
}

# site_request <path> [curl args...]: one request without following redirects. Writes the body to
# $SITE_RESPONSE_BODY and headers to $SITE_RESPONSE_HEADERS; sets SITE_STATUS and SITE_LOCATION.
site_request() {
  local path=$1
  shift
  [[ $path == /* ]] || path="/$path"
  : >"$SITE_RESPONSE_HEADERS"
  curl -sS --max-time "${SITE_CURL_MAX_TIME:-60}" -D "$SITE_RESPONSE_HEADERS" -o "$SITE_RESPONSE_BODY" \
    -H @<(auth_header "$SITE_TOKEN") "$@" "$SITE_BASE$path" || return
  # The last status line wins (skips "100 Continue").
  SITE_STATUS=$(awk '/^HTTP\//{code=$2} END{print code}' "$SITE_RESPONSE_HEADERS")
  SITE_LOCATION=$(awk 'tolower($1)=="location:"{sub(/\r$/,""); print $2}' "$SITE_RESPONSE_HEADERS" | tail -n1)
}

# is_login_redirect: true when the last response sent us to the authentik login page.
is_login_redirect() {
  [[ $SITE_STATUS == 30[1237] && $SITE_LOCATION == "https://$AUTH_HOST"* ]]
}

# authed_request <path> [curl args...]: site_request with the token, re-exchanging and retrying once on a
# redirect to the login page.
authed_request() {
  site_token
  site_request "$@" || return
  if is_login_redirect; then
    site_token --force
    site_request "$@" || return
    is_login_redirect && die "$SITE_HOST still redirects to $AUTH_HOST with a fresh site token"
  fi
  return 0
}

# redact: masks anything token-shaped (JWTs, GitHub tokens) and the live token values, for text we publish.
# Literal values are replaced in bash so they never appear in another process's argv.
redact() {
  local text secret
  text=$(sed -E \
    -e 's/eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/[redacted-jwt]/g' \
    -e 's/(gh[opsur]_|github_pat_)[A-Za-z0-9_]+/[redacted-github-token]/g')
  for secret in "${GH_TOKEN:-}" "${GITHUB_TOKEN:-}" "${GITHUB_AUTH_TOKEN:-}" "${SITE_TOKEN:-}"; do
    [[ ${#secret} -ge 8 ]] && text=${text//"$secret"/[redacted]}
  done
  printf '%s\n' "$text"
}
