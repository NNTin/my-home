# Workflow details

## Finding photos

- `photos.sh <env> list` returns metadata, newest first.
  - `pose.position` is the eye (floor + 1.6 m in walk mode). `yaw` is in radians, counter-clockwise from −z;
    heading = −yaw in degrees, clockwise from plan north (`fetch.sh` prints it).
  - `sensors.source` is `manual` when the owner set the heading by hand, which so far is every photo.
- Search by place, not only by the ids an issue lists: `--near X,Z,R` and `--level`. Photos taken for one issue
  (e.g. windows) often show the room of another (e.g. the corridor) from new angles.
- `photos.sh <env> get <id>` and `sensors <id>` give the full record. There is **no EXIF**: the server strips it,
  so the focal length comes from the stored `fovH` or from calibration.
- Uses to work on: `uses.sh staging list --home home` (filter by `typeId`) gives the ids, names, rooms and
  `effective` params.

## Looking at photos

- `fetch.sh --grid` writes `<id>.jpg` (long side 1600) and `<id>.grid.png`. The grid has a line every 100 px,
  every 5th red, labelled in **original** pixels.
  - The image reader shows big images scaled down (e.g. 1920×2560 as 1500×2000). Read positions through the grid
    labels, not the displayed pixel position, so the numbers can go straight into `measure.py`.
- `grid.sh --crop WxH+X+Y --zoom 200` shows small details (hinges, handles, unit joints) at full resolution, with
  labels still in original pixels. `convert a.jpg b.jpg +append side.jpg` puts several crops side by side.
- Mirror check: facing south (+z), plan east (+x) is on the **left** of the image; facing north, it is on the
  right. Write down "left = larger x" or "left = smaller x" before matching openings to model ids.

## View from here and the overlay

- There is no URL parameter for it. `overlay-shots.sh` drives the gallery: `/?home=…&panel=photos&hints=off`,
  the thumbnail `button.thumbnail:has(img[src*="<id>"])`, **View from here**, then **Lay the photo over the 3D
  view** at an opacity of 0.5.
- Use a desktop viewport (1440×1080, the default). Below about 900 px wide, the phone sheet covers half the view.
  SwiftShader needs long screenshot timeouts, which the script sets.
- The overlay is good for gross errors (an opening missing, a wall in the wrong place, a door on the wrong side).
  It is not good for centimetres: the opacity is low-contrast, and the stored poses are hand-set (heading, pitch
  and the default `fovH` are often off by 10–20°; see [measuring.md](measuring.md#stored-poses)). If the overlay
  is off everywhere by the same amount, suspect the pose, not the model. Calibrate it with `measure.py`, store
  the result with `pose.sh` (an agent edit with a reason, undoable) and shoot again; name the change in the
  report.

## Photo requests

`photo-requests.sh staging create --reason TEXT --at X,Z --heading-deg H [--pitch RAD] [--level ID] [--room ID]
[--subject use:<id>|type:<id>]`

- **Inside:** add `--level` and `--room`. Stand about 1.7–2 m from the inner wall face, facing the subject. The
  pitch is about atan((target height − 1.6) / distance). Use pitch ≈ +1.2 to look at the ceiling (downlights).
- **Outside:** **no `--level`**. The walking figure has no level outdoors, so a request with one never matches by
  spot.
  - Only use places the owner may stand: areas with `ownerApartmentId == apt-souterrain`, the street or the lane.
  - Check the line of sight against outbuildings.
  - Never request photos inside the ground floor or attic.
- **Heading sign check:** the view vector is `(sin h, −cos h)` in (x, z). From the north garden, the house is to
  the **south** (180°).
- **One subject per request.** For a shot covering several items, take the first one as the subject and name the
  others in the reason. Link the rest to the answering photo later
  (`photos.sh annotate <photo> --subject use:… --subject use:…`, which adds).
- Requests can't be edited. For a wrong one: `close <id>` (cancel, never delete), then create a new one.
- A good reason says where to stand, what must be in the frame, and why. For example: "door open, whole frame and
  both wall ends visible: position, width, hinge side", or "lay a folding rule along the floor by the south wall".
- **When to ask instead of guessing:**
  - the uncertainty stays above ±0.2 m;
  - two photos or two scale references disagree;
  - the item is hidden or ambiguous (a niche where the model has a door, a window type with no sash open);
  - an item that matters is only visible far away (more than 5 m) or edge-on.
- Link every answering photo, and the extras the owner took unasked, to the uses they show, so the piece pages
  list them.
- **After the answers come in:**
  - `photo-requests.sh list --status all` shows which requests are fulfilled.
  - `fetch.sh <env> -- --since <time>` gets everything taken since you asked, including extras that answer no
    request (e.g. ceiling shots tilted upwards).
  - Read every photo's `note`. The owner answers questions there ("there is a door to the boiler room…").
  - The stored position of an answer is the request's spot, not necessarily where the owner stood
    ([measuring.md](measuring.md#stored-poses)).
  - Write the new values as an addendum to your report, saying which earlier values they replace.

## Where results go

| Result                                                                               | Goes to                                                    | How                                                                                                                                                                                                               |
| ------------------------------------------------------------------------------------ | ---------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Rooms, interior walls, doors, interior openings, stairs, ceilings, floor levels      | `data/homes/home.json` (git)                               | A PR to `data/homes` (deploys replace the stored homes from git). Set `value`, `source: "estimated-from-photo"` and a `note` naming the photo id and the ±. An interior wall change rescales the rooms beside it. |
| Exterior: footprint, outer walls, roof, and openings in outer walls (position, size) | nowhere                                                    | Report it as a **conflict** in the issue (the owner decides). Classifying an exterior opening's `typeId` (e.g. tilt-turn) from inside photos is fine, but say how sure you are.                                   |
| A new kind of furniture or fixture                                                   | a catalogue type in git (#26, `docs/adding-piece-type.md`) | A PR reviewed like code: design params in the type, basic params (colour, sizes) per use.                                                                                                                         |
| Where an item stands, its colour and sizes                                           | DB placements / overrides per environment                  | `uses.sh <env> place` / `set` / `move` (staging first; production only when asked). Never in `data/homes/*.json`.                                                                                                 |
| Photo ↔ use links, notes                                                             | the photo store                                            | `photos.sh annotate --subject`, `uses.sh note-add` (test notes only on mock-home).                                                                                                                                |

Ids are permanent (`docs/home-model.md` § Naming). Give every new use a human name that says where it is
("Kitchen · microwave", "Corridor · downlight 3").

## Reporting

- Value tables: value, ± uncertainty, source photo ids, method or reference. Mark standard sizes as _assumed_.
- Keep the model-vs-photo mismatches, the exterior conflicts and the open photo requests (ids) in separate lists.
- Issue and PR comments carry numbers and lists only: no images, no location.
