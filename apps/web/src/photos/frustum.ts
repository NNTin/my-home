import { poseDirection, type Photo, type PhotoPose } from '@my-home/shared';
import type { Vec3 } from '../geom/types';
import { DEFAULT_FOCAL_LENGTH_35MM, horizontalFov } from './fieldOfView';

/**
 * Camera maths for showing photos in the 3D view: the view cone of a photo's pose, and the
 * field of view that makes the 3D camera see what the photo shows. Plain numbers, no three.js.
 */

/** Width over height of the stored image. */
export const aspectOf = (photo: Pick<Photo, 'image'>) => photo.image.width / photo.image.height;

/** The photo's horizontal field of view; a typical phone camera when it was not recorded. */
export const fovHOf = (photo: Pick<Photo, 'pose' | 'image'>) =>
  photo.pose.fovH ??
  horizontalFov(photo.image.width, photo.image.height, DEFAULT_FOCAL_LENGTH_35MM);

/** Vertical field of view for a horizontal one at an aspect ratio (width / height). */
export const verticalFov = (fovH: number, aspect: number) =>
  2 * Math.atan(Math.tan(fovH / 2) / aspect);

export interface CameraBasis {
  forward: Vec3;
  right: Vec3;
  up: Vec3;
}

/** The camera's axes for a pose: unit vectors, `up` tilted with the pitch, no roll. */
export function cameraBasis(pose: Pick<PhotoPose, 'yaw' | 'pitch'>): CameraBasis {
  const f = poseDirection(pose);
  const right: Vec3 = [Math.cos(pose.yaw), 0, -Math.sin(pose.yaw)];
  const forward: Vec3 = [f.x, f.y, f.z];
  // up = right × forward
  const up: Vec3 = [
    right[1] * forward[2] - right[2] * forward[1],
    right[2] * forward[0] - right[0] * forward[2],
    right[0] * forward[1] - right[1] * forward[0],
  ];
  return { forward, right, up };
}

/**
 * The four corners of the image plane `distance` in front of the camera, in the order top left,
 * top right, bottom right, bottom left as seen by the camera. With the camera position they span
 * the view cone (frustum) of the photo.
 */
export function frustumCorners(
  pose: PhotoPose,
  fovH: number,
  aspect: number,
  distance: number,
): Vec3[] {
  const { forward, right, up } = cameraBasis(pose);
  const halfWidth = Math.tan(fovH / 2) * distance;
  const halfHeight = halfWidth / aspect;
  const { x, y, z } = pose.position;
  const corner = (h: number, v: number): Vec3 => [
    x + forward[0] * distance + right[0] * halfWidth * h + up[0] * halfHeight * v,
    y + forward[1] * distance + right[1] * halfWidth * h + up[1] * halfHeight * v,
    z + forward[2] * distance + right[2] * halfWidth * h + up[2] * halfHeight * v,
  ];
  return [corner(-1, 1), corner(1, 1), corner(1, -1), corner(-1, -1)];
}

/**
 * The vertical field of view (radians) for the 3D camera so that a photo laid over the view,
 * scaled to fit inside it ("contain"), lines up with the model: the photo's frame fills the
 * height of a wider view, or the width of a narrower one.
 */
export function matchingVerticalFov(fovH: number, photoAspect: number, viewAspect: number) {
  return viewAspect >= photoAspect ? verticalFov(fovH, photoAspect) : verticalFov(fovH, viewAspect);
}

/** A compass-style heading for display: degrees clockwise from plan north (-z), 0 to 360. */
export const headingDegrees = (yaw: number) => {
  const degrees = ((-yaw * 180) / Math.PI) % 360;
  return (Math.round(degrees < 0 ? degrees + 360 : degrees) % 360) + 0;
};
