# AGENTS.md: packages/sakuga-vfx

Sakuga VFX: ordinary UI controls that are plain at rest and react like an anime cut when used (springs, drawn
smoke, impact bursts, slashes, manga sound-effect lettering). Copied from
[finktheartist/sakuga-vfx](https://github.com/finktheartist/sakuga-vfx) (MIT, `LICENSE`, by Justin Finkelman) at
the commit recorded in `README.md`, and owned by this repository from then on. Epic #165.

## The role: this package is the app's HUD

- **Every HUD element of the app comes from here.** The loading bar is the first (`progress/`, #166); the rest of
  the HUD follows its design (`docs/design/hud.md`, #167; #168).
- **An element that exists is used as it is:** button, toggle, slider, checkbox, radio, input, tabs, progress,
  rating, toast, tooltip. Its folder's README lists its attributes, properties and events.
- **An element the HUD needs and upstream does not have is made here, in the same style** (§ A new element), as a
  folder of its own like the others, with its file stamped from the core.
- **Restyle only through the `--sk-*` CSS variables** (`--sk-ink`, `--sk-card`, `--sk-pri`, `--sk-acc`, `--sk-sh`,
  …; a page's own `:root` values win). Never edit an element's effects to change its look.
- **How the app loads an element:** a plain script, by a classic `<script>` tag, never as a module, never bundled
  into the main chunk. Each file carries its own copy of the core; the first one loaded sets `window.SakugaFX` and
  the others reuse it (one effects canvas, one clock). The one change the app's build makes: its copies in
  `sakuga-hud` leave the core block out (the core loaded once, owner's answer 5 on #167); the files here stay whole. The loading bar is put in `<head>` by the web build,
  ahead of the main chunk; every other element the app uses comes in one deferred `sakuga-hud` script, each
  without its copy of the core (`apps/web/sakuga-plugin.ts`, `docs/loading.md`). React drives an
  element through its attributes and methods (`apps/web/src/loading/SakugaProgress.tsx`).
- **Upstream's files are kept as upstream wrote them:** prettier and eslint skip this package (except `test/` and
  this file), so a diff of an element against upstream stays readable.

## The art style (binding for every element, old and new)

- **White paper, two tones and a line.** Effects are white, lavender and a violet line; pink only for accents
  (wedges, needles, the check). Every drawn shape is one flat light tone, one flat shadow tone and an outline. No
  gradients, no blur.
- **Things leave by shrinking or thinning, not by fading.** An effect's opacity never changes. (The app's
  loading card shrinks away too.)
- **Squash keeps volume:** squashed lower is wider, stretched is thinner.
- **Springs, not easings,** for anything the hand moves. Stretch comes from the spring's speed.
- **Effects follow speed.** A slow drag is quiet; the big things fire on the release, the landing, the change.
- **Plain at rest:** no idle animation, nothing drawn around a control until it is used.
- **At most one sound-effect word per reaction, on the hit.** The six: ドン (impact), カチッ (click), シュッ
  (swish), ポン (pop), ズザッ (skid), ゴゴゴゴ (rumble). The Japanese words stay (owner, #165).
- **The control works with every effect off.** A real `<button>`, `<input>` or `role` inside, with keys and focus;
  state changes at once and effects only decorate it. Nothing to read depends on an effect.
- **Reduced motion turns the effects off, and the state still changes.** The core drops every effect when
  `prefers-reduced-motion` is set.

## The core build

- `core.js` is the one source of the shared core: `Spring`, the effects layer and every effect, the lettering
  (traced from `art/words/` by `tools/trace.py`), the palette `P`, and `Base`, the custom-element base class with
  one shared clock.
- **Edit `core.js`, never a component file's copy.** Then stamp it into every component file (between its
  `// >>> sakuga core` markers), the toggle's frames into `toggle.js`, and the skill's copy:

  ```sh
  pnpm --filter @my-home/sakuga-vfx stamp      # node tools/build.mjs
  ```

- **CI checks it:** this package's `pnpm test` runs `node tools/build.mjs --check` (exit 1, naming each stale
  file, changing nothing) and `test/build-check.test.mjs` (the check itself, on a copy). It runs in the `check`
  job's `pnpm test`. A new component goes into `NAMES` in `tools/build.mjs`, or the check does not see it.
- A change of the core changes every element: look at each element it touches (§ Checking), not only the one you
  changed.

## A new element, checked frame by frame

The workflow is upstream's skill, `skills/sakuga-vfx/SKILL.md`: read it first. In short:

1. **Decide four things before animating:** the control (it works with every effect off), the beats
   (anticipation, hit, follow-through, settle; one or two effects each), the word (at most one, on the hit), and
   what is real and what is drawn.
2. **Start from an element that exists** or `skills/sakuga-vfx/starter.html`: a folder `name/` with `name.js`
   (the core markers, then the component: `extends fx.Base`, `static css`, `render()`, `setup()`, `frame(dt)`),
   a `README.md` (attributes, properties, events, limits) and an `index.html` to try it. Add it to `NAMES` and stamp.
   Timing goes through `later()` (the shared clock), never `setTimeout`, so it can be stepped.
3. **Look at it frame by frame before it counts as done.** A component that runs without errors has said nothing
   about how it reacts. Serve the folder and step the reaction with `look.mjs`:

   ```sh
   python3 -m http.server 8000 --bind 127.0.0.1 9>&-     # from packages/sakuga-vfx; leave it running
   CHROME=... ao-heavy node skills/sakuga-vfx/look.mjs "http://127.0.0.1:8000/progress/" \
     --select sakuga-progress --do "document.querySelector('sakuga-progress').set(0.9, true)" \
     --act "0:document.querySelector('sakuga-progress').set(1)" --times 0.05,0.5,0.7,0.85,1.1,1.4,1.75,2.2 \
     --out /tmp/sheet.png
   ```

   Read every frame: is the hit frame clear, does anything cover the label, does each effect leave by
   shrinking, is there a frame where nothing happens that should. Fix and look again; expect several rounds.
   Also at `--width 390`, and with reduced motion (the state changes, no effects).

4. **Use it like a person:** real touch and key events through the DevTools protocol, at desktop width and 390 px,
   no sideways scroll, form values in `FormData`. `tools/test.mjs` does this for upstream's gallery
   (`ao-heavy node tools/test.mjs http://127.0.0.1:8000/gallery/`); add the new element's checks to it.
5. **Say what is true** in the pull request: what it does, what was checked and how ("stepped with look.mjs" is
   not "watched at real speed"), and which beats are still weak. Put the frame sheets in it.

On the agents' machine:

- Chrome is Playwright's Chromium, and it needs `--no-sandbox` here (no usable sandbox: it aborts at start and
  `look.mjs` fails with "Cannot read properties of undefined (reading 'find')"). `look.mjs` and `test.mjs` take no
  flags for Chrome, so point `CHROME` at a two-line wrapper in `/tmp`:
  `exec ~/.cache/ms-playwright/chromium-<n>/chrome-linux64/chrome --no-sandbox "$@"`.
- One browser run at a time, through `ao-heavy`. The static server is light: start it directly, with `9>&-`.
- `look.mjs` pauses the Sakuga clock only: the app's own timers (the loading card's shrink) are not stepped.

