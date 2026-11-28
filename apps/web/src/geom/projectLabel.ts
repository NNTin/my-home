import { Vector3, type Camera } from 'three';

/** Where a point in the scene falls on a view of `width` x `height` pixels, if it is in front of the camera. */
export function projectLabel(
  at: readonly [number, number, number],
  camera: Camera,
  width: number,
  height: number,
  out = new Vector3(),
): { x: number; y: number } | undefined {
  out.set(at[0], at[1], at[2]).project(camera);
  if (out.z > 1) return undefined;
  return { x: (out.x * 0.5 + 0.5) * width, y: (-out.y * 0.5 + 0.5) * height };
}
