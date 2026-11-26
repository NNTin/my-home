# The catalogue pages

Next to the 3D viewer the app has pages of its own, each with an address that can be linked to, reloaded and
reached with the browser's back and forward buttons.

| Address                    | Page                                                    |
| -------------------------- | ------------------------------------------------------- |
| `/`                        | the viewer                                              |
| `/catalog`, `/catalog/`    | the catalogue: every piece type, by kind                |
| `/catalog/<kind>/<typeId>` | one piece type, e.g. `/catalog/furniture/furniture.bed` |
| anything else              | "Page not found", with a link home                      |

`<kind>` is a `CatalogKind` (`openings`, `furniture`, `fixtures`, `outdoor`) and `<typeId>` a known type of that kind
(`packages/shared/src/catalog`); a type under the wrong kind is not found. The piece page is described
[below](#the-piece-page), its uses [after it](#uses-on-the-piece-page).

The document title follows the page: `my-home`, `Catalogue · my-home`, `<Type name> · my-home`.

## Entry points

- Desktop: **📚 Catalogue** in the control panel, next to Walk and Photos.
- Phone: **📚 Catalogue** in the top bar ([mobile.md](mobile.md#top-bar)).
- On the catalogue, **← Home** goes back to the viewer; on a piece page, **← Catalogue** goes back to the list.

All of these are real links (`<a href>`): a long press, open in a new tab and copy link work as everywhere.

## Query parameters

- `?home=` is kept on every page and by every link between them, and **Home** on the viewer keeps writing it.
- `?walk=`, `?panel=`, `?sheet=` and `?hints=` mean something on `/` only. Links from a catalogue page back to the
  viewer keep `?home=` and drop the rest.
- Leaving `/` unmounts the viewer: coming back starts a fresh view. A walk saved for a reload
  ([walking.md](walking.md)) is forgotten when another page is opened.

## The catalogue

- A header (sticky on scroll) with **← Home**, the title and a search field. The search matches the name,
  description, type id and furniture category, in any case, as you type.
- A section per kind: "Windows & doors" (windows, doors and gates in catalogue order), "Furniture",
  "Fixtures" (lights, the radiator) and "Outdoor" (patio and garden pieces), the last three by category, then by
  name, as the furniture panel.
- Each card shows the thumbnail, name, short description and **N uses**, from `GET /api/catalog/usage`: the uses
  in this environment over all its homes. While they load the card says "…"; if the api fails, the counts are
  hidden with a short notice and the page still works.
- The card is a link named "<Type name>, N uses", with its description as the link's description.
- On a phone (`useLayoutMode`): one column, safe-area insets, cards and controls at least 44 px tall, and no
  sideways scrolling upright (390×844) or across (844×390).
- After the kinds, a section **Finishes**: every finish of the library (`packages/shared/src/finishes/`,
  `docs/home-model.md` § Finishes) with its name, id, description, the kinds of surface it is for, whether it
  can be tinted, how many metres one repeat covers, and for a textured finish a link to its source and the
  licence (always CC0). The swatch is the finish's colour map, in the one size this device fetches (512 px on
  a phone, 1024 px on a desktop), or its tint for a plain or relief-only finish. The search covers finishes
  too (name, description, id). A finish card is not a link: finishes are chosen in the home file, and have no
  page of their own.

## The piece page

`/catalog/<kind>/<typeId>` (`apps/web/src/piece-page/`, a lazy chunk with its own CSS) shows one type on its
own. The preview and the **playground save nothing**: they send no request but GETs, whatever is changed.
What the page writes is in [its uses](#uses-on-the-piece-page), below the playground.

- **Header**: **← Catalogue**, the name, the kind and family (and the category); the description below, and for
  furniture and fixtures how the piece is mounted ("Hangs on a wall, its bottom 133.0 cm above the floor by
  default.").
- **Layout**: on a desktop the preview on the left (about 60 %) and the panel on the right; on a phone held
  upright the preview on top (40 % of the height) and the panel below as one scrolling page; on a phone held
  across (844×390) side by side again, the preview as high as the screen allows. Controls are at least 44 px.
- **3D inspector** (`Inspector.tsx`): an R3F canvas of `pieces.get(id).parts(values, ctx)` with the
  [preview context](#thumbnails). An opening stands in a short wall stub (`wallStub`: wall beside, over and
  under the hole, down to the floor), gates on the ground, furniture and fixtures by their mounting: on the floor,
  on a worktop block at their elevation (the microwave), on a wall stub behind them with the floor at their
  elevation, or under a ceiling slab seen from below (with a light from below). Orbit and zoom (with damping), framed
  to fit whenever the parameters change (keeping the direction), **Reset view**, and frames drawn on demand
  only. Wall openings get their preview `sill` in `ctx` (`PieceContext.sill`).
- **Dimensions**: the piece module's `dimensions(values, ctx)` as lines with end ticks and labels in cm with
  one decimal (e.g. "92.5 cm"); the **Dimensions** checkbox hides them. The labels are plain DOM over the
  canvas placed on every frame drawn (not drei `Html`, see `RoomLabels`), at most 8 per piece. The same list
  is shown as text under the preview.
- **Section** (openings; **3D / Section** swaps the views): `sectionOf(parts, ctx)` cuts the parts with the
  vertical plane through the opening's centre, perpendicular to the wall, into rectangles in (depth, height)
  tagged by role, plus the wall stub; a piece may give its own `section()`. It is drawn as SVG
  (`SectionView.tsx`) with a legend by role and, in cm, the wall, frame, sash, glass (or panel), window board
  and outside sill depths, a shutter box's height and depth, and the sill and opening heights. The
  outdoors is on the left, the room on the right. Rounded boxes and extruded outlines are cut as the box around
  them and a lathed part as the cylinder around it ([adding-piece-type.md](adding-piece-type.md) § 2).
- **Playground** (`Playground.tsx`), generated from the type's `params`:
  - a basic colour: a colour picker, a hex field (`#rgb` or `#rrggbb`, lower-cased) and a swatch; any colour;
  - a basic length: a slider in 1 cm steps and a field in cm with one decimal (`92,5` and `92.5` both work),
    with its limits ("80.0–220.0 cm"); a value beyond them says so and is not applied;
  - a basic count: − / value / + within its limits;
  - a basic fraction: a slider from 0 to 100 % in 5 % steps, with the value in %;
  - a basic choice: a drop-down list of its options;
  - **Reset to defaults**; openings show `openingFitIssues` against the preview hole.
  - The design parameters are listed read-only under "Design (changed only by a pull request)".
- **`?p=`** holds the playground's overrides (base64url JSON, written a moment after the last change, replacing
  the history entry), so a playground state can be shared. It is used only if it is valid against
  `basicOverridesSchema(type)`; otherwise the defaults are shown.

## Uses on the piece page

Below the playground and the design parameters, the page acts on **this environment's** data (#45; APIs in
[userdata.md](userdata.md) and [photos.md](photos.md)). Agents may use all of it; photos are never deleted here.

- **View mode and edit mode** ([docs/furniture.md](furniture.md#view-mode-and-edit-mode)): the page's header has
  **Edit** / **Done**. Without edit mode there is no **Place**, no per-use editor (`#use=` opens the history
  instead), no **Remove** or **Restore**, and no **Undo**; the history is read-only.
- **Place** (furniture and fixture types, on the floor, a wall or the ceiling as the type says):
  **Place…** opens a form, home → level → room (only levels with rooms; defaults:
  the `?home=` home, its first level with rooms, that level's first room). It finds a free spot in the room with
  the editor's `createItem` against the home's current placements, `POST`s the placement with the playground's
  values as `params`, and opens `/?home=<id>&focus=<newId>&panel=furniture` to move and turn it in the viewer.
  The server gives the id and the name.
- **Uses** (`Uses.tsx`): `GET /api/homes/:homeId/uses?typeId=` for every home of `GET /api/homes`, plus each
  home's model, photos, photo requests and (furniture) placements with the trash. "N uses in this environment"
  equals the catalogue card (orphan overrides are not counted). Each home is a collapsible group, then a level
  (in the model's order), rows sorted by room. A row shows the name, where ("Souterrain · Bedroom"), the
  overrides ("frame colour #383e42", "2 sashes", "width 180.0 cm", with swatches) or "Type defaults", photo and
  request counts, and **Show in model** (`/?home=<id>&focus=<useId>`), **Edit** and **History**.
  - **Needs attention** comes first, and those uses are not listed again below: `Use.problems` (orphan overrides,
    "type changed from …", ignored keys, a placement's missing level or room, fit problems). Nothing is deleted:
    the actions are **Show history** (with its Undo) and, for placements, **Remove** (to the trash).
  - Placements of the type in the trash are listed per home under **In the trash** with **Restore**.
  - **`#use=<useId>`** (the viewer's piece links, photos, agents' links) opens that use's editor and scrolls to
    it, on load and on `hashchange`; `?home=` picks the home when several have the id. Opening a row writes the
    anchor (replacing the history entry), and the playground's `?p=` keeps it.
- **Per-use editor** (`UseEditor.tsx`): the playground's controls (`BasicControl`), initialised with the use's
  overrides, each marked **Overridden** (with **Reset to type default**, which removes the key) or **Type
  default**. Keys the type ignores are dropped from the form. While a row is open, the preview and dimensions
  show that use: an opening **in its real hole** (width, height, wall depth and sill from the model), furniture at
  its size, with the unsaved values. **Save** sends `PUT …/opening-overrides/:useId` or `PATCH …/placements/:id`
  with the use's `version` and the whole override object:
  - 422: the fit issues are listed inline ("4 sashes need at least 100.0 cm, the opening is 90.0 cm"); openings
    also show them before saving;
  - 409: "Changed elsewhere", with **Reload (keeps your values)**, which shows what is saved now next to the
    unsaved form; saving then replaces it.
  - Furniture can also be renamed and removed (to the trash); restore it from **In the trash**.
- **History** (`History.tsx`): `GET …/uses/:useId/history`, newest first: when (relative, the exact time in the
  tooltip), who ("You" for the owner, "Agent", "System", and "(declared)" or "(default)" when the actor did not
  come from the sign-on), and the `changes` texts. **Undo** when `canUndo`: one click, no confirmation (the undo is
  recorded and can be undone). A 409 says "Changed again later: undo the later change first." Undone entries are
  struck through, "undone by … at …".
- **Photos and notes** (`Photos.tsx`, `Notes.tsx`):
  - type level, in **Photos & notes**: the photos linked to `type:<id>` or to any of its uses; a tap opens the
    photo (with **Open in the gallery**, no delete); the type's notes (environment-wide);
  - use level, in the open row: the photos linked to the use (with **Unlink**), **Link a photo…** (the home's
    photos, newest first, only the use's rooms unless unticked) → `PATCH /api/photos/:id { subjects }`; the open
    photo requests about the use ("Requested by agent: …", **Open in walk mode** → `/?home=<id>&walk=first`, where
    the request ghosts are); the use's notes (add, edit, delete).
  - There is **no** delete control for photos or requests: deleting stays the owner's, in the gallery.

The viewer picks up edits made here when it is opened again (it remounts) or when its tab becomes visible.

## Thumbnails

Thumbnails are drawn in the browser from the type's own geometry, so they always show the design as it is in
git. `apps/web/src/catalog-page/thumbnails.ts`:

- **One renderer.** A single offscreen three.js `WebGLRenderer` (256×256, transparent; `renderThumbnail.ts`)
  draws each type's `parts(defaultParams(type), preview)` with a fixed light and a three-quarter camera, **one
  at a time**. There is never a canvas per card: phones allow only a few WebGL contexts per page. Furniture is
  drawn at its default size, an opening in its type's `preview` hole. Each part is drawn with the viewer's own
  geometry of its shape (`shapeGeometry` in `scene/batches.ts`). A part that names a finish is drawn with the finish's
  material; the thumbnail waits up to 10 s for its texture (the 512 px files) and draws the tint if none comes.
- **Lazy.** A card asks for its thumbnail when it comes near the screen (an `IntersectionObserver` per card),
  and shows the type's icon until it is ready, or for good where WebGL is missing.
- **Cached.** Each image is kept in the Cache Storage API (cache `my-home-thumbnails`) under
  `thumb:<typeId>:<hash>` (stored as a request to `/__thumbnails/<key>`, never fetched), where `hash` is a short
  hash (FNV-1a) of `JSON.stringify(parts)`. A ceiling piece is drawn turned over (`thumbnailParts`), so the camera
  from above sees its room side. A design change gives new parts and so a new key: the old image is
  never shown again, and is deleted when the new one is stored. An unchanged design is never drawn twice. Where
  the Cache Storage API is missing (not a secure context), thumbnails are kept for the page only.
- **Pruned.** Once per page load, the cached thumbnails of types no longer in the catalogue are deleted.

In jsdom tests the renderer module is mocked; no test needs WebGL.

## Routing

There is no router library: `apps/web/src/routing/`.

| Export                          | What                                                                                          |
| ------------------------------- | --------------------------------------------------------------------------------------------- |
| `Route`, `parseRoute(pathname)` | the page of a path (see the table above)                                                      |
| `href(route, query?)`           | the path of a route with a query (empty values left out)                                      |
| `keptQuery(search?)`            | `{ home }` from the address: what every link carries                                          |
| `navigate(to, { replace })`     | `history.pushState` (or `replaceState`) and a re-render; a new page starts at the top         |
| `useRestoredScroll()`           | back on a page, scrolls to where it was (`scrollY` kept in its history entry)                 |
| `useRoute()`                    | the current route, following `navigate()` and `popstate` (back and forward)                   |
| `Link`                          | an `<a href>`; a plain left click navigates in place, modified clicks are left to the browser |
| `useDocumentTitle(page?)`       | sets the title                                                                                |

`navigate` keeps the scroll position of the page it leaves in that page's history entry (`history.state`), and
`useRestoredScroll` (the catalogue and piece pages) puts it back on back, forward or a reload. The browser's own
restoration is off (`history.scrollRestoration = 'manual'` in `main.tsx`): it ran before a lazy page had drawn its
content, so a long catalogue came back at the top.

`App.tsx` switches on the route. The catalogue pages are `React.lazy` chunks with their own CSS, so the viewer's
first load does not grow with them (about 3 kB gzip for the router and entry points).

## Serving deep links

nginx (`apps/web/nginx/default.conf.template`) proxies `/api/` first, serves `/assets/` as immutable files, and
answers every other path with `index.html` (`try_files $uri $uri/ /index.html`, `Cache-Control: no-cache`).
Assets use absolute `/assets/` URLs (Vite `base: '/'`), so a deep link loads the same app. CI's docker smoke test
curls `/catalog`, `/catalog/` and `/catalog/furniture/furniture.bed` (each must be `index.html`, not cached) and
checks that an unknown `/api/…` path is still the api's 404.

Behind the sign-on, forward auth returns to the address that was asked for after a login. If a deep link lands
on `/` after the login instead, that is a setting of the sign-on (infrastructure), not of the app.

## Testing on an environment

CI runs `catalog-smoke.sh` on staging after every deploy of a pull request: the job `staging-checks (catalog)`
([deployment.md](deployment.md#checks-on-staging)). Read the job; run it by hand only for an environment CI does
not check.

```sh
S=.claude/skills/my-home-environments/scripts
$S/catalog-smoke.sh staging                                    # desktop and phone: deep links, reload, back,
                                                               # every piece page, sections, the playground,
                                                               # uses: editor, history, Place (all writes faked)
$S/screenshot.sh staging --path '/catalog' --out /tmp/catalog.png
$S/screenshot.sh staging --viewport 390x844 --touch --path '/catalog' --out /tmp/catalog-phone.png
```

Tests: `apps/web/src/routing/routing.test.tsx`, `apps/web/src/catalog-page/Catalog.test.tsx`,
`apps/web/src/catalog-page/thumbnails.test.ts`, `apps/web/src/piece-page/*.test.ts(x)` (playground, section,
page, uses, editor, history, Place, notes and photos; the fake api in `test/fakeApi.ts` has uses, history with
undo, notes and photo subjects), `apps/web/src/catalog/dimensions.test.ts`, `apps/web/src/catalog/shapes.test.ts` (the part shapes, and the
triangles of every type against the budget of 5,000), `App.test.tsx` § pages and `Mobile.test.tsx`. The piece page's
tests mock `Inspector` (no WebGL in jsdom); the section is SVG and is tested as it is.

## Wall windows (`window.casement`, `window.tilt-turn`)

The standard German uPVC window, from the owner's photos (#47; `apps/web/src/catalog/openings/window.ts`).
From the outdoors in:

- an aluminium **outside sill** (Fensterbank außen), 5 cm past the facade;
- the **frame** (Blendrahmen), 6.5 cm wide and 7 cm deep, set back 12 cm from the facade (clamped in thin walls);
- per division a **sash** (Flügel), 6 cm wide and 7.8 cm deep, 1.8 cm proud of the frame into the room, with
  2.4 cm double glazing, a white **handle** (Olive, pointing down: closed) at mid-height on the opening side
  and two **hinges** on the other; several sashes have fixed mullions between them and their handles
  towards the middle;
- the inside **window board** (Fensterbank innen), 3 cm thick, 3 cm past the inner wall face.

Basic parameters a use may set (all off by default, so a window looks the same everywhere until its use
says otherwise): `handleSide` (`right`/`left`, as seen from the room), `boardColor`, a **roller shutter**
(`shutter`: `none`, `outside` = a box on the facade, `inside` = a lid over the window in the room with the
slats in the outer reveal; `shutterClosed` 0–100 %; `shutterColor`) and a **curtain** (`curtain`:
`none`, `both`, `left`, `right`; `curtainClosed` 0–100 %; `curtainColor`) on a black rod 15 cm above the
opening (but at least 3 cm under the ceiling: `headroom`), reaching 25 cm past it, the panels down to the floor. Fabric roller blinds, pleated blinds and
privacy film (seen on several souterrain windows) are not modelled. Per-window values are overrides in
the seed (`data/homes/home.seed.json`: set on staging with `uses.sh set`, then exported), never in `home.json`. Both types share every parameter, so a git
change from one to the other keeps a use's overrides.

## Kitchen, corridor and fixture types (#62)

From the corridor survey (#60): the souterrain kitchen and corridor. Sizes are defaults (basic parameters with
limits); each placement sets its own (#64). The kitchen soffit is geometry, not a type.

| Type                       | Mounting                     | Defaults                                                              | Basic besides colours and sizes                                                                                                      |
| -------------------------- | ---------------------------- | --------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| `kitchen.base-cabinet`     | floor                        | run 240 cm, depth 60, worktop at 90 (4 cm thick), plinth 10, units 60 | fronts (drawer over door, doors, 3 drawers); sink, hob (induction, downdraft), built-in oven, each at its distance from the left end |
| `kitchen.wall-cabinet`     | wall, bottom at 133 cm       | 68 × 68 × 35 cm, concrete-look front, white carcass                   | doors (1–4), front style (push to open, bar handles)                                                                                 |
| `kitchen.wall-shelf`       | wall, bottom at 152 cm       | 300 × 25 cm, 3 cm dark wood                                           | finish (lacquer, oak veneer stained to the colour); rail with hooks 12 cm below                                                      |
| `kitchen.tall-cabinet`     | floor                        | 50 × 199 × 48 cm, white carcass                                       | door (smoked glass, solid)                                                                                                           |
| `appliance.fridge-freezer` | floor                        | 60 × 185 × 65 cm, steel, freezer door 70 cm                           |                                                                                                                                      |
| `appliance.microwave`      | floor, on a worktop at 90 cm | 48 × 28 × 38 cm, black                                                |                                                                                                                                      |
| `furniture.shoe-cabinet`   | floor                        | 60 × 90 × 35 cm, white, open shelf at 15 cm                           | doors (1–3)                                                                                                                          |
| `furniture.storage-shelf`  | floor                        | 99 × 94 × 44 cm, pine frame                                           | columns (1–4), rows (1–5) of bins                                                                                                    |
| `fixture.downlight`        | ceiling                      | 8.5 cm round, white trim, 7 cm housing                                | light colour (2700 K, 4000 K, 6500 K)                                                                                                |
| `fixture.radiator`         | wall, bottom at 10 cm        | 75 × 60 cm, 14 cm from the wall (4 cm brackets: two panels)           | valve side                                                                                                                           |

The kitchen types and the kitchen's appliances are kind `furniture` (category "Kitchen"; the washing machine is
in "Bath room", below); the fixtures are kind `fixtures`
(categories "Lighting" and "Heating"), placed like furniture, each with its own stable placement id
([userdata.md](userdata.md#ids-and-names-of-new-furniture-and-fixtures)).

## Bath room types (#146)

From the owner's photos of the souterrain bath room (`2505beb2`, `5726165a`, `c3d258bf`). All are kind
`furniture`, category "Bath room"; the sanitary ware is the family `bath`. Sizes are defaults: each placement
sets its own. Everything is parametric (no mesh files); ceramic is the finish `ceramic.white`, chrome is lacquer
in its colour (D81).

| Type                        | Mounting             | Defaults                                                     | Basic besides colours and sizes        |
| --------------------------- | -------------------- | ------------------------------------------------------------ | -------------------------------------- |
| `bath.corner-tub`           | floor                | 140 × 140 cm, rim at 58, a quarter-round apron               | corner (the second wall left or right) |
| `bath.shower`               | floor                | 90 × 90 cm, glass 200 high on the front and one side, a rail | corner (the second wall left or right) |
| `bath.toilet`               | wall, bottom at 8 cm | 36 × 54 cm, seat at 43, the flush plate 58 above the seat    |                                        |
| `bath.vanity`               | wall, bottom at 30   | 60 × 46 cm, 55 high with its basin (5), two drawers, a tap   | drawers (1 to 3)                       |
| `bath.ledge`                | floor                | 200 × 20 cm, 105 high: a tiled wall in front of a wall       |                                        |
| `appliance.washing-machine` | floor                | 60 × 60 × 85 cm; from 120 cm of height a dryer stacked on it |                                        |

- A **corner piece** stands with its back and one side at walls: `corner` says which side. The tub's front is a
  quarter of an ellipse about that corner; the shower's glass is on the front and on the other side.
- The **ledge**'s tiles are lacquer in the tile's colour: the tile finishes are for floors and walls, not for
  parts. The tub's apron is plain for the same reason (the real one is a mosaic).
- Not types yet, for want of a photo that shows them whole: a mirror or cabinet over the washbasin, the wall
  cabinet beside the window. A door has no leaf (D82), so the hooks on the door have nowhere to hang.

## Street side (#147)

From the street-side reference images (`1bc79960`, `56b09dad`, `8808ee82`, `a8359a1e`; cited by id only). The
wheelie bin, the brick pillar at the end of the trellis fence and the kerb along the front garden are outdoor
types (below). The **satellite dish** hangs on the facade: an outdoor piece stands on the ground, so it is kind
`furniture` (family `appliance`, category "Facade"), mounted on a wall of the ground floor outside its rooms.
It shows and hides with that level, like the rest of the facade it hangs on.

| Type                       | Mounting               | Defaults                                                       | Basic besides colours and sizes |
| -------------------------- | ---------------------- | -------------------------------------------------------------- | ------------------------------- |
| `appliance.satellite-dish` | wall, bottom at 240 cm | 80 cm across, as deep; a bracket, the receiver on an arm; open |                                 |

## Patio and garden types (outdoor)

Identified in the owner's photos of the souterrain patio and garden. Kind `outdoor`, family `garden`: they stand on
the ground outside ([furniture.md](furniture.md#outdoor-pieces)). Their piece pages say so and offer no **Place**
(agents place them).

| Type                    | Category     | Defaults                                                             | Basic besides colours and sizes |
| ----------------------- | ------------ | -------------------------------------------------------------------- | ------------------------------- |
| `garden.pergola`        | Patio        | lean-to, 320 × 260 cm, 245 cm at the facade, 215 at the posts; open  | posts (2–4)                     |
| `garden.table`          | Patio        | 140 × 80 × 74 cm, dark metal frame, glass top                        |                                 |
| `garden.chair`          | Patio        | 58 × 62 × 105 cm, seat at 45 cm, mesh seat and back                  |                                 |
| `garden.bench`          | Patio        | 120 × 55 × 85 cm, seat at 45 cm, weathered slats, leaning back       |                                 |
| `garden.planter`        | Plants       | 38 cm across, pot 50 cm, plant 40 cm (zinc pot, lavender)            | shape (round, square)           |
| `garden.shrub`          | Plants       | 90 cm across, 110 cm high                                            | flowers (none, roses)           |
| `garden.grass`          | Plants       | 60 cm across, 120 cm high                                            |                                 |
| `garden.hedge`          | Plants       | 200 × 60 × 150 cm, a clipped run of rounded blocks; 50 cm to 12 m    |                                 |
| `garden.tree`           | Plants       | crown 350 cm across, 500 cm high, 180 cm of clear trunk; open        |                                 |
| `garden.rock-pile`      | Stone & wood | 160 × 80 × 60 cm of dry-laid natural stones                          |                                 |
| `garden.stepping-stone` | Stone & wood | 45 cm round, 3 cm thick; open                                        |                                 |
| `garden.log`            | Stone & wood | 80 cm long, 35 cm across, lying                                      |                                 |
| `garden.bird-house`     | Garden       | 150 cm high on a three-legged stand 60 cm wide, two-tier roof        |                                 |
| `garden.bin`            | Garden       | 58 × 73 × 107 cm, a 240 l wheelie bin, wheels and handle at the back |                                 |
| `garden.pillar`         | Stone & wood | 49 cm square, 120 cm high, clinker bricks under a concrete cap       |                                 |
| `garden.kerb`           | Stone & wood | 100 cm long, 15 thick, 25 high; up to 15 m; open (you step over it)  |                                 |
