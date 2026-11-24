#!/usr/bin/env bash
# Offline tests for infrastructure.mjs, the filter the browser scripts share: Cloudflare's own requests are
# answered inside the browser and are no write of the app; everything else stays under the read-only guard.
# Run: .claude/skills/my-home-environments/tests/infrastructure.test.sh
set -euo pipefail
scripts=$(cd "$(dirname "${BASH_SOURCE[0]}")/../scripts" && pwd)

SCRIPTS_DIR=$scripts node --input-type=module <<'JS'
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import path from 'node:path';

const { isInfrastructure, answeredInfrastructure } = await import(
  pathToFileURL(path.join(process.env.SCRIPTS_DIR, 'infrastructure.mjs')).href
);
const host = 'home-staging.nntin.xyz';
let passed = 0;
const check = (name, run) => {
  run();
  passed += 1;
  console.log(`ok    ${name}`);
};

check("Cloudflare's beacon and its other endpoints on the environment's host are infrastructure", () => {
  assert.equal(isInfrastructure(`https://${host}/cdn-cgi/rum`, host), true);
  assert.equal(isInfrastructure(new URL(`https://${host}/cdn-cgi/challenge-platform/x?y=1`), host), true);
});

check('nothing of the app is: its api, its pages, a path that only contains the name', () => {
  for (const pathname of [
    '/api/homes/home/placements',
    '/api/homes/home/photos',
    '/',
    '/catalog',
    '/cdn-cgi',
    '/assets/cdn-cgi/rum',
    '/api/cdn-cgi/rum',
  ])
    assert.equal(isInfrastructure(`https://${host}${pathname}`, host), false, pathname);
});

check('nor is the same path on another host', () => {
  assert.equal(isInfrastructure('https://example.org/cdn-cgi/rum', host), false);
  assert.equal(isInfrastructure('https://home.nntin.xyz/cdn-cgi/rum', host), false);
});

/** A Playwright route that records what is done with it. */
const route = (url, method = 'POST') => {
  const done = [];
  return {
    done,
    request: () => ({ url: () => url, method: () => method }),
    fulfill: (answer) => done.push(['fulfill', answer]),
    abort: () => done.push(['abort']),
    continue: (options) => done.push(['continue', options]),
  };
};

check('the beacon is answered inside the browser with nothing: not sent on, not aborted', () => {
  const beacon = route(`https://${host}/cdn-cgi/rum`);
  assert.equal(answeredInfrastructure(beacon, host), true);
  assert.deepEqual(beacon.done, [['fulfill', { status: 204, body: '' }]]);
});

check('a write of the app is left to the caller, untouched: the read-only guard still refuses it', () => {
  for (const [url, method] of [
    [`https://${host}/api/homes/home/placements`, 'POST'],
    [`https://${host}/api/homes/home/photos/1`, 'DELETE'],
    [`https://${host}/api/homes/home/seed`, 'PUT'],
  ]) {
    const write = route(url, method);
    assert.equal(answeredInfrastructure(write, host), false, url);
    assert.deepEqual(write.done, []);
  }
});

console.log(`${passed} passed, 0 failed`);
JS

# Every script that guards its requests uses the filter, right after it has let other hosts through.
fail=0
for script in "$scripts"/*.mjs; do
  guards=$(grep -c "host !== host) return route.continue();" "$script" || true)
  filters=$(grep -c "if (answeredInfrastructure(route, host)) return;" "$script" || true)
  if [[ $guards -ne $filters ]]; then
    echo "FAIL  ${script##*/}: $guards request guards, $filters with the infrastructure filter"
    fail=1
  fi
done
[[ $fail -eq 0 ]] && echo "ok    every request guard of the scripts uses the filter"
exit "$fail"
