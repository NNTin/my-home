#!/usr/bin/env bash
# Offline tests for parts.mjs, how CI splits a browser check over shards: every part runs in exactly one shard,
# for any number of shards, and every shard computes the same split.
# Run: .claude/skills/my-home-environments/tests/parts.test.sh
set -euo pipefail
scripts=$(cd "$(dirname "${BASH_SOURCE[0]}")/../scripts" && pwd)
# The views visual-diff.sh shoots, in its order (its `views` function).
views=$(sed -n "/^views() {/,/^EOF/p" "$scripts/visual-diff.sh" | sed '1,2d;$d' | paste -sd, -)

SCRIPTS_DIR=$scripts VIEWS=$views node --input-type=module <<'JS'
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const dir = process.env.SCRIPTS_DIR;
const { parseShard, recordCheck, selectParts, shardOf, weights } = await import(
  pathToFileURL(path.join(dir, 'parts.mjs')).href
);
const table = JSON.parse(readFileSync(path.join(dir, 'shard-weights.json'), 'utf8'));
let passed = 0;
const check = (name, run) => {
  run();
  passed += 1;
  console.log(`ok    ${name}`);
};
const all = (parts, count, weight) =>
  Array.from({ length: count }, (_, i) => shardOf(parts, { index: i + 1, count }, weight));

/** Every part in exactly one shard of `count`, each shard in the parts' own order. */
const exactlyOnce = (parts, count, weight) => {
  const shards = all(parts, count, weight);
  assert.deepEqual(shards.flat().sort(), [...parts].sort(), `${count} shards`);
  for (const shard of shards)
    assert.deepEqual(shard, parts.filter((p) => shard.includes(p)), 'kept in order');
  return shards;
};

const lists = {
  'no parts': [],
  'one part': ['only'],
  'three parts': ['a', 'b', 'c'],
  'twenty parts': Array.from({ length: 20 }, (_, i) => `part-${i}`),
  ...Object.fromEntries(
    ['mobile', 'catalog', 'visual-diff'].map((c) => [`the ${c} parts`, Object.keys(table[c])]),
  ),
};
for (const [name, parts] of Object.entries(lists)) {
  check(`${name}: every part in exactly one shard, for 1 to 8 shards`, () => {
    for (let count = 1; count <= 8; count++) {
      exactlyOnce(parts, count);
      exactlyOnce(parts, count, (p) => (p.length * 7) % 13);
    }
  });
}

for (const c of ['mobile', 'catalog', 'visual-diff']) {
  const weight = weights(c);
  const parts = Object.keys(table[c]);
  check(`${c}: with its weights, every part once and no shard empty, for 1 to 8 shards`, () => {
    for (let count = 1; count <= Math.min(8, parts.length); count++) {
      const shards = exactlyOnce(parts, count, weight);
      assert.ok(shards.every((s) => s.length > 0), `${count} shards: one is empty`);
      // Longest first onto the lightest: no shard is more than the longest part above the lightest.
      const loads = shards.map((s) => s.reduce((sum, p) => sum + weight(p), 0));
      const longest = Math.max(...parts.map(weight));
      assert.ok(Math.max(...loads) - Math.min(...loads) <= longest, `${count} shards: ${loads}`);
    }
  });
}

check('the split depends only on the parts and the weights, not on their order', () => {
  const parts = Object.keys(table.catalog);
  const weight = weights('catalog');
  const reversed = [...parts].reverse();
  for (let count = 1; count <= 4; count++)
    for (let index = 1; index <= count; index++)
      assert.deepEqual(
        new Set(shardOf(parts, { index, count }, weight)),
        new Set(shardOf(reversed, { index, count }, weight)),
      );
});

check('a part not measured yet weighs the median, and still lands in one shard', () => {
  const weight = weights('catalog');
  const known = Object.values(table.catalog).sort((a, b) => a - b);
  assert.equal(weight('desktop/piece/furniture.new-type'), known[Math.floor(known.length / 2)]);
  exactlyOnce([...Object.keys(table.catalog), 'desktop/piece/furniture.new-type'], 2, weight);
});

check('a shard is i/n with 1 ≤ i ≤ n; none is the whole check', () => {
  assert.deepEqual(parseShard('2/4'), { index: 2, count: 4 });
  assert.equal(parseShard(''), null);
  assert.equal(parseShard(undefined), null);
  for (const bad of ['0/4', '5/4', '4', 'a/b', '1/0', '-1/2', '1/2/3'])
    assert.throws(() => parseShard(bad), /i\/n/, bad);
});

check('without a shard every part runs, in its order', () => {
  assert.deepEqual([...selectParts('mobile', ['layout', 'views-phone'], '')], ['layout', 'views-phone']);
});

check('a shard prints what it runs, of how many', () => {
  const lines = [];
  const log = console.log;
  console.log = (line) => lines.push(line);
  try {
    selectParts('mobile', Object.keys(table.mobile), '1/4');
  } finally {
    console.log = log;
  }
  assert.match(lines[0], /^shard {2}mobile 1\/4: \d+ of 7 parts: \S/);
});

check('the command line splits as the module does', () => {
  const parts = process.env.VIEWS.split(',');
  for (let index = 1; index <= 4; index++) {
    const out = execFileSync('node', [path.join(dir, 'parts.mjs'), 'shard', 'visual-diff', `${index}/4`, ...parts], {
      encoding: 'utf8',
    });
    assert.deepEqual(out.trim().split('\n'), shardOf(parts, { index, count: 4 }, weights('visual-diff')));
  }
  assert.throws(() =>
    execFileSync('node', [path.join(dir, 'parts.mjs'), 'shard', 'visual-diff', '5/4', 'a'], { stdio: 'pipe' }),
  );
});

check("the weights name visual-diff.sh's views, mobile's parts and both screens of the catalogue", () => {
  assert.deepEqual(Object.keys(table['visual-diff']).sort(), process.env.VIEWS.split(',').sort());
  const devices = ['phone', 'desktop'];
  assert.deepEqual(
    Object.keys(table.mobile).sort(),
    ['layout', ...devices.flatMap((d) => [`frames-${d}`, `textures-${d}`, `views-${d}`])].sort(),
  );
  for (const screen of ['desktop', 'phone']) assert.ok(`${screen}/catalogue` in table.catalog);
});

check('with CHECK_NAMES, each check is written with its result', () => {
  const file = path.join(mkdtempSync(path.join(tmpdir(), 'parts-')), 'names');
  writeFileSync(file, '');
  process.env.CHECK_NAMES = file;
  recordCheck('desktop: a check: with a colon', true);
  recordCheck('another', false);
  delete process.env.CHECK_NAMES;
  recordCheck('not written', true);
  assert.equal(readFileSync(file, 'utf8'), 'ok\tdesktop: a check: with a colon\nFAIL\tanother\n');
});

console.log(`${passed} passed, 0 failed`);
JS
