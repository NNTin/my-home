---
name: my-home-environments
description: >-
  Reach, test or check the deployed my-home environments, staging (home-staging.nntin.xyz) and production
  (home.nntin.xyz), behind authentik SSO. Use when calling their API or UI with curl or Playwright, checking
  which commit is deployed or whether a deploy is broken or stale, or raising an environment issue.
---

# my-home environments

| Environment | Base URL                         | Deployed from                                         | Data                                                    |
| ----------- | -------------------------------- | ----------------------------------------------------- | ------------------------------------------------------- |
| staging     | `https://home-staging.nntin.xyz` | same-repo PR pushes, `v*` tags, dispatch; latest wins | reset to the real + mock home; photos and userdata stay |
| production  | `https://home.nntin.xyz`         | every push to `main`                                  | real data; change only when asked to                    |

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
$S/screenshot.sh staging --viewport 390x844 --path '/?walk=first' --pad 0,-44,2000   # walk, then shoot
$S/screenshot.sh staging --viewport 390x844 --touch --path '/?panel=furniture'   # phone layout, a panel open
$S/screenshot.sh staging --canvas --out /tmp/view.png   # the 3D canvas only, no UI text
$S/visual-diff.sh staging shoot --out /tmp/vd-main         # 8 fixed canvas views + manifest (commit)
$S/visual-diff.sh compare /tmp/vd-main /tmp/vd-pr          # identical, or differing pixels + diff PNGs
$S/walk-smoke.sh staging                                 # phone-sized smoke test of walk mode
$S/mobile-smoke.sh staging                               # phone layout: top bar, sheet, levels, furniture, walk
$S/compass-smoke.sh staging                              # Sensors / Manual camera modes, mocked sensor events
$S/camera-smoke.sh staging                               # taking a photo with a fake camera, uploads checked
$S/with-site-token.sh staging -- node e2e.mjs            # SITE_TOKEN and SITE_BASE for the child only
$S/raise-env-issue.sh --dry-run staging "health fails"   # what it would post; drop --dry-run to post
$S/photos.sh staging list --room souterrain-kitchen      # the owner's photos with their poses
$S/photo-requests.sh staging create --room souterrain-kitchen --reason "Which wall has the window?"
$S/uses.sh staging whoami                                # the actor recorded for the agent token: agent
$S/uses.sh staging list --home mock-home --status needs-attention   # where-used, with problems
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
- `screenshot.sh <env> [--path /?home=...] [--out file.png] [--wait ms] [--viewport WxH] [--touch]`: waits for the canvas
  plus `--wait` (default 6000 ms), then runs any `--click <playwright selector>` and `--drag DX,DY` (pixels from
  the canvas centre, orbits the camera) in the given order, and prints the final host, status and console/page errors. It runs in the
  shared `ao-heavy` queue when available. In walk mode (`--path '/?walk=first'` or `'/?walk=third'`, see
  `docs/walking.md`), `--pad DX,DY,MS` holds the movement pad deflected (up to 44 px; negative DY walks
  forward, negative DX turns left) and `--key KEY,MS` holds a key. `--touch` emulates a phone (touch screen,
  coarse pointer); the phone layout (`docs/mobile.md`) also shows without it at phone sizes such as 390x844 or
  844x390, and `--path '/?panel=view|furniture|photos|requests&sheet=half|full'` opens a panel of its sheet.
  Add `&hints=off` there, or the first-run hints cover the foot of the view in every fresh browser.
- `screenshot.sh --canvas` shoots only the 3D canvas: every other element is hidden and the shot is clipped to
  the canvas, so UI text (photo count, room names, panels) cannot make two shots differ. With a `--drag`, page
  time is paused before the first drag and runs exactly 1 s of frames after each action (Playwright's fake
  clock), so the orbit controls' damping ends in the same place however slow the renderer is.
- `visual-diff.sh <env> shoot --out DIR [--only VIEW]...`: pixel-exact visual regression of the 3D view,
  read-only. Shoots canvas-only screenshots of fixed views (desktop 1440x900: `default`, the cutaways
  `souterrain`, `ground-floor` and `first-floor`, `orbit-180` (`--drag 600,0`), `steep` (`--drag 0,250`, from above),
  `mock-home`; phone 390x844: `phone`; all with `hints=off`) into `DIR/<view>.png` plus `DIR/manifest.json`
  (deployed commit, view arguments, sha256). It reads the deployed commit before and after and fails if a
  deploy happened in between. `visual-diff.sh compare DIR_A DIR_B` prints a Markdown table per view:
  identical (same sha256) or the number of differing pixels and `DIR_B/diff-<view>.png` (differences red over
  a faded copy of A), decoded in headless Chromium. Exit 0 all identical, 5 some differ, 1 on an error.
  Two shoots of the same commit are byte-identical, so a renderer refactor is checked by shooting `main` and
  the PR on staging (shared: do both in one go and re-shoot if another deploy lands in between).
