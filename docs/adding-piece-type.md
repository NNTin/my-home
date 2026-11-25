# Adding a piece type

Every window, door, roof window, gate, furniture and fixture type is a **piece type** in two parts:

1. a **shared definition** in [`packages/shared/src/catalog/definitions/`](../packages/shared/src/catalog/definitions/):
   its id, kind, family, name, icon, description, placement (and, placed in a room, its mounting) and **parameters** (colours and sizes, `basic` or
   `design`, with limits). Both the api and the web app read it from `@my-home/shared` `catalog`.
2. a **piece module** in [`apps/web/src/catalog/<family>/<variant>/index.ts`](../apps/web/src/catalog/):
   how the type is drawn, as plain data (boxes, cylinders, rounded boxes, extruded outlines and lathed
   profiles), from its parameter values.

The registry ([`catalog/registry.ts`](../apps/web/src/catalog/registry.ts)) finds every module with
`import.meta.glob` and checks it against the shared catalogue: exactly one module per type, the
folder `window/casement` for the id `window.casement`. There is no other list to update: the viewer,
the editor and the furniture catalogue panel pick the new type up. Openings refer to their type by
`typeId` in the home model ([home-model.md](home-model.md)); furniture and fixtures are placements, versioned in
the home's seed (`data/homes/home.seed.json`, [userdata.md](userdata.md)).

| Kind        | Families                                                                            | Placed                               |
| ----------- | ----------------------------------------------------------------------------------- | ------------------------------------ |
| `openings`  | `window`, `door`, `gate` (`definitions/windows.ts`, `doors.ts`, `gates.ts`)         | in the home model: wall, roof, fence |
| `furniture` | `furniture`, `kitchen`, `appliance` (`furniture.ts`, `kitchen.ts`, `appliances.ts`) | in a room (`placement: 'floor'`)     |
| `fixtures`  | `fixture` (`fixtures.ts`): lights, the radiator                                     | in a room (`placement: 'floor'`)     |
| `outdoor`   | `garden` (`garden.ts`): patio and garden pieces                                     | on the ground outside (`'floor'`)    |

## 1. Define the type

Add it to the family's file in `packages/shared/src/catalog/definitions/` (a new family needs a new
file and an entry in `catalog.ts`). The spec shorthands are in `definitions/specs.ts`:

```ts
export const lamp = defineType({
  id: 'furniture.lamp', // <family>.<variant>; never changes once used
  kind: 'furniture',
  family: 'furniture',
  name: 'Floor lamp',
  description: 'Shown as the catalogue tooltip.',
  icon: '💡',
  category: 'Lighting', // furniture: catalogue group, spelled like rooms ("Bed room")
  placement: 'floor', // furniture and fixtures: in a room
  mounting: 'floor', // 'floor' | 'wall' | 'ceiling'; with `elevation`: the default bottom height
  params: {
    color: color('Colour', '#e8d9a8'), // basic: a use may change it
    diameter: length('Diameter', 0.4, 0.3, 0.6), // basic, with limits, metres
    height: fixedLength('Height', 1.6), // design: fixed by the type
  },
  snapping: { wall: 'none' }, // 'back' | 'any' | 'none'
  footprint: 'ellipse', // or 'rectangle' (default), from the effective width/depth, or 'none'
});
```

- **Basic** parameters are what a use may override (within `min`/`max`); **design** parameters belong
  to the type. Furniture sizes come from `width`, `depth` (or `length`) and `height`, or `diameter`
  (`furnitureSize`).
- Openings name the home model's `Opening.type` values they may carry (`openingTypes`) and a
  `preview` hole for the piece page. A count with a minimum width per part (`sashes`, `leaves`)
  gets `each: { minWidth, one, other }`; `openingFitIssues` reports a count that does not fit.
- Besides colours, lengths, counts and design numbers there are **fractions** (`fraction('Shutter
closed', 0)`: 0 to 1 in 5 % steps, shown in %) and **choices** (`choice('Curtain', { none: 'None',
both: 'Both sides' })`: one of a fixed list, the first the default). Both are basic; the playground
  and the per-use editor give them a slider and a drop-down list.
