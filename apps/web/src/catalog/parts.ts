import { formatCm, type ParamValues } from '@my-home/shared';
import type { Vec2, Vec3 } from '../geom/types';
import type { DimensionLine, Part, PartMaterial, PartRole } from './types';

/** Building blocks for piece modules. */

export const box = (
  center: Vec3,
  size: Vec3,
  color: string,
  role: PartRole,
  material?: PartMaterial,
): Part => ({
  shape: 'box',
  center,
  size,
  rotationY: 0,
  color,
  role,
  ...(material && { material }),
});

/** An upright cylinder of `diameter` (or an elliptic one, `depth` across z). */
export const cylinder = (
  center: Vec3,
  diameter: number,
  height: number,
  color: string,
  role: PartRole,
  depth = diameter,
): Part => ({
  shape: 'cylinder',
  center,
  size: [diameter, height, depth],
  rotationY: 0,
  color,
  role,
});

/** A box whose edges and corners are rounded by `radius`: at most half its smallest side. */
export const roundedBox = (
  center: Vec3,
  size: Vec3,
  radius: number,
  color: string,
  role: PartRole,
  material?: PartMaterial,
): Part => ({
  ...box(center, size, color, role, material),
  shape: 'roundedBox',
  radius: Math.max(0, Math.min(radius, ...size.map((s) => s / 2))),
});

const span = (values: number[]) => {
  const [min, max] = [Math.min(...values), Math.max(...values)];
  return { middle: (min + max) / 2, size: max - min };
};

/**
 * A closed `outline` in x/y about `origin`, extruded through `depth` along z (half to each side
 * of the origin), then turned about the origin's y axis by `rotationY`: -π/2 lays the outline's x
 * along the piece's z (a moulding or a worktop edge that runs along x). The outline may wind
 * either way.
 */
export function extrude(
  origin: Vec3,
  outline: Vec2[],
  depth: number,
  color: string,
  role: PartRole,
  rotationY = 0,
  material?: PartMaterial,
): Part {
  const x = span(outline.map((p) => p[0]));
  const y = span(outline.map((p) => p[1]));
  return {
    shape: 'extrude',
    // The middle of the outline's box, turned with it.
    center: [
      origin[0] + x.middle * Math.cos(rotationY),
      origin[1] + y.middle,
      origin[2] - x.middle * Math.sin(rotationY),
    ],
    size: [x.size, y.size, depth],
    profile: outline.map(([px, py]) => [px - x.middle, py - y.middle]),
    rotationY,
    color,
    role,
    ...(material && { material }),
  };
}

/**
 * A `profile` of [radius, y] points about `origin`, turned about the origin's y axis: a pot, a
 * lamp shade, a turned leg. Give it from the bottom up along the outside (and back down the
 * inside for a hollow one), and a point twice for a sharp edge; see `PartShape`.
 */
export function lathe(
  origin: Vec3,
  profile: Vec2[],
  color: string,
  role: PartRole,
  material?: PartMaterial,
): Part {
  // A radius below zero is a mistake of the module: it is drawn on the axis, and said in development.
  if (import.meta.env.DEV && profile.some((p) => p[0] < 0))
    console.warn('lathe: a negative radius is drawn as 0', profile);
  const radii = profile.map((p) => Math.max(0, p[0]));
  const y = span(profile.map((p) => p[1]));
  const diameter = 2 * Math.max(...radii);
  return {
    shape: 'lathe',
    center: [origin[0], origin[1] + y.middle, origin[2]],
    size: [diameter, y.size, diameter],
    profile: profile.map(([, py], i) => [radii[i]!, py - y.middle]),
    rotationY: 0,
    color,
    role,
    ...(material && { material }),
  };
}

/**
 * A cylinder lying down, along x or along z (a rail, a rung, a pipe). `center` is its middle; its
 * `size` stays the upright cylinder's, as for every tilted part.
 */
export const rod = (
  center: Vec3,
  diameter: number,
  length: number,
  color: string,
  role: PartRole,
  along: 'x' | 'z' = 'x',
  material?: PartMaterial,
): Part => ({
  ...cylinder(center, diameter, length, color, role),
  rotationX: Math.PI / 2,
  rotationY: along === 'x' ? Math.PI / 2 : 0,
  ...(material && { material }),
});

/**
 * A board lying along x whose grain runs along x: a box turned a quarter. A texture is projected
 * in the part's own frame and the veneer's grain runs along the part's z on a face that looks up
 * (docs/design/realistic-render.md D73), so a worktop or a shelf is drawn this way.
 */
export const plank = (
  center: Vec3,
  [length, thickness, depth]: Vec3,
  color: string,
  role: PartRole,
  material?: PartMaterial,
): Part => ({
  ...box(center, [depth, thickness, length], color, role, material),
  rotationY: Math.PI / 2,
});

/** Points on an arc about `center`, from the angle `from` to `to` (radians, from +x towards +y). */
export const arc = ([cx, cy]: Vec2, radius: number, from: number, to: number, steps = 3): Vec2[] =>
  Array.from({ length: steps + 1 }, (_, i) => {
    const a = from + ((to - from) * i) / steps;
    return [cx + radius * Math.cos(a), cy + radius * Math.sin(a)];
  });

