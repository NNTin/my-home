// The import rules (import-layers.mjs) on made-up packages: a tree that follows every rule is
// clean, and one import that breaks each rule is reported. Offline: `node --test tools/eslint`.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import { Linter } from 'eslint';
import tseslint from 'typescript-eslint';
import { importLayers } from './import-layers.mjs';
import * as declared from './layers.mjs';

const LAYERS = {
  packages: [
    {
      root: 'apps/web',
      layers: [['low'], ['mid', 'side'], ['page'], ['(root)']],
      lazy: ['page/Page'],
    },
    { root: 'apps/api', layers: [['core', 'paths.ts'], ['db'], ['(root)']], lazy: [] },
    { root: 'packages/shared', layers: [['model'], ['(root)']], lazy: [] },
  ],
  sharedEntries: ['@my-home/shared', '@my-home/shared/finish-listing'],
  testData: ['data/homes', 'packages/shared/test-fixtures'],
};

/** A repository that follows every rule. Each kind of import that is allowed is in it once. */
const CLEAN = {
  'data/homes/home.json': '{}',
  'packages/shared/test-fixtures/mock-home.json': '{}',
  'packages/shared/src/index.ts': "export * from './model/home';",
  'packages/shared/src/model/home.ts': 'export const home = 1;',
  'apps/api/src/paths.ts': "export const folder = 'drizzle';",
  'apps/api/src/core/config.ts': 'export const config = 1;',
  'apps/api/src/db/client.ts':
    "import { folder } from '../paths';\nimport { config } from '../core/config';\nexport const db = [folder, config];",
  'apps/api/src/app.ts': "import { db } from './db/client';\nexport const app = db;",
  'apps/api/test/app.test.ts':
    "import { app } from '../src/app';\nimport home from '../../../data/homes/home.json';\nexport const t = [app, home];",
  'apps/web/budget.json': '{}',
  'apps/web/src/low/a.ts': 'export const a = 1;\nexport type A = number;',
  'apps/web/src/low/index.ts': "export * from './a';",
  'apps/web/src/mid/b.ts':
    "import { a } from '../low/a';\nimport type { A } from '../low';\nimport { home } from '@my-home/shared';\nimport listing from '@my-home/shared/finish-listing';\nexport const b: A = a + home + listing;",
  'apps/web/src/mid/plain.ts': 'export const plain = 1;',
  'apps/web/src/mid/b.test.ts':
    "import { b } from './b';\nimport { Page } from '../page/Page';\nimport { helper } from '../test/helper';\nimport home from '../../../../data/homes/home.json';\nimport mock from '../../../../packages/shared/test-fixtures/mock-home.json';\nexport const t = [b, Page, helper, home, mock, await import('../low/a')];",
  'apps/web/src/side/c.ts': "export { a } from '../low/a';\nexport type { A } from '../low/a';",
  'apps/web/src/test/helper.ts': "import { b } from '../mid/b';\nexport const helper = b;",
  'apps/web/src/page/types.ts': 'export type PageProps = { n: number };',
  'apps/web/src/page/part.ts': "import { b } from '../mid/b';\nexport const part = b;",
  'apps/web/src/page/Page.tsx':
    "import budget from '../../budget.json';\nimport { part } from './part';\nimport type { PageProps } from './types';\nexport const Page = (p: PageProps) => [p, part, budget];",
  'apps/web/src/main.tsx':
    "import { b } from './mid/b';\nimport type { PageProps } from './page/types';\ntype Chunk = typeof import('./page/Page');\nexport const load = (): Promise<Chunk> => import('./page/Page');\nexport const props: PageProps = { n: b };",
};

const ORDER = 'import-layers/order';
const CYCLE = 'import-layers/no-cycle';

