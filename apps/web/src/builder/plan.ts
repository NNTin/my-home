import type { Point, Polygon } from '@my-home/shared';
import type { Vec2 } from './buildHome';

/** Plan helpers shared by the builder modules. Plan points are `[x, z]`. */

export const EPS = 1e-6;

export const toVec2 = (p: Point): Vec2 => [p.x.value, p.z.value];
export const toOutline = (polygon: Polygon): Vec2[] => polygon.map(toVec2);

/** Rotation about +y that maps the local +x axis onto the plan direction (dx, dz). */
export const rotationFor = (dx: number, dz: number) => Math.atan2(-dz, dx);
