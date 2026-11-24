---
name: my-home-environments
description: >-
  Reach, test or check the deployed my-home environments, staging (home-staging.nntin.xyz) and production
  (home.nntin.xyz), behind authentik SSO. Use when calling their API or UI with curl or Playwright, checking
  which commit is deployed or whether a deploy is broken or stale, or raising an environment issue.
---

# my-home environments

| Environment | Base URL                         | Deployed from                                         | Data                                                                                          |
| ----------- | -------------------------------- | ----------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| staging     | `https://home-staging.nntin.xyz` | same-repo PR pushes, `v*` tags, dispatch; latest wins | home and seed synced from git (`home.json`, `home.seed.json`) on every deploy; photos persist |
| production  | `https://home.nntin.xyz`         | every push to `main`                                  | home and seed synced from git on every deploy; change only when asked to                      |

Both are behind authentik SSO. Agents exchange the **nntin-bot** GitHub token (`GH_TOKEN`, `GITHUB_TOKEN` or
`gh auth token`) at `POST <base>/agent-auth/token` for a per-host site token valid for 1 hour, sent as
`Authorization: Bearer`. A missing or expired token gets a **302 to `https://auth.nntin.xyz`**, not a 401.
`GET /api/health/live` is public and returns the deployed `commit`. The full instruction sheet, API overview and
error table are in [issue #9](https://github.com/NNTin/my-home/issues/9); deploys in `docs/deployment.md`.

**Homes come from git**: every deploy replaces the stored homes with the deployed commit's `data/homes` (the release
job's log names the uses that need attention afterwards). **Changing the house = a PR to `data/homes`**;
`PUT /api/homes/:id` and `POST /api/homes/import` are staging experiments, lost on the next deploy (`Warning`
header). **The seed comes from git too**: placements with their params, opening overrides and notes are
`data/homes/<home>.seed.json`, and every deploy makes the environment match the deployed commit's seed (§ The seed).
The magnetic declination is a home setting that deploys keep:
`site-curl.sh <env> /api/homes/<home>/settings` (GET, or `-X PUT --json '{"version":N,"magneticDeclination":…|null}'`).

The scripts below do all of this. Dependencies: `bash`, `curl`, `jq`, `gh`. Run them from the repository root.

## Quick start

```sh
S=.claude/skills/my-home-environments/scripts

$S/site-curl.sh staging /api/homes                       # GET, body on stdout
$S/screenshot.sh staging --path '/?focus=souterrain-kitchen-window&hints=off'   # frame a use
$S/env-status.sh all                                     # health, auth, deployed commit vs GitHub
$S/screenshot.sh staging --out /tmp/staging.png          # render the 3D viewer in headless Chromium
$S/screenshot.sh staging --click 'label:has-text("Souterrain")' --drag -300,0   # interact first
$S/screenshot.sh staging --viewport 390x844 --path '/?walk=first' --pad 0,-44,2000   # walk, then shoot
$S/screenshot.sh staging --viewport 390x844 --touch --path '/?panel=furniture'   # phone layout, a panel open
$S/screenshot.sh staging --canvas --out /tmp/view.png   # the 3D canvas only, no UI text
$S/screenshot.sh staging --canvas --path '/?view=cutaway&hints=off'   # a named view (docs/views.md): cutaway, section, eye
$S/visual-diff.sh staging shoot --out /tmp/vd-main         # 8 fixed canvas views + manifest (commit)
$S/visual-diff.sh compare /tmp/vd-main /tmp/vd-pr          # identical, or differing pixels + diff PNGs
$S/walk-smoke.sh staging                                 # phone-sized smoke test of walk mode
$S/mobile-smoke.sh staging                               # phone layout: top bar, sheet, levels, furniture, walk
$S/catalog-smoke.sh staging                              # /catalog and every piece page: 3D, cm, section, playground,
                                                         # uses (the editor and history, Save and Place answered in the browser)
$S/screenshot.sh staging --viewport 390x844 --touch --path '/catalog'   # the catalogue on a phone
$S/compass-smoke.sh staging                              # Sensors / Manual camera modes, mocked sensor events
$S/camera-smoke.sh staging                               # taking a photo with a fake camera, uploads checked
$S/with-site-token.sh staging -- node e2e.mjs            # SITE_TOKEN and SITE_BASE for the child only
$S/raise-env-issue.sh --dry-run staging "health fails"   # what it would post; drop --dry-run to post
$S/photos.sh staging list --room souterrain-kitchen      # the owner's photos with their poses
$S/photo-requests.sh staging create --room souterrain-kitchen --reason "Which wall has the window?"
$S/uses.sh staging whoami                                # the actor recorded for the agent token: agent
$S/uses.sh staging list --status needs-attention   # where-used, with problems
$S/seed.sh staging export > data/homes/home.seed.json  # staging's placements, overrides, notes → git (a PR)
$S/seed.sh staging diff                                # drift between git's seed and staging (exit 5 on drift)
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
  (on other pages than `/`, such as `/catalog`, for the heading) plus `--wait` (default 6000 ms), then runs any `--click <playwright selector>` and `--drag DX,DY` (pixels from
  the canvas centre, orbits the camera) in the given order, and prints the final host, status and console/page errors. It runs in the
  shared `ao-heavy` queue when available. In walk mode (`--path '/?walk=first'` or `'/?walk=third'`, see
  `docs/walking.md`), `--pad DX,DY,MS` holds the movement pad deflected (up to 44 px; negative DY walks
  forward, negative DX turns left) and `--key KEY,MS` holds a key. `--touch` emulates a phone (touch screen,
  coarse pointer); the phone layout (`docs/mobile.md`) also shows without it at phone sizes such as 390x844 or
  844x390, and `--path '/?panel=view|furniture|photos|requests&sheet=half|full'` opens a panel of its sheet.
  Add `&hints=off` there, or the first-run hints cover the foot of the view in every fresh browser.
- Every shot of the viewer **waits for the settled frame** (`canvas[data-frame="settled"]`: the last frame is
  drawn and nothing asks for another) after `--wait` and after the actions, and with `quality=auto` or
  `quality=beautiful` in `--path` also for the beautiful tier (`data-tier="beautiful"`), which arrives with a
  lazy chunk. Under software rendering a beautiful frame takes many seconds, and the viewer **steps down** to a
  faster setting by itself: add `&stepdown=off` to shoot the tier you asked for.
- **Named views** (`docs/views.md`) open by URL: `?view=cutaway&level=<levelId>` (the isometric cutaway),
  `?view=section&look=north|east|south|west&at=<m>` (the cross-section: where the camera looks, and the cut's
  distance from the building's near face) and
  `?view=eye&room=<roomId>&look=<degrees>` (eye level in a room, degrees clockwise from plan north);
  `?backdrop=sky|studio-light|studio-dark` chooses the backdrop for a visit. They combine with `?quality=`. A
  shot waits until the view has opened (it comes with a lazy chunk) and settled.
- `screenshot.sh --canvas` shoots only the 3D canvas: every other element is hidden and the shot is clipped to
  the canvas, so UI text (photo count, room names, panels) cannot make two shots differ. With a `--drag`, page
  time is paused before the first drag and runs exactly 1 s of frames after each action (Playwright's fake
  clock), so the orbit controls' damping ends in the same place however slow the renderer is.
- `visual-diff.sh <env> shoot --out DIR [--only VIEW]...`: pixel-exact visual regression of the 3D view,
  read-only. Shoots canvas-only screenshots of fixed views (desktop 1440x900: `default`, the cutaways
  `souterrain`, `ground-floor` and `first-floor`, `orbit-180` (`--drag 600,0`), `steep` (`--drag 0,250`, from above),
  phone 390x844: `phone`; all with `hints=off&quality=fast`; then, with `stepdown=off`, the tiers
  (`default-beautiful`, `walk-fast`: walk mode's first room at eye level, `phone-auto`: the refined frame) and the
  named views in both tiers (`cutaway-fast`, `cutaway-beautiful`: `?view=cutaway`; `section-fast`,
  `section-beautiful`: `?view=section`; `eye-fast`, `eye-beautiful`: `?view=eye` in the kitchen)) into `DIR/<view>.png` plus `DIR/manifest.json`
  (deployed commit, view arguments, sha256). It reads the deployed commit before and after and fails if a
  deploy happened in between. `visual-diff.sh compare DIR_A DIR_B` prints a Markdown table per view:
  identical (same sha256) or the number of differing pixels, how many of them differ by more than 2 levels of
  255 in a channel, the largest difference, and `DIR_B/diff-<view>.png` (those larger differences red, the smaller
  ones, which are rounding, amber, over a faded copy of A), decoded in headless Chromium. Exit 0 all identical, 5 some differ, 1 on an error.
  Two shoots of the same commit are byte-identical, so a renderer refactor is checked by shooting `main` and
  the PR on staging (shared: do both in one go and re-shoot if another deploy lands in between).
- `mobile-smoke.sh <env> [--out file.png] [--home ID]`: the phone layout at 390x844 and 844x390 with touch: the
  3D view is clear of the top bar and the sheet, the first-run hints are dismissed, a tap opens and closes each
  panel, a fresh visit is in **view mode** (a drag moves nothing) until **Edit** is pressed, the level switcher cuts the building away, a furniture item is placed and then dragged, rotated,
  long-pressed, duplicated and deleted with real touch events, walk mode is entered and left, and held across
  the sheet is at the side. It also counts WebGL draw calls (nothing is drawn while nothing moves, a finger
  or "Reset view" draws again), checks the canvas' pixel ratio (at most 1.5), that every control has a name,
  and that the web app manifest and its icons are served, and that there is no layout manager. The View panel's
  **Quality** control has its three named values and remembers the chosen one. Then the frame loop
  (`docs/mobile.md` § Battery and heat), in a phone's and in a desktop's (1440x900) context of their own, read from
  `?perf=1` (`window.__myHomePerf()`): for each of `?quality=fast|auto|beautiful` (with `stepdown=off`) the view
  settles (`canvas[data-frame="settled"]`) in its tier (fast, or beautiful for `auto` and `beautiful`) and then
  draws nothing; finish textures, held back in a context of their own until the first frames are drawn, are
  asked for in one size (512 px on the phone, 1024 px with roughness maps on the desktop), leave the view unsettled
  until they are here, and compile no shader when they arrive; `auto` rests on a refined frame, and after input draws fast frames and exactly one more refined
  frame; the Quality control switches fast → beautiful → fast without compiling a shader; and a moving frame of the first view and of the whole
  house is within the draw-call budget (250 and 350 on a phone, 350 and 500 on a desktop) and compiles no
  shader. For every setting lamps are lit, at most 6 on a phone and 12 on a desktop, and 1 light casts a shadow on
  a phone (the sun) and 5 on a desktop; then the figure walks (`?walk=first`) until the lamp pool has moved to
  other lamps (a phone), and the shader program count and the compile counter are what they were. The readout's
  **Copy** is clicked once per device at rest: the clipboard holds the markdown table (commit, mode, viewport,
  browser, this device's budgets), the button says "Copied", nothing is drawn, and the copied idle count is 0; the
  table is printed, to paste into a pull request. A build
  before #110 skips the frame loop, one before #111 the lamps, one before #123 the copy. Then the **named views**
  (`docs/views.md`), on a phone and on a desktop: `?view=cutaway` and `?view=eye` open from their links, settle,
  keep their address and show no room names, and "Free" and "Cutaway" switch back and forth without a compile; `?view=section` stays within the whole house's draw-call budget,
  also with its cut moved by the slider (the address follows), and switching it off ("Free") and on again
  compiles no shader; and **Save image** downloads `my-home-section-<date>-<time>.png` at twice the canvas size
  with `quality=fast` in the address, after which the canvas has its own size again. A build before #114 skips
  them, one without the section its part. Read-only: every
  placement write is **answered inside the browser** (as the api would, merged into the placement reads), every
  other write is refused there.
- `catalog-smoke.sh <env> [--out file.png] [--home ID]`: the catalogue pages (`docs/catalog.md`) at 1440x900 and
  at 390x844 with touch. The control-panel or top-bar entry opens `/catalog`; both kinds are shown, every card
  has its number of uses, the finishes are listed (each textured one with a CC0 source), thumbnails are rendered
  and kept in the Cache Storage, and search filters. A card
  opens its piece page, and the back button returns to `/catalog`, then to `/`. A deep link to
  `/catalog/furniture/furniture.bed` loads in a fresh browser and survives a reload. It also checks: no console
  or page errors, every control and link has a name, and on the phone one column, touch targets of at least
  44 px, a sticky header, and no sideways scrolling upright or across (844x390). Every type's piece page draws in
  3D with dimension labels in cm, openings have a section (frame and glass rectangles where glazed), the
  playground changes the bed's colour and width live (and refuses 500 cm), and on the phone the inspector takes
  40 % of the height upright and stays usable across. In the viewer, `/?focus=<a window of the home>` selects it
  (the chip shows its name and links its piece page) and an unknown id says "Not found in this home".
  The kitchen, corridor and fixture types (#62) are all listed, **Fixtures** is a section of its own (Heating,
  Lighting), and each of their piece pages is under its kind, says how the piece is mounted and offers **Place**
  only when it stands on the floor; a desktop screenshot of each (`<out>-<family>-<variant>.png`). A build before
  #62 skips these checks. The patio and garden types (kind `outdoor`) are a section of their own, **Outdoor**, and
  each of their piece pages is under `/catalog/outdoor/`, says it stands on the ground outside and offers no
  **Place**, not even in edit mode; a build without outdoor types skips this.
  The piece page's uses: where-used of `door.interior` in the first home (the count equals the catalogue's, every
  use links to `?focus=`); a casement window's editor opens through `#use=` (on the desktop its **Save** sends the
  edit, which the browser answers with an error: nothing is stored) and its history opens read-only; and
  **Place** on the bed's page with its POST answered inside the browser (no placement is created), ending on
  `/?home=<that home>&focus=…&panel=furniture`. Screenshots: `<out>` (desktop), `<out>-phone.png`, and
  `<out>-{window,window-section,door,bed,focus,uses,history,place}.png`,
  `<out>-{bed,bed-across,focus,uses,history,place}-phone.png`. Every write is refused or answered inside the browser
  ("nothing was written": no smoke writes on a deployed environment). `screenshot.sh --path '/catalog'`
  shoots the catalogue too: off `/` it waits for the page's heading instead of the canvas (the thumbnails
  render within the default `--wait`).
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
  walks it up and the minimap switches level; and in `auto` walking draws fast frames and one beautiful frame
  follows when the figure stops; and held sideways (844x390) the `?perf=1` readout starts folded, covers no
  walk control folded or open, and its Copy answers a tap; nothing may log an error. Read-only. Playwright (pinned) is installed outside the repository in
  `${XDG_CACHE_HOME:-$HOME/.cache}/my-home-environments/playwright`, Chromium in `~/.cache/ms-playwright`;
  `screenshot.sh --check` installs them if missing and verifies a headless launch.