## Changes made here

What this repository changed in upstream's files, so a later upstream update carries it over by hand (§ Upstream
changes come in by hand). The design is `docs/design/hud.md` §6; the README's note at the top lists them in short.

### The core (#168, PR 1)

- **C1. The clock sleeps at rest.** Only awake components are in the frame loop. A component wakes on a press,
  a key, a focus change or a click inside its shadow root, on a change of an observed attribute (`define()` wraps
  `attributeChangedCallback`), and when one of its springs is moved from outside (`x`, `v` or `to` set to a new
  value: a `Spring` made during `setup()` belongs to the component). It sleeps after two frames in which every
  spring is still (`Spring.still`) and `busy()` is false. A `persist` effect keeps the loop going only while its
  `owner` is awake; a scroll or resize draws it once more. With nothing awake and nothing to draw, no animation
  frame runs at all. `SakugaFX.now` keeps the wall's time across a sleep.
  - **For a component:** state that moves outside springs must call `this.wake()` when it changes (the progress
    bar's `set()`), and a timed state must say so in `busy()` (the toast while shown, the toggle while its
    drawing plays, the progress bar while it loads). A `frame()` that stops stepping a spring must leave it still
    (the toast snaps its scale when hidden). Time "since" something: `fx.now`, not a counter of `frame(dt)` (the
    slider's シュッ throttle).
  - `SakugaFX.stats`: frames the clock ran, the time spent in them (ms), components awake, whether a frame is
    asked for. The measuring page `/?hud=measure` reads it.
- **C2. Effects scale with their element:** `--sk-fx-scale` on the element (or inherited; 1 by default, 0.7 for
  compact) scales each effect it fires about the effect's origin, and pulls an origin outside the element's box
  toward the box by the same factor (a word above a compact button sits lower). The element is the one last named
  by `at()`, the one whose `frame()` runs, or the one that scheduled a `later()`.
- **C3. `SakugaFX.calm` is settable:** the page sets it (the app's "Effects" switch); either it or
  `prefers-reduced-motion` turns effects off.
- **C5. `slash()` sweeps either way** (#168, PR 3): `turn: -1` sweeps the crescent counter-clockwise (the icon button's
  `dir="ccw"`). The default `turn: 1` computes exactly what upstream did, so no existing reaction changes.
- **C6. A press never shrinks a hit area** (HUD v2 #200): `squashy()` writes the inverse of its transform into
  `--sk-unsquash` on the squashed element; a hit area inside it (`::before`) applies `transform: var(--sk-unsquash,
none)`, and `BASE_CSS`'s `:host` resets the variable so it never reaches another component. Chrome hit-tests a tap
  again when it ends: without it, a 60 ms touch 4 px above a compact icon button clicked the page behind (its squash is
  0.74; a primary button's 0.5).
- Checked frame by frame on every upstream element the app uses (button primary and secondary, tabs, checkbox,
  slider, input, toast, toggle, progress), with `Math.random` seeded: at scale 1 the sheets before and after are
  the same pixel for pixel, but for CSS transitions (the wall's clock, not Sakuga's) and sub-pixel noise.

### Components

- `progress`: its persistent paint has the bar as `owner`; `busy()` while it loads; `set()` and `reset()` wake it.
- `toast`: `busy()` while shown; its scale spring is left still when hidden.
- `toggle`: `busy()` while the drawing plays.
- `slider`: its シュッ throttle reads `fx.now`.
- `button` (PR 3): `size="compact"` (13 px, the compact line, radius and shadow, `--sk-fx-scale: .7`, a 44 px hit area
  as `.btn::before` inside the shadow root), `href` (renders an `<a>`, no `href` while disabled), `pressed`
  (`aria-pressed`, `.on`: an ink fill), `expanded` (#168 PR 7/3: a disclosure, `aria-expanded` only; the section it
  opens shows the state). `sync()` applies the attributes without effects; a disabled link carries
  `disabled` as a plain property so `squashy()` and the effects skip it.
- `toggle` (PR 4): `size="compact"` (the drawing at 0.6, a 44 px hit area), frames from URLs
  (`SakugaToggle.frames = { rest, all }`, `warm()`; never all of them while calm), the flip drawn on the page's
  effects canvas (`fx.persist`, handed back to its own canvas at the end and over on the first frame), a CSS switch
  until frames are there, 15 px of room above instead of 89. `toggle/rest.webp` holds frames 0 and 42 (made with
  ImageMagick: `convert frames.webp \( -clone 0 -crop 300x325+0+0 +repage \) \( -clone 0 -crop 300x325+600+1625
+repage \) -delete 0 +append -quality 82 rest.webp`). The app's build strips the inline sheet.
- `checkbox`, `slider`, `input` (PR 4): `size="compact"`. The slider: a value set from code jumps (`jump()`), and
  `aria-valuetext` carries the unit.
- `toast` (PR 3): `kind="warn"` (a pink !, a pink shadow, `role="alert"`), a width from 236 to 320 px, two lines.

### Traps met while making them (PR 3)

- **React 19 sets a prop as a property when the element has a member of that name.** The badge's method `count()`
  was overwritten by `count={3}`: never name a method or field like an attribute a wrapper passes.
- **A `::before` hit area is placed from the padding box:** `inset: -5px` reaches only 2.5 px past a 2.5 px line. Add
  the line to the inset.
- **`aria-hidden=""` hides nothing;** write `"true"`.
- **`tools/test.mjs` leaves its Chrome behind when it throws** (a profile `skv-*` in the temp folder): kill those
  before the next run, they keep animating the gallery and slow every check.

- `button` and `icon-button` (HUD v2 #199): `appearance="clear"`: no box at rest, a crisp edge (`-webkit-text-stroke`
  under the fill), `tone="dark|light"`, `backing`; focus with an edge ring, pressed as an ink fill with a paper edge;
  in `tone="light"` an icon is a paper line on an ink shape. CSS only. Hover's backing leaves a pressed control alone (#200: a
  pressed Views under the mouse lost its ink fill). Demo: `gallery/clear.html` (light, dark, busy).

### Elements of our own

Made here with the workflow above, in `NAMES`, each with a README and an `index.html`; not from upstream.

- `icon-button` (PR 3, `docs/design/hud.md` §5.1): a square paper button with a named icon (`icons/icons.js`), `dir`
  (wedges, or a crescent for `cw`/`ccw`), `hit="puff"`, `size="compact"`, `href`, `pressed`. No word.
- `segmented` (PR 4, §5.2): a radiogroup from `<option>`s (re-read when they change; an option's `label` names it),
  the raised piece in the primary tone slides and lands with a small カチッ; set from code it moves without effects.
- `field` (PR 4, §5.3): a paper frame around a slotted native control; wedges on focus, a give and カチッ on a
  change of a select, colour or date, a pink shadow when `invalid`.
- `badge` (PR 3, §5.12): `shown` (pops in or shrinks away; as built, no effect), `kind="warn"`, `count`, `done`,
  `duration` (leaves by itself; busy while it waits). No word.
- `panel`, `fold`, `card`, `sheet` (HUD v2 #200 1/2, §5.4–§5.6, §5.9): `panel` is the card itself (`shown`: lands with
  a squash and two puffs, hidden it shrinks to its top; `kind="note|dialog"`, `label`); `fold` (`open`; a person's
  press springs the body's height and flips the chevron, `open` from code jumps; `toggle` event); `card` (a link with
  `href`, else a button; `selected`, `description` read after its name; three ticks at its corner); `sheet` (the
  frame of a phone sheet: `snap`, `side`, `dragging`; it springs from its size on screen to the page's CSS size,
  measured on the next frame, and lands with two puffs; it steps by the wall's time, not the clock's capped
  `dt`, and is done within 0.55 s, so a page under a heavy 3D view never measures it half-way; a turn to `side`
  clears both axes). A spring that ends a layout change stops within half a
  pixel (`Spring.still` would take a second longer on 60 px).
- `compass` (HUD v2 #202 1/3, §5.7): the page turns it with `--rose` on the host (read in CSS only); a press: the disc
  squashes, the needle swings in from the old turn (`--wob`, set at the press so no frame shows north early) and lands
  with a ring, two wedges at N and カチッ the first time it crosses north; `poor`: a dashed ring; `size="compact"`
  (60 px); `appearance="clear"` shows the needle and north mark in a 44 px target for Orbit. Its method is
  `named()`, not `label()`: React 19 sets `label={…}` as a property and would overwrite it.
- `map` (HUD v2 #202 2/3, §5.8): the frame of a map; the page's CSS gives its box small and with `large`; a change of
  `large` springs the frame from its box on screen to the new one (scale anchored at the lower right), シュッ and speed
  lines when it enlarges, a squash and two puffs when it lands; `placed(x, y)` (page coordinates): a ring, a puff,
  ポン. Its content (the map, its controls) is the page's, slotted.
- `pad` and `shutter` (HUD v2 #202 3/3, §5.10, §5.11): the look and beats only; the page keeps the controls. `pad`:
  `move(dx, dy, pressed)` (the knob on a stiff spring, stretched by its speed; rim dust at most every 0.4 s, on the
  front layer: `puff` takes no layer; released, back with one overshoot), `travel` (a setter too: React 19 sets it as
  a property). `shutter`: inside the page's `<label>` around a file input or its `<button>`; press: a deep squash;
  release: ink for 0.19 s, a burst on its back layer, a ring, four wedges, カチッ; `busy` dims the icon.

## Upstream changes come in by hand

Upstream is not followed automatically, and never as a submodule or a package dependency.

1. Read upstream's log since the recorded commit (`README.md`, the note at the top) and pick what the app wants.
2. Copy the files in (`git archive <commit> | tar -x` into a scratch directory, then copy over), keeping this
   repository's own files: `AGENTS.md`, `package.json`, `test/` and the note at the top of `README.md`. Keep
   `LICENSE` with its copyright line.
3. Carry over by hand any change made here since (an element of our own in `NAMES`, a fix), stamp the core, and
   run `pnpm --filter @my-home/sakuga-vfx test`.
4. Look at every element the app uses, frame by frame (§ A new element).
5. Record the new upstream commit (the full hash and its subject) in the note at the top of `README.md`, in the
   same pull request. It is reviewed like any change.
