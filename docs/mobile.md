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

## Opening a panel from the address

For links, screenshots and tests:

- `?panel=view`, `furniture`, `photos` or `requests` opens the viewer with that panel showing (on a desktop
  screen, `photos` and `requests` open the gallery).
- `?sheet=collapsed`, `half` or `full` sets the size of the sheet; it is `half` when a panel is named.

They combine with `?home=` and are read once when the page opens. `?walk` wins over both.

## Screen edges and browser bars

- The page uses `viewport-fit=cover` and pads the top bar, the sheet and the walking controls by the safe-area
  insets (`env(safe-area-inset-*)`), so nothing sits under a notch or the home indicator.
- The app is `100dvh` high: the height that is really visible while the browser's bars come and go.
- `overscroll-behavior: none` on the page: no pull-to-refresh and no rubber-band scrolling under a drag.
- Controls in the top bar and the sheet are at least 44 px high, and fields are 16 px so iOS does not zoom the
  page when one is focused.

## Code

| Part                                   | Where                                   |
| -------------------------------------- | --------------------------------------- |
| Which layout, media queries            | `apps/web/src/overlay/useLayoutMode.ts` |
| Sheet: tabs, sizes, dragging           | `apps/web/src/overlay/Sheet.tsx`        |
| Top bar and level switcher             | `apps/web/src/overlay/TopBar.tsx`       |
| View tab                               | `apps/web/src/overlay/ViewPanel.tsx`    |
| What is on screen, `?panel`, `?sheet`  | `apps/web/src/Viewer.tsx`               |
| Styles (`.viewer.mobile`, `.sheet`, …) | `apps/web/src/styles.css`               |

The size of a sheet being dragged stays in the DOM and never reaches React state: a re-render of the viewer per
pointer move would rebuild the whole scene description.

Tests: `apps/web/src/Mobile.test.tsx` (the layouts through the app, with `stubScreen()` from
`src/test/screen.ts` standing in for `matchMedia`) and `apps/web/src/overlay/Sheet.test.tsx`.

## Testing on an environment

```sh
S=.claude/skills/my-home-environments/scripts
$S/mobile-smoke.sh staging                                  # phone layout, touch, upright and across
$S/screenshot.sh staging --viewport 390x844 --touch         # the default view on a phone
$S/screenshot.sh staging --viewport 390x844 --touch --path '/?panel=furniture&sheet=full'
$S/screenshot.sh staging --viewport 844x390 --touch --path '/?panel=view'
```

`mobile-smoke.sh` writes only to a layout it creates itself and removes again. Headless Chromium says nothing
about how smooth the view is on a real phone, or about notches and browser bars: those need the phone.
