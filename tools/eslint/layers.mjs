/**
 * The folders of each package's `src`, in layers, lowest first (docs/architecture.md). The rules
 * that read this table are in `import-layers.mjs`.
 *
 * - A folder imports only folders of a line above its own. Folders of one line do not import each
 *   other. `import type` and re-exports are imports.
 * - `(root)` is the files directly in `src`. One of them can be named to give it a line of its
 *   own, as `paths.ts` of the api, which has to stay where it is.
 * - A folder that is not named here fails the lint: place it, in the same pull request.
 * - `lazy` names the modules that are loaded with `import()`, each the entry of a chunk of its
 *   own. An `import()` of anything else fails, and so does a static import that would put a lazy
 *   folder's code into a folder that is not lazy.
 *
 * There is no list of exceptions and none is to be added: an import that does not fit says that
 * a file is in the wrong folder.
 */
export const packages = [
  {
    root: 'apps/web',
    layers: [
      ['geom', 'keys', 'loading', 'routing', 'api', 'beautiful'],
      ['hud'],
      ['catalog'],
      ['builder'],
      ['editor'],
      ['finishes', 'lighting'],
      ['placements', 'editMode', 'quality', 'compass', 'measure'],
      ['photos'],
      ['walk'],
      ['overlay'],
      ['scene'],
      ['views'],
      ['render-mode', 'catalog-page', 'hud-measure'],
      ['piece-page'],
      ['(root)'],
    ],
    lazy: [
      'beautiful/render-beautiful',
      'views/render-views',
      'render-mode/render-path',
      'render-mode/render-denoise',
      'catalog-page/CatalogPage',
      'hud-measure/hud-measure',
      'piece-page/PiecePage',
    ],
  },
  {
    root: 'apps/api',
    layers: [['core', 'paths.ts'], ['photos'], ['db'], ['routes'], ['(root)']],
    lazy: [],
  },
  {
    root: 'packages/shared',
    layers: [['finishes'], ['catalog'], ['model'], ['(root)']],
    lazy: [],
  },
];

/** What another package may import of `@my-home/shared`: its entries, nothing inside it. */
export const sharedEntries = ['@my-home/shared', '@my-home/shared/finish-listing'];

/** What a test file may read outside its package: the homes and the test fixture. */
export const testData = ['data/homes', 'packages/shared/test-fixtures'];
