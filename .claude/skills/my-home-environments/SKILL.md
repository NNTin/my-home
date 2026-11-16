---
name: my-home-environments
description: >-
  Reach, test or check the deployed my-home environments, staging (home-staging.nntin.xyz) and production
  (home.nntin.xyz), behind authentik SSO. Use when calling their API or UI with curl or Playwright, checking
  which commit is deployed or whether a deploy is broken or stale, or raising an environment issue.
---

# my-home environments

| Environment | Base URL                         | Deployed from                                         | Data                                 |
| ----------- | -------------------------------- | ----------------------------------------------------- | ------------------------------------ |
| staging     | `https://home-staging.nntin.xyz` | same-repo PR pushes, `v*` tags, dispatch; latest wins | throwaway, reset to the mock home    |
| production  | `https://home.nntin.xyz`         | every push to `main`                                  | real data; change only when asked to |

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
$S/with-site-token.sh staging -- node e2e.mjs            # SITE_TOKEN and SITE_BASE for the child only
$S/raise-env-issue.sh --dry-run staging "health fails"   # what it would post; drop --dry-run to post
```

- `site-curl.sh <env> <path> [curl args...]`: checks once that the GitHub token is nntin-bot's, caches the site
  token per host (0600, `${XDG_RUNTIME_DIR:-$HOME/.cache}/my-home-agent-auth/`, refreshed 5 min early), never
  follows redirects, and on a 302 to auth.nntin.xyz exchanges again and retries once. Exits 22 on HTTP >= 400.
  `SITE_CURL_VERBOSE=1` prints the status. Exchange errors (401 `invalid_token`, 429 with
  `retry_after_seconds`, 502) end with a clear message; it never retries `invalid_token`.
- `with-site-token.sh <env> -- <command...>`: exports `SITE_TOKEN`, `SITE_BASE`, `SITE_HOST` and
  `SITE_TOKEN_EXPIRES_AT` to the command only, with at least 10 min of validity left.
- `env-status.sh [staging|production|all]`: exit 0 when OK or DEPLOYING (CI/deploy still running, within
  `ENV_STATUS_GRACE_MINUTES`, default 45), 1 when BROKEN or STALE. Production must run `main` HEAD; staging
  must run its latest GitHub deployment, and the output names the PR or tag it runs.
- `raise-env-issue.sh [--dry-run] <env> <summary> [details-file]`: comments on the open `environment`-labelled
  issue titled `[env] <env>: ...`, or creates one (and the label) with the `env-status.sh` output.

## Playwright

```js
// with-site-token.sh staging -- node e2e.mjs
import { chromium } from 'playwright';

const browser = await chromium.launch();
const context = await browser.newContext({
  baseURL: process.env.SITE_BASE,
  extraHTTPHeaders: { Authorization: `Bearer ${process.env.SITE_TOKEN}` },
});
const page = await context.newPage();
await page.goto('/');
```

`extraHTTPHeaders` is sent to every host the page loads from. The app loads only from its own host; if a test
navigates elsewhere, set the header per route (`context.route`) for `SITE_HOST` only.

## When an environment is broken

Run `env-status.sh <env>`. If it reports BROKEN or STALE (down, health failing, or the deployed commit not
catching up with `main` or the latest PR/tag after CI is done), run `raise-env-issue.sh <env> "<summary>"`. It
comments on an existing open issue instead of creating a duplicate. A WARN (CI on `main` failed before deploying)
is a code problem: fix `main` instead.

## Rules

- Never print, log, commit or paste the GitHub token or the site token, including in issues, PR comments and
  test output. Never send either to any host other than api.github.com and the environment itself.
- Prefer staging for tests and experiments. It is reset on every deploy, so keep nothing there you need later.
  Change production only when the task asks for it.
- Never use the browser login flow on auth.nntin.xyz. The token exchange is the only supported way for agents.
- Reuse the cached site token; exchanging per request hits the rate limit (30 per minute).
