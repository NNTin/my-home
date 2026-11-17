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

| Topic       | Convention                                                                             |
| ----------- | -------------------------------------------------------------------------------------- |
| Units       | metres                                                                                 |
| Axes        | Y-up, right-handed: `x` plan east, `y` up, `z` plan south (towards the street)         |
| North       | `building.northBearing`: true north, degrees clockwise from `-z` (default 0)           |
| Declination | `building.magneticDeclination`: magnetic north, degrees east of true north (default 0) |
| Plan points | `{ x, z }`; polygons are lists of at least 3 points, either winding                    |
| Ground      | `terrain.groundElevation`, normally `y = 0`                                            |
| Elevation   | a level's `elevation` is the top of its floor slab; below-ground levels are negative   |
| Wall height | measured from the level's floor; exterior walls usually include the slab above         |
| Ids         | letters, digits, `-` and `_`; unique across the whole document                         |

Ids are unique across all collections so other documents ([furniture layouts](layouts.md)) can
reference any home, level or room by id alone. Layouts are stored separately, so changing or
re-seeding a home never deletes them; items whose level or room disappears are kept and flagged.

### Naming: ids are permanent keys

Ids are what automations (smart-home rules, LLM tools) and layouts store, so treat them as a public
API:

- **An id never changes and is never reused**, even when the thing is renamed, moved or removed.
  `name` is only a display label and may be reworded or localised at any time.
- Ids are lower-case kebab-case and say what the thing is and where, without a lookup:

| Entity              | Id pattern                                       | Id example                                 | Name pattern                                                          | Name example                |
| ------------------- | ------------------------------------------------ | ------------------------------------------ | --------------------------------------------------------------------- | --------------------------- |
| Apartment           | `apt-<apartment>`                                | `apt-souterrain`                           | free                                                                  |                             |
| Room                | `<apartment>-<room>`                             | `souterrain-bed-room`                      | fixed two-word label (below)                                          | `Bed room`                  |
| Door                | `door-<apartment>-<room>-<room or outdoor area>` | `door-souterrain-corridor-patio`           | interior: `<room> door`; exterior: `<Room> · <what it leads to> door` | `Corridor · patio door`     |
| Window              | `window-<apartment>-<room>-<facade>`             | `window-souterrain-kitchen-north`          | `<Room> · <facade> window[ <n>]`                                      | `Kitchen · north window`    |
| Roof window         | `roof-window-<facade>`                           | `roof-window-south`                        | `<Level short name> · <facade> roof window`                           | `Attic · south roof window` |
| Outbuilding opening | `<outbuilding id>-door`                          | `shed-ground-floor-garden-door`            | `<Outbuilding name> · <what>`                                         | `Garden shed · door`        |
| Interior wall       | `<apartment>-wall-<room>-<room>`                 | `souterrain-wall-corridor-bed-room`        | (no name)                                                             |                             |
| Stair               | `stair-<apartment>-<room>-<level it leads to>`   | `stair-souterrain-stair-hall-ground-floor` | free                                                                  |                             |
| Entrance            | `entrance-<apartment>-<how>`                     | `entrance-souterrain-patio`                | free                                                                  |                             |
| Fence, gate         | `fence-<side>-<what it borders>`, `gate-<a>-<b>` | `gate-souterrain-patio-lane`               | free sentence                                                         |                             |
| Outdoor area        | `<kind or role>-<apartment or side>`             | `patio-souterrain`, `garden-divider`       | free                                                                  |                             |

Older ids that predate a pattern stay as they are (ids never change), for example the windows
`ground-floor-window-north-1` and the outbuilding openings `garage-door` and `passage-arch`.

- Room names are fixed two-word labels (`Stair hall`, `Work room`, `Bath room`, `Kitchen`,
  `Corridor`, `Living room`, `Boiler room`, `Bed room`); the id is the name in kebab-case behind the
  apartment.
- A door or gate id names the two things it connects, so the id alone tells which rooms it joins.
  Two rooms that are open to each other have **no wall and no opening** between them (the
  souterrain kitchen and corridor): their outlines simply share an edge.
- Levels that are not laid out yet keep one placeholder room (`ground-floor-interior`); it is
  replaced, not renamed, when the real rooms are added.

**Names of uses.** Every opening, outbuilding opening, roof window and gate has a human `name`,
unique in the home (ignoring case), so a name alone says which piece is meant (in the catalogue,
in photo requests, when talking to an agent):

- windows: `<Room> · <facade> window[ <n>]`; on levels without rooms yet, `<Level short name> · …`
  (`Ground floor`, `Attic`);
