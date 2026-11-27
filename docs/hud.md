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

## In React (`apps/web/src/hud/`)

- One wrapper per element (`SkButton`, `SkCheckbox`, `SkSlider`, `SkInput`, `SkTabs`, `SkToast`, …). Static
  strings are attributes; values are properties set through a ref (`useProperties`), so a value from code plays
  no reaction; events are `addEventListener` (`useListeners`). `className` stays on the host, for the stylesheet
  and the smokes. A wrapper never sets React state per frame.
- **Tests:** jsdom has no Sakuga. `test-setup.ts` installs the fallback, so tests find the HUD by role and name
  (`getByRole('button', { name: 'Walk' })`) and drive it with clicks and keys.
- `sakuga()` (`hud/sakuga.ts`) is `window.SakugaFX` with types, or undefined where it did not run.

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
- A lazy chunk (`hud-measure`, `apps/web/src/hud/measure/`), loaded only on that address. Its numbers are never
  made on the agents' machine: there the view draws about one frame a second.
