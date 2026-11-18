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
(`packages/shared/src/catalog`); a type under the wrong kind is not found. The piece page shows the name and
description for now; #43 adds the 3D inspector, #45 the uses.

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

In jsdom tests the renderer module is mocked; no test needs WebGL.

## Routing

There is no router library: `apps/web/src/routing/`.

| Export                          | What                                                                                          |
| ------------------------------- | --------------------------------------------------------------------------------------------- |
| `Route`, `parseRoute(pathname)` | the page of a path (see the table above)                                                      |
| `href(route, query?)`           | the path of a route with a query (empty values left out)                                      |
| `keptQuery(search?)`            | `{ home }` from the address: what every link carries                                          |
| `navigate(to, { replace })`     | `history.pushState` (or `replaceState`) and a re-render; a new page starts at the top         |
| `useRoute()`                    | the current route, following `navigate()` and `popstate` (back and forward)                   |
| `Link`                          | an `<a href>`; a plain left click navigates in place, modified clicks are left to the browser |
| `useDocumentTitle(page?)`       | sets the title                                                                                |

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
$S/catalog-smoke.sh staging                                    # desktop and phone: deep links, reload, back
$S/screenshot.sh staging --path '/catalog' --out /tmp/catalog.png
$S/screenshot.sh staging --viewport 390x844 --touch --path '/catalog' --out /tmp/catalog-phone.png
```

Tests: `apps/web/src/routing/routing.test.tsx`, `apps/web/src/catalog-page/Catalog.test.tsx`,
`apps/web/src/catalog-page/thumbnails.test.ts`, `App.test.tsx` § pages and `Mobile.test.tsx`.
