import { formatCm } from '@my-home/shared';
import { box } from '../catalog/parts';
import type { Part, PieceContext, SectionRole, SectionShape } from '../catalog/types';

/**
 * The piece page's wall stub and section view of an opening. Everything here is pure and in the
 * opening's local frame (the hole centred on the origin, width along x, height along y, the wall's
 * depth along z), so it is tested without WebGL.
 */

/** The outside wall's colour in the viewer (`HomeMeshes`). */
export const WALL_COLOR = '#d8d2c4';
/** How much wall the stub shows beside and above the hole. */
export const STUB_SIDE = 0.4;
export const STUB_HEAD = 0.3;

const EPS = 1e-9;

/** The floor under a wall opening: the hole's bottom less its sill height. */
export const floorOf = (ctx: PieceContext) => -ctx.height / 2 - (ctx.sill ?? 0);

/**
 * A short wall around the hole, down to the floor: the sides, the wall over the head and (for a
 * window) the wall under the sill, like `splitWall` cuts a real wall.
 */
export function wallStub(ctx: PieceContext): Part[] {
  const { width: w, height: h, wallDepth: d } = ctx;
  const floor = floorOf(ctx);
  const top = h / 2 + STUB_HEAD;
  const side = (x: number) =>
    box([x, (floor + top) / 2, 0], [STUB_SIDE, top - floor, d], WALL_COLOR, 'body');
  const parts = [
    side(-w / 2 - STUB_SIDE / 2),
    side(w / 2 + STUB_SIDE / 2),
    box([0, h / 2 + STUB_HEAD / 2, 0], [w, STUB_HEAD, d], WALL_COLOR, 'body'),
  ];
  const sill = ctx.sill ?? 0;
  if (sill > 0) parts.push(box([0, (floor - h / 2) / 2, 0], [w, sill, d], WALL_COLOR, 'body'));
  return parts;
}

/** The z range a part covers on the plane x = 0, or undefined when the plane misses it. */
function cutDepth(part: Part): [number, number] | undefined {
  const [cx, , cz] = part.center;
  const [sx, , sz] = part.size;
  if (part.shape === 'cylinder') {
    // An upright (elliptic) cylinder: the chord of its ellipse at x = 0.
    const [rx, rz] = [sx / 2, sz / 2];
    const t = 1 - (cx / rx) ** 2;
    if (t <= EPS) return undefined;
    const half = rz * Math.sqrt(t);
    return [cz - half, cz + half];
  }
  // A box turned by rotationY (three.js: local (x, z) lands at (x cos + z sin, -x sin + z cos)).
  const [c, s] = [Math.cos(part.rotationY), Math.sin(part.rotationY)];
  const corners = [
    [-1, -1],
    [1, -1],
    [1, 1],
    [-1, 1],
  ].map(([u, v]) => {
    const [x, z] = [(u! * sx) / 2, (v! * sz) / 2];
    return [cx + x * c + z * s, cz - x * s + z * c] as const;
  });
  const xs = corners.map(([x]) => x);
  if (Math.min(...xs) >= -EPS || Math.max(...xs) <= EPS) return undefined;
  const zs: number[] = [];
  corners.forEach(([x1, z1], i) => {
    const [x2, z2] = corners[(i + 1) % 4]!;
    if (Math.abs(x1) <= EPS) zs.push(z1);
    else if (x1 * x2 < 0) zs.push(z1 + ((z2 - z1) * (0 - x1)) / (x2 - x1));
  });
  return [Math.min(...zs), Math.max(...zs)];
}

/** The parts the vertical plane through the centre (x = 0) cuts, as (depth, height) rectangles. */
export function cutParts(parts: readonly Part[]): SectionShape[] {
  return parts.flatMap((part) => {
    const z = cutDepth(part);
    if (!z) return [];
    const [, cy] = part.center;
    const half = part.size[1] / 2;
    return [{ role: part.role, color: part.color, z, y: [cy - half, cy + half] }];
  });
}

/**
 * The section of an opening: the cut of its parts (or the piece's own `section`), and with
 * `stub: 'wall'` the wall stub's cut first (under the sill, over the head).
 */
export function sectionOf(
  parts: readonly Part[],
  ctx: PieceContext,
  { stub = 'wall', own }: { stub?: 'wall' | 'none'; own?: SectionShape[] | undefined } = {},
): SectionShape[] {
  const piece = own ?? cutParts(parts);
  if (stub === 'none') return piece;
  const wall = cutParts(wallStub(ctx)).map((s) => ({ ...s, role: 'wall' as const }));
  return [...wall, ...piece];
}

export interface SectionLabel {
  name: string;
  /** Metres. */
  value: number;
  label: string;
}

const depthOf = (shapes: readonly SectionShape[], role: SectionRole) => {
  const of = shapes.filter((s) => s.role === role);
  if (of.length === 0) return undefined;
  return Math.max(...of.map((s) => s.z[1])) - Math.min(...of.map((s) => s.z[0]));
};

/** The measures the section view writes next to the drawing, in cm with one decimal. */
export function sectionLabels(
  shapes: readonly SectionShape[],
  ctx: PieceContext,
  { stub = 'wall' }: { stub?: 'wall' | 'none' } = {},
): SectionLabel[] {
  const labels: SectionLabel[] = [];
  const add = (name: string, value: number | undefined) => {
    if (value !== undefined && value > EPS) labels.push({ name, value, label: formatCm(value) });
  };
  if (stub === 'wall') add('Wall depth', ctx.wallDepth);
  add('Frame depth', depthOf(shapes, 'frame'));
  add('Sash depth', depthOf(shapes, 'sash'));
  add('Glass depth', depthOf(shapes, 'glass'));
  add('Panel depth', depthOf(shapes, 'panel'));
  add('Window board depth', depthOf(shapes, 'board'));
  add('Sill depth', depthOf(shapes, 'sill'));
  const shutterBox = shapes.filter((s) => s.role === 'shutter' && s.y[0] >= ctx.height / 2 - EPS);
  if (shutterBox.length > 0) {
    add('Shutter box height', Math.max(...shutterBox.map((s) => s.y[1])) - ctx.height / 2);
    add('Shutter box depth', depthOf(shutterBox, 'shutter'));
  }
  if (stub === 'wall') {
    add('Sill height', ctx.sill);
    add('Opening height', ctx.height);
  } else {
    const piece = shapes.filter((s) => s.role !== 'wall');
    if (piece.length > 0) {
      add('Height', Math.max(...piece.map((s) => s.y[1])) - Math.min(...piece.map((s) => s.y[0])));
    }
  }
  return labels;
}

/** A section's extent: [zMin, zMax], [yMin, yMax]. */
export function sectionBounds(shapes: readonly SectionShape[]) {
  return {
    z: [Math.min(...shapes.map((s) => s.z[0])), Math.max(...shapes.map((s) => s.z[1]))] as const,
    y: [Math.min(...shapes.map((s) => s.y[0])), Math.max(...shapes.map((s) => s.y[1]))] as const,
  };
}
