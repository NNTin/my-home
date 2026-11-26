# Measuring from photos

`measure.py` is a pinhole camera in pure Python (no numpy). Its docstring has the full spec. In short: calibrate
the camera, fix the scale, then cast pixels onto known planes.

## Stored poses

- The owner sets heading and pitch by hand (`sensors.source = manual`). Some photos still have the default
  pose (a round position, yaw exactly ±π/2, pitch 0).
- `fovH` comes from the phone's EXIF focal length (23 mm here) and the picture's shape (docs/photos.md § Field
  of view):
  - landscape photos (2560×1920) store 1.328 rad (76°, f ≈ 1665 px), and that is **right**: two-VP calibration
    gave 1.318;
  - portrait photos (1920×2560) should be **1.061 rad (61°, f ≈ 1630 px)**: a two-VP calibration of the
    L-kitchen photo 17409fa3 (worktop, drawer and plinth lines, read in zoomed crops) gave 1.048 with no roll,
    and two corridor photos (the corridor's VP plus the converging door frames) gave 1.07 and 1.14. Until #70 the
    app stored 0.962 (55°) for them; the four on staging were corrected with `pose.sh`. An earlier note here said
    ≈1.30 for portrait: that was wrong. The same kitchen photo read without zooming gives 1.31 with a 4° roll,
    so read the lines in crops and distrust a fit with a large roll.
  - Physically, one camera has one f in pixels: a portrait photo's f is its landscape twin's, so its fovH is
    `2·atan(0.75·tan(fovH_landscape / 2))`. Use that to check a calibration.
- In the #60 corridor photos the pitch was really −2° to −17° (stored −14°), and headings were 15–20° off.
- **The position is not where the owner stood.** For an answered photo request, the stored position is the
  request's target spot: the owner accepts it, then stands where the view works. One answer stored at x 8.7
  showed a door that is at x ≈ 10.3–11.2.
  - Never anchor a measurement on the pose position. Anchor it on fixed features in the photo: an outer wall's
    inner face, an interior wall end, a known product against a wall.
  - Then chain the other features from that anchor, using near distances only.
- So calibrate from the image. Use the stored pose only as a rough start.

## Calibration

Write pixel coordinates in **original image pixels** (the grid labels).

1. **Two orthogonal horizontal directions** (two walls of a room corner, the two runs of an L-kitchen) give the
   focal length, heading, pitch and roll. For each direction, give at least 2 image lines that are parallel in
   the room (skirting, worktop edge, plinth, ceiling edge, a cabinet's top and bottom edges) plus the direction's
   plan heading:
   ```json
   {
     "image": { "width": 1920, "height": 2560 },
     "camera": {
       "vps": [
         {
           "lines": [
             [
               [615, 1505],
               [1107, 1419]
             ],
             [
               [577, 732],
               [1120, 799]
             ]
           ],
           "heading": 0
         },
         {
           "lines": [
             [
               [1548, 1599],
               [1107, 1419]
             ],
             [
               [1629, 654],
               [1120, 799]
             ]
           ],
           "heading": 270
         }
       ]
     },
     "fitHeight": { "bottom": [1283, 1491], "top": [1312, 878], "size": 2.0 },
     "points": [{ "name": "worktop corner", "px": [1041, 1251], "on": { "y": 0.9 } }]
   }
   ```
   These pixels are projected from a synthetic camera (fovH 1.30, heading 300°, pitch −10°, h 1.45; see
   `tests/measure.test.sh`). Rounded to whole pixels, they recover f 1267 (fovH 1.297), heading 299.97°, pitch
   −10.04°, h 1.455, and put the corner at dx −3.02, dz −2.01 (true: −3, −2).
   The underlying formula is `f² = −(VP1 − c)·(VP2 − c)`, with c the image centre. If the vanishing points are
   nearly at infinity (a wall seen head-on), the focal length is unreliable: use one VP plus a known f instead.
2. **One direction plus the verticals** (looking down a corridor with the phone tilted):
   `{"vp": {"lines": …, "heading": 90}, "vertical": {"lines": …}}`. Vertical edges (door frames, wall corners)
   converge when the camera pitches; with a horizontal VP that gives f, heading, pitch and roll. It needs a pitch
   of 5° or more (else the vertical VP is too far away), and the frame lines as long as possible: read both ends
   in zoomed crops. Check f against the stored fovH of the same format.
3. **One direction** (looking down a corridor): `{"vp": {"lines": …, "heading": 90}, "f": 1630}` or `"fovH"`.
   Take f from a calibrated photo of the same format; zero roll is assumed.
4. **Pose as stored:** `{"heading": …, "pitch": …, "fovH": …}`. Only to project model points (`"project"`) for a
   rough comparison.

Every calibration prints `camera.pose` (yaw, pitch, fovH in radians, the photo pose convention). Store it with
`pose.sh <env> set <photo-id> --from <measure output> --reason "…"` so the overlay and later measurements start
from it; the position is not changed (anchor positions on fixed features, below). When the model's layout is refitted
(walls moved, #78), move the photo with `--x`/`--z` so it stands where it did relative to the rooms: `pose.sh <env> set <id>
--x 6.63 --z -6.74 --reason "onto the refitted corridor"`. A fovH alone (for example
recomputed for a format) is `pose.sh <env> set <id> --fovh 1.0614 --reason "…"`.

## Scale

Every distance scales with the camera height h. Fix h with `"height"` or with `"fitHeight"` (a vertical edge of
known length standing on the floor). Then check it with a second reference in the same photo. Expect h ≈
1.3–1.6 m (a phone held at chest height); it differs per photo.

| Reference                      | Size                                                                                                         | Notes                                                                   |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------- |
| Interior door, German standard | leaf 0.735/0.86/0.985 × 1.985; frame opening ≈ leaf + 0.02; frame outer ≈ leaf + 0.12; frame top ≈ 2.00–2.07 | Most here are 0.86 leaves.                                              |
| Worktop height                 | 0.90 (0.86–0.92)                                                                                             | Check it: with the right h, both runs come out at 0.90.                 |
| Worktop depth, thickness       | 0.60, 0.038–0.04                                                                                             |                                                                         |
| Kitchen units                  | widths 0.30, 0.40, 0.45, 0.50, 0.60, 0.80, 0.90; plinth 0.10–0.15                                            | Snap measured widths to these.                                          |
| Built-in oven, dishwasher      | 0.60 wide (0.595 visible)                                                                                    | A full-height panel with no drawer is usually an integrated dishwasher. |
| Hob                            | 0.60 / 0.80 wide                                                                                             | A slot in the middle means a downdraft extractor.                       |
| Light switch, socket plate     | 0.08 × 0.08                                                                                                  | Only for nearby walls.                                                  |
| IKEA Trofast 3×3               | 0.99 × 0.44 × 0.94                                                                                           |                                                                         |
| Fridge-freezer                 | 0.60 wide, 0.65 deep, 1.76/1.86/2.01 high                                                                    |                                                                         |
| Floor planks                   | count joints across a known width; plank widths vary by product                                              | Weak.                                                                   |
| Tiles                          | 0.30 × 0.60, 0.20 × 0.20, mosaic 0.025                                                                       | Count tiles between features.                                           |
| Window (German)                | common widths 0.885 / 1.01 / 1.135 (rough opening); sill heights ≈0.9 inside, higher in basements            |                                                                         |

Ratio tests need no calibration. Use them first:

- a room's end wall versus the door frame in it gives the room width;
- a cabinet's height-to-width ratio gives its width from its height;
- objects in the same plane share one scale.

## Planes

| `"on"`                    | Plane                                            | Typical use                                                               |
| ------------------------- | ------------------------------------------------ | ------------------------------------------------------------------------- |
| `"floor"`                 | the floor                                        | skirting lines, plinth bottoms, door-frame feet: positions and room width |
| `{"y": 0.9}`              | a height above the floor                         | worktop edges, sills, wall-cabinet bottoms (poor near the horizon)        |
| `{"dx": …}` / `{"dz": …}` | a wall at a known offset from the camera         | items on a wall: widths, heights, positions along it                      |
| `{"x": …}` / `{"z": …}`   | a wall at a known plan coordinate (needs `"at"`) | the fixed exterior faces (e.g. an outer wall's inner face)                |

Anchor the camera on **near** features or on the **fixed exterior** (an outer wall face from `home.json`), never
on a far door. `"project"` with `"at"` draws model points into the photo, to compare without the app.

## Heights without calibration

- **Ratio on a vertical line:** with the camera roughly level (pitch within ±5°), two heights on the same wall
  line at the same distance scale with their pixel distance from the floor line:
  `height_X / height_ref = (v_floor − v_X) / (v_floor − v_ref)`.
  - Door frame top (≈2.05) against the ceiling on the same wall line gave the corridor ceiling (0.92–0.96 →
    2.15–2.25).
  - Check it with a calibrated photo and the worktop as the reference: the kitchen gave 2.11–2.19.
- **Tilted-up photos** (pitch +30…+45°, the owner's answer to "how low is the bulkhead") show ceiling steps,
  boxes and downlights well. Scale them with a known width at the same depth: the corridor's clear width W spans
  Δu pixels at a depth D = f·W/Δu along the optical axis.
  - Two edges at the same height and depths D1, D2 are (D2 − D1)/cos(pitch) apart horizontally. That gave the
    bulkhead box's length (≈1.35 m).
  - A vertical face of Δv pixels at that depth is ≈ Δv·W/(Δu·cos e) high, with e its elevation angle. That gave
    the box's drop below the ceiling (0.10–0.20).
- Keep the ceiling as its own measurement. A misread ceiling line once gave 2.40 where the real suspended ceiling
  was 2.15: always confirm it a second way (the frame ratio, the worktop-calibrated wall line).
- Recessed downlights mean a suspended ceiling. Its height is the finished ceiling (an interior value), not the
  level's structural height (slab and floor levels stay).

## Stairs

- **Count first.** Risers and treads per flight, from below and from above: a count is exact, a going is not.
  A tread seen from above hides the riser under it; the lowest bright line is the first nosing, not the floor.
- **The nosings of a flight give three numbers, not four.** They are equal steps on one line, so one photo fixes
  the ratio of going to rise only together with the camera's pitch: a pitch 3° off moved the going from 0.245 to
  0.28 (#145). Take the rise from the level difference and the count, and the going from a **fixed length**: the
  room's length less the landing, in goings (the foot of the stair to the far wall came out the same, 6.8 goings,
  with two different calibrations).
- A flight's width against its riser's height in a level photo is a ratio test (5.4 risers wide: 1.0 m).
- The stored height of a photo taken on a stair is the model's step under the figure, not a measurement.
- What a photo from below cannot show (the steps above the ceiling's edge) and what it shows dark (the space under
  a landing): ask for it.

## A folding rule in the photo

When the owner lays a folding rule (Zollstock) or tape in the picture, it is the best scale there is:

- A German folding rule has links of 0.20 m, numbered every cm. A tape is numbered every cm, with labels every
  10 cm.
- On the floor along a wall, it measures positions along that wall directly. Read the numbers next to each door
  casing; no camera model is needed for features right next to it.
- For features away from the rule, cast its two ends with `measure.py` (`"on": "floor"`). Adjust `"height"` until
  the cast length equals the rule's length, then measure the rest in the same photo.
- Ask for it explicitly: "lay a folding rule flat along the skirting by the south wall, starting at the corner,
  with both casings of each door in the picture". Without that wording, owners rarely include one.

## Accuracy

- Good (±0.05 m): lateral offsets, widths and heights within about 4 m of the camera.
- Poor: depth along the view axis beyond about 5 m. Points near the horizon move by metres for a 10 px error.
  Re-run with the vanishing point ±25 px to see how sensitive a value is.
- Floor-line and ceiling-line vanishing points can disagree by ~40 px. Average them, or prefer the floor lines
  (closer to the camera).
- When two references disagree (e.g. a door frame gives h = 1.55, a shelf's width gives much less), the wall is
  probably seen more frontally than the fit says. Widen the ± and ask for a photo.
- Cross-check each value: the same jamb from both ends of a corridor, a wall end against the model's interior
  walls, and the worktop at 0.90.

## Reading the scene

- A ceiling **step down** is visible only from the side it faces. Seeing a step from both ends means a lowered
  section between them: locate both faces.
- A recessed niche where the model has a door may be a door hidden behind furniture, or a former doorway. Ask.
- A leaf visible inside a room means the door opens into that room. Hinges show on the side a door opens
  towards. The handle is opposite the hinges.
- Foreground objects hide whole units: a fridge hid an oven, then the corner beyond it in every later view.
  Find a frontal photo of every run before listing its units, and ask for the view from the other side.
- Unit widths come out best from a **frontal** photo: take one known unit (an oven is 0.60) as the scale, then
  snap the others to standard widths.
- Ignore clutter: boxes, bottles, bags, shoes, magnets, items on counters.
