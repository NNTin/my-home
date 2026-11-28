import { DEFAULT_FOCAL_LENGTH_35MM, horizontalFov } from '../photos/fieldOfView';

/** Longest edge of a photo sent to the api, which stores at most this much anyway. */
export const MAX_UPLOAD_EDGE = 2560;

/**
 * What is known about where a photo came from. The camera inside the page (`CameraView`) gives
 * the size of its picture as shown and the track's zoom. `source` says whether the photo was just
 * taken with this phone's camera (inside the page, or the camera app) rather than picked from the
 * gallery, which may hold a telephoto shot or one from another device.
 */
export interface CameraHints {
  width?: number;
  height?: number;
  zoom?: number;
  source?: 'in-page' | 'camera-app';
}

/** A phone's main camera (35 mm equivalent); anything else is another lens. */
export const MAIN_CAMERA_FOCAL_RANGE = { min: 20, max: 30 } as const;
const isMainCamera = (focal: number) =>
  focal >= MAIN_CAMERA_FOCAL_RANGE.min && focal <= MAIN_CAMERA_FOCAL_RANGE.max;

export interface PreparedImage {
  /** What to upload: resized and re-encoded where the browser can, else the file itself. */
  blob: Blob;
  /**
   * The photo's horizontal field of view in radians (`horizontalFov`): from the focal length in
   * its EXIF data, else a typical phone's, and the size of the picture as shown.
   */
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

/**
 * The size of the picture a JPEG shows, read from its header alone: the frame size (SOF marker),
 * turned by 90° when the EXIF orientation says so (values 5 to 8). Undefined when the header
 * does not say. Nothing is decoded, so this costs no memory even for a 50 MP photo.
 */
export function jpegSize(file: ArrayBuffer): { width: number; height: number } | undefined {
  const view = new DataView(file);
  if (view.byteLength < 4 || view.getUint16(0) !== 0xffd8) return undefined;
  let orientation = 1;
  let offset = 2;
  while (offset + 4 <= view.byteLength && view.getUint8(offset) === 0xff) {
    const marker = view.getUint8(offset + 1);
    const size = view.getUint16(offset + 2);
    if (
      marker === 0xe1 &&
      offset + 10 <= view.byteLength &&
      view.getUint32(offset + 4) === 0x45786966
    ) {
      orientation = readOrientation(
        view,
        offset + 10,
        Math.min(view.byteLength, offset + 2 + size),
      );
    }
    // SOF0 to SOF15, except DHT (C4), JPG (C8) and DAC (CC): height, then width.
    if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) {
      if (offset + 9 > view.byteLength) return undefined;
      const height = view.getUint16(offset + 5);
      const width = view.getUint16(offset + 7);
      if (width === 0 || height === 0) return undefined;
      const turned = orientation >= 5 && orientation <= 8;
      return turned ? { width: height, height: width } : { width, height };
    }
    if (marker === 0xda || size < 2) break;
    offset += 2 + size;
  }
  return undefined;
}

/** Whether a JPEG shows a picture taller than wide (`jpegSize`); undefined when it does not say. */
export function jpegIsPortrait(file: ArrayBuffer): boolean | undefined {
  const size = jpegSize(file);
  return size && size.height > size.width;
}