/** One broken rule each: the files that differ from the clean tree, and what must be reported. */
const BROKEN = [
  {
    name: 'a folder imports a higher layer',
    files: {
      'apps/web/src/low/a.ts': "import { plain } from '../mid/plain';\nexport const a = plain;",
    },
    expect: [['apps/web/src/low/a.ts', ORDER, 'order']],
  },
  {
    name: 'import type counts',
    files: {
      'apps/web/src/low/a.ts':
        "import type { PageProps } from '../page/types';\nexport const a = 1;\nexport type A = PageProps;",
    },
    expect: [['apps/web/src/low/a.ts', ORDER, 'order']],
  },
  {
    name: 'a re-export counts',
    files: { 'apps/web/src/low/index.ts': "export * from './a';\nexport * from '../mid/plain';" },
    expect: [['apps/web/src/low/index.ts', ORDER, 'order']],
  },
  {
    name: 'folders of one layer do not import each other',
    files: { 'apps/web/src/side/c.ts': "export { b } from '../mid/b';" },
    expect: [['apps/web/src/side/c.ts', ORDER, 'order']],
  },
  {
    name: 'a folder that is in no layer',
    files: { 'apps/web/src/fresh/d.ts': 'export const d = 1;' },
    expect: [['apps/web/src/fresh/d.ts', ORDER, 'undeclared']],
  },
  {
    name: 'an import from a folder that is in no layer',
    files: {
      'apps/web/src/fresh/d.ts': 'export const d = 1;',
      'apps/web/src/main.tsx': "export { d } from './fresh/d';",
    },
    expect: [
      ['apps/web/src/fresh/d.ts', ORDER, 'undeclared'],
      ['apps/web/src/main.tsx', ORDER, 'undeclared'],
    ],
  },
  {
    name: 'import() of a module that is no lazy entry',
    files: { 'apps/web/src/mid/b.ts': "export const b = () => import('../low/a');" },
    expect: [['apps/web/src/mid/b.ts', ORDER, 'notLazy']],
  },
  {
    name: 'typeof import() of a module that is no lazy entry',
    files: {
      'apps/web/src/mid/b.ts': "export type B = typeof import('../low/a');\nexport const b = 1;",
    },
    expect: [['apps/web/src/mid/b.ts', ORDER, 'notLazy']],
  },
  {
    name: 'import() of an expression',
    files: { 'apps/web/src/mid/b.ts': 'export const b = (name: string) => import(name);' },
    expect: [['apps/web/src/mid/b.ts', ORDER, 'notLazy']],
  },
  {
    name: 'a static import of a lazy entry',
    files: { 'apps/web/src/main.tsx': "export { Page } from './page/Page';" },
    expect: [['apps/web/src/main.tsx', ORDER, 'lazyEntry']],
  },
  {
    name: 'a static import of a lazy entry inside its folder',
    files: { 'apps/web/src/page/other.ts': "export { Page } from './Page';" },
    expect: [['apps/web/src/page/other.ts', ORDER, 'lazyEntry']],
  },
  {
    name: 'a static import from a folder that is not lazy into a lazy one',
    files: { 'apps/web/src/main.tsx': "export { part } from './page/part';" },
    expect: [['apps/web/src/main.tsx', ORDER, 'lazyFolder']],
  },
  {
    name: 'a relative import that leaves its package',
    files: {
      'apps/web/src/mid/b.ts': "export { config as b } from '../../../api/src/core/config';",
    },
    expect: [['apps/web/src/mid/b.ts', ORDER, 'leaves']],
  },
  {
    name: 'a production file reads the homes by path',
    files: {
      'apps/web/src/mid/b.ts':
        "import home from '../../../../data/homes/home.json';\nexport const b = home;",
    },
    expect: [['apps/web/src/mid/b.ts', ORDER, 'leaves']],
  },
  {
    name: 'a test file leaves its package for more than the homes and the fixture',
    files: {
      'apps/api/test/app.test.ts':
        "export { home } from '../../../packages/shared/src/model/home';",
    },
    expect: [['apps/api/test/app.test.ts', ORDER, 'leaves']],
  },
  {
    name: '@my-home/shared by a path that is no entry',
    files: {
      'apps/web/src/mid/b.ts': "export { home as b } from '@my-home/shared/src/model/home';",
    },
    expect: [['apps/web/src/mid/b.ts', ORDER, 'sharedEntry']],
  },
  {
    name: 'an app imports the other app',
    files: { 'apps/web/src/mid/b.test.ts': "export { app } from '@my-home/api';" },
    expect: [['apps/web/src/mid/b.test.ts', ORDER, 'app']],
  },
  {
    name: 'a production file imports a test file',
    files: { 'apps/web/src/mid/b.ts': "export { t as b } from './b.test';" },
    expect: [['apps/web/src/mid/b.ts', ORDER, 'testFile']],
  },
  {
    name: 'a production file imports a test helper',
    files: { 'apps/web/src/page/part.ts': "export { helper as part } from '../test/helper';" },
    expect: [['apps/web/src/page/part.ts', ORDER, 'testFile']],
  },
  {
    name: 'a file of src named in a layer is held to it',
    files: {
      'apps/api/src/paths.ts': "import { app } from './app';\nexport const folder = String(app);",
    },
    // paths.ts → app.ts → db/client.ts → paths.ts is a cycle as well.
    expect: [
      ['apps/api/src/paths.ts', ORDER, 'order'],
      ['apps/api/src/paths.ts', CYCLE, 'cycle'],
      ['apps/api/src/app.ts', CYCLE, 'cycle'],
      ['apps/api/src/db/client.ts', CYCLE, 'cycle'],
    ],
  },
  {
    name: 'a file cycle through import type alone',
    files: {
      'apps/web/src/low/a.ts':
        "import type { E } from './e';\nexport const a = 1;\nexport type A = E;",
      'apps/web/src/low/e.ts': "import type { A } from './a';\nexport type E = A | string;",
    },
    expect: [
      ['apps/web/src/low/a.ts', CYCLE, 'cycle'],
      ['apps/web/src/low/e.ts', CYCLE, 'cycle'],
    ],
  },
];