- A **choice of finish** (`finishChoice('Finish', ['plastic.matt', 'wood.veneer'])`) is a choice whose values are
  finish ids, labelled with the finishes' names, the first the default. `catalog` refuses, at import, an id the
  finish library does not have and a finish that is not for parts (its `surfaces` lack `part`). Like every basic
  parameter it is stored per use, in the seed, only where a use changes it; the api takes the type's options and
  nothing else. The piece module passes the value to its parts as `material.finish` (`kitchen.wall-shelf`).
- **Mounting** (furniture and fixtures): `floor` (the default), `wall` (a wall cabinet, the shelf, the radiator)
  or `ceiling` (a downlight), and an optional `elevation`: the default height of the piece's bottom above the
  floor (a wall cabinet 1.33, the microwave on the worktop 0.90). A ceiling piece has none. A new placement
  gets them (`mountingsFor`, `defaultElevation`); each placement then stores its own
  ([furniture.md](furniture.md#mounting-walls-and-ceilings)).
- **Footprint** `none`: the piece takes no floor space, so it collides with nothing and never blocks the walking
  figure: an open pergola you sit under, a stepping stone you walk over. A size without a `height` parameter
  falls back to the `diameter` (a log lying down).
- **Outdoor pieces** (kind `outdoor`, family `garden`, mounting `floor`) stand on the ground where they are
  placed, the terrain's surface there (`groundAt` in the builder), not on their level's floor: the patio, a
  step of the sunken entry, a slope. They have no ceiling over them, show whatever the cutaway, and move within
  the outdoor areas (not on the roads) in edit mode ([furniture.md](furniture.md#outdoor-pieces)).

## 2. Draw it

Create `apps/web/src/catalog/<family>/<variant>/index.ts` and default-export `definePiece({...})`
([`types.ts`](../apps/web/src/catalog/types.ts) has the contract):

```ts
import { colorParam, cylinder, shade } from '../../parts';
import { definePiece } from '../../types';
import { furnitureDimensions, sizeOf } from '../size';

export default definePiece({
  id: 'furniture.lamp', // must match the folder: catalog/furniture/lamp/
  parts: (values) => {
    const { width: w, height: h } = sizeOf(values);
    const color = colorParam(values, 'color');
    return [
      cylinder([0, 0.015, 0], w, 0.03, shade(color, -0.4), 'body'),
      cylinder([0, h / 2, 0], 0.04, h, shade(color, -0.4), 'body'),
      cylinder([0, h - 0.15, 0], 0.36, 0.3, color, 'detail'),
    ];
  },
  dimensions: furnitureDimensions,
});
```

- `parts(values, ctx)` is **pure**: the same values give the same parts, and valid values never
  throw (clamp instead, as `fittingCount` does for sashes that do not fit). `values` are the
  effective values (defaults plus a use's overrides); read them with `numberParam`/`colorParam`.
- **Local frame.** Openings: centred on the hole, width along x, height along y, the wall's depth
  along z; `ctx` is the hole (`width`, `height`, `wallDepth`), the `sill` height and `outside` (which
  way local z points to the outdoors: the builder derives it from the footprint; the catalogue and
  piece pages show the room side, `-1`) and, in the house, `headroom` (from the hole's top to its level's
  ceiling). Doors use [`openings/frame.ts`](../apps/web/src/catalog/openings/frame.ts),
  the wall windows [`openings/window.ts`](../apps/web/src/catalog/openings/window.ts). Furniture: origin on the floor at
  the centre of the footprint, the front faces **+z** (a headboard or backrest sits at `-depth / 2`).
  A wall piece uses the same frame: its back (-z) against the wall, the origin at its bottom (the mounting
  height is the placement's). A ceiling piece's origin is on the ceiling's surface, +y up into it: what shows
  hangs below 0 (a downlight's trim), what is hidden sits above (its housing).
  The builder or the editor places the piece, so a module never sees world coordinates.
- A `Part` is one solid: a shape (below), turned by `rotationY` and
  optionally tilted by `rotationX` (about its own x axis, before the turn: a sloping roof sheet, a leaning
  backrest, `tilted(cylinder(…), Math.PI / 2)` for a log lying on its side), with a colour, a
  `role` (`frame`, `glass`, `body`, …) and optional `material` settings (transparency, metalness,
  shadows). [`PartsMesh`](../apps/web/src/catalog/PartsMesh.tsx) draws every piece the same way,
  in the order of its parts (keep glass after the frame), and adds the selection and collision
  highlight to furniture.
- **Shapes**, each with a helper in [`parts.ts`](../apps/web/src/catalog/parts.ts) that works out the part's
  `center` and `size` (always the box around the part, before it is turned):

  | Helper                                          | Shape                                                                                       | For                                | Triangles           |
  | ----------------------------------------------- | ------------------------------------------------------------------------------------------- | ---------------------------------- | ------------------- |
  | `box(center, size, …)`                          | A box                                                                                       | Boards, carcasses, panes           | 12                  |
  | `cylinder(center, diameter, height, …)`         | An upright cylinder, elliptic with a `depth`                                                | Posts, discs, trunks               | 96                  |
  | `roundedBox(center, size, radius, …)`           | A box whose edges and corners are rounded by `radius` (at most half its smallest side)      | Cushions, fronts, appliances       | 300                 |
  | `extrude(origin, outline, depth, …, rotationY)` | A closed outline in x/y about `origin`, extruded through `depth` along z, half to each side | Handles, legs, mouldings, worktops | 4 n − 4 (n corners) |
  | `lathe(origin, profile, …)`                     | A profile of `[radius, y]` points about `origin`, turned about the y axis                   | Lamp shades, pots, turned legs     | 48 (n − 1)          |
  - **`extrude`** takes its turn as an argument, because the outline turns about `origin`, not about the middle
    of its box: `-Math.PI / 2` lays the outline's x along the piece's z, for a side view that runs along x (the
    hooks of `kitchen.wall-shelf`). The outline may wind either way.
  - **`lathe`**: give the profile from the bottom up along the outside (and back down the inside for a hollow
    pot). A point given twice is a sharp edge; a single point is a soft one. A profile that starts and ends on
    the axis (radius 0), or ends where it starts (a ring), is a solid. Any other is an open skin (a bowl, a
    lamp shade): it is drawn from both sides, as a mesh of its own, and a section does not cap it
    (`garden.planter` is a pot and a bush).
  - **Parts that lie down, and outlines** (the same file): `rod(center, diameter, length, …, 'x' | 'z')` is a
    cylinder lying along x or z (a rail, a knob); `slab(center, [width, thickness, depth], radius, …)` a flat
    plate with rounded corners in plan (an inset sink, a hob); `plank(center, [length, thickness, depth], …)` a
    board whose grain runs along it (below). For `extrude`: `strip(path, gauge)` is the outline of a bent bar or
    a tube seen from its side (a handle, a hook, a tap: `kitchen.base-cabinet`), `arc(center, radius, from, to)`
    the points of a bend, `roundedRect(width, height, radius)` a rectangle with rounded corners.
  - **Everything else ignores the shape.** Dimensions, the footprint, collisions and snapping come from the
    type's parameters (`furnitureSize`), as for boxes. The piece page frames a part by its `size`, and a
    section (`sectionOf`) cuts a rounded box and an extruded outline by that box and a lathed part by the
    cylinder around it, unless the module gives its own `section`.
  - **Budget:** at most 5,000 triangles per piece (`docs/design/realistic-render.md` §10.1). The count of every
    type at its default size is recorded in `apps/web/src/catalog/__golden__/triangles.json` and checked by
    `catalog/shapes.test.ts`; a design change updates it with the other goldens.

- **Finishes** (`docs/design/realistic-render.md` §5.7): a part may name a finish of the library that is for
  parts, `material: { finish: 'wood.veneer' }` (`wood.veneer`, `fabric.weave`, `metal.brushed`, `ceramic.white`,
  `plastic.matt`, `glass.clear`; the catalogue page lists them).
  - The part's colour is the **tint**: the texture is multiplied by it, so a white part shows the finish as it
    is. A finish that is not tintable (`ceramic.white`) keeps its own colour.
  - The finish gives the roughness and the metalness; the part's own are ignored. `transparent`, `opacity`,
    `depthWrite` and the shadow flags still count (`glass.clear`).
  - A texture is laid on by a box projection **in the part's own frame**, in metres: it turns and tilts with the
    part, and two parts of the same size show the same piece of it. Around a cylinder or a lathe it is poor: use a
    plain finish there.
  - The parts of one finish are one mesh; a part without a finish draws as before. **Give every part of a piece
    a finish,** and at most four finishes a piece: a plain part with its own roughness or shadow flags is one
    more mesh, and the default view has a draw-call budget (§10.1 of the design). `catalog/cabinet.ts` has the
    usual ones: `LACQUER` (`plastic.matt`: carcasses, fronts, laminate), `METAL` (`metal.brushed`, tinted by the
    part's colour: dark hardware only, because a metal mirrors the room and bright steel reads as charcoal under
    a ceiling and on a piece page; draw steel and chrome as `LACQUER` in their colour), `GLASS` (`glass.clear`: glossy; see-through only with `transparent`).
  - **Wood:** the veneer's grain runs along the part's own z on a face that looks up, and up a face that looks
    sideways. A board that lies along x is a `plank` (a box turned a quarter). A tint multiplies the texture, so
    a colour used as the tint comes out far too dark: `wood(color)` of `catalog/cabinet.ts` gives the colour and
    finish of a stained board (`veneerTint`: the colour divided by the oak's own), or lacquer for a colour
    lighter than oak, which no stain gives.
  - **Handles:** `handle(x, y, face, length, color, upright?)` of `catalog/cabinet.ts` is a bar of brushed metal
    on two posts, 3 cm off its front.
  - `catalog/partFinishes.test.ts` fails for a part of any type, at any of its choices, that names a finish the
    library does not have or one that is not for parts. In the app such a part draws plain.
- `dimensions(values, ctx)` lists the measurements the piece page shows: lines in the local frame
  with a `value` in metres, a `label` in cm with one decimal and a `name` ("Width", "Sill height"),
  built with `dimension(from, to, value, name)`. At most 8 lines (the piece page labels at most 8 in
  3D). Windows and doors use `framedDimensions` (hole, sill when `ctx.sill` is known, frame width,
  each sash or leaf; the window board, outside sill and shutter box are measured in the section), furniture `furnitureDimensions` or `roundDimensions`.
- Optional `section(values, ctx)` (openings): the piece's own section as `SectionShape`s (rectangles
  in depth × height, tagged by role), when the generic cut of its parts through the centre
  (`sectionOf` in [`piece-page/section.ts`](../apps/web/src/piece-page/section.ts)) is not right,
  e.g. once a design draws real sill or sash profiles. The wall around the hole is added by the page.
- Optional `emits(values, ctx)` (placed kinds): the light the piece gives, as `PieceEmitter`s in the local
  frame: a `position`, a `color`, an `intensity` in candela and a `range` in metres (`fixture.downlight`). The
  viewer lights the nearest emitters with its fixed lamp pool and ends each range at the piece's room
  (`docs/design/realistic-render.md` §6.4). A piece never adds a light to the scene itself.

## 3. Check it

```sh
pnpm --filter @my-home/web test   # registry parity, piece and golden tests
pnpm dev                          # furniture: the type appears in the "Add to ..." catalogue
```

The registry rejects a module whose `id` does not match its folder, that lacks `parts` or
`dimensions`, has no shared type or is missing for a type, with the file path in the error, so a
broken piece fails the tests and the build.

## Golden draw lists

[`catalog/golden.test.ts`](../apps/web/src/catalog/golden.test.ts) builds the **draw list** of both homes and of
every furniture and outdoor type at its default size, without WebGL, and compares every draw item (shape, world
matrix, finish and tint, material settings, shadow flags, in draw order) with the records in
`apps/web/src/catalog/__golden__/`. The draw list ([`builder/drawList.ts`](../apps/web/src/builder/drawList.ts)) is
everything the renderer is given; how it is merged into meshes is not recorded. **A design change updates the
goldens in the same PR and says so**: run `pnpm --filter @my-home/web exec vitest run
src/catalog/golden.test.ts src/catalog/shapes.test.ts -u` (the flag last: it takes the word after it) and review the diff (one line per solid). A refactor must leave them
unchanged. A new type changes no golden until a home or the furniture list uses it (the furniture
golden lists every furniture type, so a new furniture type adds its lines). `triangles.json` beside them
lists the triangles of every type; a new type adds its line.

## Removing or renaming a type

Never rename a type id once a home or a placement uses it. Placements whose type is unknown are kept:
they are drawn as grey boxes and listed under **Needs attention**, never deleted. An opening's
`typeId` must be a known type, or the home model fails validation.