function readOrientation(view: DataView, tiff: number, end: number): number {
  if (tiff + 8 > end) return 1;
  const little = view.getUint16(tiff) === 0x4949;
  const ifd = tiff + view.getUint32(tiff + 4, little);
  if (ifd + 2 > end) return 1;
  const count = view.getUint16(ifd, little);
  for (let i = 0; i < count; i++) {
    const entry = ifd + 2 + i * 12;
    if (entry + 12 > end) return 1;
    if (view.getUint16(entry, little) === 0x0112) return view.getUint16(entry + 8, little);
  }
  return 1;
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

const FOCAL_LENGTH_KEY = 'my-home.camera.focal-length-35mm';

/**
 * The focal length of this phone's main camera as its last photo taken here said, else a typical
 * phone's. A video frame from the camera inside the page has no EXIF data of its own, and phones
 * differ (23 to 26 mm), which is 10 % of the field of view. Only a photo just taken with this
 * phone (not a gallery pick) and a main-camera value (`MAIN_CAMERA_FOCAL_RANGE`) count, so a
 * telephoto or ultra-wide shot never sets the view of later frames.
 */
export function rememberedFocalLength(): number {
  try {
    const value = Number(localStorage.getItem(FOCAL_LENGTH_KEY));
    return Number.isFinite(value) && isMainCamera(value) ? value : DEFAULT_FOCAL_LENGTH_35MM;
  } catch {
    return DEFAULT_FOCAL_LENGTH_35MM;
  }
}

function rememberFocalLength(focal: number) {
  try {
    localStorage.setItem(FOCAL_LENGTH_KEY, String(focal));
  } catch {
    // Private mode or no storage: the next frame uses the typical phone again.
  }
}

/**
 * Gets a camera photo ready for upload: reads the focal length, then draws the image onto a
 * canvas no larger than `MAX_UPLOAD_EDGE` and encodes it as JPEG. That keeps uploads small on a
 * phone connection and already leaves the file's metadata (including the GPS location) behind;
 * the api strips metadata again in any case.
 *
 * The field of view comes from the focal length and the picture's size as shown (after its EXIF
 * orientation). Without a focal length (a video frame of the camera inside the page) it is the
 * one this phone's last photo taken here had (`rememberedFocalLength`), narrowed by the track's
 * zoom.
 *
 * Falls back to the file itself when the browser cannot decode or encode it. In that case the
 * file's metadata does travel to the api (over HTTPS, behind the site's sign-on), which strips it
 * before anything is stored, and the size comes from the JPEG header or the camera.
 */
export async function prepareImage(file: Blob, camera: CameraHints = {}): Promise<PreparedImage> {
  let focal: number | undefined;
  let header: { width: number; height: number } | undefined;
  try {
    const head = await file.slice(0, 256 * 1024).arrayBuffer();
    focal = focalLength35mm(head);
    header = jpegSize(head);
  } catch {
    focal = undefined;
  }
  if (focal !== undefined && camera.source !== undefined && isMainCamera(focal)) {
    rememberFocalLength(focal);
  }
  const fov = (width: number, height: number) =>
    focal === undefined
      ? horizontalFov(width, height, rememberedFocalLength(), camera.zoom ?? 1)
      : horizontalFov(width, height, focal);
  try {
    const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
    const scale = Math.min(1, MAX_UPLOAD_EDGE / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    const context = canvas.getContext('2d');
    if (!context) throw new Error('no 2d context');
    // JPEG has no transparency: a see-through PNG goes onto white instead of turning black.
    context.fillStyle = '#fff';
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    const { width, height } = bitmap;
    bitmap.close();
    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, 'image/jpeg', 0.9),
    );
    if (!blob) throw new Error('encoding failed');
    return { blob, fovH: fov(width, height) };
  } catch {
    // The header's size, else the camera's; else a phone held upright with a 4:3 camera.
    const size =
      header ??
      (camera.width && camera.height ? { width: camera.width, height: camera.height } : undefined);
    return { blob: file, fovH: size ? fov(size.width, size.height) : fov(3, 4) };
  }
}

/**
 * When a photo was taken: the file's own time, which a phone camera sets at the shot, so a photo
 * picked or saved a while later keeps its real time. A time in the future (a wrong clock) or no
 * time at all falls back to now.
 */
export function takenAtOf(file: Blob, now = Date.now()): string {
  const modified = file instanceof File ? file.lastModified : NaN;
  return new Date(
    Number.isFinite(modified) && modified > 0 && modified <= now ? modified : now,
  ).toISOString();
}