/** The outline of a `width` x `height` rectangle about the origin, its corners rounded by `radius`. */
export const roundedRect = (width: number, height: number, radius: number): Vec2[] =>
  [0, 1, 2, 3].flatMap((q) =>
    arc(
      [(q % 3 ? -1 : 1) * (width / 2 - radius), (q < 2 ? 1 : -1) * (height / 2 - radius)],
      radius,
      (q * Math.PI) / 2,
      ((q + 1) * Math.PI) / 2,
    ),
  );

/**
 * The outline of a strip `gauge` thick that follows `path`, its corners mitred: a bent bar or a
 * tube seen from its side (a handle, a hook, a tap, a chair's runner). For `extrude`.
 */
export function strip(path: Vec2[], gauge: number): Vec2[] {
  const normals = path.slice(1).map(([x, y], i): Vec2 => {
    const [dx, dy] = [x - path[i]![0], y - path[i]![1]];
    const length = Math.hypot(dx, dy);
    return [-dy / length, dx / length];
  });
  const side = (half: number) =>
    path.map(([x, y], i): Vec2 => {
      const a = normals[Math.max(0, i - 1)]!;
      const b = normals[Math.min(i, normals.length - 1)]!;
      const [mx, my] = [a[0] + b[0], a[1] + b[1]];
      const k = half / (mx * a[0] + my * a[1]);
      return [x + mx * k, y + my * k];
    });
  return [...side(gauge / 2), ...side(-gauge / 2).reverse()];
}

/**
 * A flat slab lying down, `width` along x and `depth` along z, its corners rounded by `radius`
 * in plan: an inset sink, a hob, a table top. `center` is its middle.
 */
export const slab = (
  center: Vec3,
  [width, thickness, depth]: Vec3,
  radius: number,
  color: string,
  role: PartRole,
  material?: PartMaterial,
): Part =>
  tilted(
    extrude(center, roundedRect(width, depth, radius), thickness, color, role, 0, material),
    Math.PI / 2,
  );

/**
 * A plan outline (`[x, z]` points in the piece's frame) standing from `bottom` to `top`: a tub's
 * wall, a bowl, a bent screen. Its `size` is the box before the tilt: `[x, z, height]`.
 */
export function upright(
  outline: Vec2[],
  bottom: number,
  top: number,
  color: string,
  role: PartRole,
  material?: PartMaterial,
): Part {
  const x = span(outline.map((p) => p[0]));
  const z = span(outline.map((p) => p[1]));
  return tilted(
    extrude(
      [x.middle, (bottom + top) / 2, z.middle],
      outline.map(([px, pz]): Vec2 => [px - x.middle, pz - z.middle]),
      top - bottom,
      color,
      role,
      0,
      material,
    ),
    Math.PI / 2,
  );
}

/** The part tilted about its own x axis by `angle` radians (see `Part.rotationX`). */
export const tilted = (part: Part, angle: number): Part => ({ ...part, rotationX: angle });

/** A numeric parameter; effective values always carry every key of their type. */
export function numberParam(values: ParamValues, key: string): number {
  const value = values[key];
  if (typeof value !== 'number') throw new Error(`Parameter "${key}" is not a number`);
  return value;
}

export function colorParam(values: ParamValues, key: string): string {
  const value = values[key];
  if (typeof value !== 'string') throw new Error(`Parameter "${key}" is not a colour`);
  return value;
}

export const dimension = (from: Vec3, to: Vec3, value: number, name?: string): DimensionLine => ({
  from,
  to,
  value,
  label: formatCm(value),
  ...(name && { name }),
});

/** The mean colour of the oak veneer's texture, 0 to 255 a channel. */
const OAK = [161, 126, 87];

/**
 * The tint that makes `wood.veneer` show `color`, as a stain does: a tint multiplies the texture,
 * so the colour is divided by the texture's own. Undefined for a colour lighter than oak in any
 * channel: no stain gives it, and the tint would be cut off at white.
 */
export function veneerTint(color: string): string | undefined {
  const n = Number.parseInt(color.slice(1), 16);
  const tint = OAK.map((mean, i) => Math.round((((n >> (16 - 8 * i)) & 0xff) * 255) / mean));
  if (tint.some((channel) => channel > 255)) return undefined;
  return `#${tint.map((channel) => channel.toString(16).padStart(2, '0')).join('')}`;
}

/** Mixes a `#rrggbb` colour towards black (`amount` < 0) or white (`amount` > 0). */
export function shade(color: string, amount: number) {
  const n = Number.parseInt(color.slice(1), 16);
  const target = amount < 0 ? 0 : 255;
  const t = Math.abs(amount);
  const channel = (shift: number) => {
    const c = (n >> shift) & 0xff;
    return Math.round(c + (target - c) * t);
  };
  return `#${((channel(16) << 16) | (channel(8) << 8) | channel(0)).toString(16).padStart(6, '0')}`;
}
