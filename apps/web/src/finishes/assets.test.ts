// @vitest-environment node
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  assetManifest,
  deviceTotals,
  finishes,
  TEXTURE_BUDGETS,
  textureFiles,
  type FileFacts,
} from '@my-home/shared';
import { describe, expect, it } from 'vitest';

// The texture files against the finish definitions and the manifest (docs/design/realistic-render.md
// §5.3, §10.2). The files are only read from disk here: no texture is decoded or loaded.

const here = fileURLToPath(new URL('.', import.meta.url));
const texturesDir = join(here, 'textures');

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? walk(path) : [path];
  });
}

const onDisk = walk(texturesDir).map((path) => relative(texturesDir, path).split(sep).join('/'));
const facts: FileFacts = new Map(
  onDisk.map((path) => {
    const data = readFileSync(join(texturesDir, path));
    return [path, { bytes: data.length, sha256: createHash('sha256').update(data).digest('hex') }];
  }),
);
const listed = finishes.finishes.flatMap(textureFiles).map((f) => f.path);
const manifest = readFileSync(join(here, 'ASSETS.md'), 'utf8');
/** The manifest's rows: path → SHA-256. */
const rows = new Map(
  [...manifest.matchAll(/^\| `([^`]+)`\s*\|[^|]*\| `([0-9a-f]{64})`\s*\|$/gm)].map((m) => [
    m[1]!,
    m[2]!,
  ]),
);

describe('the texture files', () => {
  it('are exactly the files the finish definitions name', () => {
    expect([...onDisk].sort()).toEqual([...listed].sort());
  });

  it('are WebP files of the size their name says', () => {
    for (const path of onDisk) {
      const data = readFileSync(join(texturesDir, path));
      expect(data.subarray(0, 4).toString('latin1'), path).toBe('RIFF');
      expect(data.subarray(8, 12).toString('latin1'), path).toBe('WEBP');
      // A lossy file: the frame header of the VP8 chunk holds the size (14 bits each).
      expect(data.subarray(12, 16).toString('latin1'), path).toBe('VP8 ');
      const size = Number(/-(\d+)\.webp$/.exec(path)![1]);
      expect([data.readUInt16LE(26) & 0x3fff, data.readUInt16LE(28) & 0x3fff], path).toEqual([
        size,
        size,
      ]);
    }
  });
});

describe('ASSETS.md', () => {
  it('lists every file with its checksum, and no file that is not there', () => {
    expect([...rows.keys()].sort()).toEqual([...onDisk].sort());
    for (const [path, sha256] of rows) expect(sha256, path).toBe(facts.get(path)?.sha256);
  });

  it('is what the definitions and the files generate (run `pnpm finishes:manifest`)', () => {
    // Prettier pads the tables: compare without the padding.
    const bare = (text: string) =>
      text
        .split('\n')
        .map((line) =>
          line.startsWith('|')
            ? line
                .split('|')
                .map((cell) => (/^[\s-]+$/.test(cell) ? '-' : cell.trim()))
                .join('|')
            : line,
        )
        .join('\n')
        .trim();
    expect(bare(manifest)).toBe(bare(assetManifest(finishes.finishes, facts)));
  });

  it('names a CC0 source for every texture set', () => {
    for (const finish of finishes.finishes.filter((f) => f.texture)) {
      const section = manifest.split(`## ${finish.id}\n`)[1]?.split('\n## ')[0] ?? '';
      expect(section, finish.id).toContain(finish.source!.url);
      expect(section, finish.id).toContain('licence CC0-1.0');
    }
  });
});

describe('the texture budgets', () => {
  const textured = finishes.finishes.filter((f) => f.texture);

  it.each(['phone', 'desktop'] as const)('hold for a %s', (device) => {
    const totals = deviceTotals(textured, device, facts);
    expect(totals.download).toBeGreaterThan(0);
    expect(totals.download).toBeLessThanOrEqual(TEXTURE_BUDGETS.download[device]);
    expect(totals.memory).toBeLessThanOrEqual(TEXTURE_BUDGETS.memory[device]);
  });

  it('are the numbers of the design: 1.5 and 6 MB to download, 40 and 220 MB of memory, 16 MB in git', () => {
    expect(TEXTURE_BUDGETS).toEqual({
      download: { phone: 1_500_000, desktop: 6_000_000 },
      memory: { phone: 40_000_000, desktop: 220_000_000 },
      folder: 16_000_000,
    });
  });

  it('keep the folder under its cap', () => {
    const bytes = [...facts.values()].reduce((sum, f) => sum + f.bytes, 0);
    expect(bytes).toBeLessThanOrEqual(TEXTURE_BUDGETS.folder);
  });
});