- interior doors: `<the room that is not the corridor or hall> door`, otherwise
  `<Room A> / <Room B> door`;
- exterior doors: `<Room> · <what it leads to> door`;
- outbuilding openings: `<Outbuilding name> · <what>`;
- names may be reworded at any time; ids never change.

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

| Field          | Content                                                                                                                     |
| -------------- | --------------------------------------------------------------------------------------------------------------------------- |
| `building`     | `footprint` (exterior wall centre lines, used for slabs), `roofThickness`, `roof?`, `northBearing?`, `magneticDeclination?` |
| `terrain`      | `groundElevation`, `bottomElevation` and `patches`: plan polygons (with optional `holes`) at an elevation                   |
| `levels`       | `elevation`, clear `height` and floor `slabThickness`                                                                       |
| `apartments`   | `levelIds` they occupy and, optionally, their `entrances`                                                                   |
| `rooms`        | floor `outline` on a `levelId`, optionally in an `apartmentId`                                                              |
| `walls`        | centre line `start`/`end`, `thickness`, `height`, `kind` (`exterior`/`interior`), `levelId`, `apartmentId?`                 |
| `openings`     | `door`/`window` on a `wallId`: `name`, `typeId`, `offset` from the wall start, `width`, `height`, `sill`                    |
| `outdoorAreas` | `garden`/`driveway`/`patio`/`path`/`road`/`gravel`/`embankment` polygons at an `elevation` (or `slope`)                     |
| `outbuildings` | optional garages, carports, sheds, porches and compost bins: a `footprint`, flat roof and edge openings                     |
| `stairs`       | optional: a walking line from one level up to another                                                                       |
| `fences`       | optional: fence lines and gates on the ground                                                                               |

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

A sloped outdoor area is drawn with contour lines, one for every 0.2 m of fall and clipped to its
outline, so slopes stand out
from levelled areas and a steep bank shows as tightly packed lines. Outdoor area kind `embankment`
is a steep bank or retaining slope that divides two levels and is not walked on; `gravel` is a
gravel or drainage strip such as the one along a facade.

### Entrances

`apartments[].entrances` (optional) lists every way into an apartment, so "how do I get in" does
not have to be worked out from the geometry:

```json
{
  "id": "entrance-souterrain-patio",
  "name": "Patio entrance",
  "roomId": "souterrain-corridor",
  "viaId": "door-souterrain-corridor-patio",
  "description": "From the lane through the gate onto the souterrain patio, ..."
}
```

`roomId` is the room of the apartment the entrance leads into and `viaId` the door (an opening) or
stair that is passed to get in.

### Stairs

```json
{
  "id": "stair-souterrain-stair-hall-ground-floor",
  "name": "Stair from the stair hall up to the ground floor",
  "levelId": "souterrain",
  "toLevelId": "ground-floor",
  "apartmentId": "apt-souterrain",
  "path": [{ "x": ..., "z": ... }, ...],
  "width": { "value": 1, "source": "mock" }
}
```

`path` is the walking line **going up**: straight flights between consecutive points, with a square
landing (`width` on each side) at every turning point, so turns are right angles. The order of the
points therefore gives the direction of travel: seen from above with north (`-z`) up, a path that
keeps turning left climbs counter-clockwise. The builder spreads steps of at most 0.19 m over the
rise between the two levels, shows the stair with `levelId` (and `apartmentId`), and cuts a
stairwell opening over it in the floor of `toLevelId`.

### Fences

```json
{
  "id": "fence-north", "name": "North fence of the souterrain garden", "kind": "chain-link",
  "path": [{ "x": ..., "z": ... }, ...],
  "elevation": { "value": -1.65, "source": "estimated-from-photo" },
  "height": { "value": 1, "source": "estimated-from-photo" }
}
```

`kind` is `chain-link`, `privacy` (mesh with a privacy screen), `trellis` (wood between brick
pillars) or `gate`. `elevation` is the ground height at the start of `path`; with `endElevation`
the ground runs linearly to that height at the end, and the fence steps down bay by bay (posts at
most 2.5 m apart). A gate is its own short fence of kind `gate` in the fence line, with an id that
names what it connects, and the catalogue type `"typeId": "gate.swing"` (other fence kinds have no
`typeId`). Fences are always shown.

### Openings

```json
{
  "id": "window-souterrain-kitchen-north", "name": "Kitchen · north window", "typeId": "window.casement",
  "wallId": "souterrain-wall-north", "type": "window",
  "offset": ..., "width": ..., "height": ..., "sill": ...
}
```

