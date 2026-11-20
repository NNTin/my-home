# From photos to catalogue pieces

Extending the catalogue is a recurring task: the owner photographs a room, the patio or the garden, and asks for
what is in it. The workflow is **identify → reuse or add a type (PR 1) → place (PR 2, the seed)**. The patio and
garden of the souterrain went this way: the `outdoor` kind, ten `garden.*` types, then their placements.

## 1. Identify

- Fetch every photo of the place (`fetch.sh staging -- --near X,Z,R`, outdoors without `--level`), including
  photos taken for other issues. Read their notes.
- List each object with the photo ids that show it, roughly where it stands (anchored on the facade, a fence, a
  window or a wall end), and its size class. Count repeated ones (four chairs, two planters).
- Leave out clutter: bags, watering cans, hoses, boxes, things on tables. Leave out anything personal: names,
  number plates, signs, letters, faces, neighbours' houses. Never describe them in GitHub, not even to say
  you left them out.
- Fixed structure is not a piece. Walls, the sunken entry and its steps, retaining banks and terrain levels are
  `home.json` (the exterior and the room plan stay fixed: AGENTS.md). Fences and gates are home-model fences.
  Everything that stands, hangs or grows is a piece: furniture, fixtures, outdoor pieces.

## 2. Reuse a type, or add one

- **Reuse first:** `uses.sh staging types` and `/catalog`. A use changes its basic parameters (colours,
  sizes, a choice), so an existing type with other defaults is no reason for a new one.
- Prefer **one parametric type** to near-duplicates. A rose bush is `garden.shrub` with `flowers: roses`; a square
  pot is `garden.planter` with `shape: square`.
- A new type is a PR reviewed like code ([docs/adding-piece-type.md](../../../../docs/adding-piece-type.md)):
  - the shared definition: id `<family>.<variant>` (never renamed once used), kind, category, basic
    parameters with defaults and limits from the photos, and design ones fixed;
  - the piece module in `apps/web/src/catalog/<family>/<variant>/`: boxes and cylinders, `rotationX` to tilt,
    at most 8 dimension lines;
  - the tests that list every type (`catalog.test.ts`, `Catalog.test.tsx`), the goldens (`vitest -u
src/catalog/golden.test.ts`, reviewed), a test for anything clever, and the table in `docs/catalog.md`.
- Pick the kind by where the piece is:
  - `furniture`: in a room, stands or hangs;
  - `fixtures`: built in (lights, heating);
  - `outdoor` (family `garden`): on the ground outside the rooms.
- Pick the footprint:
  - `rectangle` or `ellipse` take floor space: they collide and block the walking figure;
  - `none` takes none: something you walk or sit under (a pergola) or step over (a stepping stone).
- Look at every new piece page before the PR: `pnpm dev`, then `/catalog/<kind>/<typeId>`, or a local
  Playwright shot. Check the tilts and the proportions.

## 3. Measure and place

Once the type PR is merged and deployed:

- Measure each position with the usual tools ([measuring.md](measuring.md)).
  - Outdoors, anchor on the fixed exterior: the facade's outer face (`x 13.42` on the east), a window's edges,
    the fence line, the sunken entry's edges. The figure's stored pose is no anchor.
  - The ground height is automatic: an outdoor piece stands on the terrain at its position.
- Place on staging, one use per object, with a name that says where it is:
  `uses.sh staging --allow-write place --type garden.chair --level souterrain --at 15.6,-9.4 --rotation-deg 180
--param color=#2f3234 --name "Patio · chair 1"`.
  - Outdoor pieces take the level of the apartment that owns the area (`souterrain`).
  - Rotations: the front is +z, as for furniture.
- Check the result: `screenshot.sh staging --path '/?focus=<use id>&hints=off'`, and `overlay-shots.sh` at the
  photo poses (the poses are hand-set: judge relative positions, not the absolute offset).
- Right away: `seed.sh staging export > data/homes/home.seed.json` (rebase first), then a PR. Production follows on
  its merge. `seed.sh staging diff` is empty after the PR's deploy.
- Link the photos to their uses (`photos.sh annotate <photo> --subject use:<id>`) so the piece pages list them.

## 4. Ask

Ask for a photo when a piece is hidden, only seen far away, or its size or position stays above ±0.2 m
([workflow.md](workflow.md#photo-requests)). Outdoors, the owner may only stand in the souterrain's patio and
garden, or on the street or lane. Questions go in the PR body with your defaults applied.

## Report

Write one table per PR: object, type, use id, position and size with ±, and the photo ids. Keep "left out" to
categories ("clutter, personal items"), without naming any.
