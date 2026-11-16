---
name: my-home-environments
description: >-
  Reach, test or check the deployed my-home environments, staging (home-staging.nntin.xyz) and production
  (home.nntin.xyz), behind authentik SSO. Use when calling their API or UI with curl or Playwright, checking
  which commit is deployed or whether a deploy is broken or stale, or raising an environment issue.
---

# my-home environments

| Environment | Base URL                         | Deployed from                                         | Data                                       |
| ----------- | -------------------------------- | ----------------------------------------------------- | ------------------------------------------ |
| staging     | `https://home-staging.nntin.xyz` | same-repo PR pushes, `v*` tags, dispatch; latest wins | reset to the real + mock home; photos stay |
| production  | `https://home.nntin.xyz`         | every push to `main`                                  | real data; change only when asked to       |

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
$S/photos.sh staging list --room souterrain-kitchen      # the owner's photos with their poses
$S/photo-requests.sh staging create --room souterrain-kitchen --reason "Which wall has the window?"
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

## Photos and photo requests

The owner photographs the real home from a known pose in the model (`docs/photos.md`). Use the photos when
refining the model, and **ask for a photo instead of guessing** when unsure about a wall, room, opening or
furniture. `--home` defaults to the first home.

- `photos.sh <env> list [filters]`: metadata as JSON, newest first. Filters: `--room ID`, `--level ID`,
  `--near X,Z,RADIUS` (metres on the plan), `--tag TAG`, `--request ID`, `--since TIME`, `--until TIME`.
- `photos.sh <env> get <photo-id>`: one photo's metadata (pose, captured room, note, tags).
- `photos.sh <env> download [--dir DIR] [--thumbnail] <photo-id>... | [filters]`: saves `<id>.webp` and
  `<id>.json`. Use a temp or artifact directory, **never the repository**.
- `photos.sh <env> annotate <photo-id> [--note TEXT] [--tag TAG]...`: record what the photo shows.
- `photo-requests.sh <env> create --reason TEXT [--room ID] [--at X,Z] [--level ID] [--heading-deg DEG | --yaw RAD]
[--pitch RAD]`: ask the owner for a photo: where to stand, which way to look (degrees clockwise from plan
  north, `-z`) and what you need to see. The owner sees it on the phone as a target marker.
- `photo-requests.sh <env> list [--status open|fulfilled|cancelled|all]`, `get <id>`,
  `close <id> [--photo PHOTO_ID]` (fulfilled by that photo; without `--photo`, cancelled).
- `photos-copy.sh <from-env> <to-env> [--since TIME] [--dry-run]`: copies photos between the environments'
  separate stores, for example `staging production`. Only when the owner asks; run `--dry-run` first. It skips
  photos the destination already has and never changes the source.

**Never delete or purge photos or photo requests.** There is no script for it on purpose: deleting is the
owner's action in the app. The only exception is test data you uploaded yourself in the same task. Photos
survive staging redeploys, so anything you upload stays until it is deleted.

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
- Prefer staging for tests and experiments. Homes and layouts are reset on every deploy, so keep nothing there
  you need later; photos and photo requests are **not** reset, so clean up test photos you uploaded.
  Change production only when the task asks for it.
- Never use the browser login flow on auth.nntin.xyz. The token exchange is the only supported way for agents.
- Reuse the cached site token; exchanging per request hits the rate limit (30 per minute).
