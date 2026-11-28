# The viewer on a phone

On a phone the 3D view fills the screen and the controls stay out of its way: a **top bar** for what is used
most, and one **sheet** with the panels. A desktop screen rests on its corners and opens one surface at a time
(HUD v2 #200, [`docs/design/hud-v2/layers.md`](design/hud-v2/layers.md) § Primary; below, § The desktop).

## When the phone layout is used

`useLayoutMode()` ([`apps/web/src/overlay/useLayoutMode.ts`](../apps/web/src/overlay/useLayoutMode.ts)) follows
two media queries:

| Layout      | When                                                                  | Sheet                  |
| ----------- | --------------------------------------------------------------------- | ---------------------- |
| `desktop`   | none of the conditions below                                          | none: the corners      |
| `portrait`  | at most 768 px wide, at most 500 px high, or a coarse (touch) pointer | at the bottom          |
| `landscape` | the same, and the screen is wider than it is high                     | at the right-hand side |

A phone held across is wider than 768 px, which is why a low screen counts as well. The layout follows the
screen while the page is open (turning the phone, resizing a window), and what was chosen stays chosen.

## Top bar

- The mode, read ("Orbit"), and **Walk**, which starts [walking](walking.md) (its name is "Walk and take photos").
- The **level switcher**, a segmented control for the cutaway: Roof and then the levels from the top down. The
  buttons show short names ("First floor (attic)" becomes "Attic", "Ground floor" becomes "Ground";
  `shortLevelName()`), and keep the full name as their accessible name. The arrow keys move through it like a
  radio group. The desktop's upper left corner has the same control (`LevelControl.tsx`).

## Stage tools and Tools

At the foot of the 3D view, within thumb reach: **Edit**, the painted switch that turns
[edit mode](furniture.md#view-mode-and-edit-mode) on (an "Edit mode" badge shows while it is on), **Tools**, **Reset
view** and the status chip. **Tools** opens a menu above them with what left the top bar in HUD v2 (#200): the home
(its name, or a selector when there are several), **Photos (n)** (opens the gallery in the sheet, says the open
photo requests; pressed again while the photos show, it closes the sheet) and **Catalogue** (a link, keeping
`?home=`). Below them (HUD v2 #203): the status in words, **Effects**, **Gestures** (folded: this device's gestures),
**Keyboard shortcuts** (folded: every action's keys, to change, clear or reset; #205), **Measure a distance** (Orbit only, #206: its task bar at the head of the stage, left of the compass; a tap on the model is a point) and **Diagnostics** (the performance readout, the measuring pages). A choice closes the menu; Escape or Tools again closes it and gives the focus back to Tools.

## The desktop

The compass is at the upper right (the orientation area, HUD v2 #202), as on a phone; the surfaces open below it.
Under the compass, **Floor overview** opens the level in view from above, north up (the walking figure is never
moved): on a desktop as the open surface, on a phone at the foot of the view above the tab bar.

Full-bleed at rest: the mode, **Walk** and the level switcher at the upper left; **Views**, **Edit** and **Tools**
at the lower right, clear controls on the scene (`HudCorners.tsx`). The corners take no input themselves, so drags,
clicks and the wheel reach the 3D view between the controls. One surface opens at a time, at the right: **Views**
(the View panel: named views, backdrop, Save image, Render, room names, plan colours, quality and Effects, the
show/hide groups), **Tools** (the menu above), the photos (from Tools; Tools over them goes back to its menu) and the
furniture panel, which opens with Edit and is the selection's inspector: a selection shows a short label at the
lower left ("Bed ›"), which opens it; a `?focus=` link opens it at once; outside Edit it closes when the selection
ends (HUD v2 #201). On a phone the selected window, door, gate or item shows a chip at the top: its name opens the
sheet's Furniture tab on it. In view mode a click or tap on a room's floor selects the room: its floor is outlined,
its label shows, and its inspector says its level and offers **Focus room**. A selected door or window says which
spaces it links. A trigger
pressed again, or Escape, closes the surface and gives the focus back to the trigger.

## Sheet

Four tabs, one panel at a time:

| Tab       | Panel                                                                                                                                                                                                                                                                        |
| --------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| View      | room names, **Plan colours** (room floors in the colours that tell rooms apart, instead of their finishes; remembered on the device), the quality, and **Show / hide…**: levels, apartments and outdoor areas, folded away by default, each with **Show all** / **Hide all** |
| Furniture | the [catalogue and edit tools](furniture.md)                                                                                                                                                                                                                                 |
| Photos    | the [gallery](photos.md#browsing-photos); the trash is behind **🗑 Trash** at its end                                                                                                                                                                                         |
| Requests  | the photo requests                                                                                                                                                                                                                                                           |

The sheet has three sizes: **collapsed** (only the tabs), **half** and **full**.

- A tap on a tab opens its panel; a tap on the open tab, or on the arrow, closes it.
- **⤢** makes an open sheet full size and back.
- The tab bar can be dragged; on release the sheet takes the nearest size.

The 3D view ends where the sheet begins (the `.stage` element is inset by the sheet's size), so the model stays
centred in what is visible, and the compass rose and everything else that floats on the view can never lie under
a panel. A sheet opened to full size lies over the view instead of squeezing it to nothing. Held across, the
sheet is a rail of tabs at the right with the panel beside it, and the view keeps most of the width.

Walking takes the whole screen: the top bar and the sheet are gone until **Exit**, and come back as they were.

## Touch

- **The 3D view**: one finger turns it, a pinch zooms, two fingers move it. The page itself never zooms or
  scrolls under these (`touch-action`), and **⟲ Reset view** at the foot of the view puts the camera back where
  it started, fitted to the view as it is now. It is hidden while looking from a photo ("View from here").
- **Furniture**: in view mode a tap selects an item and shows its name and piece page link, nothing moves. In
  [edit mode](furniture.md#view-mode-and-edit-mode) tap an item to select it and drag it to move it. The rotate ring is wide enough for a finger.
  The selected item's tools float next to it: rotate left and right, **▲ ▼** (raise or lower it by 5 cm; for a
  piece on a wall or raised), duplicate, delete, and **⋯** for the furniture panel (its mounting and height in cm). A **long press** on an item (0.45 s without moving) opens that panel too.
- **Photos**: camera markers have a tap target larger than the camera they show.
- In the panels, on/off settings are switches and every control is at least 44 px high.

The toolbar is DOM floating over the canvas (drei `Html`). R3F listens for pointer events on the element around
the canvas, so events on such DOM reach the scene too: handlers in the scene check `onCanvas()`
(`scene/canvasEvent.ts`) first, or a tap on a toolbar button would also clear the selection.

## Hints and status

- **First-run hints** show once per browser on a phone: how to move the view, where the panels are, how to start
  walking. **Got it** dismisses them for good (`localStorage` key `my-home.hints.seen`).
- A **status chip** next to "Reset view" says what the closed panels cannot: "Loading furniture…", "Saving…",
  "Saved" (fades out), and what needs attention ("Offline: changes kept on this phone", "Changed elsewhere: see
  Furniture").

## The on-screen keyboard

The open sheet must not end up under the keyboard. Where the browser resizes the page for the keyboard
(`interactive-widget=resizes-content`, Chrome on Android), the layout simply shrinks. Where only the visual
viewport shrinks (Safari on iOS), `useKeyboardViewport()` puts the visible height into `--app-height` and sets
`keyboard-open` on the root element; the open sheet then takes all the room that is left and the focused field
is scrolled into view.

## Opening a panel from the address

For links, screenshots and tests:

- `?panel=view`, `furniture`, `photos` or `requests` opens the viewer with that panel showing (on a desktop
  screen, `view` opens the Views surface, `furniture` the furniture panel, `photos` and `requests` the gallery).
- `?sheet=collapsed`, `half` or `full` sets the size of the sheet; it is `half` when a panel is named.

- `?hints=off` leaves the first-run hints out, without marking them as seen.

They combine with `?home=` and are read once when the page opens. `?walk` wins over the panel parameters.
They mean something on `/` only: the [catalogue pages](catalog.md#query-parameters) keep just `?home=`.

## Screen edges and browser bars

- The page uses `viewport-fit=cover` and pads the top bar, the sheet and the walking controls by the safe-area
  insets (`env(safe-area-inset-*)`), so nothing sits under a notch or the home indicator.
- The app is `100dvh` high: the height that is really visible while the browser's bars come and go.
- `overscroll-behavior: none` on the page: no pull-to-refresh and no rubber-band scrolling under a drag.
- Controls in the top bar and the sheet are at least 44 px high, and fields are 16 px so iOS does not zoom the
  page when one is focused.

## Battery and heat

On **every device**, a phone and a desktop alike, the 3D view renders **on demand**: a new frame only when
something changed (the camera, the scene, the size of the view), not sixty times a second. Orbiting, dragging
furniture and the panels ask for frames by themselves. While walking, the walk loop runs outside the canvas, so
`WalkRig` watches the figure and asks for a frame whenever it has moved, and once more while the figure still eases
to a new height. The walk [minimap](walking.md#minimap) is SVG outside the canvas and asks for no frames. At rest
nothing is drawn. The frame loop is `apps/web/src/scene/Frame.tsx`; the frame governor
(`apps/web/src/quality/governor.ts`) marks the canvas with `data-frame="moving|settled"` and
`data-tier="fast|beautiful"` (the tier of the frame on screen), so a smoke or a screenshot can wait for a
settled frame. Settled means the GPU has drawn it.

The sun's **shadow map is static**: it is fitted to what is visible and drawn again only when what casts shadows
changed (the home, what is shown, a furniture item, the walking figure in the overview).

The scene is lit by a **light rig** (`apps/web/src/lighting/`, `docs/design/realistic-render.md` §6): a studio
sun, a neutral studio environment drawn once in the browser, and the **lamps**. Fixtures that emit light (the
downlights) are lit by a **fixed pool of point lights**, created once: **6 on a phone, 12 on a desktop**. A
frame moves the pool to the emitters nearest the view's focus; it never adds or removes a light, so moving
between rooms compiles no shader. A light changes its lamp only while that lamp's room is out of sight. On a
desktop the 4 nearest lamps cast shadows; **a phone never draws a lamp shadow**: the sun's is its only shadow
map. A lamp's light ends at the bounds of its room. `?backdrop=sky|studio-light|studio-dark` sets what is
behind the scene for one visit.

On a phone (the same condition as the phone layout) the 3D view also:

- caps the **device pixel ratio** at 1.5 (2 on a desktop screen): a phone with a ratio of 3 would otherwise
  shade four times as many pixels for little visible gain;
- uses a **1024 px shadow map** instead of 2048 px;
- draws its frames **without multisampling** and smooths the edges with one **FXAA** step after the output pass
  (a desktop's frames have 4 samples).

The **Views** control of the View tab opens the named views (the isometric cutaway, the cross-section with its
slider, eye level in a room), chooses the backdrop and saves the view as an image; **Reset view** goes back to
the free view (`docs/views.md`).

The **Quality** control of the View tab (`fast`, `auto`, `beautiful`: "Fast", "Automatic", "Always beautiful")
says which tier is drawn when; a phone starts on "Automatic". It is remembered on the device
(`localStorage`, `my-home.quality`), and `?quality=` sets it for one visit (`docs/design/realistic-render.md` §3):

- **Fast** draws fast frames always.
- **Automatic** (a phone's default) draws fast frames while a finger moves the view, and **one beautiful frame**
  200 ms after the last frame, when nothing moves any more: ambient occlusion, 4 samples of anti-aliasing, a
  softer sun shadow, and grass tufts on the lawns (along their edges and within 6 m of the camera). Then it stops; at rest nothing is drawn.
- **Always beautiful** (a desktop's default) draws every frame that way.

The beautiful tier's code is a **lazy chunk** (`render-beautiful`), asked for after the first frame; until it
has arrived every frame is a fast one, and if it does not arrive the viewer stays fast and says so. Fast and
beautiful frames draw the same scene with the same lights and shader programs, so switching tier compiles
nothing and a view does not change brightness when it settles.

The viewer **steps down** by itself for the rest of a visit: from "Always beautiful" to "Automatic" when the
median of 30 consecutive moving frames is above 40 ms, and from "Automatic" to "Fast" when a refined frame
takes longer than a second. It says so once ("Showing a faster view on this device"); choosing a value in the
control clears it. `?stepdown=off` turns this off, for captures under software rendering. `?perf=1` shows what a frame costs on the
device: the tier and whether the viewer stepped down, draw calls, triangles, lit lamps, lights with shadows,
shader programs, frame times and the refined frame's time. Its **Copy** button puts the readout on the
clipboard as a markdown table, with the commit, the mode, the viewport and this device's budgets, to paste into
an issue; **Perf** folds it to the two buttons (it starts folded on a phone held sideways, and stands clear of
the walk controls).

Anything new that moves the camera or an object from outside React and the orbit controls (a timer, a sensor)
must call `invalidate()`, or the picture stays as it was until the next input. Anything new that casts a shadow
and moves must also tell the frame loop (`useFrameControl().castersChanged()`), or its shadow stays behind.
Never add a light to the viewer's scene or remove one while it runs: the number of lights is part of every
shader program. A piece that should light the room declares it (`emits`, `docs/adding-piece-type.md`).

## Installing it

The app can be installed to the home screen ("Add to Home Screen" in Safari, "Install app" in Chrome) and then
opens in its own window without the browser's bars.

- [`apps/web/public/manifest.webmanifest`](../apps/web/public/manifest.webmanifest): name, `display:
standalone`, start and scope `/`, the theme colour, and the icons in `apps/web/public/icons/` (192 and
  512 px, a maskable 512 px one, the SVG they are drawn from, and the 180 px `apple-touch-icon.png` for iOS).
- **Behind the sign-on**: browsers fetch a manifest without cookies unless told otherwise, and the sign-on would
  answer that with a redirect to its login page. The `<link rel="manifest">` therefore has
  `crossorigin="use-credentials"`. When the session has expired, the installed app opens the sign-on page
  first, like the browser does, and then the viewer.
- There is **no service worker**: nothing is cached for offline use, on purpose. Cached pages behind a
  sign-on show stale content after a deploy or a sign-out, and furniture edits already survive a lost
  connection ([furniture.md](furniture.md#saving-in-the-web-app)).
- nginx serves the manifest as `application/manifest+json`, revalidated on every load; CI checks that the image
  serves it and every icon.

To redraw the icons, edit `icons/icon.svg` and render it to the PNG sizes (any SVG renderer; they were made
with headless Chromium at 192, 512 and 180 px, the maskable one from the same drawing, which keeps its subject
inside the middle 80 %).

## Accessibility

- Every control has an accessible name: icon-only buttons (the toolbar, the sheet's arrow and size buttons)
  carry `aria-label`s, the level switcher's short labels keep the level's full name.
- The level switcher is a radio group and the sheet's tabs a tab list: one stop in the tab order each, moved
  through with the arrow keys (Home and End for the tabs); Enter or Space opens a tab.
- Focus is visible on every control (a light blue outline, 9:1 against the panels). Measured contrast: text on
  the panels 11.8:1, notes and inactive tabs above 7:1, the weakest label (the selected level in the top bar)
  6.8:1; switches and their borders above 3:1.
- Status changes are announced (`role="status"` on the status chip and the save state, `role="alert"` on
  errors), and `prefers-reduced-motion` switches the sheet's and the switches' transitions off.

## Code

| Part                                   | Where                                                                                |
| -------------------------------------- | ------------------------------------------------------------------------------------ |
| Which layout, media queries            | `apps/web/src/overlay/useLayoutMode.ts`                                              |
| Sheet: tabs, sizes, dragging           | `apps/web/src/overlay/Sheet.tsx`                                                     |
| Top bar and level switcher             | `apps/web/src/overlay/TopBar.tsx`, `apps/web/src/overlay/LevelControl.tsx`           |
| Tools menu                             | `apps/web/src/overlay/ToolsMenu.tsx`                                                 |
| The desktop's corners                  | `apps/web/src/overlay/HudCorners.tsx`                                                |
| View tab                               | `apps/web/src/overlay/ViewPanel.tsx`                                                 |
| Edit, Tools, Reset view, status chip   | `apps/web/src/overlay/StageTools.tsx`                                                |
| First-run hints                        | `apps/web/src/overlay/Hints.tsx`                                                     |
| Furniture toolbar, long press          | `apps/web/src/overlay/FurnitureToolbar.tsx`, `apps/web/src/scene/FurnitureLayer.tsx` |
| Keyboard                               | `apps/web/src/overlay/useKeyboardViewport.ts`                                        |
| What is on screen, `?panel`, `?sheet`  | `apps/web/src/Viewer.tsx`                                                            |
| Styles (`.viewer.mobile`, `.sheet`, …) | `apps/web/src/styles.css`                                                            |

The size of a sheet being dragged stays in the DOM and never reaches React state: a re-render of the viewer per
pointer move would rebuild the whole scene description.

Tests: `apps/web/src/Mobile.test.tsx` (the furniture through the app, with `stubScreen()` from
`src/test/screen.ts` standing in for `matchMedia`), `apps/web/src/overlay/Sheet.test.tsx` and
`apps/web/src/overlay/Touch.test.tsx` (toolbar, long press, reset view, status chip, hints, keyboard).

## Testing on an environment

```sh
S=.claude/skills/my-home-environments/scripts
$S/mobile-smoke.sh staging                                  # phone layout, touch, upright and across
$S/screenshot.sh staging --viewport 390x844 --touch --path '/?hints=off'   # the default view on a phone
$S/screenshot.sh staging --viewport 390x844 --touch --path '/?panel=furniture&sheet=full'
$S/screenshot.sh staging --viewport 844x390 --touch --path '/?panel=view'
```

`mobile-smoke.sh` checks that a fresh visit is in view mode and that a drag there moves nothing, then taps Edit, places, drags, rotates, duplicates and deletes a furniture item with real touch events. Every
placement write is answered inside the browser (route interception), so it changes nothing on the environment. Headless Chromium says nothing
about how smooth the view is on a real phone, or about notches and browser bars: those need the phone.
