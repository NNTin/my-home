#!/usr/bin/env bash
# Lints and renders the chart, and asserts the deployment contract (charts/my-home).
set -euo pipefail
cd "$(dirname "$0")/.."
chart=charts/my-home
values=$chart/ci/values.json
render() { helm template my-home "$chart" --namespace my-home --kube-version 1.36.4 -f "$values" "$@"; }
fail() { echo "FAIL $*" >&2; exit 1; }

helm lint "$chart" --strict --kube-version 1.36.4 -f "$values"
rendered=$(render)
if command -v kubeconform > /dev/null; then
  kubeconform -strict -summary -kubernetes-version 1.36.4 <<<"$rendered"
fi

# Unstamped charts must not render: production always runs an immutable digest.
! helm template my-home "$chart" > /dev/null 2>&1 || fail 'a chart without image digests rendered'
grep -q 'image: "ghcr.io/nntin/my-home-api@sha256:1111' <<<"$rendered" || fail 'api image is not pinned by digest'
grep -q 'image: "ghcr.io/nntin/my-home-web@sha256:2222' <<<"$rendered" || fail 'web image is not pinned by digest'

# Migrations run in a pre-deploy hook, never at api start-up; liveness does not depend on the database.
grep -q 'helm.sh/hook: pre-install,pre-upgrade' <<<"$rendered" || fail 'release hook missing'
# Every deploy syncs data/homes; production only the real home and never resets.
grep -q 'command: \[node, dist/release.js\]' <<<"$rendered" || fail 'production hook must run the release job'
grep -A1 'name: HOME_FILES' <<<"$rendered" | grep -q 'value: "home.json"$' || fail 'production must sync only home.json'
! grep -q 'ALLOW_DATABASE_RESET' <<<"$rendered" || fail 'reset allowed by default'
! grep -q 'RESET_PUBLIC' <<<"$rendered" || fail 'production resets public'
grep -A1 'name: MIGRATE_ON_START' <<<"$rendered" | grep -q '"false"' || fail 'api migrates on start'
grep -A1 'name: AGENT_USERNAMES' <<<"$rendered" | grep -q '"nntin-bot"' || fail 'agent usernames not rendered'
grep -A1 'livenessProbe:' <<<"$rendered" | grep -q '/api/health/live' || fail 'api liveness must use /api/health/live'
grep -A1 'readinessProbe:' <<<"$rendered" | grep -q 'path: /api/health,' || fail 'api readiness must use /api/health'

# Staging resets `public` on every deploy, syncs only the home and purges the retired mock home.
staging=$(render --set database.resetOnDeploy=true)
grep -q 'command: \[node, dist/release.js\]' <<<"$staging" || fail 'staging hook must run the release job'
grep -A1 'name: ALLOW_DATABASE_RESET' <<<"$staging" | grep -q '"true"' || fail 'staging reset not allowed'
grep -A1 'name: RESET_PUBLIC' <<<"$staging" | grep -q '"true"' || fail 'staging does not reset public'
grep -A1 'name: HOME_FILES' <<<"$staging" | grep -q 'value: "home.json"$' || fail 'staging must sync only home.json'
grep -A1 'name: PURGE_HOMES' <<<"$staging" | grep -q 'value: "mock-home"$' || fail 'staging must purge mock-home'
! grep -q 'PURGE_HOMES' <<<"$rendered" || fail 'production purges a home'

# An explicit homes.files overrides the default.
custom=$(render --set 'homes.files={other-home.json}')
grep -A1 'name: HOME_FILES' <<<"$custom" | grep -q 'value: "other-home.json"$' || fail 'homes.files not rendered'

# The infrastructure repository owns routes, policies and namespaces.
! grep -qE 'kind: (NetworkPolicy|Namespace|HTTPRoute|Ingress)' <<<"$rendered" || fail 'chart renders infrastructure kinds'
echo 'PASS chart contract'
