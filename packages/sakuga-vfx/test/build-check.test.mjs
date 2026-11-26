// The core-copy check CI runs (`pnpm test`): `tools/build.mjs --check` passes on this package as it is,
// and fails, naming the file and changing nothing, when one component's copy of core.js is out of date.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

/** A copy of the package to break, so the real files are never touched. */
function copy() {
  const dir = mkdtempSync(path.join(tmpdir(), 'sakuga-vfx-'));
  cpSync(root, dir, { recursive: true, filter: (src) => !src.includes('node_modules') });
  return dir;
}

const check = (dir) =>
  spawnSync(process.execPath, [path.join(dir, 'tools/build.mjs'), '--check'], { encoding: 'utf8' });

test('every component file carries the current core', () => {
  const result = check(root);
  assert.equal(result.status, 0, result.stdout + result.stderr);
});

test('a stale copy of the core fails the check and is not rewritten', () => {
  const dir = copy();
  try {
    const file = path.join(dir, 'progress/progress.js');
    const stale = readFileSync(file, 'utf8').replace(
      'const TAU = Math.PI * 2;',
      'const TAU = 6.28;',
    );
    writeFileSync(file, stale);
    const result = check(dir);
    assert.equal(result.status, 1);
    assert.match(result.stdout, /stale progress\/progress\.js/);
    assert.equal(readFileSync(file, 'utf8'), stale);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('an edit of core.js not yet stamped fails the check', () => {
  const dir = copy();
  try {
    const core = path.join(dir, 'core.js');
    writeFileSync(core, readFileSync(core, 'utf8').replace('version: 1', 'version: 2'));
    const result = check(dir);
    assert.equal(result.status, 1);
    assert.match(result.stdout, /stale button\/button\.js/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
