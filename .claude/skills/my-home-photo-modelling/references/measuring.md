# Measuring from photos

`measure.py` is a pinhole camera in pure Python (no numpy). Its docstring has the full spec. In short: calibrate
the camera, fix the scale, then cast pixels onto known planes.

## Stored poses

- The owner sets heading and pitch by hand (`sensors.source = manual`). Some photos still have the default
  pose (a round position, yaw exactly ±π/2, pitch 0).
- `fovH` is an assumption, not a measurement:
  - landscape in-app photos store 1.328 rad (76°);
  - older portrait photos (1920×2560) store 0.9618 rad (55°), but calibrating one gave **≈1.30 rad (74°)**.
- In the #60 corridor photos the pitch was really −2° to −17° (stored −14°), and one heading was 20° off.
- So calibrate from the image. Use the stored pose only as a start and for the rough position.

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
2. **One direction** (looking down a corridor): `{"vp": {"lines": …, "heading": 90}, "f": 1270}` or `"fovH"`.
   Take f from a calibrated photo of the same format; zero roll is assumed.
3. **Pose as stored:** `{"heading": …, "pitch": …, "fovH": …}`. Only to project model points (`"project"`) for a
   rough comparison.

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
- Foreground objects hide whole units (a fridge hid an oven). Find a frontal photo of every run before listing
  its units.
- Ignore clutter: boxes, bottles, bags, shoes, magnets, items on counters.
