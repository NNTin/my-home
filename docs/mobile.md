# The viewer on a phone

On a phone the 3D view fills the screen and the controls stay out of its way: a **top bar** for what is used
most, and one **sheet** with the panels. A desktop screen keeps the two floating panels.

## When the phone layout is used

`useLayoutMode()` ([`apps/web/src/overlay/useLayoutMode.ts`](../apps/web/src/overlay/useLayoutMode.ts)) follows
two media queries:

| Layout      | When                                                                  | Sheet                  |
| ----------- | --------------------------------------------------------------------- | ---------------------- |
| `desktop`   | none of the conditions below                                          | none: the two panels   |
| `portrait`  | at most 768 px wide, at most 500 px high, or a coarse (touch) pointer | at the bottom          |
| `landscape` | the same, and the screen is wider than it is high                     | at the right-hand side |

A phone held across is wider than 768 px, which is why a low screen counts as well. The layout follows the
screen while the page is open (turning the phone, resizing a window), and what was chosen stays chosen.

## Top bar

- The home: its name, or a selector when there are several.
- **🚶 Walk** starts [walking](walking.md); **📷 Photos (n)** opens the gallery in the sheet, with a badge for
  open photo requests.
- The **level switcher**, a segmented control for the cutaway: Roof and then the levels from the top down. The
  buttons show short names ("First floor (attic)" becomes "Attic", "Ground floor" becomes "Ground";
  `shortLevelName()`), and keep the full name as their accessible name. The arrow keys move through it like a
  radio group.

## Sheet

Four tabs, one panel at a time:

| Tab       | Panel                                                                                                                                 |
| --------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| View      | room names, and **Show / hide…**: levels, apartments and outdoor areas, folded away by default, each with **Show all** / **Hide all** |
| Furniture | the [layout manager, catalog and edit tools](layouts.md)                                                                              |
| Photos    | the [gallery](photos.md#browsing-photos); the trash is behind **🗑 Trash** at its end                                                  |
| Requests  | the photo requests                                                                                                                    |

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
- **Furniture**: tap an item to select it and drag it to move it. The rotate ring is wide enough for a finger.
  The selected item's tools float next to it: rotate left and right, duplicate, delete, and **⋯** for the
  furniture panel. A **long press** on an item (0.45 s without moving) opens that panel too.
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
  screen, `photos` and `requests` open the gallery).
- `?sheet=collapsed`, `half` or `full` sets the size of the sheet; it is `half` when a panel is named.

- `?hints=off` leaves the first-run hints out, without marking them as seen.

They combine with `?home=` and are read once when the page opens. `?walk` wins over the panel parameters.

## Screen edges and browser bars

- The page uses `viewport-fit=cover` and pads the top bar, the sheet and the walking controls by the safe-area
  insets (`env(safe-area-inset-*)`), so nothing sits under a notch or the home indicator.
- The app is `100dvh` high: the height that is really visible while the browser's bars come and go.
- `overscroll-behavior: none` on the page: no pull-to-refresh and no rubber-band scrolling under a drag.
- Controls in the top bar and the sheet are at least 44 px high, and fields are 16 px so iOS does not zoom the
  page when one is focused.

## Code

| Part                                   | Where                                                                                |
| -------------------------------------- | ------------------------------------------------------------------------------------ |
| Which layout, media queries            | `apps/web/src/overlay/useLayoutMode.ts`                                              |
| Sheet: tabs, sizes, dragging           | `apps/web/src/overlay/Sheet.tsx`                                                     |
| Top bar and level switcher             | `apps/web/src/overlay/TopBar.tsx`                                                    |
| View tab                               | `apps/web/src/overlay/ViewPanel.tsx`                                                 |
| Reset view, status chip                | `apps/web/src/overlay/StageTools.tsx`                                                |
| First-run hints                        | `apps/web/src/overlay/Hints.tsx`                                                     |
| Furniture toolbar, long press          | `apps/web/src/overlay/FurnitureToolbar.tsx`, `apps/web/src/scene/FurnitureLayer.tsx` |
| Keyboard                               | `apps/web/src/overlay/useKeyboardViewport.ts`                                        |
| What is on screen, `?panel`, `?sheet`  | `apps/web/src/Viewer.tsx`                                                            |
| Styles (`.viewer.mobile`, `.sheet`, …) | `apps/web/src/styles.css`                                                            |

The size of a sheet being dragged stays in the DOM and never reaches React state: a re-render of the viewer per
pointer move would rebuild the whole scene description.

Tests: `apps/web/src/Mobile.test.tsx` (the layouts through the app, with `stubScreen()` from
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

`mobile-smoke.sh` places, drags, rotates, duplicates and deletes a furniture item with real touch events. It
writes only to a layout it creates itself and removes again. Headless Chromium says nothing
about how smooth the view is on a real phone, or about notches and browser bars: those need the phone.
