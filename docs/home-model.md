# Home model

The building is described by one JSON document, the **home model**. Its single source of truth is
the zod schema `HomeModel` in [`packages/shared/src/home-model.ts`](../packages/shared/src/home-model.ts).
The api validates every write with it and the web app validates every response with it.

- JSON Schema: [`packages/shared/schema/home-model.schema.json`](../packages/shared/schema/home-model.schema.json),
  generated with `pnpm schema:generate` and committed (a test fails when it is out of date).
- Mock home: [`data/homes/mock-home.json`](../data/homes/mock-home.json). Its `$schema` points at the
  JSON Schema, so editors such as VS Code validate and autocomplete it.

## Conventions

| Topic       | Convention                                                                           |
| ----------- | ------------------------------------------------------------------------------------ |
| Units       | metres                                                                               |
| Axes        | Y-up, right-handed: `x` east, `y` up, `z` south (towards the street in the mock)     |
| Plan points | `{ x, z }`; polygons are lists of at least 3 points, either winding                  |
| Ground      | `terrain.groundElevation`, normally `y = 0`                                          |
| Elevation   | a level's `elevation` is the top of its floor slab; below-ground levels are negative |
| Wall height | measured from the level's floor; exterior walls usually include the slab above       |
| Ids         | letters, digits, `-` and `_`; unique across the whole document                       |

Ids are unique across all collections so other documents ([furniture layouts](layouts.md)) can
reference any home, level or room by id alone. Layouts are stored separately, so changing or
re-seeding a home never deletes them; items whose level or room disappears are kept and flagged.

## Dimensions and provenance

Every length, coordinate and elevation is a `Dimension`:

```json
{ "value": 2.5, "source": "mock", "note": "optional free text" }
```

| `source`               | Meaning                                       |
| ---------------------- | --------------------------------------------- |
| `mock`                 | placeholder value, not based on the real home |
| `estimated-from-photo` | estimated from photos or video                |
| `measured`             | measured on site                              |

Refining a value means changing `value` and `source` (and adding a `note`, for example which photo
it came from). Nothing else in the model or renderer changes. The only bare number is
`schemaVersion`.

## Structure

| Field          | Content                                                                                                     |
| -------------- | ----------------------------------------------------------------------------------------------------------- |
| `building`     | `footprint` (exterior wall centre lines, used for slabs) and `roofThickness`                                |
| `terrain`      | `groundElevation`, `bottomElevation` and `patches`: plan polygons (with optional `holes`) at an elevation   |
| `levels`       | `elevation`, clear `height` and floor `slabThickness`                                                       |
| `apartments`   | `levelIds` they occupy                                                                                      |
| `rooms`        | floor `outline` on a `levelId`, optionally in an `apartmentId`                                              |
| `walls`        | centre line `start`/`end`, `thickness`, `height`, `kind` (`exterior`/`interior`), `levelId`, `apartmentId?` |
| `openings`     | `door`/`window` on a `wallId`: `offset` from the wall start, `width`, `height`, `sill`                      |
| `outdoorAreas` | `garden`/`driveway`/`patio`/`path` polygons at an `elevation`, with an optional `ownerApartmentId`          |

Terrain patches are drawn as solid blocks from `bottomElevation` up to their elevation. Leaving the
building footprint out of every patch (a hole, or no patch there) keeps the ground out of
below-ground rooms; a lower patch next to a higher one forms a retaining wall, which is how the mock
home's sunken souterrain garden works.

### Validation beyond the shape

The zod schema also checks what JSON Schema cannot, so these only show up in `pnpm test`, the api
and the seed script, not in the editor:

- no duplicate ids
- references resolve: room/wall → level and apartment, apartment → levels, opening → wall, outdoor
  area → owner apartment; a room's level must belong to its apartment
- openings fit inside their wall (`offset + width <= length`, `sill + height <= wall height`) and do
  not overlap each other
- walls have a non-zero length; terrain patches are above `bottomElevation`

Errors carry a path into the document, for example
`openings[2].width: Opening "x" spans 7.65 m to 9.15 m but wall "y" is only 8 m long`.

## The mock home

`data/homes/mock-home.json` (all values `source: "mock"`):

- **Souterrain** (floor at -1.2 m, 2.5 m clear): the user's apartment with hallway, living room,
  kitchen, bedroom and bathroom, interior walls with doors, an entrance door and a patio door to its
  sunken garden (-1.1 m), and high windows on the street side above ground level
- **Ground floor**, **first floor**, **second floor**: one empty apartment each (exterior walls,
  slabs, a few windows; the ground floor has a front door)
- **Gardens**: the souterrain garden behind the building and the ground-floor garden wrapping the
  west and back of the plot; a shared **driveway** on the east side

## Rendering

`apps/web/src/builder/buildHome.ts` turns a model into render descriptors (wall segments, openings,
slabs, room floors, terrain blocks, outdoor surfaces) without three.js, and `visibility.ts` filters
them for the cutaway and the visibility toggles. Walls are split around openings (no CSG). The R3F
components in `apps/web/src/scene/` only draw descriptors, so any file that follows the schema
renders without renderer changes.

## Seeding, swapping and importing homes

The api seeds `data/homes/mock-home.json` on start in development (`SEED_ON_START`). Seeding is
idempotent: a home whose id already exists is left alone.

```sh
pnpm db:seed                                   # the mock home (or SEED_FILE)
pnpm db:seed path/to/other-home.json           # another file; relative to where pnpm runs
pnpm db:seed data/homes/mock-home.json --replace   # overwrite an existing home with the same id
SEED_FILE=../../data/homes/other.json pnpm dev # default for start-up and db:seed (relative to apps/api)
```

Stop `pnpm dev` first when using PGlite (one process per data directory). With the api running,
use HTTP instead:

| Endpoint                    | Behaviour                                                          |
| --------------------------- | ------------------------------------------------------------------ |
| `GET /api/homes`            | summaries `{ id, name, schemaVersion, createdAt, updatedAt }`      |
| `GET /api/homes/:id`        | the model                                                          |
| `PUT /api/homes/:id`        | full replace; body `id` must match; 404 if the home does not exist |
| `POST /api/homes/import`    | create (201) or replace (200) the home with the body's id          |
| `GET /api/homes/:id/export` | the model as a pretty-printed attachment `<id>.json`               |

```sh
curl -X POST localhost:3000/api/homes/import -H 'content-type: application/json' \
  --data @data/homes/other-home.json
curl -OJ localhost:3000/api/homes/mock-home/export
```

Exporting and re-importing gives an identical model. Invalid documents get a 400:

```json
{
  "statusCode": 400,
  "error": "Bad Request",
  "message": "Invalid request body: openings[2].width: Opening ... (and 1 more)",
  "issues": [{ "path": "openings[2].width", "message": "Opening ..." }]
}
```

The viewer shows the first home the api lists; pick another with the home selector or `?home=<id>`.

## Changing the schema

1. Edit `packages/shared/src/home-model.ts` (keep every length a `Dimension`).
2. `pnpm schema:generate` and commit the JSON Schema.
3. Update `data/homes/*.json`. A breaking change bumps `HOME_SCHEMA_VERSION`; stored documents are
   re-validated on read, so old rows need a migration or a re-import.
