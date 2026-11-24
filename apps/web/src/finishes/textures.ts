import {
  deviceTextureFiles,
  finishes,
  type DeviceClass,
  type TextureFile,
  type TextureMap,
} from '@my-home/shared';
import { NoColorSpace, RepeatWrapping, SRGBColorSpace, Texture } from 'three';
import { textureUrl } from './urls';

/**
 * Texture loading (docs/design/realistic-render.md §4.4, §5.3). A device holds one size of each
 * texture set in every tier: a phone the 512 px maps, a desktop the 1024 px maps with the
 * roughness map. A set's files are requested when its finish is first drawn; until one arrives,
 * and for good when it fails, the finish draws with its tint alone.
 */

export type LoadTexture = (url: string) => Promise<Texture>;

/** A file that neither arrives nor fails within this time counts as failed. */
export const TEXTURE_TIMEOUT_MS = 30_000;

const loadFromNetwork: LoadTexture = (url) => {
  // Web tests draw nothing: a test that reaches this has asked for a texture by mistake.
  if (import.meta.env.MODE === 'test') {
    return Promise.reject(new Error(`A test must not load a texture (${url})`));
  }
  // Decoded off the main thread. The renderer does not turn an image bitmap upright, and not
  // every browser does when asked to (`imageOrientation`): the bitmap is taken as it is, top row
  // first, and `request` reads it bottom up instead.
  return fetch(url)
    .then((response) => {
      if (!response.ok) throw new Error(`${url}: HTTP ${response.status}`);
      return response.blob();
    })
    .then((blob) => createImageBitmap(blob, { colorSpaceConversion: 'none' }))
    .then((bitmap) => {
      const texture = new Texture(bitmap);
      texture.flipY = false;
      texture.needsUpdate = true;
      return texture;
    });
};

export interface TextureEvent {
  finish: string;
  map: TextureMap;
  /** Absent when the file failed to load. */
  texture?: Texture;
}

export class FinishTextures {
  private readonly requested = new Set<string>();
  private readonly loaded = new Map<string, Partial<Record<TextureMap, Texture>>>();
  private readonly listeners = new Set<(event: TextureEvent) => void>();
  private inFlight = 0;
  private done = 0;
  private failures = 0;
  private disposed = false;

  constructor(
    readonly device: DeviceClass,
    private readonly load: LoadTexture = loadFromNetwork,
    private readonly urlOf: (path: string) => string | undefined = textureUrl,
    private readonly timeoutMs = TEXTURE_TIMEOUT_MS,
  ) {}

  /**
   * Asks for the files of a finish's texture set, in this device's size, once. A plain finish and
   * a finish the library does not have ask for nothing.
   */
  request(finishId: string): void {
    if (this.requested.has(finishId)) return;
    this.requested.add(finishId);
    const finish = finishes.get(finishId);
    if (!finish?.tileSize) return;
    const repeat = 1 / finish.tileSize;
    for (const file of deviceTextureFiles(finish, this.device)) {
      this.inFlight += 1;
      void this.fetch(file).then(
        (texture) => {
          if (this.disposed) return texture.dispose();
          // One repeat of the image covers `tileSize` metres: the coordinates are metres.
          texture.wrapS = texture.wrapT = RepeatWrapping;
          // Downwards: a file's first row is its top (`loadFromNetwork`), and with a wrapped
          // texture reading it backwards is reading it upright. So the relief of a normal map
          // keeps its direction too.
          texture.repeat.set(repeat, -repeat);
          texture.colorSpace = file.map === 'color' ? SRGBColorSpace : NoColorSpace;
          texture.anisotropy = 4;
          this.loaded.set(finishId, { ...this.loaded.get(finishId), [file.map]: texture });
          this.settle(1, 0, { finish: finishId, map: file.map, texture });
        },
        () => this.settle(0, 1, { finish: finishId, map: file.map }),
      );
    }
  }

  private fetch(file: TextureFile): Promise<Texture> {
    const url = this.urlOf(file.path);
    if (!url) return Promise.reject(new Error(`No texture file ${file.path}`));
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`${file.path} timed out`)), this.timeoutMs);
      this.load(url).then(
        (texture) => {
          clearTimeout(timer);
          resolve(texture);
        },
        (error: unknown) => {
          clearTimeout(timer);
          reject(error instanceof Error ? error : new Error(String(error)));
        },
      );
    });
  }

  private settle(done: number, failed: number, event: TextureEvent) {
    this.inFlight -= 1;
    this.done += done;
    this.failures += failed;
    for (const listener of [...this.listeners]) listener(event);
  }

  /** The maps of a finish that have arrived. */
  maps(finishId: string): Partial<Record<TextureMap, Texture>> {
    return this.loaded.get(finishId) ?? {};
  }

  /** Told of every file that arrives or fails. */
  subscribe(listener: (event: TextureEvent) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** Files asked for and not yet arrived or failed. */
  get pending(): number {
    return this.inFlight;
  }

  /**
   * Frees the textures: this device class is no longer drawn (the layout changed). A file still
   * on its way is freed when it arrives, and tells no one.
   */
  dispose() {
    this.disposed = true;
    this.listeners.clear();
    for (const maps of this.loaded.values()) {
      for (const texture of Object.values(maps)) texture.dispose();
    }
    this.loaded.clear();
  }

  /** For the `?perf` data: texture files that arrived, failed and are still on their way. */
  counts() {
    return { loaded: this.done, failed: this.failures, pending: this.inFlight };
  }
}