- `raise-env-issue.sh [--dry-run] [--force] <env> <summary> [details-file]`: refuses (exit 3) unless
  `env-status.sh` reports BROKEN; then comments on the open `environment`-labelled issue titled
  `[env] <env>: ...`, or creates one (and the label). `--force` is for a human override only.

## Photos and photo requests

The owner photographs the real home from a known pose in the model (`docs/photos.md`). Use the photos when
refining the model, and **ask for a photo instead of guessing** when unsure about a wall, room, opening or
furniture. `--home` defaults to the first home.
To measure from photos (calibrating the camera, scale references, overlay screenshots at each pose), see
[my-home-photo-modelling](../my-home-photo-modelling/SKILL.md).

- `photos.sh <env> list [filters]`: metadata as JSON, newest first. Filters: `--room ID`, `--level ID`,
  `--near X,Z,RADIUS` (metres on the plan), `--tag TAG`, `--request ID`, `--since TIME`, `--until TIME`,
  `--subject use:<useId>|type:<typeId>` (photos linked to that use or type; each photo lists its `subjects` with
  their name and `current`/`missing` status).
- `photos.sh <env> get <photo-id>`: one photo's metadata (pose, captured room, note, tags, sensor snapshot).
- `photos.sh <env> sensors <photo-id>`: whether the photo's heading was measured by the phone's compass or
  set by hand, with the raw sensor values. Trust a measured heading more, but mind its accuracy.
