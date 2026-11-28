export type Vec3 = [number, number, number];
export type Vec2 = [number, number];

/** A box: `size` is [length along its local x, height, depth]; rotated about y by `rotationY`. */
export interface Box {
  center: Vec3;
  size: Vec3;
  rotationY: number;
}
