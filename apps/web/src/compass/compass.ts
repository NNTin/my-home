import type { Vec2, Vec3 } from '../geom/types';

/**
 * Compass math, without three.js. Bearings are degrees clockwise seen from above, starting at the
 * plan's -z axis (`building.northBearing` is the bearing of true north). The camera azimuth is
 * OrbitControls' azimuthal angle: radians about +y of the camera's offset from its target,
 * `atan2(dx, dz)`, so 0 is a camera south of the target looking towards -z.
 */

export const CARDINALS = ['N', 'E', 'S', 'W'] as const;
export type Cardinal = (typeof CARDINALS)[number];

const RAD = Math.PI / 180;

/** Normalises an angle in degrees to (-180, 180]. */
export function normalizeDegrees(deg: number): number {
  const r = ((deg % 360) + 360) % 360;
  return r > 180 ? r - 360 : r;
}

/** Unit plan direction `[x, z]` of a bearing; bearing 0 is -z, 90 is +x. */
export const directionOf = (bearingDeg: number): Vec2 => [
  Math.sin(bearingDeg * RAD),
  -Math.cos(bearingDeg * RAD),
];

/** Azimuth of a camera around its orbit target, as OrbitControls reports it. */
export const azimuthOf = (camera: Vec3, target: Vec3) =>
  Math.atan2(camera[0] - target[0], camera[2] - target[2]);

/**
 * How far to turn the compass rose clockwise (degrees) so its N points at true north on screen.
 * The camera looks along -(sin a, cos a), so a plan direction at bearing b shows at b + a.
 */
export const compassRotation = (northBearingDeg: number, azimuthRad: number) =>
  normalizeDegrees(northBearingDeg + azimuthRad / RAD);

/**
 * Camera position for a north-up view: same distance, height and target, turned about the
 * target so true north points up the screen.
 */
export function northUpPosition(camera: Vec3, target: Vec3, northBearingDeg: number): Vec3 {
  const radius = Math.hypot(camera[0] - target[0], camera[2] - target[2]);
  const azimuth = -northBearingDeg * RAD;
  return [
    target[0] + radius * Math.sin(azimuth),
    camera[1],
    target[2] + radius * Math.cos(azimuth),
  ];
}

export interface CompassMarker {
  label: Cardinal;
  position: Vec3;
}

/** N/E/S/W markers on the ground, `margin` metres outside the footprint's bounding box. */
export function compassMarkers(
  footprint: Vec2[],
  groundY: number,
  northBearingDeg: number,
  margin = 3,
): CompassMarker[] {
  if (footprint.length === 0) return [];
  const xs = footprint.map(([x]) => x);
  const zs = footprint.map(([, z]) => z);
  const cx = (Math.min(...xs) + Math.max(...xs)) / 2;
  const cz = (Math.min(...zs) + Math.max(...zs)) / 2;
  const radius =
    Math.hypot(Math.max(...xs) - Math.min(...xs), Math.max(...zs) - Math.min(...zs)) / 2 + margin;
  return CARDINALS.map((label, i) => {
    const [dx, dz] = directionOf(northBearingDeg + i * 90);
    return { label, position: [cx + dx * radius, groundY, cz + dz * radius] };
  });
}