- `photos.sh <env> download [--dir DIR] [--thumbnail] <photo-id>... | [filters]`: saves `<id>.webp` and
  `<id>.json`. Use a temp or artifact directory, **never the repository**.
- `photos.sh <env> annotate <photo-id> [--note TEXT] [--tag TAG]... [--subject S]... [--no-subject S]...`: record
  what the photo shows; `--subject use:<id>` or `type:<id>` links it to a use or type, `--no-subject` unlinks.
- `photo-requests.sh <env> create --reason TEXT [--room ID] [--at X,Z] [--level ID] [--heading-deg DEG | --yaw RAD]
[--pitch RAD] [--subject use:<id>|type:<id>]`: ask the owner for a photo: where to stand, which way to look
  (degrees clockwise from plan north, `-z`) and what you need to see. The owner sees it on the phone as a target
  marker. With `--subject use:<id>`, `--room`/`--at` are optional: the server puts the request in the use's first
  room. The photo that answers it is linked to the subject.
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
be undone. Placements, overrides and notes come from the **seed in git** (§ The seed): an edit on an environment is
a **draft** until it is exported into a pull request, and the next deploy (of any branch, on staging) overwrites
it. So agents edit them on **staging** and export; production follows on the merge's deploy (edit production only
when asked, and export that too).