- `mobile-smoke.sh <env> [--out file.png] [--home ID]`: the phone layout at 390x844 and 844x390 with touch: the
  3D view is clear of the top bar and the sheet, the first-run hints are dismissed, a tap opens and closes each
  panel, the level switcher cuts the building away, a furniture item is placed and then dragged, rotated,
  long-pressed, duplicated and deleted with real touch events, walk mode is entered and left, and held across
  the sheet is at the side. It also counts WebGL draw calls (nothing is drawn while nothing moves, a finger
  or "Reset view" draws again), checks the canvas' pixel ratio (at most 1.5), that every control has a name,
  and that the web app manifest and its icons are served. It writes only to a **layout it creates itself and removes again**; every other write is refused inside
  the browser.
- `compass-smoke.sh <env> [--out file.png]`: the camera modes of walk mode (Sensors / Manual) at 390x844 with
  **mocked** orientation events (Android absolute alpha and the iOS `webkitCompassHeading` path). Manual mode
  ignores the events and turns by drag and ▲; Sensor mode turns and tilts the figure with the mocked phone (north
  crossed smoothly, landscape compensated, the compass rose turns), ignores every drag, hides ▲▼ and sidesteps
  with the pad; a refusal or silence falls back to Manual, the mode survives a reload, and a captured photo
  carries the sensor snapshot. Read-only: the upload is intercepted in the browser and nothing is stored. A real
  phone is still needed for the checklist in `docs/walking.md`.
- `camera-smoke.sh <env> [--out file.png]`: taking a photo in walk mode at 390x844 with touch and Chromium's
  **fake** camera: the camera inside the page (viewfinder, shutter, sheet, save), the fallback to the camera app
  and the gallery when the camera is refused, and walk mode coming back at the same pose with a "take it again"
  message after a reload while the camera app was open. Each upload is parsed and checked (a `meta` JSON with a
  valid pose and a JPEG `image`) and answered in the browser. Read-only: nothing is stored.
- `walk-smoke.sh <env> [--out file.png]`: opens walk mode at 390x844 with touch, pushes the pad and checks that
  the figure walks, turns and stops, that the controls and the minimap fit without overlapping, that the
  minimap tracks the figure, and, after putting the figure at the stair from the enlarged map, that the pad
  walks it up and the minimap switches level; nothing may log an error. Read-only. Playwright (pinned) is installed outside the repository in
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
- `photos.sh <env> get <photo-id>`: one photo's metadata (pose, captured room, note, tags, sensor snapshot).
- `photos.sh <env> sensors <photo-id>`: whether the photo's heading was measured by the phone's compass or
  set by hand, with the raw sensor values. Trust a measured heading more, but mind its accuracy.
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

## Uses, placements and colours

A **use** is one piece in a home: an opening, roof window or gate from git (`data/homes/`), or a furniture
**placement** stored in the database (`docs/userdata.md`). Uses keep the basic parameters they change (colours,
some sizes, within the type's limits), and every change is recorded in the use's history with its actor and can
be undone. Agents may edit them on **both** environments; **production only when asked**. Placements and
overrides are **not** reset by staging deploys.

- `uses.sh <env> whoami`: the actor the api records for this token (`agent`, source `identity` on deployed hosts).
- `uses.sh <env> types`: the catalogue types with their parameters (tier `basic` = changeable per use, limits).
- `uses.sh <env> list [--type TYPEID] [--status ok|needs-attention] [--include removed]`: where-used. Git uses
  with their overrides, placements, and orphans (an override whose opening left git, a placement whose type,
  level or room is gone) with `problems`.
- `uses.sh <env> place --type furniture.bed --level ID --at X,Z [--rotation-deg D] [--param k=v]... [--name TEXT]`:
  the server picks the id (`<apartment>-<type>-<n>`, never reused), the name ("Bedroom · Bed") and the room.
- `uses.sh <env> set <useId> --param k=v [--param k=v]... [--clear k]...`: a placement's params or an opening's
  override (colours `#rrggbb`, lengths in metres). `move <id> --at X,Z [--rotation-deg D]`, `rename <id> TEXT`.
- `uses.sh <env> remove|restore <placementId>`: to the trash (purged with its history after 30 days) and back.
- `uses.sh <env> history <useId>`, `uses.sh <env> undo <useId> <entryId>`: undo is field by field; it refuses
  (409) when a field changed again later or the entry was already undone. An undo can itself be undone.

Every write reads the current version first; a 409 means someone changed the use in between: list again.

### Test data

Only on **`mock-home`**, and cleaned up in the same task: undo your changes to git uses (or `set --clear` them),
and `remove` the placements you made (they leave the trash after 30 days). The browser smoke tests stay
read-only; the CI docker job runs the same place → set → history → undo → remove round trip on a throwaway stack.

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
  you need later; photos, photo requests, placements, overrides and history are **not** reset, so clean up test
  photos you uploaded and test uses you made (on `mock-home` only).
  Change production only when the task asks for it.
- Never use the browser login flow on auth.nntin.xyz. The token exchange is the only supported way for agents.
- Reuse the cached site token; exchanging per request hits the rate limit (30 per minute).