`type` is `window`, `door` (drawn open), `french-door` (glazed down to the floor) or `garage-door`
(a closed panel); the builder draws by it. `typeId` is the [piece type](#piece-types) and must
carry that `type` (a `door.interior` is a `door`, a `window.casement` a `window`). `name` follows
§ Naming. Roof windows and outbuilding openings have a `name` and a `typeId` too.

### Piece types

Every opening, outbuilding opening, roof window and gate refers to a **catalogue type** by
`typeId`: what kind of piece it is, which parameters it has and their defaults. The types live in
[`packages/shared/src/catalog/`](../packages/shared/src/catalog/) (`definitions/`, one file per
family). A parameter is **basic** (a use may change it within limits, for example a frame colour
or a bed's width) or **design** (fixed by the type). Nothing reads the types yet when drawing
(#38); their defaults equal what the viewer draws today.

| Family    | Type ids                                                                                                        | Sits in               |
| --------- | --------------------------------------------------------------------------------------------------------------- | --------------------- |
| window    | `window.casement`, `window.tilt-turn` (both `type: window`), `window.roof`                                      | a wall; a roof plane  |
| door      | `door.interior`, `door.exterior` (`door`), `door.french` (`french-door`), `door.garage` (`garage-door`)         | a wall or outbuilding |
| gate      | `gate.swing`                                                                                                    | a fence line          |
| furniture | `furniture.bed`, `furniture.sofa`, `furniture.table`, `furniture.chair`, `furniture.wardrobe`, `furniture.desk` | a floor               |

Interior or exterior follows the wall's `kind`. **The wall windows of the real home are all
`window.casement` placeholders** until photos show which are casement and which tilt-and-turn (both
are drawn the same). `modelUses(model)` lists every use with its type, name, level and the rooms it
touches.

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
for example a carport's sides or a porch against the house. Openings are placed like wall openings (never on an open edge),
measured from the edge's start point. Outbuildings have no levels or rooms and are always shown.
`kind` is `garage`, `carport`, `shed`, `porch` or `compost` (a closed compost bin: a low box with a lid).

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

`building.magneticDeclination` (optional, default 0) is how far **magnetic** north lies east (+) or west (−)
of true north at the home, in degrees. A phone compass reports magnetic north, so the walking view needs it
to turn a compass reading into a direction on the plan
([walking.md](walking.md#from-the-sensors-to-the-plan)):

```
true bearing = magnetic bearing + magneticDeclination (+ the device's calibration offset)
plan heading = true bearing + northBearing        (degrees clockwise from the plan's -z)
yaw          = -plan heading                      (radians, counter-clockwise, as in poses)
```

Example: `northBearing` 20 and a declination of 3. A compass reading of 67° is 70° true, which is 90°
clockwise from `-z`: the figure looks along `+x`. The owner enters the declination (from a declination chart)
in the walking view's **Calibrate** sheet or in the home file, with the usual provenance. It is never derived
from the home's location, which the model does not contain.

### Validation beyond the shape

The zod schema also checks what JSON Schema cannot, so these only show up in `pnpm test`, the api
and the seed script, not in the editor:

- no duplicate ids
- references resolve: room/wall → level and apartment, apartment → levels, opening → wall, outdoor
  area → owner apartment; a room's level must belong to its apartment
- openings fit inside their wall (`offset + width <= length`, `sill + height <= wall height`) and do
  not overlap each other
- walls have a non-zero length; terrain patches are above `bottomElevation`
- an entrance's room belongs to its apartment, and its `viaId` is a door on a wall of that room
  (not a window) or a stair that starts or ends in it
- a stair leads up to a higher level, turns at right angles and its flights leave room for the
  landings; fence points are distinct
- every `typeId` is a known piece type that sits where the use is (`wall`, `roof`, `fence`), and a
  wall opening's `type` is one its type carries; a gate has a `typeId`, other fences none
- names are unique across all uses, ignoring case

Errors carry a path into the document, for example
`openings[2].width: Opening "x" spans 7.65 m to 9.15 m but wall "y" is only 8 m long`.

## The real home

`data/homes/home.json` (id `home`) is the house the project is about. Values come from:

- **geodata**: the building footprint, eave and ridge heights (roof pitch 29°, ridge east-west), the
  garage, the terrain levels and `northBearing` (2.5°, including the map grid's convergence) were
  derived from official geodata of the Bavarian surveying administration (LoD2 building model, DGM1
  terrain model, orthophoto). Datenquelle: Bayerische Vermessungsverwaltung, CC BY 4.0.
- **estimated-from-photo**: windows and doors (position, size, sill), floor levels, the light well,
  the fences, the drainage strips, the garden shed and the compost, from street-level and aerial
  photos. The north facade was only seen at
  a grazing angle. The souterrain room layout is from the owner's annotated plan sketch (about
  ±0.3 m).
- **mock**: assumed wall, slab and roof thicknesses, the position of the interior doors along their
  walls and the stair's position in the stair hall.

The plan origin is the house's south-west outside corner, `x` runs along the south wall and `z`
towards the street. Heights are relative to the ground-floor finished floor (`y = 0`), not to sea
level. Everything is axis-aligned and the terrain is simplified to levelled areas and slopes:

- **South level** (about 0): the street, the driveway in front of the garage and the ground-floor
  garden and covered terrace. The garden ends at the street on the same line as the driveway; the
  road junction cuts off its south-east corner. A **garden shed** (`shed-ground-floor-garden`) and a
  **compost** (`compost-ground-floor-garden`) stand on its lawn.
- **Lower level** (-1.65): the souterrain apartment's garden on the north side and its patio on the
  east side.
- The **garden divider wall** (`garden-divider`, kind `embankment`): a short, steep bank at the
  south-east corner that separates the ground-floor garden (south level) from the souterrain patio
  and garden (lower level). It is a dividing element, not a way in.
- **Souterrain** (floor -2.6): its north windows sit just above the lawn, the south window is below
  ground in a **light well**.
- The **garage** (flat roof) and the arched **entrance passage** stand west of the house; the lane on
  the east falls towards the north.
- **Fences**: along the lane on the east, along the north boundary of the souterrain garden, and a
  trellis fence along the driveway. The lane fence has one gate, `gate-souterrain-patio-lane`, at the
  north end of the souterrain patio where the lawn begins; the ground-floor garden has no gate, and
  its fence ends where the road junction cuts the corner. The patio fence follows the lane, which
  is higher than the patio there.
- **Drainage**: gravel strips (`drainage-*`, kind `gravel`) along the north facade and the north
  part of the east facade, around the south-west corner and in front of the south wall.

### The souterrain apartment

```text
            north
 +-----------+-----------+-----------+-----------+
 | Stair     | Work room | Bath room | Kitchen   |
 | hall      |           |           |           |
 | (stair    +---door----+---door----+  (open)   |
 |  up)    door          Corridor              door --> Souterrain patio
 +-----------+---door----+--door--+----door------+
 | Living room           | Boiler | Bed room     |
 |                       | room   |              |
 |                       +--------+--------------+
 +-----------------------+
            south
```

| Room id                  | Name        | Connected to                                      |
| ------------------------ | ----------- | ------------------------------------------------- |
| `souterrain-stair-hall`  | Stair hall  | corridor (door), ground floor (stair)             |
| `souterrain-work-room`   | Work room   | corridor (door)                                   |
| `souterrain-bath-room`   | Bath room   | corridor (door)                                   |
| `souterrain-kitchen`     | Kitchen     | corridor (open, no wall)                          |
| `souterrain-corridor`    | Corridor    | every other room, and the souterrain patio (door) |
| `souterrain-living-room` | Living room | corridor (door)                                   |
| `souterrain-boiler-room` | Boiler room | corridor (door)                                   |
| `souterrain-bed-room`    | Bed room    | corridor (door)                                   |

There are exactly **two ways into the apartment** (`apartments[].entrances`):

| Entrance id                      | Name                | Route                                                                                                                                                                                       |
| -------------------------------- | ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `entrance-souterrain-stair-hall` | Stair hall entrance | the house's entrance on the ground floor, then down `stair-souterrain-stair-hall-ground-floor` into the stair hall, then `door-souterrain-corridor-stair-hall`                              |
| `entrance-souterrain-patio`      | Patio entrance      | from the lane through `gate-souterrain-patio-lane` (north end of the patio) onto the souterrain patio, down the sunken entry steps, then `door-souterrain-corridor-patio` into the corridor |

The stair in the stair hall climbs counter-clockwise (north along the east side, west across the
north end, south along the west side). The ground floor and the attic are not laid out yet: each has
one placeholder room covering its floor. Never add the house's address or location (coordinates, map
links, tile IDs, place names) to the repo.

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
slabs, room floors, terrain blocks, outdoor surfaces, roof planes, stair steps, fence posts and
panels) without three.js, and
`visibility.ts` filters them for the cutaway and the visibility toggles. The cutaway's top entry,
**Roof**, shows the whole building; choosing the highest level hides the roof to look into it, and
**Room names** labels the rooms of the level being looked into. Walls are split around openings (no CSG). The R3F
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
