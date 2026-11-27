#!/usr/bin/env node
// Checks the web build against apps/web/bundle-budget.json (docs/design/realistic-render.md §10.2):
// - the main chunk (the entry and everything it imports statically) has not grown beyond its budget;
// - each lazy chunk is within its budget and is not imported statically by the main chunk; a lazy entry's
//   `files` are assets it fetches (the denoiser's weights), counted as they are: the server does not gzip them;
// - each script that loads first (a classic <script src> in index.html, ahead of the main chunk: the loading
//   bar, docs/loading.md) is within its budget. It also prints what the first load fetches in all: index.html,
//   those scripts, the main chunk and its CSS.
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
const raw = (file) => readFileSync(path.join(dist, file)).length;

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

/** The classic scripts of index.html: `<script src>` without `type="module"`, run before the main chunk. */
function firstScripts() {
  const html = readFileSync(path.join(dist, 'index.html'), 'utf8');
  return [...html.matchAll(/<script\b([^>]*)>/g)]
    .map((m) => m[1])
    .filter((attrs) => !/type="module"/.test(attrs))
    .map((attrs) => attrs.match(/\bsrc="\/([^"]+\.js)"/)?.[1])
    .filter(Boolean);
}

/** The stylesheets index.html links: the main chunk's CSS. */
function firstStyles() {
  const html = readFileSync(path.join(dist, 'index.html'), 'utf8');
  return [...html.matchAll(/<link[^>]+rel="stylesheet"[^>]+href="\/([^"]+\.css)"/g)].map(
    (m) => m[1],
  );
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
    const codeSize = files.reduce((sum, file) => sum + gzipped(file), 0);
    const fetched = [];
    for (const prefix of lazy.files ?? []) {
      const found = assets.filter((file) => path.basename(file).startsWith(`${prefix}-`));
      if (found.length === 0)
        failures.push(`the file ${prefix} of the lazy chunk ${name} is missing`);
      fetched.push(...found);
    }
    const fetchedSize = fetched.reduce((sum, file) => sum + raw(file), 0);
    const lazySize = codeSize + fetchedSize;
    const limit = lazy.maxGzipBytes;
    console.log(
      `${name.padEnd(13)} ${kB(lazySize)} gzipped${
        fetched.length
          ? ` (code ${kB(codeSize)}, ${fetched.join(', ')} ${kB(fetchedSize)} as sent)`
          : ''
      }${limit === undefined ? '' : `, budget ${kB(limit)}`}`,
    );
    if (limit !== undefined && lazySize > limit)
      failures.push(`the lazy chunk ${name} is ${kB(lazySize)}, more than ${kB(limit)}`);
    for (const file of files)
      if (chunks.includes(file))
        failures.push(`the main chunk imports the lazy chunk ${file} statically`);
  }

  const first = firstScripts();
  for (const [name, script] of Object.entries(budget.first ?? {})) {
    const files = first.filter((file) => path.basename(file).startsWith(`${name}-`));
    if (files.length === 0) {
      if (script.required)
        failures.push(`the first script ${name} is missing from index.html: is it loaded first?`);
      else console.log(`${name.padEnd(13)} not loaded first`);
      continue;
    }
    const scriptSize = files.reduce((sum, file) => sum + gzipped(file), 0);
    console.log(
      `${name.padEnd(13)} ${kB(scriptSize)} gzipped, loaded first (${files.join(', ')}), budget ${kB(script.maxGzipBytes)}`,
    );
    if (scriptSize > script.maxGzipBytes)
      failures.push(
        `the first script ${name} is ${kB(scriptSize)}, more than ${kB(script.maxGzipBytes)}`,
      );
  }
  const parts = { 'index.html': gzipped('index.html') };
  for (const file of first) parts[file] = gzipped(file);
  for (const file of chunks) parts[file] = gzipped(file);
  for (const file of firstStyles()) parts[file] = gzipped(file);
  const total = Object.values(parts).reduce((a, b) => a + b, 0);
  console.log(
    `first load    ${kB(total)} gzipped: ` +
      Object.entries(parts)
        .map(([file, bytes]) => `${file} ${kB(bytes)}`)
        .join(', '),
  );

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
