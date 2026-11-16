---
name: my-home-environments
description: >-
  Reach, test or check the deployed my-home environments, staging (home-staging.nntin.xyz) and production
  (home.nntin.xyz), behind authentik SSO. Use when calling their API or UI with curl or Playwright, checking
  which commit is deployed or whether a deploy is broken or stale, or raising an environment issue.
---

# my-home environments

| Environment | Base URL                         | Deployed from                                         | Data                                     |
| ----------- | -------------------------------- | ----------------------------------------------------- | ---------------------------------------- |
| staging     | `https://home-staging.nntin.xyz` | same-repo PR pushes, `v*` tags, dispatch; latest wins | throwaway, reset to the real + mock home |
| production  | `https://home.nntin.xyz`         | every push to `main`                                  | real data; change only when asked to     |

Both are behind authentik SSO. Agents exchange the **nntin-bot** GitHub token (`GH_TOKEN`, `GITHUB_TOKEN` or
`gh auth token`) at `POST <base>/agent-auth/token` for a per-host site token valid for 1 hour, sent as
`Authorization: Bearer`. A missing or expired token gets a **302 to `https://auth.nntin.xyz`**, not a 401.
`GET /api/health/live` is public and returns the deployed `commit`. The full instruction sheet, API overview and
error table are in [issue #9](https://github.com/NNTin/my-home/issues/9); deploys in `docs/deployment.md`.

The scripts below do all of this. Dependencies: `bash`, `curl`, `jq`, `gh`. Run them from the repository root.

## Quick start

```sh
S=.claude/skills/my-home-environments/scripts

$S/site-curl.sh staging /api/homes                       # GET, body on stdout
$S/site-curl.sh staging /api/homes/mock-home/layouts -X POST --json '{"name":"test"}'
$S/env-status.sh all                                     # health, auth, deployed commit vs GitHub
$S/screenshot.sh staging --out /tmp/staging.png          # render the 3D viewer in headless Chromium
$S/screenshot.sh staging --click 'label:has-text("Souterrain")' --drag -300,0   # interact first
$S/with-site-token.sh staging -- node e2e.mjs            # SITE_TOKEN and SITE_BASE for the child only
$S/raise-env-issue.sh --dry-run staging "health fails"   # what it would post; drop --dry-run to post
```

- `site-curl.sh <env> <path> [curl args...]`: checks once that the GitHub token is nntin-bot's, caches the site
  token per host (0600, `${XDG_RUNTIME_DIR:-$HOME/.cache}/my-home-agent-auth/`, refreshed 5 min early), never
  follows redirects, and on a 302 to auth.nntin.xyz exchanges again and retries once. Exits 22 on HTTP >= 400,
  1 on other errors; `-L`, `-f`, `-o`, `-D` and `-w` are rejected. `SITE_CURL_VERBOSE=1` prints the status.
  Exchange errors (401 `invalid_token`, 429 with `retry_after_seconds`, 502) end with a clear message; it never
  retries `invalid_token`.
- `with-site-token.sh <env> -- <command...>`: exports `SITE_TOKEN`, `SITE_BASE`, `SITE_HOST` and
  `SITE_TOKEN_EXPIRES_AT` to the command only, with at least 10 min of validity left.
- `env-status.sh [staging|production|all]`: OK, DEPLOYING, PENDING, CI_FAILED or BROKEN per environment (see
  below). Exit 4 when one is BROKEN, 1 on a script
  or tool error. The output names the PR or tag staging runs.
- `screenshot.sh <env> [--path /?home=...] [--out file.png] [--wait ms] [--viewport WxH]`: waits for the canvas
  plus `--wait` (default 6000 ms), then runs any `--click <playwright selector>` and `--drag DX,DY` (pixels from
  the canvas centre, orbits the camera) in the given order, and prints the final host, status and console/page errors. It runs in the
  shared `ao-heavy` queue when available. Playwright (pinned) is installed outside the repository in
  `${XDG_CACHE_HOME:-$HOME/.cache}/my-home-environments/playwright`, Chromium in `~/.cache/ms-playwright`;
  `screenshot.sh --check` installs them if missing and verifies a headless launch.
- `raise-env-issue.sh [--dry-run] [--force] <env> <summary> [details-file]`: refuses (exit 3) unless
  `env-status.sh` reports BROKEN; then comments on the open `environment`-labelled issue titled
  `[env] <env>: ...`, or creates one (and the label). `--force` is for a human override only.

## Playwright

Attach the token only to requests for the environment's own host. Never use `extraHTTPHeaders`: it sends the
token to every third-party host the page loads from. Chromium here needs `--no-sandbox` and SwiftShader for WebGL.

```js
// with-site-token.sh staging -- node e2e.mjs
import { chromium } from 'playwright';

const { SITE_BASE, SITE_HOST, SITE_TOKEN } = process.env;
const browser = await chromium.launch({
  args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});
const context = await browser.newContext({ baseURL: SITE_BASE });
await context.route('**/*', (route) => {
  const request = route.request();
  if (new URL(request.url()).host !== SITE_HOST) return route.continue();
  return route.continue({
    headers: { ...request.headers(), authorization: `Bearer ${SITE_TOKEN}` },
  });
});
const page = await context.newPage();
await page.goto('/');
```

## When an environment is broken

Image builds and deploys take a while, so `env-status.sh` calls an environment BROKEN only when:

- it is down or unhealthy on every probe (4 probes over about 2 minutes, `ENV_STATUS_PROBES`,
  `ENV_STATUS_PROBE_INTERVAL`), or
- the CI publish job for the expected commit succeeded more than `STALE_MINUTES` (default 60) ago and
  `/api/health/live` still reports another commit. Expected: `main` HEAD for production; for staging the
  newest same-repo PR push, `v*` tag or dispatch whose publish succeeded.

Before that it reports DEPLOYING, even when the deploy job failed (the output names it). PENDING (image not
published yet) and CI_FAILED (publish failed) are CI problems: fix the code or CI, do not raise an environment
issue. Only on BROKEN run `raise-env-issue.sh <env> "<summary>"`; it comments on an existing open issue instead
of creating a duplicate.

## Rules

- Never print, log, commit or paste the GitHub token or the site token, including in issues, PR comments and
  test output. Never send either to any host other than api.github.com and the environment itself.
- Prefer staging for tests and experiments. It is reset on every deploy, so keep nothing there you need later.
  Change production only when the task asks for it.
- Never use the browser login flow on auth.nntin.xyz. The token exchange is the only supported way for agents.
- Reuse the cached site token; exchanging per request hits the rate limit (30 per minute).
