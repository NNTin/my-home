# Adding a furniture type

Each furniture type is **one module folder** in [`apps/web/src/items/`](../apps/web/src/items/).
The registry ([`registry.ts`](../apps/web/src/items/registry.ts)) finds every
`src/items/<type>/index.tsx` at build time with `import.meta.glob`, so adding a folder is all it
takes: no change to the registry, the catalog, the editor, the API or the database.

## 1. Create the folder

The folder name is the type id that layouts store as `typeId`. Use letters, digits, `-` and `_`.

```
apps/web/src/items/
  lamp/
    index.tsx
```

## 2. Define the type

`index.tsx` default-exports `defineItemType({...})`, which type-checks the
[`ItemTypeModule`](../apps/web/src/items/types.ts) contract:

```tsx
import { Cylinder, shade } from '../parts';
import { defineItemType } from '../types';

export default defineItemType({
  id: 'lamp', // must equal the folder name
  name: 'Floor lamp',
  category: 'Lighting', // catalog group; a new name creates a new group
  icon: '💡',
  description: 'Shown as the catalog tooltip.',
  size: { width: 0.4, depth: 0.4, height: 1.6 }, // metres
  color: '#e8d9a8',
  // Optional convex footprint in the local frame; defaults to the width x depth rectangle.
  // footprint: ellipse(0.4, 0.4),
  snapping: { wall: 'none' }, // 'back' | 'any' | 'none'
  Render: ({ size, color, ...state }) => (
    <group>
      <Cylinder
        position={[0, 0.015, 0]}
        radius={size.width / 2}
        height={0.03}
        color={shade(color, -0.4)}
        state={state}
      />
      <Cylinder
        position={[0, size.height / 2, 0]}
        radius={0.02}
        height={size.height}
        color={shade(color, -0.4)}
        state={state}
      />
      <Cylinder
        position={[0, size.height - 0.15, 0]}
        radius={0.18}
        height={0.3}
        color={color}
        state={state}
      />
    </group>
  ),
});
```

| Field       | Meaning                                                                                    |
| ----------- | ------------------------------------------------------------------------------------------ |
| `id`        | stored in layouts; must match the folder name and stay stable once layouts use it          |
| `name`      | label in the catalog and the selection panel                                               |
| `category`  | catalog group (any string; groups are sorted by name)                                      |
| `icon`      | short text or emoji shown on the catalog button                                            |
| `size`      | default size in metres: `width` along local x, `depth` along local z, `height` up          |
| `color`     | base colour passed to `Render`                                                             |
| `footprint` | convex 2D outline `[x, z][]` for collision and wall snapping (default: the size rectangle) |
| `snapping`  | `wall: 'back'` turns its back to a nearby wall, `'any'` aligns any side, `'none'` never    |
| `Render`    | R3F component drawing the item                                                             |

### Local frame

The item's origin is the centre of its footprint **on the floor**; y goes up. The front faces
local **+z**, so the back is the -z side: a bed's headboard, a sofa's backrest and a wardrobe's
back panel sit at `-depth / 2`. The editor places and rotates the whole group, so `Render` never
deals with world coordinates or the level's elevation.

### Rendering

`Render` receives `{ size, color, selected, colliding }`. Build it from the helpers in
[`parts.tsx`](../apps/web/src/items/parts.tsx) (`Block`, `Cylinder`, `shade`) and pass the state
through (`state={state}`): their material then shows the selection (blue) and collision (red)
highlight the same way for every type. Keep geometry simple (boxes and cylinders); real models and
textures are out of scope for now.

Footprints must be **convex** (collision uses the separating axis theorem). Approximate round
items with `ellipse(width, depth)` from `editor/geometry.ts`, as the round table does.

## 3. Check it

```sh
pnpm --filter @my-home/web test   # registry tests validate every module
pnpm dev                          # the new type appears in the "Add to ..." catalog
```

The registry rejects a module whose `id` does not match its folder, whose `size` is not positive,
whose `snapping.wall` is unknown or whose `Render` is missing, with the file path in the error, so
a broken module fails the tests and the build.

## Removing or renaming a type

Layouts keep items whose type is unknown: they are drawn as grey boxes and listed under
**Needs attention**, never deleted. To rename a type, keep the old folder until the layouts that
use it have been migrated (for example by exporting, editing `typeId` and re-importing them).
