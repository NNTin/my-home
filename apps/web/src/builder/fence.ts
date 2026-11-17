import type { HomeModel } from '@my-home/shared';
import type { Box, Vec2 } from './buildHome';
import { EPS, rotationFor } from './plan';

type FenceKind = NonNullable<HomeModel['fences']>[number]['kind'];

/** The sizes a fence line is built with. A gate takes them from its type's parameters. */
export interface FenceSpec {
  /** Posts are square: this wide and deep. */
  postSize: number;
  /** How far a post stands above its panels. */
  postExtra: number;
  panelDepth: number;
  /** Posts stand at most this far apart. */
  bay: number;
}

/** Fence posts stand at most this far apart (fences other than gates). */
export const FENCE_BAY = 2.5;
/** Posts are metal profiles, except the brick pillars of a trellis fence. */
const FENCE_POST: Record<Exclude<FenceKind, 'gate'>, number> = {
  'chain-link': 0.08,
  privacy: 0.08,
  trellis: 0.24,
};

export const fenceSpec = (kind: Exclude<FenceKind, 'gate'>): FenceSpec => ({
  postSize: FENCE_POST[kind],
  postExtra: 0.1,
  panelDepth: 0.04,
  bay: FENCE_BAY,
});

/**
 * Posts and panels along a fence line through `points`. The ground runs linearly from `start` to
 * `end` along the whole path; each bay's panel is level, at the ground height of its middle, so a
 * fence on a slope steps down bay by bay.
 */
export function fenceLine(
  id: string,
  points: Vec2[],
  height: number,
  start: number,
  end: number,
  spec: FenceSpec,
): { posts: (Box & { id: string })[]; panels: (Box & { id: string })[] } {
  const size = spec.postSize;
  const lengths = points.slice(0, -1).map(([x, z], i) => {
    const [ex, ez] = points[i + 1]!;
    return Math.hypot(ex - x, ez - z);
  });
  const total = lengths.reduce((sum, l) => sum + l, 0);
  const groundAt = (distance: number) => start + ((end - start) * distance) / Math.max(total, EPS);

  const posts: (Box & { id: string })[] = [];
  const panels: (Box & { id: string })[] = [];
  // Neighbouring panels differ by at most this much in height; posts cover half of it each way.
  const step = (Math.abs(end - start) / Math.max(total, EPS)) * spec.bay;
  const post = ([x, z]: Vec2, distance: number, rotationY: number) => {
    const ground = groundAt(distance);
    posts.push({
      id: `${id}:post:${posts.length}`,
      center: [x, ground + (height + spec.postExtra) / 2, z],
      size: [size, height + spec.postExtra + step, size],
      rotationY,
    });
  };
  let walked = 0;
  lengths.forEach((length, i) => {
    if (length < EPS) return;
    const [sx, sz] = points[i]!;
    const [ex, ez] = points[i + 1]!;
    const [dx, dz] = [(ex - sx) / length, (ez - sz) / length];
    const rotationY = rotationFor(dx, dz);
    const bays = Math.ceil(length / spec.bay - EPS);
    const bay = length / bays;
    for (let j = 0; j < bays; j++) {
      post([sx + dx * j * bay, sz + dz * j * bay], walked + j * bay, rotationY);
      const mid = (j + 0.5) * bay;
      panels.push({
        id: `${id}:panel:${panels.length}`,
        center: [sx + dx * mid, groundAt(walked + mid) + height / 2, sz + dz * mid],
        size: [bay, height, spec.panelDepth],
        rotationY,
      });
    }
    walked += length;
    if (i === lengths.length - 1) post([ex, ez], walked, rotationY);
  });
  return { posts, panels };
}
