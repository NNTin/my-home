# Architecture: layers and import rules

The folders of each package import each other in one direction only. The order is declared once, in
[`tools/eslint/layers.mjs`](../tools/eslint/layers.mjs), and `pnpm lint` checks every import against it (the
commit hook and CI's `check` job). This page explains the order and the rules. The tables below repeat the
file, and a test fails when they differ from it.

Why: before #225, 17 of the 22 folders of `apps/web/src` formed one import cycle. A folder said nothing about
what its files could depend on, and a lazy chunk could grow by one import from the wrong side. Now a folder's
place in the table says what it may use, and a file that needs more is in the wrong folder.

## The layers

A folder imports only folders of a layer with a lower number. Folders of one layer do not import each other.
`(root)` is the files directly in `src`.

### `apps/web`

| Layer | Folders                                                   | What is there                                                 |
| ----- | --------------------------------------------------------- | ------------------------------------------------------------- |
| 0     | `geom`, `keys`, `loading`, `routing`, `api`, `beautiful`  | leaves: vectors and plan maths, the api client, the addresses |
| 1     | `hud`                                                     | the Sakuga wrappers                                           |
| 2     | `catalog`                                                 | the piece modules                                             |
| 3     | `builder`                                                 | home model to draw list                                       |
| 4     | `editor`                                                  | the furniture editor's maths                                  |
| 5     | `finishes`, `lighting`                                    | materials and textures; lamps and the light rig               |
| 6     | `placements`, `editMode`, `quality`, `compass`, `measure` |                                                               |
| 7     | `photos`                                                  |                                                               |
| 8     | `walk`                                                    |                                                               |
| 9     | `overlay`                                                 | the viewer's HUD                                              |
| 10    | `scene`                                                   | composes the 3D view                                          |
| 11    | `views`                                                   | the named views (lazy)                                        |
| 12    | `render-mode`, `catalog-page`, `hud-measure`              | lazy pages and render mode                                    |
| 13    | `piece-page`                                              | lazy                                                          |
| 14    | `(root)`                                                  | `main.tsx`, `App.tsx`, `Viewer.tsx`                           |

### `apps/api`

| Layer | Folders            | What is there                                                 |
| ----- | ------------------ | ------------------------------------------------------------- |
| 0     | `core`, `paths.ts` | configuration, errors, the actor; the folders the api reads   |
| 1     | `photos`           | image handling                                                |
| 2     | `db`               | the database                                                  |
| 3     | `routes`           | the HTTP routes                                               |
| 4     | `(root)`           | `app.ts` and the programs (`server`, `migrate`, `seed`, more) |

`paths.ts` is a file of `src` with a layer of its own. It finds the migrations and the homes from its own place
(`import.meta.url`), and the bundle in `dist/` is at the same depth as `src/`: it cannot move into a folder.

### `packages/shared`

| Layer | Folders    | What is there                                               |
| ----- | ---------- | ----------------------------------------------------------- |
| 0     | `finishes` | the finish library                                          |
| 1     | `catalog`  | the catalogue types                                         |
| 2     | `model`    | the home model, the seed, the api's shapes                  |
| 3     | `(root)`   | `index.ts`, the entry `.` (`./finish-listing` is the other) |

`packages/sakuga-vfx` is upstream's code and outside these rules (ESLint ignores it).

## Lazy entries

These modules are loaded with `import()`, and each is the entry of a chunk of its own (`docs/views.md`,
`docs/render-mode.md`, `docs/catalog.md`, `docs/hud.md`):

| Entry                        | Loaded by               |
| ---------------------------- | ----------------------- |
| `beautiful/render-beautiful` | `scene/Frame.tsx`       |
| `views/render-views`         | `Viewer.tsx`            |
| `render-mode/render-path`    | `views/RenderMode.tsx`  |
| `render-mode/render-denoise` | `render-mode/tracer.ts` |
| `catalog-page/CatalogPage`   | `App.tsx`               |
| `hud-measure/hud-measure`    | `scene/Scene.tsx`       |
| `piece-page/PiecePage`       | `App.tsx`               |

A folder with an entry is a lazy folder. An `import()` goes where it has to, whatever the layers: the views
load render mode from below it.

## The rules

`import-layers/order`, for every file of the three packages:

1. **No relative import leaves its package.** A test file may read `data/homes/` and
   `packages/shared/test-fixtures/`, nothing else. A file beside `src` in the same package (`bundle-budget.json`)
   is inside.
2. **`@my-home/shared` only by its entries**, `@my-home/shared` and `@my-home/shared/finish-listing`. The apps
   never import each other.
3. **No production file imports a test file** (`*.test.ts`, `src/test/`, `test-setup.ts`, a package's `test/`).

And for the production files of `src` (test files are held to rules 1 to 3 only: the catalogue's tests use
`scene/batches` on purpose):

4. **Its folder is in the table.** A new folder is placed in the pull request that adds it.
5. **It imports only lower layers.** `import type` and `export … from` count.
6. **`import()` only of a lazy entry**, and `typeof import()` likewise.
7. **No static import of a lazy entry, and none from a folder that is not lazy into a lazy one.** It would put
   the chunk into the main one. `import type` is allowed where the layers allow it: the whole
   declaration, since `import { type A }` keeps the import itself (`verbatimModuleSyntax`).

`import-layers/no-cycle`:

8. **No import cycle between files**, `import type` counted. `import()` does not count: it is the lazy boundary.

## No exceptions

The rules have no options, and there is no list of allowed imports. A test fails when an `eslint-disable`
comment names one of them, or names no rule at all. If an import seems to need an exception, a file is in the
wrong folder: move it, or move the part of it that both sides need into a lower folder (#225 did this for the
52 imports that broke the order).

What to do with a report:

- **"may not import"**: the importing file belongs higher, or the imported thing belongs lower. A type that many
  folders share goes to the lowest folder that names it (`geom/types.ts`, `builder/types.ts`).
- **"is in no layer"**: add the folder to `layers.mjs`, on the lowest line that is above everything it imports,
  and to the table on this page.
- **"only a declared lazy entry"**: a new chunk is a decision (`apps/web/bundle-budget.json`). Add its entry to
  `lazy` with the budget.
- **"Import cycle"**: the message names the files. Move what both need into a file that imports neither.

## The rule itself

- [`tools/eslint/layers.mjs`](../tools/eslint/layers.mjs): the table.
- [`tools/eslint/import-layers.mjs`](../tools/eslint/import-layers.mjs): the two rules, an ESLint plugin of the
  repository (no dependency). It resolves `.ts`, `.tsx` and `index.ts` itself.
- [`tools/eslint/import-layers.test.mjs`](../tools/eslint/import-layers.test.mjs): one made-up tree that follows
  every rule and one per rule that breaks it, and the checks of the table, of this page and of the disable
  comments. `pnpm test` runs it first (`node --test`, about 3 s, offline).

A file that finds others from its own place (`import.meta.url`, `import.meta.glob`) is not seen by the rules or
by `tsc`: `catalog/registry.ts` (`./*/*/index.ts`), `finishes/urls.ts` (`./textures/*/*.webp`), the api's
`paths.ts`, and the fixtures of the shared package's tests. Run their tests after a move.
