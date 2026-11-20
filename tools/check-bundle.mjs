#!/usr/bin/env node
// Checks the web build against apps/web/bundle-budget.json (docs/design/realistic-render.md §10.2):
// - the main chunk (the entry and everything it imports statically) has not grown beyond its budget;
// - each lazy chunk is within its budget and is not imported statically by the main chunk.
// Run after `pnpm build`:  node tools/check-bundle.mjs [--dist DIR] [--budget FILE]
// Exit 0 within budget, 1 over budget or on an error.
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const args = process.argv.slice(2);
const option = (name, fallback) => {
  const at = args.indexOf(name);
  return at >= 0 && args[at + 1] ? path.resolve(args[at + 1]) : path.join(root, fallback);
};
const dist = option('--dist', 'apps/web/dist');
const budgetFile = option('--budget', 'apps/web/bundle-budget.json');

const kB = (bytes) => `${(bytes / 1000).toFixed(1)} kB`;
const gzipped = (file) => gzipSync(readFileSync(path.join(dist, file)), { level: 9 }).length;

/** The chunks a chunk imports statically: `import"./x.js"` and `from"./x.js"`, not `import("./x.js")`. */
function staticImports(file) {
  const code = readFileSync(path.join(dist, file), 'utf8');
  const found = new Set();
  for (const match of code.matchAll(/(?:\bimport|\bfrom)\s*["']\.\/([\w.-]+\.js)["']/g))
    found.add(`assets/${match[1]}`);
  return found;
}

/** The entry of index.html with every chunk it reaches by static imports. */
function mainChunks() {
  const html = readFileSync(path.join(dist, 'index.html'), 'utf8');
  const entries = [...html.matchAll(/<script[^>]+type="module"[^>]+src="\/([^"]+\.js)"/g)].map(
    (m) => m[1],
  );
  if (entries.length === 0) throw new Error(`no module script in ${path.join(dist, 'index.html')}`);
  const reached = new Set(entries);
  for (const file of reached) for (const next of staticImports(file)) reached.add(next);
  return [...reached];
}

function main() {
  if (!existsSync(dist)) throw new Error(`${dist} does not exist: run pnpm build first`);
  const budget = JSON.parse(readFileSync(budgetFile, 'utf8'));
  const failures = [];
  const chunks = mainChunks();
  const size = chunks.reduce((sum, file) => sum + gzipped(file), 0);
  const { baseline, baselineGzipBytes, maxGrowthGzipBytes } = budget.main;
  const growth = size - baselineGzipBytes;
  console.log(
    `main chunk    ${kB(size)} gzipped (${chunks.join(', ')}): ` +
      `${growth >= 0 ? '+' : ''}${kB(growth)} over ${baseline}, budget +${kB(maxGrowthGzipBytes)}`,
  );
  if (growth > maxGrowthGzipBytes)
    failures.push(`the main chunk grew by ${kB(growth)}, more than ${kB(maxGrowthGzipBytes)}`);

  const assets = readdirSync(path.join(dist, 'assets')).map((name) => `assets/${name}`);
  for (const [name, lazy] of Object.entries(budget.lazy ?? {})) {
    const files = assets.filter(
      (file) => path.basename(file).startsWith(`${name}-`) && file.endsWith('.js'),
    );
    if (files.length === 0) {
      if (lazy.required)
        failures.push(`the lazy chunk ${name} is missing: is its code in the main chunk?`);
      else console.log(`${name.padEnd(13)} not built yet`);
      continue;
    }
    const lazySize = files.reduce((sum, file) => sum + gzipped(file), 0);
    const limit = lazy.maxGzipBytes;
    console.log(
      `${name.padEnd(13)} ${kB(lazySize)} gzipped${limit === undefined ? '' : `, budget ${kB(limit)}`}`,
    );
    if (limit !== undefined && lazySize > limit)
      failures.push(`the lazy chunk ${name} is ${kB(lazySize)}, more than ${kB(limit)}`);
    for (const file of files)
      if (chunks.includes(file))
        failures.push(`the main chunk imports the lazy chunk ${file} statically`);
  }

  for (const failure of failures) console.error(`FAILED: ${failure}`);
  if (failures.length === 0) console.log('bundle within budget');
  process.exit(failures.length ? 1 : 0);
}

try {
  main();
} catch (error) {
  console.error(`FAILED: ${error.message}`);
  process.exit(1);
}
