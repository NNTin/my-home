# Furniture

Each home has **one set of furniture**: its placements, stored per environment in the database (`userdata.placements`,
[userdata.md](userdata.md)) and kept across every deploy. The viewer edits that set directly; every change is saved
per piece of furniture and becomes a history entry with its actor, so agents can read, change and undo it too
(`uses.sh`, see `SKILL.md`). The named layouts of earlier versions are gone from the viewer
([§ The one-time import](#the-one-time-import)).

## A placement

```json
{
  "id": "souterrain-bed-1",
  "homeId": "mock-home",
  "typeId": "furniture.bed",
  "name": "Bedroom · Bed",
  "levelId": "souterrain",
  "roomId": "souterrain-bedroom",
  "position": { "x": -4.05, "z": 2.06 },
  "rotationY": 0,
  "params": { "width": 1.8 },
  "version": 3,
  "createdAt": "2026-11-18T00:00:00.000Z",
  "updatedAt": "2026-11-18T00:00:00.000Z",
  "removedAt": null,
  "purgeAt": null
}
```

- `position` is the centre on the plan in metres (x east, z south, as in the [home model](home-model.md));
  `rotationY` is in radians, counter-clockwise seen from above.
- `typeId` is a catalogue type ([adding a type](adding-piece-type.md)); `params` holds only its basic-parameter
  overrides (sizes, colour). Invalid or stale ones are ignored when drawing.
- The server gives the id (`<apartment>-<type>-<n>`, never reused) and, unless one is sent, the name
  ("<Room> · <Type>", numbered when taken). The room is derived from the position.
- Placements reference the building **only by id**. One whose type, level or room is gone is **kept**: the panel
  lists it under **Needs attention** (as where-used does: `needs-attention`); one on a missing level is hidden
  from the 3D view and can be moved to the current level with one click.

The API (`/api/homes/:homeId/placements`, history and undo) is in [userdata.md](userdata.md).

## Saving in the web app

`apps/web/src/placements/`: `usePlacements` loads `GET /placements?include=removed` into the editor;
`PlacementSync` (`sync.ts`) saves.

- After every **committed** edit (a drag counts once it ends) the editor's items are compared by id with the
  server's last known copy:
  - a new item is `POST`ed under a temporary id (`new-…`); the server's id and name replace it in the items and in
    the undo/redo stacks (`remapId` in `editor/history.ts`);
  - a changed one (position, rotation, level, params, name) is `PATCH`ed with its `version`, changed fields only;
  - a removed one is `DELETE`d: it goes to the 30-day trash. Undoing the delete **restores** it (same id).
- **One call at a time.** Edits made while a call is on its way are sent next, as the latest state (two quick
  rotations become one `PATCH`).
- **Offline or a 5xx:** the pending changes are kept in localStorage (`my-home:placement-ops:<homeId>`) and
  retried every 5 s; status "Offline". A reload replays them on the server copy, so a reload or a short offline
  period loses nothing. A replayed change to an item that was changed elsewhere meanwhile is dropped.
- **A 409** (an agent or another tab changed the item): the item is reloaded from the server and the panel says
  "Changed elsewhere … reloaded: <name>" until the next edit.
- **Another 4xx** (e.g. a size that does not fit, 422): "Not saved" with the server's reason, and the item goes back
  to the server's copy (a refused new item is dropped). Nothing stays pending, so the change neither blocks the
  reload of the tab nor comes back on the next visit.
- Status (`saved | pending | saving | offline | rejected | conflict`) shows in the panel and, on a phone, in the
  chip at the foot of the 3D view.
- When the tab becomes visible again and nothing is pending, the placements and the opening overrides are reloaded,
  so an agent's edits show up.

### History and undo

The local undo/redo (`Ctrl+Z`, ↶ ↷) edits the items, and the sync writes the inverse change; each is also a server
history entry (`uses.sh history <id>`). Per-use history and undo across sessions are on the piece page.

## Opening overrides in the house

`placements/useOpeningOverrides.ts` loads `GET /api/homes/:homeId/opening-overrides` and passes them to
`buildHome(model, overrides)`: a frame colour or a sash count set through the API (`uses.sh set`) shows in the house.
Invalid or stale overrides are ignored by `effectiveParams`.

## Selecting pieces, piece pages and `?focus=`

- A tap or click on a window, door, roof window or gate (not in walk mode) selects it: the furniture panel's
  **Selected** area (on a phone, a chip at the top of the 3D view) shows its name, its type and **Open piece
  page** → `/catalog/<kind>/<typeId>?home=<id>#use=<useId>`. It glows for 2 s. Only what is in front counts: a
  click on a wall does not pick the window behind it.
- A selected piece of furniture has the same link (desktop: in the panel; phone: ⓘ in its floating toolbar).
- `/?focus=<useId>` frames a use: the cutaway goes to its level (with the roof for a roof window), the camera looks
  at it (from outside for exterior pieces, from above into the cutaway for interior doors and furniture), and it is
  selected. An unknown id shows "Not found in this home". `?walk=` wins when both are given.

```sh
S=.claude/skills/my-home-environments/scripts
$S/screenshot.sh staging --path '/?home=mock-home&focus=souterrain-kitchen-window&hints=off'
```

## Editing

The **Furniture** panel (the Furniture tab of the sheet [on a phone](mobile.md)) adds items to the highest
level shown by the cutaway ("Add to …"), in the selected room. Click an item to select it, drag it on the floor to
move it and drag the blue ring to rotate it (in the chosen step, or freely). Touch works the same way;
[on a phone](mobile.md#touch) the ring is wider, the selected item's tools (rotate, duplicate, delete, piece page)
float next to it, and a long press on an item opens the panel.

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

The logic is plain TypeScript in [`apps/web/src/editor/`](../apps/web/src/editor/) (`item`, `geometry`,
`floorPlan`, `placement`, `snapping`, `collision`, `history`, `editorState`, `operations`,
`shortcuts`), unit-tested without three.js. The R3F layer in `scene/FurnitureLayer.tsx` only turns
pointer events into floor-plane coordinates. `furniture.resolve()` (`catalog/furniture.ts`) is cached per type
and params, since collision checks and snapping resolve every item on each pointer move.

## The one-time import

The named layouts of earlier versions (`public.layouts`) become the placement set once, in the release job
(`dist/release.js`, after the sync) and on a local start with `MIGRATE_ON_START` (`apps/api/src/db/layout-import.ts`):

- for each home with layouts and no `userdata.imports` row `(home, 'layouts')`;
- if the home has **no placements at all** (trashed ones included): the most recently updated layout's items become
  placements, with ids and names from the scheme above, `import` history rows by `system`, and the log line
  `release: home "home": imported layout "Default layout" (7 items)`. Legacy type ids map through
  `LEGACY_FURNITURE_TYPE_IDS` (`bed` → `furniture.bed`); an unknown one is kept as `furniture.<id>` (it shows as
  needs attention); props that are not valid basic parameters are dropped and logged;
- otherwise nothing is imported (`layouts not imported (placements exist)`);
- either way the `imports` row is written, so it never runs again for that home.

Layouts are never deleted. Staging resets `public` on every deploy, so it never has any; production had none.

## The deprecated layouts API

`/api/homes/:homeId/layouts`, `/api/layouts/:id` (CRUD, duplicate, export, import) and the `public.layouts` table
stay for **one release** after the viewer moved to placements, so a rollback to the previous api version still
finds them. Nothing in the web app uses them; a follow-up issue removes them. Schemas:
[`packages/shared/src/layouts.ts`](../packages/shared/src/layouts.ts).
