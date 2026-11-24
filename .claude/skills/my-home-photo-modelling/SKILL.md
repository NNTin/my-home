---
name: my-home-photo-modelling
description: >-
  Turn the owner's photos into model values for my-home: find and download photos by id, compare them with the
  model ("view from here" + overlay), measure positions and sizes from perspective (vanishing points, scale
  references, a calibrated camera), judge German windows and doors, decide when to ask for a photo instead of
  guessing, choose surface finishes (floors, walls, ceilings, facade, ground) and their tints, and record results
  with provenance in home.json (inside, and finishes) or in the seed (placements, overrides: place on staging,
  export, PR). Use for any refinement of rooms, walls, doors, windows, finishes, furniture or fixtures from
  photos, and for extending the catalogue from photos (identify objects, reuse or add a catalogue type, place them
  through the seed), indoors and on the patio and garden.
---

# my-home photo modelling

Builds on [my-home-environments](../my-home-environments/SKILL.md): its `photos.sh`, `photo-requests.sh`,
`uses.sh` and Playwright install. Follow the [AGENTS.md](../../../AGENTS.md) rules, the **House model** section
above all: the exterior is fixed, only the souterrain interior is in scope, furniture and fixtures are catalogue
types, and placements, overrides and notes come from the seed in git (`data/homes/home.seed.json`): what you set on
staging is a draft until it is exported into a PR, and the next deploy of any branch overwrites it.

```sh
P=.claude/skills/my-home-photo-modelling/scripts
$P/tools.sh check                                   # ImageMagick, font, python3, Playwright, optional OpenCV
$P/fetch.sh staging --grid <photo-id>...            # temp dir: <id>.jpg to view, <id>.grid.png to read pixels
$P/fetch.sh staging -- --near 11,-8,3 --level souterrain   # every photo near a spot (photos.sh list filters)
$P/grid.sh <id>.webp crop.png --crop 600x400+900+1200 --zoom 200   # zoom into a detail, labels stay original px
$P/overlay-shots.sh staging <photo-id>...           # "view from here": <id8>-model.png and <id8>-overlay.png
python3 -I $P/measure.py spec.json                  # calibrate the camera, cast pixels onto floor/wall planes
$P/pose.sh staging set <photo-id> --from out.json --reason "measure.py: corridor VP + verticals"   # correct a pose
$P/pose.sh staging set <photo-id> --x 6.63 --z -6.74 --reason "onto the refitted layout"   # move it (y stays)
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
   the right place ([workflow.md](references/workflow.md#where-results-go)). Placements, overrides and notes:
   **place on staging → export → PR → merge → production follows on its deploy**:
   `uses.sh staging --allow-write place|set|move …`, check the render, then right away
   `seed.sh staging export > data/homes/home.seed.json` and commit it in your PR (the PR's staging deploy applies it
   again: `seed.sh staging diff` stays empty). Never write placements or overrides on production: the merge brings
   them there.
7. **New kinds of objects** (a room's furniture, the patio and garden): identify them in the photos, reuse a type or
   add one in its own PR, then place them through the seed:
   [catalogue-from-photos.md](references/catalogue-from-photos.md).
8. **Clean up:** `rm -rf` every temp dir (photos, grids, overlays). Never delete photos or requests in the store.

## Finishes from photos

A **finish** is a named surface material from the library in git (`docs/home-model.md` § Finishes; the list is on
`/catalog`, section "Finishes"). A room of the souterrain names one for its floor, its walls and its ceiling; the
building for its facade and roof; an outdoor area for its ground. Choosing one changes appearance only: the
geometry rules are untouched. Upper floors take no finishes.

1. **Collect** the photos of the room or surface, as for any refinement (`fetch.sh … -- --room <id>`, and
   `--near` for photos taken from next door). Outside, only photos taken from the owner's garden, patio or the street.
2. **Choose** the library finish that matches the **material and pattern**, not the lighting: a floor in lamp light
   and in daylight is the same floor. Zoom in (`grid.sh --crop`) before calling a wall plain or grained. One finish
   covers all walls of a room: take the one that covers most of them and say in the `note` what differs (a tiled
   strip, one coloured wall).
3. **Tint,** only where the finish is `tintable`: measure a **lit, unshadowed** patch of the surface in **two**
   photos and use a value both agree on.
   - `convert <id>.webp -crop 300x150+X+Y +repage -scale 1x1! -format '%[fx:int(255*r)] %[fx:int(255*g)] %[fx:int(255*b)]' info:`
     gives a patch's mean colour. Look at the cropped patch first: it must show only the surface.
   - A photo gives hue and saturation well and lightness badly (exposure). Compare with something white in the
     same light (a window frame, a tank, a painted wall) to place the lightness.
   - The tint **multiplies** the texture. For a finish with a colour map, divide the colour you want by the mean
     colour of its `color-1024.webp` (the same command), channel by channel, and cap each at 1.
   - A white wall keeps the finish's own white: no photo separates a faint tint from the colour of the lamps.
4. **Direction:** a room's floor may be turned a quarter (`rotation: 90`). At `0` planks run along plan x
   (east-west). Leave it out when the photos do not show the direction, and say so in the `note`.
5. **Record** the finish use in `data/homes/home.json` with `source: "estimated-from-photo"`, the `photos` (ids of
   the photos the choice and the tint were made from) and a `note` (what the surface is, where the tint comes
   from, what the finish does not show). It is a PR to `data/homes`, like every change to the house.
6. **Missing finish:** when nothing in the library fits the material, add one in its own PR from a CC0 library
   (the definition, then `pnpm finishes:fetch <id>`; the manifest test holds the budgets), and name the photo ids
   that called for it. A near match with a note is better than a new finish for a small difference.
7. **Unsure, or not in any photo:** ask for a photo (`photo-requests.sh`, one surface per request, light on,
   what must be in the frame) instead of guessing. Until it arrives the surface keeps its default: write the
   default finish with `source: "mock"` and a `note` that names the request, or leave the field out.
8. **Check** the render on staging against the photos, side by side on your machine, and adjust a tint that reads
   wrong. PRs show renders of the model only.

**Photos are named by id and never uploaded or committed. No texture is ever made from a photo:** a texture cut
from the owner's photo would put the photo into git.

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
- [catalogue-from-photos.md](references/catalogue-from-photos.md): from objects in photos to catalogue types and
  their placements (furniture, fixtures, outdoor pieces).
