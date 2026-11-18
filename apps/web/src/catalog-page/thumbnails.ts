import type { CatalogType } from '@my-home/shared';
import { useEffect, useState } from 'react';
import type { Part } from '../catalog/types';
import { previewParts } from './preview';
import { renderThumbnail } from './renderThumbnail';

/**
 * Catalogue thumbnails: rendered in the browser from a type's parts, one at a time on one
 * offscreen renderer, and kept in the Cache Storage API. The key holds a hash of the parts, so a
 * design change makes a new thumbnail and an unchanged design is never rendered again
 * (docs/catalog.md).
 */

export const THUMBNAIL_CACHE = 'my-home-thumbnails';

/** A short hash (FNV-1a, 32 bits, hex) of the parts as JSON. */
export function hashParts(parts: readonly Part[]): string {
  const text = JSON.stringify(parts);
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}

/** `thumb:<typeId>:<hash>`: the cache entry of a type's thumbnail for these parts. */
export const thumbnailKey = (typeId: string, parts: readonly Part[]) =>
  `thumb:${typeId}:${hashParts(parts)}`;

/** Where rendered thumbnails are kept between visits. */
export interface ThumbnailStore {
  get(key: string): Promise<Blob | undefined>;
  /** Stores `blob` under `key` and forgets the type's other (older) thumbnails. */
  put(key: string, blob: Blob): Promise<void>;
}

/** The Cache Storage API; entries are requests to `/__thumbnails/<key>`, never fetched. */
export function cacheStorageStore(name = THUMBNAIL_CACHE): ThumbnailStore {
  const url = (key: string) =>
    new URL(`/__thumbnails/${encodeURIComponent(key)}`, window.location.origin).href;
  return {
    async get(key) {
      const response = await (await caches.open(name)).match(url(key));
      return response ? response.blob() : undefined;
    },
    async put(key, blob) {
      const cache = await caches.open(name);
      await cache.put(url(key), new Response(blob, { headers: { 'content-type': blob.type } }));
      const typePrefix = url(key.slice(0, key.lastIndexOf(':') + 1));
      for (const request of await cache.keys()) {
        if (request.url.startsWith(typePrefix) && request.url !== url(key))
          await cache.delete(request);
      }
    },
  };
}

/** Kept for this page only: where the Cache Storage API is missing (no secure context). */
export function memoryStore(): ThumbnailStore {
  const blobs = new Map<string, Blob>();
  return {
    get: (key) => Promise.resolve(blobs.get(key)),
    put: (key, blob) => {
      blobs.set(key, blob);
      return Promise.resolve();
    },
  };
}

export interface Thumbnailer {
  /** An image URL of the thumbnail for these parts: cached, or rendered after any before it. */
  get(typeId: string, parts: readonly Part[]): Promise<string>;
}

export function createThumbnailer({
  store,
  render,
  toUrl = (blob) => URL.createObjectURL(blob),
}: {
  store: ThumbnailStore;
  render(parts: readonly Part[]): Promise<Blob>;
  toUrl?(blob: Blob): string;
}): Thumbnailer {
  const urls = new Map<string, Promise<string>>();
  // One render at a time: each waits for the one before it, failed or not.
  let queue: Promise<unknown> = Promise.resolve();
  const rendered = (parts: readonly Part[]) => {
    const next = queue.then(() => render(parts));
    queue = next.catch(() => undefined);
    return next;
  };
  const load = async (key: string, parts: readonly Part[]) => {
    const cached = await store.get(key).catch(() => undefined);
    if (cached) return toUrl(cached);
    const blob = await rendered(parts);
    await store.put(key, blob).catch(() => undefined);
    return toUrl(blob);
  };
  return {
    get(typeId, parts) {
      const key = thumbnailKey(typeId, parts);
      let url = urls.get(key);
      if (!url) {
        url = load(key, parts);
        // A failed render is tried again on the next visit, not on every scroll.
        urls.set(key, url);
      }
      return url;
    },
  };
}

let shared: Thumbnailer | undefined;
const thumbnailer = () =>
  (shared ??= createThumbnailer({
    store: typeof caches === 'undefined' ? memoryStore() : cacheStorageStore(),
    render: renderThumbnail,
  }));

/**
 * The thumbnail of `type` once its card has come into view (`element`); undefined until it is
 * ready, or when it cannot be drawn (no WebGL): the card shows the type's icon meanwhile.
 */
export function useThumbnail(type: CatalogType, element: Element | null): string | undefined {
  const [url, setUrl] = useState<string>();
  useEffect(() => {
    if (!element) return;
    let live = true;
    const start = () =>
      thumbnailer()
        .get(type.id, previewParts(type))
        .then((u) => live && setUrl(u))
        .catch(() => undefined);
    if (typeof IntersectionObserver === 'undefined') {
      void start();
      return () => void (live = false);
    }
    const observer = new IntersectionObserver(
      (entries) => {
        if (!entries.some((e) => e.isIntersecting)) return;
        observer.disconnect();
        void start();
      },
      { rootMargin: '200px' },
    );
    observer.observe(element);
    return () => {
      live = false;
      observer.disconnect();
    };
  }, [type, element]);
  return url;
}
