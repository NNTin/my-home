# The catalogue pages

Next to the 3D viewer the app has pages of its own, each with an address that can be linked to, reloaded and
reached with the browser's back and forward buttons.

| Address                    | Page                                                    |
| -------------------------- | ------------------------------------------------------- |
| `/`                        | the viewer                                              |
| `/catalog`, `/catalog/`    | the catalogue: every piece type, by kind                |
| `/catalog/<kind>/<typeId>` | one piece type, e.g. `/catalog/furniture/furniture.bed` |
| anything else              | "Page not found", with a link home                      |

`<kind>` is a `CatalogKind` (`openings`, `furniture`) and `<typeId>` a known type of that kind
(`packages/shared/src/catalog`); a type under the wrong kind is not found. The piece page is described
[below](#the-piece-page); #45 adds the uses.

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
- A section per kind: "Windows & doors" (windows, doors and gates in catalogue order) and "Furniture" (by
  category, then by name, as the furniture panel).
- Each card shows the thumbnail, name, short description and **N uses**, from `GET /api/catalog/usage`: the uses
  in this environment over all its homes. While they load the card says "…"; if the api fails, the counts are
  hidden with a short notice and the page still works.
- The card is a link named "<Type name>, N uses", with its description as the link's description.
- On a phone (`useLayoutMode`): one column, safe-area insets, cards and controls at least 44 px tall, and no
  sideways scrolling upright (390×844) or across (844×390).

## The piece page

`/catalog/<kind>/<typeId>` (`apps/web/src/piece-page/`, a lazy chunk with its own CSS) shows one type on its
own. **Nothing on it is saved**: it sends no request but GETs, whatever is changed.

- **Header**: **← Catalogue**, the name, the kind and family (and the furniture category); the description below.
- **Layout**: on a desktop the preview on the left (about 60 %) and the panel on the right; on a phone held
  upright the preview on top (40 % of the height) and the panel below as one scrolling page; on a phone held
  across (844×390) side by side again, the preview as high as the screen allows. Controls are at least 44 px.
- **3D inspector** (`Inspector.tsx`): an R3F canvas of `pieces.get(id).parts(values, ctx)` with the
  [preview context](#thumbnails). An opening stands in a short wall stub (`wallStub`: wall beside, over and
  under the hole, down to the floor), furniture and gates on the ground. Orbit and zoom (with damping), framed
  to fit whenever the parameters change (keeping the direction), **Reset view**, and frames drawn on demand
  only. Wall openings get their preview `sill` in `ctx` (`PieceContext.sill`).
- **Dimensions**: the piece module's `dimensions(values, ctx)` as lines with end ticks and labels in cm with
  one decimal (e.g. "92.5 cm"); the **Dimensions** checkbox hides them. The labels are plain DOM over the
  canvas placed on every frame drawn (not drei `Html`, see `RoomLabels`), at most 8 per piece. The same list
  is shown as text under the preview.
- **Section** (openings; **3D / Section** swaps the views): `sectionOf(parts, ctx)` cuts the parts with the
  vertical plane through the opening's centre, perpendicular to the wall, into rectangles in (depth, height)
  tagged by role, plus the wall stub; a piece may give its own `section()`. It is drawn as SVG
  (`SectionView.tsx`) with a legend by role and the wall depth, frame depth, glass (or panel) depth, sill height
  and opening height in cm. It shows what the design draws today (frame and glass or panel), noted as
  "simplified design".
- **Playground** (`Playground.tsx`), generated from the type's `params`:
  - a basic colour: a colour picker, a hex field (`#rgb` or `#rrggbb`, lower-cased) and a swatch; any colour;
  - a basic length: a slider in 1 cm steps and a field in cm with one decimal (`92,5` and `92.5` both work),
    with its limits ("80.0–220.0 cm"); a value beyond them says so and is not applied;
  - a basic count: − / value / + within its limits;
  - **Reset to defaults**; openings show `openingFitIssues` against the preview hole.
  - The design parameters are listed read-only under "Design (changed only by a pull request)".
- **`?p=`** holds the playground's overrides (base64url JSON, written a moment after the last change, replacing
  the history entry), so a playground state can be shared. It is used only if it is valid against
  `basicOverridesSchema(type)`; otherwise the defaults are shown.

## Thumbnails

Thumbnails are drawn in the browser from the type's own geometry, so they always show the design as it is in
git. `apps/web/src/catalog-page/thumbnails.ts`:

- **One renderer.** A single offscreen three.js `WebGLRenderer` (256×256, transparent; `renderThumbnail.ts`)
  draws each type's `parts(defaultParams(type), preview)` with a fixed light and a three-quarter camera, **one
  at a time**. There is never a canvas per card: phones allow only a few WebGL contexts per page. Furniture is
  drawn at its default size, an opening in its type's `preview` hole.
- **Lazy.** A card asks for its thumbnail when it comes near the screen (an `IntersectionObserver` per card),
  and shows the type's icon until it is ready, or for good where WebGL is missing.
- **Cached.** Each image is kept in the Cache Storage API (cache `my-home-thumbnails`) under
  `thumb:<typeId>:<hash>` (stored as a request to `/__thumbnails/<key>`, never fetched), where `hash` is a short
  hash (FNV-1a) of `JSON.stringify(parts)`. A design change gives new parts and so a new key: the old image is
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

```sh
S=.claude/skills/my-home-environments/scripts
$S/catalog-smoke.sh staging                                    # desktop and phone: deep links, reload, back,
                                                               # every piece page, sections, the playground
$S/screenshot.sh staging --path '/catalog' --out /tmp/catalog.png
$S/screenshot.sh staging --viewport 390x844 --touch --path '/catalog' --out /tmp/catalog-phone.png
```

Tests: `apps/web/src/routing/routing.test.tsx`, `apps/web/src/catalog-page/Catalog.test.tsx`,
`apps/web/src/catalog-page/thumbnails.test.ts`, `apps/web/src/piece-page/*.test.ts(x)` (playground, section,
page), `apps/web/src/catalog/dimensions.test.ts`, `App.test.tsx` § pages and `Mobile.test.tsx`. The piece page's
tests mock `Inspector` (no WebGL in jsdom); the section is SVG and is tested as it is.
