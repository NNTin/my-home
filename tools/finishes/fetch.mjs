// The texture files of the finish library (docs/design/realistic-render.md §5.3).
//
//   pnpm finishes:fetch [finish id ...]   download, verify, convert, then write the manifest
//   pnpm finishes:manifest                write apps/web/src/finishes/ASSETS.md from the files
//
// Runs on a developer machine or in an agent session, never in CI: CI only checks the result
// (apps/web/src/finishes/assets.test.ts). Needs ImageMagick (`convert`, with WebP) and `unzip`.
// Sources are CC0 libraries only. A texture is never made from one of the owner's photos.
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { assetManifest, textureFiles } from '../../packages/shared/src/finishes/index.ts';
import { finishListing } from '../../packages/shared/src/finishes/listing.ts';

const root = join(dirname(fileURLToPath(import.meta.url)), '../..');
const texturesDir = join(root, 'apps/web/src/finishes/textures');
const manifestPath = join(root, 'apps/web/src/finishes/ASSETS.md');
const pinsPath = join(dirname(fileURLToPath(import.meta.url)), 'checksums.json');
const cache = join(tmpdir(), 'my-home-finishes');
const USER_AGENT = 'my-home-finish-fetch';

/** The size the sources are downloaded at: twice the largest file, so both sizes are scaled down. */
const SOURCE = '2k';

/**
 * WebP quality per map and size. Chosen so that the downloads stay within the budgets of §10.1
 * (the manifest test checks them); a normal map shows its artefacts as lighting, so it gets more.
 */
const QUALITY = {
  color: { 512: 80, 1024: 74 },
  normal: { 512: 84, 1024: 80 },
  roughness: { 512: 60, 1024: 60 },
};

const hash = (algorithm, data) => createHash(algorithm).update(data).digest('hex');

async function download(url, name) {
  const target = join(cache, name);
  if (existsSync(target)) return readFileSync(target);
  const response = await fetch(url, { headers: { 'user-agent': USER_AGENT } });
  if (!response.ok) throw new Error(`${url}: HTTP ${response.status}`);
  const data = Buffer.from(await response.arrayBuffer());
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, data);
  return data;
}

async function json(url) {
  const response = await fetch(url, { headers: { 'user-agent': USER_AGENT } });
  if (!response.ok) throw new Error(`${url}: HTTP ${response.status}`);
  return response.json();
}

/**
 * Checksums the tool keeps itself, for a provider that publishes none (ambientCG): written on the
 * first download, compared on every later one.
 */
const pins = existsSync(pinsPath) ? JSON.parse(readFileSync(pinsPath, 'utf8')) : {};
function checkPin(name, data) {
  const sha256 = hash('sha256', data);
  if (pins[name] === undefined) pins[name] = sha256;
  else if (pins[name] !== sha256)
    throw new Error(`${name}: SHA-256 ${sha256} differs from the pinned ${pins[name]}`);
}

/** Poly Haven publishes an MD5 per file; each downloaded file is compared with it. */
async function polyHavenSources(assetId, maps) {
  const files = await json(`https://api.polyhaven.com/files/${assetId}`);
  const key = { color: 'Diffuse', normal: 'nor_gl', roughness: 'Rough' };
  const out = {};
  for (const map of maps) {
    const file = files[key[map]]?.[SOURCE]?.jpg;
    if (!file) throw new Error(`${assetId}: no ${SOURCE} ${map} map`);
    const name = `polyhaven/${assetId}/${map}.jpg`;
    const data = await download(file.url, name);
    if (hash('md5', data) !== file.md5)
      throw new Error(`${assetId} ${map}: MD5 differs from Poly Haven's ${file.md5}`);
    out[map] = join(cache, name);
  }
  return out;
}

/** ambientCG publishes sizes only: the archive's size is compared, and its SHA-256 is pinned. */
async function ambientCgSources(assetId, maps) {
  const attribute = `${SOURCE.toUpperCase()}-JPG`;
  const found = await json(
    `https://ambientcg.com/api/v2/full_json?id=${assetId}&include=downloadData`,
  );
  const downloads =
    found.foundAssets?.[0]?.downloadFolders?.default?.downloadFiletypeCategories?.zip?.downloads;
  const entry = downloads?.find((d) => d.attribute === attribute);
  if (!entry) throw new Error(`${assetId}: no ${attribute} archive`);
  const name = `ambientcg/${entry.fileName}`;
  const data = await download(entry.downloadLink, name);
  if (data.length !== entry.size)
    throw new Error(`${assetId}: ${data.length} bytes, ambientCG says ${entry.size}`);
  checkPin(entry.fileName, data);
  const folder = join(cache, 'ambientcg', assetId);
  mkdirSync(folder, { recursive: true });
  execFileSync('unzip', ['-o', '-q', join(cache, name), '-d', folder]);
  const key = { color: 'Color', normal: 'NormalGL', roughness: 'Roughness' };
  return Object.fromEntries(
    maps.map((map) => [map, join(folder, `${assetId}_${attribute}_${key[map]}.jpg`)]),
  );
}

function convert(source, target, map, size, crop) {
  mkdirSync(dirname(target), { recursive: true });
  const percent = crop === undefined ? [] : [`${crop * 100}%x${crop * 100}%+0+0`];
  execFileSync('convert', [
    source,
    ...(percent.length ? ['-gravity', 'NorthWest', '-crop', percent[0], '+repage'] : []),
    ...(map === 'roughness' ? ['-colorspace', 'Gray'] : []),
    '-filter',
    'Lanczos',
    '-resize',
    `${size}x${size}!`,
    '-strip',
    '-quality',
    String(QUALITY[map][size]),
    '-define',
    'webp:method=6',
    target,
  ]);
}

async function fetchFinish(finish) {
  const { texture, source } = finish;
  const sources =
    source.provider === 'Poly Haven'
      ? await polyHavenSources(source.assetId, texture.maps)
      : await ambientCgSources(source.assetId, texture.maps);
  for (const file of textureFiles(finish)) {
    convert(sources[file.map], join(texturesDir, file.path), file.map, file.size, source.crop);
  }
  console.log(`fetched ${finish.id} (${source.provider} ${source.assetId})`);
}

function writeManifest() {
  const facts = new Map();
  for (const file of finishListing.flatMap(textureFiles)) {
    const path = join(texturesDir, file.path);
    if (!existsSync(path)) continue;
    const data = readFileSync(path);
    facts.set(file.path, { bytes: data.length, sha256: hash('sha256', data) });
  }
  writeFileSync(manifestPath, assetManifest(finishListing, facts));
  execFileSync('pnpm', ['exec', 'prettier', '--write', manifestPath], { cwd: root });
  console.log(`wrote ${manifestPath}`);
}

const [command, ...ids] = process.argv.slice(2);
if (command === 'fetch') {
  const textured = finishListing.filter((f) => f.texture);
  const unknown = ids.filter((id) => !textured.some((f) => f.id === id));
  if (unknown.length) throw new Error(`Not a textured finish: ${unknown.join(', ')}`);
  for (const finish of textured.filter((f) => ids.length === 0 || ids.includes(f.id))) {
    await fetchFinish(finish);
  }
  writeFileSync(pinsPath, `${JSON.stringify(pins, null, 2)}\n`);
  writeManifest();
} else if (command === 'manifest') {
  writeManifest();
} else {
  console.error('usage: fetch.mjs fetch [finish id ...] | manifest');
  process.exit(2);
}