const roots = [];
after(() => roots.forEach((root) => rmSync(root, { recursive: true, force: true })));

/** Writes the tree to a folder of its own and lints every source file of it. */
function lint(files) {
  const repo = mkdtempSync(path.join(tmpdir(), 'import-layers-'));
  roots.push(repo);
  for (const [name, text] of Object.entries(files)) {
    mkdirSync(path.dirname(path.join(repo, name)), { recursive: true });
    writeFileSync(path.join(repo, name), `${text}\n`);
  }
  const config = [
    {
      files: ['**/*.{ts,tsx}'],
      languageOptions: { parser: tseslint.parser, parserOptions: { ecmaFeatures: { jsx: true } } },
      plugins: { 'import-layers': importLayers({ repo, ...LAYERS }) },
      rules: { [ORDER]: 'error', [CYCLE]: 'error' },
    },
  ];
  const linter = new Linter({ cwd: repo });
  const reports = [];
  for (const name of Object.keys(files).filter((file) => /\.tsx?$/.test(file)))
    for (const message of linter.verify(files[name], config, { filename: path.join(repo, name) }))
      reports.push([name, message.ruleId, message.messageId ?? message.message]);
  return reports.sort();
}

describe('the import rules', () => {
  it('report nothing in a tree that follows them', () => {
    assert.deepEqual(lint(CLEAN), []);
  });

  for (const { name, files, expect } of BROKEN)
    it(`report ${name}`, () => {
      assert.deepEqual(lint({ ...CLEAN, ...files }), [...expect].sort());
    });
});

describe('the layers of the repository (layers.mjs)', () => {
  const repo = fileURLToPath(new URL('../..', import.meta.url));

  it('name every folder once, and lazy entries that are files', () => {
    for (const pkg of declared.packages) {
      const names = pkg.layers.flat();
      assert.deepEqual(
        names.filter((n, i) => names.indexOf(n) !== i),
        [],
        `${pkg.root}: named twice`,
      );
      assert.equal(pkg.layers.at(-1).join(), '(root)', `${pkg.root}: (root) is the last layer`);
      for (const entry of pkg.lazy) {
        assert.ok(names.includes(entry.split('/')[0]), `${pkg.root}: ${entry} is in no layer`);
        assert.ok(
          ['.ts', '.tsx'].some((ext) => existsSync(path.join(repo, pkg.root, 'src', entry + ext))),
          `${pkg.root}: the lazy entry ${entry} is no file`,
        );
      }
    }
  });

  it('are the tables of docs/architecture.md', () => {
    const page = readFileSync(path.join(repo, 'docs/architecture.md'), 'utf8');
    const names = (cell) => [...cell.matchAll(/`([^`]+)`/g)].map((match) => match[1]);
    /** The first column's or the second's names, per row of the table under a heading. */
    const table = (heading, column) => {
      const start = page.indexOf(`\n${heading}\n`);
      assert.notEqual(start, -1, `no section ${heading}`);
      const rows = page
        .slice(start + heading.length + 2)
        .split(/\n#+ /)[0]
        .split('\n');
      return rows
        .filter((row) => /^\| *(\d|`)/.test(row))
        .map((row) => names(row.split('|')[column]));
    };
    for (const pkg of declared.packages)
      assert.deepEqual(table(`### \`${pkg.root}\``, 2), pkg.layers, `the layers of ${pkg.root}`);
    assert.deepEqual(
      table('## Lazy entries', 1).flat(),
      declared.packages.flatMap((pkg) => pkg.lazy),
      'the lazy entries',
    );
  });

  it('are excepted nowhere: no eslint-disable names these rules, and none is without a rule', () => {
    // git grep ends with 1 when it finds nothing.
    const found = spawnSync(
      'git',
      ['grep', '-n', '-I', 'eslint-disable', '--', 'apps', 'packages/shared', 'tools'],
      { cwd: repo, encoding: 'utf8' },
    );
    assert.ok(found.status === 0 || found.status === 1, found.stderr);
    const lines = found.stdout.split('\n').filter(Boolean);
    const excepted = lines.filter((line) => {
      if (line.startsWith('tools/eslint/')) return false;
      const rules = line.replace(/^.*eslint-disable(-next-line|-line)?/, '').replace(/\*\/.*$/, '');
      return rules.trim() === '' || rules.includes('import-layers');
    });
    assert.deepEqual(excepted, []);
  });
});
