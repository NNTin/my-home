/** A phone's main camera, when the photo does not say: about 26 mm (35 mm equivalent). */
export const DEFAULT_FOCAL_LENGTH_35MM = 26;

/**
 * Horizontal field of view of a photo `width` × `height` pixels (as shown, after its EXIF
 * orientation) from the camera's 35 mm equivalent focal length. The equivalent puts the 36 mm
 * side of the film frame on the picture's **long** edge, so the short edge spans 36 mm times
 * short / long: 27 mm on a phone's 4:3 picture, not the 24 mm of the 3:2 film frame (#70). A
 * 16:9 picture is the 4:3 sensor with the top and bottom cut off, so its long edge is the same.
 * `zoom` (the camera track's) narrows the view.
 */
export function horizontalFov(
  width: number,
  height: number,
  focalLength35mm = DEFAULT_FOCAL_LENGTH_35MM,
  zoom = 1,
): number {
  const across = width >= height || height <= 0 ? 1 : width / height;
  return 2 * Math.atan((18 * across) / (focalLength35mm * Math.max(zoom, 1e-3)));
}
