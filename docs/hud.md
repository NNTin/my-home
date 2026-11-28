# The HUD

The HUD is Sakuga VFX (`packages/sakuga-vfx`, read its `AGENTS.md` first), built family by family after the
design `docs/design/hud.md` (#167, #168). This page says what exists and how the app uses it.

## Loading

- `sakuga-progress-<hash>.js`, blocking in `<head>`: the loading bar with the core (`docs/loading.md`).
- `sakuga-hud-<hash>.js`, deferred right after it: every other element the app uses, each **without its copy of
  the core**, and the icons (`icons/icons.js`). `apps/web/sakuga-plugin.ts` builds it (`HUD_ELEMENTS`: a family's
  PR adds its elements there) and puts both scripts into `index.html`; `sakuga-plugin.test.ts` checks it
  offline. Budget: `first.sakuga-hud` in `apps/web/bundle-budget.json` (50 kB gzipped).
- If `sakuga-hud` did not load, `main.tsx` defines plain stand-ins for its tags (`apps/web/src/hud/fallback.ts`):
  the HUD works without reactions.

## The look: paper

- **The HUD is white paper on the scene** (design §3): every panel, bar, sheet, floating tool and page an opaque
  white card with the ink line and the hard lavender shadow; no translucency, no blur. The values are the
  `:root` block at the top of `apps/web/src/styles.css` (upstream's `--sk-*`, which win over the core's
  `:where(:root)`, plus the compact size `--hud-*-compact`, `--hud-line`, `--hud-focus` and `--hud-page`).
  Restyle through these variables, never with a colour of its own.
- **Today's native controls are drawn in paper** by the shared rules after it (compact line, 800 italic labels,
  pressed is an ink fill, the pink focus ring), until their family makes them Sakuga elements. Warnings are ink
  text after a pink "!" and boxes with a pink shadow, never pink text. Room names are paper tags.
- The catalogue and piece pages are white (`--hud-page`); the 3D previews keep their backdrop in a paper frame.

## In React (`apps/web/src/hud/`)

- One wrapper per element (`SkButton`, `SkCheckbox`, `SkSlider`, `SkInput`, `SkTabs`, `SkToast`, …). Static
  strings are attributes; values are properties set through a ref (`useProperties`), so a value from code plays
  no reaction; events are `addEventListener` (`useListeners`). `className` stays on the host, for the stylesheet
  and the smokes. A wrapper never sets React state per frame.
- **Tests:** jsdom has no Sakuga. `test-setup.ts` installs the fallback, so tests find the HUD by role and name
  (`getByRole('button', { name: 'Walk' })`) and drive it with clicks and keys.
- `sakuga()` (`hud/sakuga.ts`) is `window.SakugaFX` with types, or undefined where it did not run.
- **What is Sakuga so far (PR 3, buttons):** the phone's top bar (Walk, Photos with its count, Catalogue), the stage
  tools (Reset view, the status badge), the furniture and piece toolbars (`SkIconButton`), the hints' "Got it", the
  edit badge and the viewer's warnings (`SkNotice`: `sakuga-toast kind="warn"`). `SkButton` and `SkIconButton` take
  `href` (a real link; `useLink` sends a plain click through the router), `pressed` (a toggle, even when off) and
  `size="compact"`; `SkBadge` takes `shown` (it pops in or shrinks away), `kind`, `count`, `done`, `duration`.
  `HudIcon` puts an ink-line icon in a control's text.
- **What PR 4 added (choices):** `SkSegmented` (the levels, the quality, the named views), `SkField` (the selects and
  the furniture panel's number), `SkToggle` (the painted switch: Edit, Room names, Plan colours, Effects; its words
  flip it too), compact `SkCheckbox` in the panels' lists, `SkSlider` for "Cut at". Edit is in the stage tools on a
  phone, on its own line under the home's name on a desktop, and on the piece page's second header line.
- **The painted toggle's frames** come lazily (`hud/toggle.ts`, `virtual:sakuga-toggle-frames`): the two rest frames
  once the loading screen has gone, all 43 on idle with effects on; their files are `sakuga-toggle-rest-*.webp` and
  `sakuga-toggle-frames-*.webp` (lazy budgets with `ext: ".webp"`, checked by `check:bundle`).
- **Effects** (`hud/effects.ts`): on by default, stored as `my-home.effects`; off sets `SakugaFX.calm` (C3).
- **Touch size:** a compact control draws a 34 px face and takes touches 44 px across inside its shadow root. The
  smokes hit-test it (`elementFromPoint` at the edges of the 44 px square), never its box.

## The clock at rest, effects off

- **The Sakuga clock sleeps at rest** (C1): with nothing being used, no animation frame runs.
  `SakugaFX.stats` says how many frames it ran.
- **Effects scale with their element** (C2): `--sk-fx-scale` (0.7 for compact controls).
- **`SakugaFX.calm = true`** turns every effect off (C3), as reduced motion does. The app's "Effects" switch sets
  it (PR 4 of #168).

## The measuring page: `/?hud=measure`

What only the owner's phone can tell (`docs/design/hud.md` §10.2): whether effects over the 3D view cost frames
while orbiting and walking, and whether the Sakuga clock sleeps at rest on the phone.

- Open `https://home-staging.nntin.xyz/?hud=measure` (or production) and leave it in front, untouched, for about
  a minute: it orbits the camera for two runs of 5 s (without and with effects fired over the view four times a
  second), opens itself again walking (`&walk=first`) for two more, and checks the clock at rest in between.
- It ends with **"Copy the table"** (the commit, the device, the numbers) and the six words at compact size, each
  with "Save". Paste the table and attach the images where the issue asks.
- **Measured on the owner's phone (2026-11-27): a pass** (design §10.2): 60 fps with and without effects,
  Sakuga about 1 ms a frame, asleep at rest.
- A lazy chunk (`hud-measure`, `apps/web/src/hud-measure/`), loaded only on that address. Its numbers are never
  made on the agents' machine: there the view draws about one frame a second.
