import { formatCm, type ParamValues } from '@my-home/shared';
import type { Vec3 } from '../builder/buildHome';
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