The viewer's furniture **is** the home's placement set (one per home, no named layouts; `docs/furniture.md`), and
opening overrides render in the house: a change made here shows up in the viewer (when its tab becomes visible
again). `/?home=<id>&focus=<useId>` frames and selects a use, e.g. to screenshot an override:
`screenshot.sh staging --path '/?focus=<useId>&hints=off'`.

The **piece page** of a type (`/catalog/<kind>/<typeId>`, `docs/catalog.md`) lists every use in the environment
with its overrides, history (with one-click Undo), photos, notes and photo requests, and edits each use's basic
parameters. To point the owner at one use in an issue or PR, link its row:
`https://home-staging.nntin.xyz/catalog/openings/window.casement#use=souterrain-kitchen-window`
(`#use=<useId>` opens and scrolls to it; `?home=` picks the home when ids repeat). The old layouts API is gone
(`/api/homes/<id>/layouts` is a 404): furniture is placements (`docs/furniture.md`).

- `uses.sh <env> whoami`: the actor the api records for this token (`agent`, source `identity` on deployed hosts).
- `uses.sh <env> types`: the catalogue types with their parameters (tier `basic` = changeable per use, limits).
- `uses.sh <env> list [--type TYPEID] [--status ok|needs-attention] [--include removed]`: where-used. Git uses
  with their overrides, placements, and orphans (an override whose opening left git, a placement whose type,
  level or room is gone) with `problems`.
