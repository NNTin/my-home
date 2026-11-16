import { createHash } from 'node:crypto';
import sharp from 'sharp';

// Photos are processed one at a time (see `processImage`), so keep libvips small too.
sharp.cache(false);
sharp.concurrency(1);

/** Longest edge of a stored photo and of its thumbnail, in pixels. */
export const MAX_PHOTO_EDGE = 2560;
export const THUMBNAIL_EDGE = 480;
/** Uploads above this many pixels are rejected before decoding (a phone photo has 12 to 50 MP). */
export const MAX_INPUT_PIXELS = 120_000_000;
export const STORED_CONTENT_TYPE = 'image/webp';

const ACCEPTED_FORMATS = new Set(['jpeg', 'png', 'webp']);

export interface EncodedImage {
  data: Buffer;
  contentType: string;
  width: number;
  height: number;
}

export interface ProcessedImage {
  image: EncodedImage;
  thumbnail: EncodedImage;
  /** Of the stored image bytes. */
  sha256: string;
}

/** The upload is not a JPEG, PNG or WebP image, or cannot be decoded. Answered with a 415. */
export class UnsupportedImageError extends Error {
  readonly statusCode = 415;
  readonly code = 'Unsupported Media Type';
}

async function encode(input: Buffer, edge: number, quality: number): Promise<EncodedImage> {
  const { data, info } = await sharp(input, { limitInputPixels: MAX_INPUT_PIXELS })
    // Applies the EXIF orientation to the pixels, since the tag itself is dropped below.
    .rotate()
    .resize({ width: edge, height: edge, fit: 'inside', withoutEnlargement: true })
    // sharp writes no input metadata (EXIF with GPS, XMP, IPTC, ICC) unless asked to: re-encoding
    // is what strips it. Colours are converted to sRGB.
    .webp({ quality })
    .toBuffer({ resolveWithObject: true });
  return { data, contentType: STORED_CONTENT_TYPE, width: info.width, height: info.height };
}

/** Chunks of a WebP file that hold only pixels: the bitstream, its header and the alpha plane. */
const PIXEL_CHUNKS = new Set(['VP8 ', 'VP8L', 'VP8X', 'ALPH']);

/**
 * Whether a file is a WebP that holds nothing but pixels: a well-formed RIFF container whose
 * every chunk is a pixel chunk, with no EXIF, XMP, colour profile, animation or unknown chunk and
 * nothing after its end. Such a file is what this module writes, so it can be stored as it is.
 */
export function isMetadataFreeWebp(file: Buffer): boolean {
  if (file.length < 20 || file.toString('latin1', 0, 4) !== 'RIFF') return false;
  if (file.toString('latin1', 8, 12) !== 'WEBP') return false;
  if (file.readUInt32LE(4) + 8 !== file.length) return false;
  let offset = 12;
  while (offset < file.length) {
    if (offset + 8 > file.length) return false;
    if (!PIXEL_CHUNKS.has(file.toString('latin1', offset, offset + 4))) return false;
    const size = file.readUInt32LE(offset + 4);
    // Chunks are padded to an even length.
    offset += 8 + size + (size % 2);
  }
  return offset === file.length;
}

let queue: Promise<unknown> = Promise.resolve();

/**
 * Turns an upload into what is stored: the photo, at most `MAX_PHOTO_EDGE` on its long edge, and
 * a thumbnail, both re-encoded as WebP **without any metadata**. The original is not kept: it
 * carries EXIF (camera, time and GPS location), which must never be stored.
 *
 * The one upload that is not re-encoded is a photo this module wrote before (the copy tool sends
 * those): a WebP within the size limit that holds nothing but pixels is stored byte for byte, so
 * copying a photo between environments does not degrade it.
 *
 * Calls run one after another, so a burst of uploads cannot multiply the memory of decoding a
 * full-size phone photo.
 */
export function processImage(input: Buffer): Promise<ProcessedImage> {
  const run = async (): Promise<ProcessedImage> => {
    let metadata: Awaited<ReturnType<ReturnType<typeof sharp>['metadata']>>;
    try {
      metadata = await sharp(input, { limitInputPixels: MAX_INPUT_PIXELS }).metadata();
    } catch {
      throw new UnsupportedImageError('The upload is not an image this server can read');
    }
    const { format } = metadata;
    if (!format || !ACCEPTED_FORMATS.has(format)) {
      throw new UnsupportedImageError(
        `Unsupported image format "${format ?? 'unknown'}": upload a JPEG, PNG or WebP`,
      );
    }
    const stored =
      format === 'webp' &&
      Math.max(metadata.width, metadata.height) <= MAX_PHOTO_EDGE &&
      isMetadataFreeWebp(input);
    // Decoding the upload is where a broken or unreadable file shows: that is the caller's
    // fault (415). Anything that fails after that is ours and stays a 500.
    let image: EncodedImage;
    let thumbnail: EncodedImage | undefined;
    try {
      if (stored) {
        thumbnail = await encode(input, THUMBNAIL_EDGE, 70);
        image = {
          data: input,
          contentType: STORED_CONTENT_TYPE,
          width: metadata.width,
          height: metadata.height,
        };
      } else {
        image = await encode(input, MAX_PHOTO_EDGE, 82);
      }
    } catch (err) {
      throw new UnsupportedImageError(`The image cannot be decoded: ${(err as Error).message}`);
    }
    thumbnail ??= await encode(image.data, THUMBNAIL_EDGE, 70);
    return { image, thumbnail, sha256: createHash('sha256').update(image.data).digest('hex') };
  };
  const result = queue.then(run, run);
  queue = result.catch(() => undefined);
  return result;
}
