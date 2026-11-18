---
name: my-home-photo-modelling
description: >-
  Turn the owner's photos into model values for my-home: find and download photos by id, compare them with the
  model ("view from here" + overlay), measure positions and sizes from perspective (vanishing points, scale
  references, a calibrated camera), judge German windows and doors, decide when to ask for a photo instead of
  guessing, and record results with provenance in home.json (inside only) or as DB placements. Use for any
  refinement of rooms, walls, doors, windows, furniture or fixtures from photos.
---

# my-home photo modelling

Builds on [my-home-environments](../my-home-environments/SKILL.md): its `photos.sh`, `photo-requests.sh`,
`uses.sh` and Playwright install. Follow the [AGENTS.md](../../../AGENTS.md) rules, the **House model** section
above all: the exterior is fixed, only the souterrain interior is in scope, furniture and fixtures are catalogue
types, and placements are DB data.

```sh
P=.claude/skills/my-home-photo-modelling/scripts
$P/tools.sh check                                   # ImageMagick, font, python3, Playwright, optional OpenCV
$P/fetch.sh staging --grid <photo-id>...            # temp dir: <id>.jpg to view, <id>.grid.png to read pixels
$P/fetch.sh staging -- --near 11,-8,3 --level souterrain   # every photo near a spot (photos.sh list filters)
$P/grid.sh <id>.webp crop.png --crop 600x400+900+1200 --zoom 200   # zoom into a detail, labels stay original px
$P/overlay-shots.sh staging <photo-id>...           # "view from here": <id8>-model.png and <id8>-overlay.png
python3 -I $P/measure.py spec.json                  # calibrate the camera, cast pixels onto floor/wall planes
$P/pose.sh staging set <photo-id> --from out.json --reason "measure.py: corridor VP + verticals"   # correct a pose
$P/pose.sh staging history <photo-id>               # who changed the pose, when; undo <photo-id> <change-id>
```

## Workflow

1. **Collect:** `photos.sh staging list` (filters: `--room`, `--level`, `--near X,Z,R`, `--subject`) and read the
   poses. Check the owner's newer photos too: photos taken for another issue often show your room.
2. **Look:** `fetch.sh` (WebP → JPEG; the image reader cannot open WebP) into a temp dir **outside the repo**.
3. **Compare:** run `overlay-shots.sh` for each photo and list every mismatch (a missing opening, a wall in the
   wrong place). The stored poses are hand-set and often off, so a bad overlay is not proof that the model is wrong.
   When a calibration shows the pose is off, correct it with `pose.sh` (yaw, pitch, fovH; recorded as an agent
   edit with your reason, undoable, the sensor snapshot untouched) and shoot the overlay again.
4. **Measure:** read pixels on the grid, calibrate with `measure.py`, and fix the scale with a known size. Then
   cross-check every value from a second photo or a second reference ([measuring.md](references/measuring.md)).
   Anchor positions on fixed features, never on the pose's position (an answer is stored at the request's spot).
5. **Ask** when a value stays above ±0.2 m, two photos disagree, or something is ambiguous (a door hidden
   behind furniture, a window type). Use `photo-requests.sh create` with a target pose, a reason that says exactly
   what to show (a folding rule in the picture, the phone tilted up for ceilings), and a subject
   ([workflow.md](references/workflow.md#photo-requests)). When the answers arrive, fetch them with
   `-- --since <time>` and read their notes.
6. **Record** every value as `estimated-from-photo` with an uncertainty and its source photo id, then map it to
   the right place ([workflow.md](references/workflow.md#where-results-go)).
7. **Clean up:** `rm -rf` every temp dir (photos, grids, overlays). Never delete photos or requests in the store.

## Rules

- **Privacy:** photo ids only in issues, PRs and reports. Never upload, commit or describe images (no personal
  items, no location). Keep files in `mktemp -d` dirs; the scripts refuse paths inside the repository.
- **The exterior is fixed:** a mismatch with the footprint, outer walls, roof or their openings is reported as
  a conflict, never changed. The ground floor and attic interiors are out of scope.
- **Heavy work** (Chromium, installs) runs in `ao-heavy`, one job at a time. The scripts do this themselves.

## References

- [workflow.md](references/workflow.md): finding photos, view from here, photo requests, where results go, reports.
- [measuring.md](references/measuring.md): the camera model, calibration, scale references, accuracy and pitfalls.
- [windows.md](references/windows.md): German windows and doors: tilt-turn, roller shutters, sills, swing sides.
- [tools.md](references/tools.md): what is installed where, and how to reproduce it.
