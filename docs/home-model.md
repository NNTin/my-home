# Home model

The building is described by one JSON document, the **home model**. Its single source of truth is
the zod schema `HomeModel` in [`packages/shared/src/home-model.ts`](../packages/shared/src/home-model.ts).
The api validates every write with it and the web app validates every response with it.

- JSON Schema: [`packages/shared/schema/home-model.schema.json`](../packages/shared/schema/home-model.schema.json),
  generated with `pnpm schema:generate` and committed (a test fails when it is out of date).
- Real home: [`data/homes/home.json`](../data/homes/home.json), see [The real home](#the-real-home).
- Test fixture: [`packages/shared/test-fixtures/mock-home.json`](../packages/shared/test-fixtures/mock-home.json),
  a small made-up home (id `mock-home`, no location) that unit and integration tests load into a throwaway
  database. It is **not** under `data/homes`, so no environment ever syncs it. Both files' `$schema` points at
  the JSON Schema, so editors such as VS Code validate and autocomplete them.

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

Ids are unique across all collections (and differ from the home's own id) so other documents
([furniture placements](furniture.md)) can reference any home, level or room by id alone. Placements are
stored separately, so changing or re-seeding a home never deletes them; items whose level or room
disappears are kept and flagged.

### Naming: ids are permanent keys

Ids are what automations (smart-home rules, LLM tools) and placements store, so treat them as a public
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
| `ceilings`     | optional: lowered ceilings, an `outline` on a `levelId` with the underside `height` above its floor                         |

Terrain patches are drawn as solid blocks from `bottomElevation` up to their elevation (or their
slope, below). Leaving the
building footprint out of every patch (a hole, or no patch there) keeps the ground out of
below-ground rooms; a lower patch next to a higher one forms a retaining wall, which is how a
sunken souterrain garden works.

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

A sloped outdoor area is drawn as one smooth surface in its finish, from its high edge to its low
one. Outdoor area kind `embankment`
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
keeps turning right climbs clockwise. The builder spreads steps of at most 0.19 m over the
rise between the two levels, shows the stair with `levelId` (and `apartmentId`), and cuts a
stairwell opening in the floor of `toLevelId` over every step that is less than 2.2 m below it.

- **A half landing.** Two turning points with no room for a tread between their landings (less than 0.15 m)
  share one level landing: the stair turns back beside itself. The distance between the two flights' lines
  is then their width plus the gap the railing stands in.
- **What the builder makes of it** (`apps/web/src/builder/stair.ts`, sizes in `STAIR_DETAIL`): treads 3 cm
  thick that stand out 2 cm over the riser below; the first flight as a solid standing on the floor, every
  later flight and every landing as a slab 0.2 m thick, open below; and on the inside of the turn a railing:
  a post beside the second riser, one at each turn and one at the top, a handrail 0.9 m above the nosings, a
  board under it along each flight, and round bars at most 12.5 cm apart. A straight stair has no railing.
- **Finishes:** `finish` (treads and landings), `risers` (risers, sides and underside) and `railing`
  (posts, handrail and board); the bars are `metal.brushed`. See § Finishes.

### Ceilings

```json
{
  "id": "souterrain-ceiling-corridor-box",
  "name": "Corridor · lowered box",
  "levelId": "souterrain",
  "apartmentId": "apt-souterrain",
  "outline": [{ "x": ..., "z": ... }, ...],
  "height": { "value": 2.0, "source": "estimated-from-photo" }
}
```

A level's `height` is its structural clear height, floor to slab. A suspended ceiling, or a box
(bulkhead) under it, is a `ceilings` entry: the area it covers and the height of its underside
above the level's floor, below the level's `height`. Where entries overlap the lowest counts:
`ceilingHeightAt(model, levelId, x, z)` (`packages/shared`) gives the ceiling at a plan point, the
level's `height` where there is none: where a ceiling-mounted fixture hangs
([furniture.md](furniture.md#mounting-walls-and-ceilings)). The builder draws each as a
solid from its underside up to the slab and shows it with the level above, so the cutaway still
looks into the rooms from above while walk mode and "view from here" see it. Walls, openings and
the walk world ignore ceilings: a door must simply fit under the ceiling it stands below.

### Fences

```json
{
  "id": "fence-north", "name": "North fence of the souterrain garden", "kind": "chain-link",
  "path": [{ "x": ..., "z": ... }, ...],
  "elevation": { "value": -1.65, "source": "estimated-from-photo" },
  "height": { "value": 1, "source": "estimated-from-photo" }
}
```

`kind` is `chain-link` (a wire mesh between two rails), `privacy` (upright boards), `trellis` (a
diagonal lattice of laths between brick pillars) or `gate`. `elevation` is the ground height at the start of `path`; with `endElevation`
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
or a bed's width) or **design** (fixed by the type). The viewer draws every use with the piece
module of its type (`apps/web/src/catalog/`, see [adding-piece-type.md](adding-piece-type.md)).

| Family    | Type ids                                                                                                        | Sits in               |
| --------- | --------------------------------------------------------------------------------------------------------------- | --------------------- |
| window    | `window.casement`, `window.tilt-turn` (both `type: window`), `window.roof`                                      | a wall; a roof plane  |
| door      | `door.interior`, `door.exterior` (`door`), `door.french` (`french-door`), `door.garage` (`garage-door`)         | a wall or outbuilding |
| gate      | `gate.swing`                                                                                                    | a fence line          |
| furniture | `furniture.bed`, `furniture.sofa`, `furniture.table`, `furniture.chair`, `furniture.wardrobe`, `furniture.desk` | a floor               |

Interior or exterior follows the wall's `kind`. **The wall windows of the real home are all
`window.casement` placeholders** until photos show which are casement and which tilt-and-turn (both
are drawn the same). `modelUses(model)` lists every use with its type, name, level and the rooms it
touches: those along whose outline at least a quarter of its width runs, so a door where two rooms
meet without a wall (the patio door at the corridor's open east end) touches both.

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
in the walking view's **Calibrate** sheet (stored as a home setting on top of the file, which wins over the
file's value) or in the home file, with the usual provenance. It is never derived
from the home's location, which the model does not contain.

### Finishes

A **finish** is a named surface material: oak laminate, plain paint, clay roof tiles. Finishes are a library in
git, like the piece types: [`packages/shared/src/finishes/`](../packages/shared/src/finishes/) (definitions in
`definitions/`, validated at import: what a finish is drawn with in `<group>.ts`, its description and the source of
its texture in `<group>.about.ts`, which only the catalogue page, the asset manifest and the fetch tool read). A home refers to a finish by id. A home may leave out every finish: a surface without
one draws the **default for its kind**, so a home that names no finish is valid and complete.

A **finish use** is:

```json
{
  "finish": "wood.oak-laminate",
  "tint": "#d9c2a0",
  "rotation": 90,
  "source": "estimated-from-photo",
  "photos": ["<photo id>"],
  "note": "Planks run along the long side of the room"
}
```

| Field      | Meaning                                                                                                  |
| ---------- | -------------------------------------------------------------------------------------------------------- |
| `finish`   | The finish's id, `<material>.<name>`                                                                     |
| `tint`     | `#rrggbb`, lower case; replaces the finish's own colour. Only where the finish is tintable               |
| `rotation` | `0` or `90`: a quarter turn, for the direction planks run. Only on a room's floor                        |
| `source`   | Required. `mock` for a placeholder, `estimated-from-photo`, or `measured` when the owner named a product |
| `photos`   | Ids of photos in the photo store the choice was made from. Never a file name, never an upload            |
| `note`     | Free text                                                                                                |

| Where           | Field                                                  | Kind of surface            | Default when missing                                                                                                                                    |
| --------------- | ------------------------------------------------------ | -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A room          | `finishes.floor`, `finishes.walls`, `finishes.ceiling` | `floor`, `wall`, `ceiling` | `floor.neutral`, `paint.plain`, `paint.plain`                                                                                                           |
| The building    | `building.finishes.facade`, `.roof`                    | `facade`, `roof`           | `render.facade`, `roof.clay-tile`                                                                                                                       |
| An outdoor area | `finish`                                               | `ground`                   | By kind: garden `grass.lawn`; patio, path and driveway `paving.concrete-slab`; road `asphalt.plain`; gravel `gravel.fine`; embankment `concrete.screed` |
| An outbuilding  | `finish` (its walls)                                   | `facade`                   | By kind, with the colours they have always had: garage, carport and porch `render.facade`; shed and compost `paint.plain`                               |
| A stair         | `finish` (treads and landings), `risers`, `railing`    | `floor`, `wall`, `part`    | `wood.oak-laminate`, `paint.plain`, `wood.veneer`                                                                                                       |

- **Finishes are appearance.** They may be refined from photos like windows and furniture. They never move,
  resize or re-angle anything: the geometry rules are unchanged.
- **`walls` is per room, not per wall.** Every wall face takes the `walls` finish of the room it borders; a face
  that borders no room is an outer face and takes the facade finish.
- **Only rooms of the lowest level take finishes.** That is the level modelled inside (the souterrain of
  "Our home"). The rooms of every level above are neutral shells (`shell.neutral`), and `finishes` on one of
  them is an error.
- **Defaults are plain indoors on purpose:** a room nobody has refined looks neutral, not falsely specific.
- **The ground itself** (terrain where no area covers it) is `soil.plain`, and cut faces are `cut.dark`. Neither
  is in the model; `cut.dark` cannot be named by a home.
- **Editing:** by a pull request to `data/homes/home.json`. The app has no editor for finishes.
- **Choosing them from photos** (material, tint from two photos, provenance, when to ask for a photo): the
  `my-home-photo-modelling` skill, § Finishes from photos. A surface no photo shows keeps its default, either by
  leaving the field out or as the default finish with `source: "mock"` and a note that names the photo request.

Which finishes exist, with their surfaces, tints and sources, is listed on the catalogue page (`/catalog`,
section "Finishes") and in the definitions. A textured finish has files under
[`apps/web/src/finishes/textures/`](../apps/web/src/finishes/textures/), all from CC0 libraries, each listed with
its source, licence and SHA-256 in [`apps/web/src/finishes/ASSETS.md`](../apps/web/src/finishes/ASSETS.md).

**Adding a finish** is its own pull request: the definition and its entry in the group's `.about.ts`, then `pnpm finishes:fetch <finish id>` (downloads
from the CC0 library, checks the provider's checksum, writes the WebP files and the manifest; needs ImageMagick
with WebP and `unzip`), and a note of which photo ids called for it. `pnpm test` checks the files against the
manifest and the texture budgets. **No texture is ever made from a photo:** a texture cut from one of the
owner's photos would put the photo into git.

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
- a ceiling is on a known level (and apartment) and below that level's clear height
- every `typeId` is a known piece type that sits where the use is (`wall`, `roof`, `fence`), and a
  wall opening's `type` is one its type carries; a gate has a `typeId`, other fences none
- names are unique across all uses, ignoring case
- every finish use names a finish of the library that is for that kind of surface; a `tint` only on a tintable
  finish, a `rotation` only on a room's floor; `finishes` only on rooms of the lowest level

Errors carry a path into the document, for example
`openings[2].width: Opening "x" spans 7.65 m to 9.15 m but wall "y" is only 8 m long`.

## The real home

`data/homes/home.json` (id `home`) is the house the project is about. Its exterior (footprint, exterior walls,
roof) is derived from geodata and fixed; refinements change only the inside (rules in
[`AGENTS.md`](../AGENTS.md#house-model)). Values come from:

- **geodata**: the building footprint, eave and ridge heights (roof pitch 29°, ridge east-west), the
  garage, the terrain levels and `northBearing` (2.5°, including the map grid's convergence) were
  derived from official geodata of the Bavarian surveying administration (LoD2 building model, DGM1
  terrain model, orthophoto). Datenquelle: Bayerische Vermessungsverwaltung, CC BY 4.0.
- **estimated-from-photo**: windows and doors (position, size, sill), floor levels, the light well,
  the fences, the drainage strips, the garden shed and the compost, from street-level and aerial
  photos. The north facade was only seen at
  a grazing angle.
- **measured**: the souterrain room layout and its wall thicknesses (#78). The owner measured every
  room's inside size except the boiler room's. One uniform outer wall thickness (0.48) and one
  uniform inner wall thickness (0.24) were fitted by least squares, so the rooms fill the fixed
  exterior. Each room is within about 5 cm of its measured size, except the living room's depth
  (−9 cm: the measured depths of the living and bed rooms differ by 13 cm more than the geodata
  recess). The outer face of every souterrain wall stays on the geodata outline; the centre line
  moved inward. Room outlines run along the inner face of the outer walls and the centre line of
  the inner walls, so a room's inside size is its outline minus half an inner wall on each inner
  side.
- **mock**: the ground-floor and attic wall thicknesses, slab and roof thicknesses, the position of
  the interior doors along their walls and the stair's position in the stair hall.

The plan origin is the house's south-west outside corner, `x` runs along the south wall and `z`
towards the street. Heights are relative to the ground-floor finished floor (`y = 0`), not to sea
level. Everything is axis-aligned and the terrain is simplified to levelled areas and slopes:

- **South level** (about 0): the street, the driveway in front of the garage and the ground-floor
  garden and covered terrace. The garden ends at the street on the same line as the driveway; the
  road junction cuts off its south-east corner. A **garden shed** (`shed-ground-floor-garden`) and a
  **compost** (`compost-ground-floor-garden`) stand on its lawn.
- **Lower level** (-1.65): the souterrain apartment's garden on the north side and its patio on the
  east side.
- The **sunken entry** at the souterrain patio door: a paved landing at the souterrain floor, then
  seven irregular natural-stone steps up east to the patio, between rubble side walls (sloped terrain
  patches, drawn as embankments, falling from the patio to the landing and each step).
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

| Room id                  | Name        | Connected to                                          |
| ------------------------ | ----------- | ----------------------------------------------------- |
| `souterrain-stair-hall`  | Stair hall  | corridor (door), ground floor (stair)                 |
| `souterrain-work-room`   | Work room   | corridor (door)                                       |
| `souterrain-bath-room`   | Bath room   | corridor (door)                                       |
| `souterrain-kitchen`     | Kitchen     | corridor (open, no wall), the patio door's north part |
| `souterrain-corridor`    | Corridor    | every other room, and the souterrain patio (door)     |
| `souterrain-living-room` | Living room | corridor (door)                                       |
| `souterrain-boiler-room` | Boiler room | corridor (door)                                       |
| `souterrain-bed-room`    | Bed room    | corridor (door)                                       |

There are exactly **two ways into the apartment** (`apartments[].entrances`):

| Entrance id                      | Name                | Route                                                                                                                                                                                                                              |
| -------------------------------- | ------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `entrance-souterrain-stair-hall` | Stair hall entrance | the house's entrance on the ground floor, then down `stair-souterrain-stair-hall-ground-floor` into the stair hall, then `door-souterrain-corridor-stair-hall`                                                                     |
| `entrance-souterrain-patio`      | Patio entrance      | from the lane through `gate-souterrain-patio-lane` (north end of the patio), west down the straight flight of the sunken entry (seven stone steps) and across its landing, then `door-souterrain-corridor-patio` into the corridor |

The stair in the stair hall climbs clockwise (#145, from the owner's photos): eight risers north along
the west wall, a landing across the north end under the window, and six back south along the east wall,
with the railing between the two flights and a storage space under the upper one. The ground floor and the attic are not laid out yet: each has
one placeholder room covering its floor. The corridor and the kitchen have a suspended ceiling at 2.15
with a box down to 2.00 at the east end of the corridor's north wall (#61); the level's clear height stays 2.35.
Never add the house's address or location (coordinates, map
links, tile IDs, place names) to the repo.

## The test fixture

`packages/shared/test-fixtures/mock-home.json` (all values `source: "mock"`):

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
slabs, lowered ceilings, room floors, terrain blocks, outdoor surfaces, roof planes, stair steps, fence posts, bays and
slats) without three.js, and
`visibility.ts` filters them for the cutaway and the visibility toggles. The cutaway's top entry,
**Roof**, shows the whole building; choosing the highest level hides the roof to look into it, and
**Room names** labels the rooms of the level being looked into. Walls are split around openings (no CSG).

Every descriptor carries its **finish**, resolved from the model or its default (§ [Finishes](#finishes)):

- A wall is drawn face by face (`wallFaces`, `builder/wallFaces.ts`): each long face is one flat polygon per
  room it borders, with the windows as holes and the doors as notches, so a wall with openings has no seams.
  The builder finds that room with a point 5 cm in front of the face. A face that borders no room takes the
  facade finish when that point is outside the footprint, and the level's default wall finish otherwise. The
  reveal of an opening is in two halves, each with the finish of the long face it meets. The top is a cut face
  (`cut.dark`), drawn only while the level above or the roof is hidden. An end that looks into a room takes that
  room's finish; an end inside another wall and the underside are not drawn. The solid stretches of a wall
  (`walls`) are what a section caps; they are not drawn.
- **Shell detail** is derived by the builder from the walls, openings and roof (`builder/shellDetail.ts`); the
  sizes are its defaults (`SHELL_DETAIL`), not measurements, and nothing of the model moves:
  - `skirting`: boards 7 cm high and 1.2 cm deep at the foot of every wall face of a room of the level modelled
    inside, broken at doors, around a wall's free end.
  - `doorReveals`: a threshold in every doorway, through the wall's depth and 1 cm over the floor; a door through
    an inner wall of that level is also lined (jambs and head, 1.5 cm) in the colour of its frame. The frame
    stays the door piece's.
  - `roofTrim`: on a gable roof an eaves board on each eave's edge, a half-round gutter in front of it and a cap
    over the ridge, shown and hidden with the roof.
  - `stairs`: treads and landings (`steps`, what walk mode stands on), the flights as solids seen from their
    side (`flights`), the slabs under the landings and the railing (§ Stairs).
- Every room has a ceiling surface just under the slab above (`roomCeilings`), shown and hidden like a lowered
  ceiling, with the room's ceiling finish; a lowered ceiling takes the ceiling finish of the room it hangs in.
  The top level under a pitched roof has none.
- Texture coordinates are in metres and are written when the draw items are merged: floors and the ground on
  the plan from the plan origin (so neighbours line up), a wall face along the wall from its start and up from
  its floor, a roof plane along the eave and up the slope at true length. The finish's `tileSize` then says how
  many metres one repeat covers, so a tile of 60 cm measures 60 cm on every surface.
- The viewer's **Plan colours** switch (off by default, remembered per device) draws the room floors in the
  pastel colours that tell rooms apart, instead of their finishes.
  The R3F
  components in `apps/web/src/scene/` only draw descriptors, so any file that follows the schema
  renders without renderer changes.

## Seeding, swapping and importing homes

The api seeds `data/homes/home.json` ("Our home", the only home) on start in development
(`SEED_ON_START`); the viewer opens the oldest home. `SEED_FILE` seeds a single file instead. The code
stays ready for more homes (`?home=<id>`, the home list), but the home selector is hidden while there is
only one. Seeding is idempotent: a home whose id already exists is left alone.

**Deployed environments sync their homes from git on every deploy** (`dist/release.js`): both
environments `home.json`, validated first and replaced in one transaction
([deployment.md](deployment.md#homes-come-from-git)). Changing the house there is a pull request to
`data/homes`. The magnetic declination entered in walk mode is not part of that: it is a home setting
stored on top of the model (`GET/PUT /api/homes/:homeId/settings`, [userdata.md](userdata.md#home-settings)),
and `GET /api/homes/:id` and the export return the model with it applied.

```sh
pnpm db:seed                                   # data/homes/home.json (or SEED_FILE)
pnpm db:seed path/to/other-home.json           # another file; relative to where pnpm runs
pnpm db:seed data/homes/home.json --replace       # overwrite an existing home with the same id
SEED_FILE=../../data/homes/other.json pnpm dev # default for start-up and db:seed (relative to apps/api)
```

Stop `pnpm dev` first when using PGlite (one process per data directory). With the api running,
use HTTP instead:

| Endpoint                    | Behaviour                                                          |
| --------------------------- | ------------------------------------------------------------------ |
| `GET /api/homes`            | summaries `{ id, name, schemaVersion, createdAt, updatedAt }`      |
| `GET /api/homes/:id`        | the effective model: the stored one with the home settings applied |
| `PUT /api/homes/:id`        | full replace; body `id` must match; 404 if the home does not exist |
| `POST /api/homes/import`    | create (201) or replace (200) the home with the body's id          |
| `GET /api/homes/:id/export` | the effective model as a pretty-printed attachment `<id>.json`     |

On deployed environments `PUT` and `import` are for experiments only: they answer with the header
`Warning: 299 - "Replaced from data/homes on the next deploy"`, because the next deploy's sync replaces
every home that is in git.

```sh
curl -X POST localhost:3000/api/homes/import -H 'content-type: application/json' \
  --data @data/homes/other-home.json
curl -OJ localhost:3000/api/homes/home/export
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