- `uses.sh <env> place --type furniture.bed --level ID --at X,Z [--rotation-deg D] [--mount M] [--elevation-cm CM]
[--param k=v]... [--name TEXT]`: the server picks the id (`<apartment>-<type>-<n>`, never reused), the name
  ("Bedroom · Bed") and the room. `--mount floor|wall|ceiling` and `--elevation-cm` (the bottom's height above the
  floor) default to the type's; a wall piece's back must touch a wall face (else it needs attention: "hangs on no
  wall"), a ceiling piece hangs at the ceiling over it. `move <id> [--at X,Z] [--rotation-deg D] [--mount M]
[--elevation-cm CM]` changes any of them.
- `uses.sh <env> set <useId> --param k=v [--param k=v]... [--clear k]...`: a placement's params or an opening's
  override (colours `#rrggbb`, lengths in metres). `move <id> --at X,Z [--rotation-deg D]`, `rename <id> TEXT`.
- `uses.sh <env> remove|restore <placementId>`: to the trash (purged with its history after 30 days) and back.
- `uses.sh <env> history <useId>`, `uses.sh <env> undo <useId> <entryId>`: undo is field by field; it refuses
  (409) when a field changed again later or the entry was already undone. An undo can itself be undone.

Every write reads the current version first; a 409 means someone changed the use in between: list again.

Notes (free text, `docs/userdata.md` § Notes; ids with a `.` are types, others uses of `--home`):

- `uses.sh <env> notes <useId|typeId>`: oldest first. Type notes are environment-wide.
- `uses.sh <env> note-add <useId|typeId> TEXT`, `note-edit <noteId> TEXT`, `note-delete <noteId>` (soft). Notes have
  no history or undo. Notes are the owner's: write one only when asked. `note-delete` deletes notes only, **never photos**.

### The seed

`data/homes/<home>.seed.json` (`home.seed.json` for "Our home") holds the home's active placements with their
basic params, the opening overrides and the notes (on its uses and on types), in a canonical format: sorted by
id, fixed key order, so a diff shows only what changed. CI validates it against the catalogue and the home's
opening ids. Not in it: history, issued ids, photos, photo requests and the home settings (the declination).

Every deploy's release job makes the environment match the seed of the deployed commit, in one transaction:
missing placements are created with the seed's ids (never re-issued), changed ones are updated, a seed placement
in the trash is restored, and **active placements that are not in the seed go to the trash** (restorable for 30
days); overrides are set or emptied; notes are created, overwritten or soft-deleted. Every placement and override
change is in the use's history as actor `system` named `seed` and can be undone until the next deploy. An unchanged seed
changes nothing. Photos and their links survive, as ids are stable.

- `seed.sh <env> export`: the environment's state as a seed file, on stdout. The workflow: **place on staging →
  `seed.sh staging export > data/homes/home.seed.json` → PR → merge → production follows on its deploy.** Export
  right after placing: staging is shared, and a deploy of another branch replaces unexported edits with that
  branch's seed. Rebase first, so the export does not undo another merged PR's seed (review the diff).
- `seed.sh <env> diff [--file PATH]`: a unified diff from git's seed (`-`) to the environment (`+`); exit 0 none,
  5 drift. After a deploy it is empty; anything else is an unexported edit (or a deploy of another branch).
- `seed.sh <env> --allow-write import [--file PATH]`: applies a seed now, as a deploy would (`PUT
/api/homes/<home>/seed`, history by `system` named `seed import by <who>`). Only when the owner asks;
  the next deploy applies git's seed again.

### Test data

There is no test home on a deployed environment: **never write test data there** (the mock home is gone). Every
browser smoke is read-only: it refuses writes, or answers them inside the browser. `uses.sh` refuses its write
commands without `--allow-write`, which is for a change the owner asked for in "Our home", never for a test. API
write tests run in CI (the unit tests on PGlite or the CI Postgres, and the docker job's place → set → history →
undo → remove round trip on a throwaway stack).

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
- Prefer staging for tests and experiments. Homes, placements, overrides and notes are replaced from git on every
  deploy, so keep nothing there you need later without exporting it; photos, photo requests and history are **not**
  reset, so write only what the task asks for: no test photos, uses or notes.
  Change production only when the task asks for it.
- Never use the browser login flow on auth.nntin.xyz. The token exchange is the only supported way for agents.
- Reuse the cached site token; exchanging per request hits the rate limit (30 per minute).
