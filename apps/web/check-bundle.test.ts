// tools/check-bundle.mjs (CI's `pnpm check:bundle`) on a made-up build: the script that loads first, a
// classic <script> in index.html ahead of the main chunk (docs/loading.md), is measured against its budget.
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

// vitest runs in apps/web (jsdom: import.meta.url is no file URL here).
const tool = path.resolve(process.cwd(), '../../tools/check-bundle.mjs');
const budget = {
  first: { 'sakuga-progress': { maxGzipBytes: 25_000, required: true } },
  main: { baseline: 'test', baselineGzipBytes: 1_000_000, maxGzipBytes: 0, maxGrowthGzipBytes: 0 },
  lazy: {},
};
let dir = '';

/** Random bytes do not compress: `size` bytes are about `size` gzipped. */
const noise = (size: number) => {
  let text = '';
  while (text.length < size) text += Math.random().toString(36).slice(2);
  return `/*${text.slice(0, size)}*/`;
};

function build(first: string | undefined, firstBytes = 1000) {
  dir = mkdtempSync(path.join(tmpdir(), 'check-bundle-'));
  mkdirSync(path.join(dir, 'assets'));
  const tag = first ? `<script src="/assets/${first}"></script>` : '';
  writeFileSync(
    path.join(dir, 'index.html'),
    `<html><head>${tag}<title>t</title><script type="module" crossorigin src="/assets/index-a.js"></script>` +
      '<link rel="stylesheet" crossorigin href="/assets/index-a.css"></head></html>',
  );
  writeFileSync(path.join(dir, 'assets/index-a.js'), 'export{};');
  writeFileSync(path.join(dir, 'assets/index-a.css'), 'a{}');
  if (first) writeFileSync(path.join(dir, 'assets', first), noise(firstBytes));
  writeFileSync(path.join(dir, 'budget.json'), JSON.stringify(budget));
  return spawnSync(
    process.execPath,
    [tool, '--dist', dir, '--budget', path.join(dir, 'budget.json')],
    { encoding: 'utf8' },
  );
}

afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe('check-bundle: the script that loads first', () => {
  it('is measured, and counted in the first load', () => {
    const result = build('sakuga-progress-1234abcd.js', 5000);
    expect(result.status, result.stdout + result.stderr).toBe(0);
    expect(result.stdout).toMatch(
      /sakuga-progress \d+\.\d kB gzipped, loaded first \(assets\/sakuga-progress-1234abcd\.js\), budget 25\.0 kB/,
    );
    expect(result.stdout).toMatch(/first load .*assets\/sakuga-progress-1234abcd\.js/);
    // The module entry is the main chunk, not a first script.
    expect(result.stdout).not.toMatch(/loaded first \(assets\/index-a\.js\)/);
  });

  it('fails over its budget', () => {
    const result = build('sakuga-progress-1234abcd.js', 40_000);
    expect(result.status).toBe(1);
    expect(result.stderr).toMatch(/the first script sakuga-progress is .* more than 25\.0 kB/);
  });

  it('fails when it is not loaded first', () => {
    const result = build(undefined);
    expect(result.status).toBe(1);
    expect(result.stderr).toMatch(/the first script sakuga-progress is missing from index\.html/);
  });
});

/** A made-up build with a lazy WebP file (the painted toggle's frames, docs/design/hud.md §9.4). */
function buildWithWebp({ inHtml = false, inlined = false, bytes = 3000 } = {}) {
  dir = mkdtempSync(path.join(tmpdir(), 'check-bundle-'));
  mkdirSync(path.join(dir, 'assets'));
  const webp = Buffer.from(noise(bytes));
  const file = 'sakuga-toggle-rest-1234abcd.webp';
  writeFileSync(path.join(dir, 'assets', file), webp);
  writeFileSync(
    path.join(dir, 'index.html'),
    `<html><head>${inHtml ? `<link rel="preload" href="/assets/${file}">` : ''}<title>t</title>` +
      '<script type="module" crossorigin src="/assets/index-a.js"></script></head></html>',
  );
  const url = inlined ? `data:image/webp;base64,${webp.toString('base64')}` : `/assets/${file}`;
  writeFileSync(path.join(dir, 'assets/index-a.js'), `export const rest=${JSON.stringify(url)};`);
  const lazyBudget = {
    first: {},
    main: budget.main,
    lazy: { 'sakuga-toggle-rest': { maxGzipBytes: 12_000, required: true, ext: '.webp' } },
  };
  writeFileSync(path.join(dir, 'budget.json'), JSON.stringify(lazyBudget));
  return spawnSync(
    process.execPath,
    [tool, '--dist', dir, '--budget', path.join(dir, 'budget.json')],
    { encoding: 'utf8' },
  );
}

describe("check-bundle: a lazy file with an ext (the toggle's WebP)", () => {
  it('is measured as sent, and the main chunk holds only its URL', () => {
    const result = buildWithWebp();
    expect(result.status, result.stdout + result.stderr).toBe(0);
    expect(result.stdout).toMatch(/sakuga-toggle-rest 3\.\d kB gzipped, budget 12\.0 kB/);
  });

  it('fails over its budget', () => {
    const result = buildWithWebp({ bytes: 20_000 });
    expect(result.status).toBe(1);
    expect(result.stderr).toMatch(/the lazy chunk sakuga-toggle-rest is .* more than 12\.0 kB/);
  });

  it('fails when index.html names it: it would load first', () => {
    const result = buildWithWebp({ inHtml: true });
    expect(result.status).toBe(1);
    expect(result.stderr).toMatch(
      /the lazy file assets\/sakuga-toggle-rest-1234abcd\.webp is named in index\.html/,
    );
  });

  it('fails when the main chunk holds its bytes (inlined as a data URL)', () => {
    const result = buildWithWebp({ inlined: true });
    expect(result.status).toBe(1);
    expect(result.stderr).toMatch(/the main chunk holds the bytes of the lazy file/);
  });
});
