# Home model

The building is described by one JSON document, the **home model**. Its single source of truth is
the zod schema `HomeModel` in [`packages/shared/src/home-model.ts`](../packages/shared/src/home-model.ts).
The api validates every write with it and the web app validates every response with it.

- JSON Schema: [`packages/shared/schema/home-model.schema.json`](../packages/shared/schema/home-model.schema.json),
  generated with `pnpm schema:generate` and committed (a test fails when it is out of date).
- Real home: [`data/homes/home.json`](../data/homes/home.json), see [The real home](#the-real-home).
- Mock home: [`data/homes/mock-home.json`](../data/homes/mock-home.json), the test fixture. Both
  files' `$schema` points at the JSON Schema, so editors such as VS Code validate and autocomplete
  them.

## Conventions

| Topic       | Convention                                                                           |
| ----------- | ------------------------------------------------------------------------------------ |
| Units       | metres                                                                               |
| Axes        | Y-up, right-handed: `x` plan east, `y` up, `z` plan south (towards the street)       |
| North       | `building.northBearing`: true north, degrees clockwise from `-z` (default 0)         |
| Plan points | `{ x, z }`; polygons are lists of at least 3 points, either winding                  |
| Ground      | `terrain.groundElevation`, normally `y = 0`                                          |
| Elevation   | a level's `elevation` is the top of its floor slab; below-ground levels are negative |
| Wall height | measured from the level's floor; exterior walls usually include the slab above       |
| Ids         | letters, digits, `-` and `_`; unique across the whole document                       |

Ids are unique across all collections so other documents ([furniture layouts](layouts.md)) can
reference any home, level or room by id alone. Layouts are stored separately, so changing or
re-seeding a home never deletes them; items whose level or room disappears are kept and flagged.

## Dimensions and provenance

Every length, coordinate and elevation is a `Dimension` (angles, such as the roof pitch and the
north bearing, use the same shape in degrees):

```json
{ "value": 2.5, "source": "mock", "note": "optional free text" }
```

| `source`               | Meaning                                       |
| ---------------------- | --------------------------------------------- |
| `mock`                 | placeholder value, not based on the real home |
| `estimated-from-photo` | estimated from photos or video                |
| `measured`             | measured on site                              |
| `geodata`              | derived from official geodata (see below)     |

Refining a value means changing `value` and `source` (and adding a `note`, for example which photo
it came from). Nothing else in the model or renderer changes. The only bare number is
`schemaVersion` (and the edge indexes of outbuildings, which are references, not lengths).

## Structure

| Field          | Content                                                                                                        |
| -------------- | -------------------------------------------------------------------------------------------------------------- |
| `building`     | `footprint` (exterior wall centre lines, used for slabs), `roofThickness`, `roof?`, `northBearing?`            |
| `terrain`      | `groundElevation`, `bottomElevation` and `patches`: plan polygons (with optional `holes`) at an elevation      |
| `levels`       | `elevation`, clear `height` and floor `slabThickness`                                                          |
| `apartments`   | `levelIds` they occupy                                                                                         |
| `rooms`        | floor `outline` on a `levelId`, optionally in an `apartmentId`                                                 |
| `walls`        | centre line `start`/`end`, `thickness`, `height`, `kind` (`exterior`/`interior`), `levelId`, `apartmentId?`    |
| `openings`     | `door`/`window` on a `wallId`: `offset` from the wall start, `width`, `height`, `sill`                         |
| `outdoorAreas` | `garden`/`driveway`/`patio`/`path`/`road` polygons at an `elevation` (or `slope`), optional `ownerApartmentId` |
| `outbuildings` | optional garages, carports, sheds and porches: a `footprint`, flat roof and openings on its edges              |

Terrain patches are drawn as solid blocks from `bottomElevation` up to their elevation (or their
slope, below). Leaving the
building footprint out of every patch (a hole, or no patch there) keeps the ground out of
below-ground rooms; a lower patch next to a higher one forms a retaining wall, which is how the mock
home's sunken souterrain garden works.

### Slopes

A terrain patch or an outdoor area can fall linearly across its bounding box instead of being flat:
`elevation` is then its high edge and `slope.lowElevation` the edge it falls `towards`
(`+x`, `-x`, `+z` or `-z`):

```json
"elevation": { "value": -0.05, "source": "estimated-from-photo" },
"slope": { "towards": "-z", "lowElevation": { "value": -1.65, "source": "estimated-from-photo" } }
```

Model levelled areas as flat patches and join them with sloped patches (ramps, embankments) or let
a lower patch next to a higher one form a retaining wall. Light wells and sunken entries are small
low patches in a notch of the surrounding one.

### Openings

`type` is `window`, `door` (drawn open), `french-door` (glazed down to the floor) or `garage-door`
(a closed panel).

### Outbuildings

```json
{
  "id": "garage", "name": "Garage", "kind": "garage",
  "footprint": [ ... wall centre lines ... ],
  "floorElevation": { "value": -0.2, "source": "estimated-from-photo" },
  "height": { "value": 2.47, "source": "geodata", "note": "Floor to the top of the flat roof" },
  "wallThickness": { "value": 0.24, "source": "mock" },
  "roofThickness": { "value": 0.2, "source": "mock" },
  "openEdges": [],
  "openings": [{ "id": "garage-door", "type": "garage-door", "edge": 0, "offset": ..., "width": ..., "height": ..., "sill": ... }]
}
```

A wall stands on every footprint edge (from point `edge` to the next) except those in `openEdges`,
for example a carport's sides or a porch against the house. Openings are placed like wall openings,
measured from the edge's start point. Outbuildings have no levels or rooms and are always shown.

### Roof and attic

`building.roof` covers the highest level. Omitted (as in documents stored before it existed) or
`{ "type": "flat" }` is a flat slab of `roofThickness` on top of the highest level's walls. A
gable roof turns the highest level into an attic:

```json
"roof": {
  "type": "gable",
  "ridgeAxis": "x",
  "pitch": { "value": 40, "source": "mock", "note": "Degrees" },
  "kneeWallHeight": { "value": 1, "source": "mock" },
  "overhang": { "value": 0.4, "source": "mock" }
}
```

| Field            | Meaning                                                                               |
| ---------------- | ------------------------------------------------------------------------------------- |
| `ridgeAxis`      | ridge direction on the plan: `x` (along x, east-west) or `z` (along z, north-south)   |
| `pitch`          | slope of both roof planes in degrees (0 to 80, exclusive)                             |
| `kneeWallHeight` | height of the roof underside above the attic floor at the footprint edge (eaves side) |
| `overhang`       | how far the roof reaches past the footprint on all four sides                         |

`windows` (optional) are roof windows lying in a roof plane: `side` `min` or `max` (the plane falling
towards the lower or higher across-ridge coordinate), `offset` along the ridge from the footprint's
lower end, `fromEave` up the slope from the footprint edge, `width` along the ridge and `length`
along the slope. They are hidden with the roof.

The roof spans the bounding rectangle of the footprint, with the ridge over its centre line;
`roofThickness` is the thickness of the roof planes at right angles to the slope. The builder
trims every wall of the attic level to the roof underside, so model the attic walls **at least as
high as the roof**: a gable-end wall (across the ridge) as tall as the ridge becomes the gable, and
an eave wall a little higher than the knee wall closes flush against the roof. Openings must still
fit under the roof slope (this is not validated). The attic floor is an ordinary level, so rooms,
the cutaway and furniture placement work unchanged.

### Orientation

`building.northBearing` says where true north is: degrees clockwise, seen from above, from the
plan's `-z` axis. 0 (the default) means `-z` is north and `+x` east; 90 means true north is `+x`.
The viewer's compass and the N/E/S/W ground markers follow it; geometry does not change.

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

## The real home

`data/homes/home.json` (id `home`) is the house the project is about. Values come from:

- **geodata**: the building footprint, eave and ridge heights (roof pitch 29°, ridge east-west), the
  garage, the terrain levels and `northBearing` (2.5°, including the map grid's convergence) were
  derived from official geodata of the Bavarian surveying administration (LoD2 building model, DGM1
  terrain model, orthophoto). Datenquelle: Bayerische Vermessungsverwaltung, CC BY 4.0.
- **estimated-from-photo**: windows and doors (position, size, sill), floor levels, the light well
  and the entrance, from street-level photos. The north facade was only seen at a grazing angle.
- **mock**: assumed wall, slab and roof thicknesses.

The plan origin is the house's south-west outside corner, `x` runs along the south wall and `z`
towards the street. Heights are relative to the ground-floor finished floor (`y = 0`), not to sea
level. Everything is axis-aligned and the terrain is simplified to levelled areas and slopes:

- **South level** (about 0): the street, the driveway in front of the garage and the ground-floor
  garden and covered terrace.
- **Lower level** (-1.65): the souterrain garden on the north side and the patio on the east side,
  reached from the south garden by the **entrance slope**; steps lead down to the souterrain door.
- **Souterrain** (floor -2.6): its north windows sit just above the lawn, the south window is below
  ground in a **light well**.
- The **garage** (flat roof) and the arched **entrance passage** stand west of the house; the lane on
  the east falls towards the north.

The interior layout is not modelled yet: each level has one room covering its floor. Never add the
house's address or location (coordinates, map links, tile IDs, place names) to the repo.

## The mock home

`data/homes/mock-home.json` (all values `source: "mock"`):

- **Souterrain** (floor at -1.2 m, 2.5 m clear): the user's apartment with hallway, living room,
  kitchen, bedroom and bathroom, interior walls with doors, an entrance door and a patio door to its
  sunken garden (-1.1 m), and high windows on the street side above ground level
- **Ground floor**: an empty apartment (exterior walls, slab, windows and the front door)
- **First floor (attic)**: an empty attic apartment under a 40° gable roof with an east-west ridge,
  1 m knee walls on the street and garden sides and two windows in each gable end. There is no
  second floor.
- `northBearing` is 0 for now; the real value will be set once known
- **Gardens**: the souterrain garden behind the building and the ground-floor garden wrapping the
  west and back of the plot; a shared **driveway** on the east side

## Rendering

`apps/web/src/builder/buildHome.ts` turns a model into render descriptors (wall segments, openings,
slabs, room floors, terrain blocks, outdoor surfaces, roof planes) without three.js, and
`visibility.ts` filters them for the cutaway and the visibility toggles. The cutaway's top entry,
**Roof**, shows the whole building; choosing the highest level hides the roof to look into it. Walls are split around openings (no CSG). The R3F
components in `apps/web/src/scene/` only draw descriptors, so any file that follows the schema
renders without renderer changes.

## Seeding, swapping and importing homes

The api seeds `data/homes/home.json` and then `data/homes/mock-home.json` on start in development
(`SEED_ON_START`), and staging resets to both; the viewer opens the oldest home, the real one.
`SEED_FILE` seeds a single file instead. Seeding is idempotent: a home whose id already exists is
left alone. Production is not seeded.

```sh
pnpm db:seed                                   # the real and the mock home (or SEED_FILE)
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
   re-validated on read, so old rows need a migration or a re-import. Prefer optional fields with
   defaults (like `roof` and `northBearing`), which keep stored documents valid at version 1.
