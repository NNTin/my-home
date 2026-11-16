import { DEFAULT_FOCAL_LENGTH_35MM, horizontalFov } from './figure';

/** Longest edge of a photo sent to the api, which stores at most this much anyway. */
export const MAX_UPLOAD_EDGE = 2560;

export interface PreparedImage {
  /** What to upload: resized and re-encoded where the browser can, else the file itself. */
  blob: Blob;
  /** The camera's horizontal field of view in radians: from its focal length, else a typical phone's. */
  fovH: number;
}

/**
 * The 35 mm equivalent focal length recorded in a JPEG's EXIF data, if any. Only this one number
 * is read: it tells how wide the camera saw. Nothing else of the metadata is used or sent on.
 */
export function focalLength35mm(file: ArrayBuffer): number | undefined {
  const view = new DataView(file);
  if (view.byteLength < 4 || view.getUint16(0) !== 0xffd8) return undefined;
  let offset = 2;
  while (offset + 4 <= view.byteLength && view.getUint8(offset) === 0xff) {
    const marker = view.getUint8(offset + 1);
    const size = view.getUint16(offset + 2);
    // APP1 with an "Exif\0\0" header holds a TIFF structure.
    if (
      marker === 0xe1 &&
      offset + 10 <= view.byteLength &&
      view.getUint32(offset + 4) === 0x45786966
    ) {
      return readFocalLength(view, offset + 10, Math.min(view.byteLength, offset + 2 + size));
    }
    if (marker === 0xda || size < 2) break;
    offset += 2 + size;
  }
  return undefined;
}

function readFocalLength(view: DataView, tiff: number, end: number): number | undefined {
  if (tiff + 8 > end) return undefined;
  const little = view.getUint16(tiff) === 0x4949;
  /** The value (or offset) field of `tag` in the directory at `ifd`, as a reader position. */
  const find = (ifd: number, tag: number): number | undefined => {
    if (ifd + 2 > end) return undefined;
    const count = view.getUint16(ifd, little);
    for (let i = 0; i < count; i++) {
      const entry = ifd + 2 + i * 12;
      if (entry + 12 > end) return undefined;
      if (view.getUint16(entry, little) === tag) return entry + 8;
    }
    return undefined;
  };
  const exifPointer = find(tiff + view.getUint32(tiff + 4, little), 0x8769);
  if (exifPointer === undefined) return undefined;
  const value = find(tiff + view.getUint32(exifPointer, little), 0xa405);
  if (value === undefined) return undefined;
  const focal = view.getUint16(value, little);
  return focal > 0 ? focal : undefined;
}

/**
 * Gets a camera photo ready for upload: reads the focal length, then draws the image onto a
 * canvas no larger than `MAX_UPLOAD_EDGE` and encodes it as JPEG. That keeps uploads small on a
 * phone connection and already leaves the file's metadata (including the GPS location) behind;
 * the api strips metadata again in any case. Falls back to the file itself when the browser
 * cannot decode or encode it.
 */
export async function prepareImage(file: Blob): Promise<PreparedImage> {
  let focal: number | undefined;
  try {
    focal = focalLength35mm(await file.slice(0, 256 * 1024).arrayBuffer());
  } catch {
    focal = undefined;
  }
  const fov = (portrait: boolean) => horizontalFov(portrait, focal ?? DEFAULT_FOCAL_LENGTH_35MM);
  try {
    const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
    const scale = Math.min(1, MAX_UPLOAD_EDGE / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    const context = canvas.getContext('2d');
    if (!context) throw new Error('no 2d context');
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    const portrait = bitmap.height > bitmap.width;
    bitmap.close();
    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, 'image/jpeg', 0.9),
    );
    if (!blob) throw new Error('encoding failed');
    return { blob, fovH: fov(portrait) };
  } catch {
    // Orientation unknown: phones are mostly held upright.
    return { blob: file, fovH: fov(true) };
  }
}
