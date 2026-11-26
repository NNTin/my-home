#!/usr/bin/env bash
# Offline tests for scene.mjs, what the browser scripts wait for and shoot: the scene's canvas is never one of
# the HUD's effect layers (packages/sakuga-vfx), and the loading screen is waited for until it has gone.
# Run: .claude/skills/my-home-environments/tests/scene.test.sh
set -euo pipefail
scripts=$(cd "$(dirname "${BASH_SOURCE[0]}")/../scripts" && pwd)

SCRIPTS_DIR=$scripts node --input-type=module <<'JS'
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import path from 'node:path';

const { SCENE, loadingScreenGone } = await import(
  pathToFileURL(path.join(process.env.SCRIPTS_DIR, 'scene.mjs')).href
);
let passed = 0;
const check = async (name, run) => {
  await run();
  passed += 1;
  console.log(`ok    ${name}`);
};

await check('the scene is a canvas, and neither of the HUD effect layers', () => {
  assert.match(SCENE, /^canvas/);
  // The core's names (packages/sakuga-vfx/core.js): the layer over the page and the one inside a control.
  assert.match(SCENE, /:not\(\.sakuga-fx\)/);
  assert.match(SCENE, /:not\(\.back\)/);
  // It still takes the attributes the scripts add to it.
  assert.equal(`${SCENE}[data-frame="settled"]`.startsWith('canvas:not('), true);
});

await check('the loading screen is waited for until it is detached, with the time given', async () => {
  const asked = [];
  const page = { waitForSelector: async (selector, options) => asked.push({ selector, ...options }) };
  await loadingScreenGone(page, 1234);
  await loadingScreenGone(page);
  assert.deepEqual(asked, [
    { selector: '#boot', state: 'detached', timeout: 1234 },
    { selector: '#boot', state: 'detached', timeout: 30_000 },
  ]);
});

await check('a screen that stays is an error the caller sees', async () => {
  const page = {
    waitForSelector: async () => {
      throw new Error('timeout');
    },
  };
  await assert.rejects(loadingScreenGone(page, 1), /timeout/);
});

console.log(`${passed} passed`);
JS
