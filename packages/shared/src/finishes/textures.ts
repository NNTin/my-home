import type { Finish, TextureMap } from './types';

/**
 * Which texture files a device holds (docs/design/realistic-render.md §5.3): one size of each set
 * in every tier. A phone fetches the 512 px colour and normal maps; a desktop the 1024 px maps,
 * with the roughness map. The loader, the manifest and its budgets all read this.
 */

export type DeviceClass = 'phone' | 'desktop';

export const TEXTURE_SIZES = { phone: 512, desktop: 1024 } as const;
export type TextureSize = (typeof TEXTURE_SIZES)[DeviceClass];

export interface TextureFile {
  set: string;
  map: TextureMap;
  size: TextureSize;
  /** Under `apps/web/src/finishes/textures/`. */
  path: string;
}

const file = (set: string, map: TextureMap, size: TextureSize): TextureFile => ({
  set,
  map,
  size,
  path: `${set}/${map}-${size}.webp`,
});

/** Whether a device draws this map: the roughness map exists at 1024 px only. */
export const deviceHasMap = (device: DeviceClass, map: TextureMap) =>
  device === 'desktop' || map !== 'roughness';

/** The files of a finish's texture set that a device fetches (none for a plain finish). */
export function deviceTextureFiles(finish: Finish, device: DeviceClass): TextureFile[] {
  const { texture } = finish;
  if (!texture) return [];
  return texture.maps
    .filter((map) => deviceHasMap(device, map))
    .map((map) => file(texture.id, map, TEXTURE_SIZES[device]));
}

/** Every file of a finish's texture set, as the repository holds them. */
export const textureFiles = (finish: Finish): TextureFile[] => [
  ...deviceTextureFiles(finish, 'phone'),
  ...deviceTextureFiles(finish, 'desktop'),
];

/** GPU memory of one texture: four bytes a pixel, and a third more for its mipmaps. */
export const textureMemoryBytes = (size: number) => size * size * 4 * 1.33;

const MB = 1_000_000;

/** The texture budgets of §10.1, in bytes. */
export const TEXTURE_BUDGETS = {
  /** Every file a device fetches, all finishes together. */
  download: { phone: 1.5 * MB, desktop: 6 * MB },
  /** Computed, not measured: `textureMemoryBytes` of every texture a device holds. */
  memory: { phone: 40 * MB, desktop: 220 * MB },
  /** Every texture file in the repository. */
  folder: 16 * MB,
} as const;
