import type { HomeModel } from '@my-home/shared';
import type { Box, Vec2, Vec3 } from './buildHome';
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
/**
 * Posts are metal profiles, a trellis' wooden ones (#147: the street-side images show wooden posts;
 * a brick pillar is a catalogue piece, `garden.pillar`, placed where one stands).
 */
const FENCE_POST: Record<Exclude<FenceKind, 'gate'>, number> = {
  'chain-link': 0.08,
  privacy: 0.08,
  trellis: 0.07,
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

/** A board, lath or rail of a fence: an outline in its bay's upright plane, `depth` thick. */
export interface FenceSlat {
  id: string;
  center: Vec3;
  rotationY: number;
  depth: number;
  outline: Vec2[];
}

/** Boards, laths and rails are this thick. */
const SLAT_DEPTH = 0.02;
/** A privacy fence: upright boards this wide, a centimetre apart, their tops a little uneven. */
const BOARD = 0.11;
/**
 * A trellis: laths 3 cm wide in a diagonal lattice, this far apart along the bay. A lath leans
 * at 45 degrees, so it takes the square root of two times its width of the bay's length.
 */
const LATH = 0.03 * Math.SQRT2;
const LATTICE = 0.16;
/** The rails a wire mesh hangs between. */
const RAIL = 0.04;

/** What is left of a convex outline where `a x + b y <= c`. */
const cut = (outline: Vec2[], a: number, b: number, c: number): Vec2[] =>
  outline.flatMap((p, i) => {
    const q = outline[(i + 1) % outline.length]!;
    const [dp, dq] = [a * p[0] + b * p[1] - c, a * q[0] + b * q[1] - c];
    const kept: Vec2[] = dp <= 0 ? [p] : [];
    if (dp * dq < 0) {
      const t = dp / (dp - dq);
      kept.push([p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t]);
    }
    return kept;
  });

/**
 * What fills the bays of a fence between its posts (docs/design/realistic-render.md §8.3):
 * upright boards (privacy), a diagonal lattice cut to the bay (trellis), or the two rails of a
 * wire mesh (chain-link; the mesh itself is the bay's translucent panel). Outlines are in the
 * panel's own frame, about its middle.
 */
export function fenceSlats(
  kind: Exclude<FenceKind, 'gate'>,
  panels: (Box & { id: string })[],
): FenceSlat[] {
  const gap = FENCE_POST[kind];
  return panels.flatMap((panel) => {
    const [w, h] = [(panel.size[0] - gap) / 2, panel.size[1] / 2];
    const rect = (x0: number, x1: number, y0: number, y1: number): Vec2[] => [
      [x0, y0],
      [x1, y0],
      [x1, y1],
      [x0, y1],
    ];
    const outlines: Vec2[][] = [];
    if (kind === 'privacy') {
      const count = Math.max(1, Math.round((2 * w) / (BOARD + 0.01)));
      const pitch = (2 * w) / count;
      for (let i = 0; i < count; i++) {
        const x = -w + i * pitch;
        outlines.push(rect(x, x + pitch - 0.01, -h, h - (i % 3) * 0.02));
      }
    } else {
      outlines.push(rect(-w, w, h - RAIL, h), rect(-w, w, -h, RAIL - h));
      if (kind === 'trellis') {
        for (const side of [1, -1]) {
          for (let c = -w - h; c < w + h; c += LATTICE) {
            const lath = cut(cut(rect(-w, w, -h, h), 1, side, c + LATH), -1, -side, -c);
            if (lath.length > 2) outlines.push(lath);
          }
        }
      }
    }
    return outlines.map((outline, i) => ({
      id: `${panel.id}:slat:${i}`,
      center: panel.center,
      rotationY: panel.rotationY,
      depth: SLAT_DEPTH,
      outline,
    }));
  });
}
