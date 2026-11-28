/**
 * The import rules of the repository as an ESLint plugin (docs/architecture.md), fed with the
 * layers of `layers.mjs`. Two rules:
 *
 * - `order`: the package rules (no relative import out of a package, `@my-home/shared` by its
 *   entries, no production file imports a test file) for every file, and for the production files
 *   of `src` the layers and the lazy entries.
 * - `no-cycle`: no production file of `src` is in an import cycle, `import type` counted.
 *
 * `import type`, re-exports and `import()` are all imports here. Nothing is configured per file
 * and nothing can be excepted: the rules have no options.
 */
import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';

const EXTENSIONS = ['', '.ts', '.tsx', '.mts', '.mjs', '.js', '/index.ts', '/index.tsx'];
const ROOT = '(root)';
const posix = (p) => p.split(path.sep).join('/');

/** @param {{ repo: string, packages: {root: string, layers: string[][], lazy: string[]}[], sharedEntries: string[], testData: string[] }} options */
export function importLayers({ repo, packages, sharedEntries, testData }) {
  const isFile = new Map();
  const fileExists = (file) => {
    if (!isFile.has(file))
      isFile.set(file, fs.statSync(file, { throwIfNoEntry: false })?.isFile() === true);
    return isFile.get(file);
  };
  /** The file a relative specifier names, or the path itself when no file is there. */
  const resolve = (from, specifier) => {
    const base = path.resolve(path.dirname(from), specifier.replace(/[?#].*$/, ''));
    for (const extension of EXTENSIONS) if (fileExists(base + extension)) return base + extension;
    return base;
  };

  const known = packages.map((pkg) => {
    const layerOf = new Map();
    pkg.layers.forEach((folders, index) => folders.forEach((folder) => layerOf.set(folder, index)));
    return {
      ...pkg,
      dir: path.resolve(repo, pkg.root),
      layerOf,
      lazyFolders: new Set(pkg.lazy.map((entry) => entry.split('/')[0])),
      lazyEntries: new Set(pkg.lazy),
    };
  });
  const inside = (dir, file) => file === dir || file.startsWith(dir + path.sep);
  const packageOf = (file) => known.find((pkg) => inside(pkg.dir, file));

  /** Where a file stands in its package. */
  const place = (pkg, file) => {
    const rel = posix(path.relative(pkg.dir, file));
    const test =
      /\.test\.[cm]?[jt]sx?$/.test(rel) ||
      rel.startsWith('test/') ||
      rel.startsWith('src/test/') ||
      /^src\/test-setup\.[jt]s$/.test(rel);
    const inSrc = rel.startsWith('src/');
    const parts = rel.split('/');
    return {
      rel,
      test,
      /** A file of `src` that is not a test: the layers hold for it. */
      production: inSrc && !test,
      folder: !inSrc
        ? undefined
        : parts.length > 2
          ? parts[1]
          : pkg.layerOf.has(parts[1])
            ? parts[1]
            : ROOT,
      /** As a lazy entry is written: its path in `src` without the extension. */
      module: inSrc ? rel.slice(4).replace(/\.tsx?$/, '') : undefined,
    };
  };

  const order = {
    meta: {
      type: 'problem',
      docs: { description: 'The layers of each package, its lazy entries and the package rules' },
      schema: [],
      messages: {
        undeclared:
          "The folder '{{folder}}' of {{pkg}}/src is in no layer. Place it in tools/eslint/layers.mjs.",
        order:
          "'{{from}}' (layer {{fromLayer}}) may not import '{{to}}' (layer {{toLayer}}): a folder imports only lower layers (tools/eslint/layers.mjs). Move the file that is in the wrong folder.",
        notLazy:
          "import() of '{{target}}': only a declared lazy entry is loaded with import() (tools/eslint/layers.mjs).",
        lazyEntry:
          "'{{target}}' is a lazy entry: load it with import(). A static import puts its chunk into this one.",
        lazyFolder:
          "'{{from}}' is not lazy and may take only types from the lazy folder '{{to}}': a static import pulls its chunk into the main one.",
        leaves:
          'A relative import may not leave its package ({{pkg}}). Import another package by its name.',
        testFile: "A production file may not import a test file or a test helper ('{{target}}').",
        sharedEntry: "'{{specifier}}' is not an entry of @my-home/shared: import {{entries}}.",
        app: "'{{specifier}}': the apps do not import each other. What both need is in @my-home/shared.",
      },
    },
    create(context) {
      const file = context.filename;
      const pkg = packageOf(file);
      if (!pkg) return {};
      const from = place(pkg, file);
      const declared = (folder) => pkg.layerOf.has(folder);

      const check = (node, source, kind) => {
        if (!source || typeof source.value !== 'string') {
          if (kind === 'dynamic' && from.production)
            context.report({ node, messageId: 'notLazy', data: { target: 'an expression' } });
          return;
        }
        const specifier = source.value;
        if (!specifier.startsWith('.')) {
          if (/^@my-home\/(web|api)(\/|$)/.test(specifier))
            context.report({ node: source, messageId: 'app', data: { specifier } });
          else if (/^@my-home\/shared(\/|$)/.test(specifier) && !sharedEntries.includes(specifier))
            context.report({
              node: source,
              messageId: 'sharedEntry',
              data: { specifier, entries: sharedEntries.map((e) => `'${e}'`).join(' or ') },
            });
          return;
        }
        const target = resolve(file, specifier);
        if (!inside(pkg.dir, target)) {
          const data =
            !from.production && testData.some((dir) => inside(path.resolve(repo, dir), target));
          if (!data) context.report({ node: source, messageId: 'leaves', data: { pkg: pkg.root } });
          return;
        }
        if (!from.production) return;
        const to = place(pkg, target);
        if (to.test) {
          context.report({ node: source, messageId: 'testFile', data: { target: to.rel } });
          return;
        }
        if (to.folder === undefined) return;
        const entry = pkg.lazyEntries.has(to.module);
        if (kind === 'dynamic') {
          if (!entry)
            context.report({ node: source, messageId: 'notLazy', data: { target: to.module } });
          return;
        }
        if (to.folder !== from.folder) {
          if (!declared(to.folder)) {
            context.report({
              node: source,
              messageId: 'undeclared',
              data: { folder: to.folder, pkg: pkg.root },
            });
            return;
          }
          if (!declared(from.folder)) return;
          const fromLayer = pkg.layerOf.get(from.folder);
          const toLayer = pkg.layerOf.get(to.folder);
          if (toLayer >= fromLayer) {
            context.report({
              node: source,
              messageId: 'order',
              data: { from: from.folder, to: to.folder, fromLayer, toLayer },
            });
            return;
          }
        }
        if (kind !== 'value') return;
        if (entry)
          context.report({ node: source, messageId: 'lazyEntry', data: { target: to.module } });
        else if (pkg.lazyFolders.has(to.folder) && !pkg.lazyFolders.has(from.folder))
          context.report({
            node: source,
            messageId: 'lazyFolder',
            data: { from: from.folder, to: to.folder },
          });
      };

      const typeOnly = (node) =>
        node.importKind === 'type' ||
        node.exportKind === 'type' ||
        (node.specifiers?.length > 0 &&
          node.specifiers.every((s) => s.importKind === 'type' || s.exportKind === 'type'));

      return {
        Program(node) {
          if (from.production && !declared(from.folder))
            context.report({
              node,
              loc: { line: 1, column: 0 },
              messageId: 'undeclared',
              data: { folder: from.folder, pkg: pkg.root },
            });
        },
        ImportDeclaration: (node) => check(node, node.source, typeOnly(node) ? 'type' : 'value'),
        ExportNamedDeclaration: (node) =>
          node.source && check(node, node.source, typeOnly(node) ? 'type' : 'value'),
        ExportAllDeclaration: (node) => check(node, node.source, typeOnly(node) ? 'type' : 'value'),
        TSImportEqualsDeclaration: (node) =>
          node.moduleReference.type === 'TSExternalModuleReference' &&
          check(node, node.moduleReference.expression, typeOnly(node) ? 'type' : 'value'),
        ImportExpression: (node) =>
          check(node, node.source.type === 'Literal' ? node.source : undefined, 'dynamic'),
        // `typeof import('…')`: the type of what an import() gives, so held to the same rule.
        TSImportType: (node) => {
          const source = node.source ?? node.argument?.literal ?? node.argument;
          check(node, source?.type === 'Literal' ? source : undefined, 'dynamic');
        },
      };
    },
  };

  /** The static imports between the production files of a package's `src`, and its cycles. */
  const graphs = new Map();
  const STALE = 30_000;
  const graphOf = (pkg) => {
    const cached = graphs.get(pkg);
    if (cached && Date.now() - cached.at < STALE) return cached;
    const edges = new Map();
    const walk = (dir) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const file = path.join(dir, entry.name);
        if (entry.isDirectory()) walk(file);
        else if (/\.tsx?$/.test(entry.name) && place(pkg, file).production) edges.set(file, []);
      }
    };
    const src = path.join(pkg.dir, 'src');
    if (fs.existsSync(src)) walk(src);
    for (const [file, targets] of edges) {
      const text = fs.readFileSync(file, 'utf8');
      for (const imported of ts.preProcessFile(text, true, false).importedFiles) {
        if (!imported.fileName.startsWith('.')) continue;
        // `import('…')` and `typeof import('…')` are the lazy boundary, not a static import.
        if (/\(\s*$/.test(text.slice(Math.max(0, imported.pos - 40), imported.pos))) continue;
        const target = resolve(file, imported.fileName);
        if (edges.has(target) && target !== file) targets.push(target);
      }
    }
    // Tarjan's strongly connected components: a component of two files or more is a cycle.
    const component = new Map();
    const index = new Map();
    const low = new Map();
    const stack = [];
    const onStack = new Set();
    let next = 0;
    const visit = (v) => {
      index.set(v, next);
      low.set(v, next++);
      stack.push(v);
      onStack.add(v);
      for (const w of edges.get(v)) {
        if (!index.has(w)) {
          visit(w);
          low.set(v, Math.min(low.get(v), low.get(w)));
        } else if (onStack.has(w)) low.set(v, Math.min(low.get(v), index.get(w)));
      }
      if (low.get(v) !== index.get(v)) return;
      const members = new Set();
      let w;
      do {
        w = stack.pop();
        onStack.delete(w);
        members.add(w);
      } while (w !== v);
      if (members.size > 1) for (const member of members) component.set(member, members);
    };
    for (const v of edges.keys()) if (!index.has(v)) visit(v);
    const graph = { at: Date.now(), edges, component };
    graphs.set(pkg, graph);
    return graph;
  };
  /** The shortest way back from `start` to `goal` inside their cycle. */
  const wayBack = (graph, start, goal) => {
    const members = graph.component.get(goal);
    const before = new Map([[start, undefined]]);
    const queue = [start];
    for (const v of queue) {
      if (v === goal) break;
      for (const w of graph.edges.get(v))
        if (members.has(w) && !before.has(w)) {
          before.set(w, v);
          queue.push(w);
        }
    }
    const way = [];
    for (let v = goal; v !== undefined; v = before.get(v)) way.unshift(v);
    return way;
  };

  const noCycle = {
    meta: {
      type: 'problem',
      docs: { description: 'No import cycle between files, import type counted' },
      schema: [],
      messages: {
        cycle:
          'Import cycle, import type counted: {{way}}. Move what both files need into a file that imports neither.',
      },
    },
    create(context) {
      const file = context.filename;
      const pkg = packageOf(file);
      if (!pkg || !place(pkg, file).production) return {};
      const graph = graphOf(pkg);
      const members = graph.component.get(file);
      if (!members) return {};
      const name = (f) => posix(path.relative(path.join(pkg.dir, 'src'), f));
      const check = (node) => {
        if (
          !node.source ||
          typeof node.source.value !== 'string' ||
          !node.source.value.startsWith('.')
        )
          return;
        const target = resolve(file, node.source.value);
        if (!members.has(target)) return;
        const way = [file, ...wayBack(graph, target, file)].map(name).join(' → ');
        context.report({ node: node.source, messageId: 'cycle', data: { way } });
      };
      return {
        ImportDeclaration: check,
        ExportNamedDeclaration: check,
        ExportAllDeclaration: check,
      };
    },
  };

  return { meta: { name: 'import-layers' }, rules: { order, 'no-cycle': noCycle } };
}
