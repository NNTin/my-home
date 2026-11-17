# Furniture layouts

A home can have any number of named **layouts**: furniture arrangements stored separately from the
home model. The zod schemas live in
[`packages/shared/src/layouts.ts`](../packages/shared/src/layouts.ts); the api validates every
request with them and the web app every response.

## Model

```json
{
  "id": "4f0c…",
  "homeId": "mock-home",
  "name": "Default layout",
  "schemaVersion": 1,
  "version": 3,
  "items": [
    {
      "id": "9b2e…",
      "typeId": "bed",
      "levelId": "souterrain",
      "roomId": "souterrain-bedroom",
      "position": { "x": -4.05, "z": 2.06 },
      "rotationY": 0,
      "props": {}
    }
  ],
  "createdAt": "2026-11-16T00:00:00.000Z",
  "updatedAt": "2026-11-16T00:00:00.000Z"
}
```

- `position` is the item's centre on the plan in metres (x east, z south, as in the
  [home model](home-model.md)); `rotationY` is in radians, counter-clockwise seen from above.
- `typeId` refers to a furniture type by its id without the family (`bed` for the catalogue type
  `furniture.bed`, [adding a type](adding-piece-type.md)); `props` holds free-form JSON per item,
  read as overrides of the type's basic parameters (e.g. `{ "width": 1.8 }`; invalid ones are
  ignored).
- Items reference the building **only by id** (`levelId`, `roomId`). `roomId` is recomputed when an
  item moves.
- Item ids are unique within a layout.

### Independent of the building

Layouts live in their own `layouts` table (`home_id` references `homes`; deleting a home deletes
its layouts). Replacing, re-importing or re-seeding a home never touches them. Items whose level,
room or type no longer exists are **kept**: the editor lists them under **Needs attention**; items
on a missing level are hidden from the 3D view and can be moved to the current level with one
click.

## API

| Endpoint                                 | Behaviour                                                |
| ---------------------------------------- | -------------------------------------------------------- |
| `GET /api/homes/:homeId/layouts`         | summaries (no items, with `itemCount`), oldest first     |
| `POST /api/homes/:homeId/layouts`        | create `{ name, items? }` at version 1 (201)             |
| `GET /api/layouts/:id`                   | the layout                                               |
| `PUT /api/layouts/:id`                   | full replace `{ name, items, version }`; bumps `version` |
| `DELETE /api/layouts/:id`                | delete (204)                                             |
| `POST /api/layouts/:id/duplicate`        | copy under a new id; optional body `{ name }` (201)      |
| `GET /api/layouts/:id/export`            | pretty-printed attachment `<name>.layout.json`           |
| `POST /api/homes/:homeId/layouts/import` | create a new layout from a layout file (201)             |

`PUT` uses **optimistic concurrency**: `version` must be the version the client last saw. If the
layout changed in the meantime the api answers **409** and leaves it untouched:

```json
{
  "statusCode": 409,
  "error": "Conflict",
  "message": "Layout \"4f0c…\" is at version 4, not 3",
  "currentVersion": 4
}
```

A layout file is `{ schemaVersion, name, homeId?, items }`; export writes exactly that and import
accepts it (server fields such as `id` or `version` are ignored, the home comes from the URL), so
export then import gives the same layout under a new id.

```sh
curl -OJ localhost:3000/api/layouts/<id>/export
curl -X POST localhost:3000/api/homes/mock-home/layouts/import \
  -H 'content-type: application/json' --data @Default-layout.layout.json
```

## Saving in the web app

- Every edit is written at once to a **localStorage draft** for that layout
  (`my-home:layout-draft:<id>`) and saved to the api after a short debounce (800 ms). Saves run one
  at a time; a successful save removes the draft.
- Offline or on a server error the draft stays and the save is retried.
- On load, a draft with unsynced edits that is newer than the server copy is restored (and saved).
- On a **409** auto-saving stops and the draft is kept; the panel offers **Reload server copy**
  (drops the local edits) or **Overwrite with mine**.
- The last opened layout per home is remembered (`my-home:last-layout:<homeId>`). A home without
  layouts gets a `Default layout`.

## Editing

The **Furniture** panel (the Furniture tab of the sheet [on a phone](mobile.md)) adds items to the highest
level shown by the cutaway ("Add to …"), in the selected room. Click an item to select it, drag it on the floor to move it and drag the blue ring
to rotate it (in the chosen step, or freely). Touch works the same way; [on a phone](mobile.md#touch) the
ring is wider, the selected item's tools (rotate, duplicate, delete) float next to it, and a long press on an
item opens the panel.

| Key                       | Action                      |
| ------------------------- | --------------------------- |
| `R` / `Shift+R`           | rotate by one step (⟲ / ⟳)  |
| `Delete` / `Backspace`    | delete the selected item    |
| `Ctrl+D`                  | duplicate the selected item |
| `Ctrl+Z`                  | undo                        |
| `Ctrl+Shift+Z` / `Ctrl+Y` | redo                        |
| `Escape`                  | clear the selection         |

(`Cmd` instead of `Ctrl` on macOS.) Moves are constrained and snapped in this order:

1. **Grid** (optional, 10 cm).
2. **Walls** (optional): within 25 cm of a wall face the item moves flush against it, and a
   `back`-snapping type that is within 12° of facing away from the wall is turned to line up; a
   second wall at an angle pulls it into the corner.
3. **Stay inside the apartment**: the footprint must stay within the rooms of the apartment it is
   in (the building footprint on levels without rooms); a move that would leave it slides along the
   boundary.

Items whose footprint overlaps a wall or another item are highlighted in red. Window parapets
count as walls; doorways do not.

The logic is plain TypeScript in [`apps/web/src/editor/`](../apps/web/src/editor/) (`geometry`,
`floorPlan`, `placement`, `snapping`, `collision`, `history`, `editorState`, `operations`,
`shortcuts`), unit-tested without three.js. The R3F layer in `scene/FurnitureLayer.tsx` only turns
pointer events into floor-plane coordinates.
