# German windows and doors: what the photos show

From #47 (souterrain windows) and #60 (corridor). Catalogue types: `window.tilt-turn`, `window.casement`,
`window.roof`, `door.interior`, `door.exterior`, `door.french`.

## Windows

- Modern white uPVC, usually one sash per opening. Pairs with a pier between them are two windows.
- **Tilt-turn (Dreh-Kipp) with no sash open.** On the hinge side there is a **corner bearing at the bottom**
  (Ecklager, the tilt pivot pin visible at the corner) and a **stay bearing at the top corner** (Scherenlager,
  with a cover on the frame). The handle sits mid-height on the opposite side, pointing down when closed.
- **Casement only (Dreh):** side hinges, no bottom corner pivot.
- Practically every modern German uPVC window with one handle is tilt-turn. Still say "from the fittings, not
  seen open" and ask the owner to confirm. Read the photos' notes first: on #47 the owner wrote "This window
  can tilt and swing open", which settles it.
- From **outside**, a closed window shows nothing of its hinges, so the type can't be told; only a tilted sash
  shows it. Don't classify other apartments' windows from outside.
- **Roller shutter (Rollladen):**
  - Outside: a slat curtain in side rails with a box above (here only on ground-floor windows).
  - Inside: a box above the window (often a removable panel) and a belt winder or switch beside it.
  - Fabric roller blinds, pleated blinds (Plissee) and privacy film are **not** roller shutters.
- **Window boards:** light marble inside on most windows, tiled in the bath; grey aluminium sills outside.
- Basement windows sit high (sill ≈1.05–1.25 above the souterrain floor) in deep plaster reveals.
  - Measure the opening on the wall plane (reveal edges), not the sash.
  - Interior windows are a refinement only if the owner agrees. The opening is part of the fixed exterior: report
    a size mismatch as a conflict.

### From the photos to the window design (`window.tilt-turn` / `window.casement` parameters)

The design (frame and sash profile, handle, hinges, window board, outside sill; `docs/catalog.md` § Wall windows)
is the same for every wall window. What differs per window is a **basic parameter**, set as a DB override
(`uses.sh <env> set <useId> --param shutter=outside --param shutterClosed=0.4`), never in `home.json`:

| Parameter       | Read it from            | Notes                                                                                                                                                                                      |
| --------------- | ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `handleSide`    | an inside photo         | `right`/`left` **as seen from the room**, facing the window. The handle is on the opening side, the hinges on the other. Several sashes: handles towards the middle (not a parameter).     |
| `boardColor`    | an inside photo         | Light marble ≈ `#ebe8e1` (the default); tiled boards take the tile's colour.                                                                                                               |
| `shutter`       | outside photos first    | `outside`: a box on the facade over the window. `inside`: slats in rails in the outer reveal and no box outside; the box is built in, with a lid over the window inside. `none`: no rails. |
| `shutterClosed` | the photo, or the owner | 0 = rolled up, 1 = closed. It changes from day to day, so record the usual state (or ask) and say which photo you took it from.                                                            |
| `shutterColor`  | an outside photo        | Slat colour (white, grey, beige/wood).                                                                                                                                                     |
| `curtain`       | an inside photo         | `both`, `left`, `right` (as seen from the room) or `none`. Curtains on a rod over the window, not blinds in the frame.                                                                     |
| `curtainClosed` | the photo               | 0 = pushed to the sides.                                                                                                                                                                   |
| `curtainColor`  | an inside photo         | Pick the fabric's mid-tone in daylight, not a highlight.                                                                                                                                   |

Fabric roller blinds, pleated blinds (Plissee) and privacy film are **not** modelled (neither shutter nor
curtain). Mention them in the PR or in the use's note.

### Setting the values (#47 phase C)

- **Pairs of windows** (two openings with a pier, one curtain rod over both, as in the living room): each window
  gets its outer panel. `curtain: left` goes on the window that is on the left as seen from the room, `right` on the
  other. The handles of a pair face the pier, so the window on the right as seen from the room gets
  `handleSide: left`. Work out left and right from the heading: facing south from inside, east is on the left.
- **Colours from indoor photos** read too dark and too warm (lamp light, auto exposure). Average a patch:
  `convert in.webp -crop WxH+X+Y +repage -resize 1x1\! -format '%[hex:p{0,0}]' info:`. Then scale it by a surface of
  known colour in the same light: the kitchen's marble board sampled `#b6b2b0` against the design's `#ebe8e1`, so ≈0.77.
  Say in the issue that the colour is an estimate.
- **Check the render, not only the values:** "View from here" at each photo pose after setting them. The curtain rod
  hangs 15 cm over the opening but never higher than 3 cm under the ceiling (`headroom` from the level's clear
  height). Souterrain windows sit about 10 cm under the ceiling.
- **Staging, then production, with one script** of `uses.sh <env> set <useId> --param k=v … --allow-write` lines, so
  both get the same values. Read back with `uses.sh <env> list` and compare `overrides` and `version`. Every set is in
  the use's history and can be undone.

## Doors

- **Interior doors:**
  - leaves 0.735/0.86/0.985 × 1.985 in a frame (Zarge) whose top is ≈2.0–2.07 above the floor;
  - light-wood or grey leaves here;
  - the leaf is visible inside the room it opens into, and hinges show on that side;
  - the handle at ≈1.05 is opposite the hinges.
- **Exterior (patio) door:**
  - white uPVC with frosted panes and a lever handle (a pull bar outside);
  - opens inward, in a deep reveal;
  - clear opening ≈0.80 inside a ≈0.95–1.0 frame.
- Record swing as "opens into <room>, hinged on the <side> jamb". Say so when it's not visible.
