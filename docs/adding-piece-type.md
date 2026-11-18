# Adding a piece type

Every window, door, roof window, gate and furniture type is a **piece type** in two parts:

1. a **shared definition** in [`packages/shared/src/catalog/definitions/`](../packages/shared/src/catalog/definitions/):
   its id, name, icon, description, placement and **parameters** (colours and sizes, `basic` or
   `design`, with limits). Both the api and the web app read it from `@my-home/shared` `catalog`.
2. a **piece module** in [`apps/web/src/catalog/<family>/<variant>/index.ts`](../apps/web/src/catalog/):
   how the type is drawn, as plain data (boxes and cylinders), from its parameter values.

The registry ([`catalog/registry.ts`](../apps/web/src/catalog/registry.ts)) finds every module with
`import.meta.glob` and checks it against the shared catalogue: exactly one module per type, the
folder `window/casement` for the id `window.casement`. There is no other list to update: the viewer,
the editor and the furniture catalogue panel pick the new type up. Openings refer to their type by
`typeId` in the home model ([home-model.md](home-model.md)); furniture is placed from the panel.

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
  placement: 'floor',
  params: {
    color: color('Colour', '#e8d9a8'), // basic: a use may change it
    diameter: length('Diameter', 0.4, 0.3, 0.6), // basic, with limits, metres
    height: fixedLength('Height', 1.6), // design: fixed by the type
  },
  snapping: { wall: 'none' }, // 'back' | 'any' | 'none'
  footprint: 'ellipse', // or 'rectangle' (default), from the effective width/depth
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
- Furniture also needs its id without the family in `LEGACY_FURNITURE_TYPE_IDS` (the old named
  layouts stored `lamp`; the one-time import maps it); that list is derived from `furniture` in `furniture.ts`.

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
  piece pages show the room side, `-1`). Doors use [`openings/frame.ts`](../apps/web/src/catalog/openings/frame.ts),
  the wall windows [`openings/window.ts`](../apps/web/src/catalog/openings/window.ts). Furniture: origin on the floor at
  the centre of the footprint, the front faces **+z** (a headboard or backrest sits at `-depth / 2`).
  The builder or the editor places the piece, so a module never sees world coordinates.
- A `Part` is a `box` or a `cylinder` (`size` = `[diameter, height, diameter]`) with a colour, a
  `role` (`frame`, `glass`, `body`, …) and optional `material` settings (transparency, metalness,
  shadows). [`PartsMesh`](../apps/web/src/catalog/PartsMesh.tsx) draws every piece the same way,
  in the order of its parts (keep glass after the frame), and adds the selection and collision
  highlight to furniture.
- `dimensions(values, ctx)` lists the measurements the piece page shows: lines in the local frame
  with a `value` in metres, a `label` in cm with one decimal and a `name` ("Width", "Sill height"),
  built with `dimension(from, to, value, name)`. At most 8 lines (the piece page labels at most 8 in
  3D). Windows and doors use `framedDimensions` (hole, sill when `ctx.sill` is known, frame width,
  each sash or leaf; the window board, outside sill and shutter box are measured in the section), furniture `furnitureDimensions` or `roundDimensions`.
- Optional `section(values, ctx)` (openings): the piece's own section as `SectionShape`s (rectangles
  in depth × height, tagged by role), when the generic cut of its parts through the centre
  (`sectionOf` in [`piece-page/section.ts`](../apps/web/src/piece-page/section.ts)) is not right,
  e.g. once a design draws real sill or sash profiles. The wall around the hole is added by the page.

## 3. Check it

```sh
pnpm --filter @my-home/web test   # registry parity, piece and golden tests
pnpm dev                          # furniture: the type appears in the "Add to ..." catalogue
```

The registry rejects a module whose `id` does not match its folder, that lacks `parts` or
`dimensions`, has no shared type or is missing for a type, with the file path in the error, so a
broken piece fails the tests and the build.

## Golden render records

[`catalog/golden.test.tsx`](../apps/web/src/catalog/golden.test.tsx) renders both homes and every
furniture type without WebGL and compares every mesh (geometry, world matrix, material, shadows, in
draw order) with the records in `apps/web/src/catalog/__golden__/`. **A design change updates the
goldens in the same PR and says so**: run `pnpm --filter @my-home/web exec vitest run -u
src/catalog/golden.test.tsx` and review the diff (one line per mesh). A refactor must leave them
unchanged. A new type changes no golden until a home or the furniture list uses it (the furniture
golden lists every furniture type, so a new furniture type adds its lines).

## Removing or renaming a type

Never rename a type id once a home or a placement uses it. Placements whose type is unknown are kept:
they are drawn as grey boxes and listed under **Needs attention**, never deleted. An opening's
`typeId` must be a known type, or the home model fails validation.
