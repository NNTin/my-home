// Run by visual-diff.sh compare; not meant to be called directly.
//   node visual-diff.mjs '<[{view, a, b, diff}]>'
// Identical bytes (sha256) count as identical without decoding. Otherwise both PNGs are decoded in headless
// Chromium (canvas getImageData), differing pixels are counted and a diff PNG is written: differing pixels red,
// the rest a faded copy of A. Exit 0 when every view is identical, 5 when some differ, 1 on an error.
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';

const require = createRequire(path.join(process.env.MY_HOME_PLAYWRIGHT_DIR, 'package.json'));
const { chromium } = require('playwright');

const LAUNCH_ARGS = ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'];
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');

/* global Image, ImageData, document -- diffInPage runs in the browser page */

/** In the page: decodes two PNG data URLs and returns the differing pixel count and a diff PNG. */
async function diffInPage([a, b]) {
  const load = (src) =>
    new Promise((resolve, reject) => {
      const image = new Image();
      image.onload = () => resolve(image);
      image.onerror = () => reject(new Error('cannot decode PNG'));
      image.src = src;
    });
  const [ia, ib] = await Promise.all([load(a), load(b)]);
  const width = Math.max(ia.width, ib.width);
  const height = Math.max(ia.height, ib.height);
  const pixels = (image) => {
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d');
    context.drawImage(image, 0, 0);
    return context.getImageData(0, 0, width, height);
  };
  const pa = pixels(ia);
  const pb = pixels(ib);
  const out = new ImageData(width, height);
  let differing = 0;
  for (let i = 0; i < pa.data.length; i += 4) {
    const same =
      pa.data[i] === pb.data[i] &&
      pa.data[i + 1] === pb.data[i + 1] &&
      pa.data[i + 2] === pb.data[i + 2] &&
      pa.data[i + 3] === pb.data[i + 3];
    if (same) {
      out.data[i] = 255 - (255 - pa.data[i]) * 0.3;
      out.data[i + 1] = 255 - (255 - pa.data[i + 1]) * 0.3;
      out.data[i + 2] = 255 - (255 - pa.data[i + 2]) * 0.3;
    } else {
      differing++;
      out.data[i] = 255;
    }
    out.data[i + 3] = 255;
  }
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  canvas.getContext('2d').putImageData(out, 0, 0);
  return {
    differing,
    total: width * height,
    sizes: [`${ia.width}x${ia.height}`, `${ib.width}x${ib.height}`],
    diff: canvas.toDataURL('image/png'),
  };
}

async function main() {
  const pairs = JSON.parse(process.argv[2] ?? '[]');
  if (!pairs.length) throw new Error('no views to compare');
  const rows = [];
  let browser;
  try {
    for (const { view, a, b, diff } of pairs) {
      const ba = readFileSync(a);
      const bb = readFileSync(b);
      if (sha256(ba) === sha256(bb)) {
        rows.push({ view, result: 'identical', detail: `sha256 ${sha256(ba).slice(0, 12)}` });
        continue;
      }
      browser ??= await chromium.launch({ args: LAUNCH_ARGS });
      const page = await browser.newPage();
      const url = (bytes) => `data:image/png;base64,${bytes.toString('base64')}`;
      const result = await page.evaluate(diffInPage, [url(ba), url(bb)]);
      await page.close();
      writeFileSync(diff, Buffer.from(result.diff.split(',')[1], 'base64'));
      const sizes =
        result.sizes[0] === result.sizes[1] ? '' : `, sizes ${result.sizes.join(' vs ')}`;
      rows.push({
        view,
        result: result.differing ? 'DIFFERS' : 'same pixels',
        detail: result.differing
          ? `${result.differing} of ${result.total} pixels${sizes}, ${diff}`
          : 'bytes differ, pixels identical',
        differs: result.differing > 0,
      });
    }
  } finally {
    await browser?.close();
  }
  console.log('| View | Result | Detail |');
  console.log('| --- | --- | --- |');
  for (const row of rows) console.log(`| ${row.view} | ${row.result} | ${row.detail} |`);
  const differing = rows.filter((r) => r.differs).length;
  console.log(
    differing
      ? `${differing} of ${rows.length} views differ`
      : `all ${rows.length} views identical`,
  );
  process.exit(differing ? 5 : 0);
}

main().catch((error) => {
  console.error(`FAILED: ${error.message}`);
  process.exit(1);
});
