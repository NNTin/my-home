import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import {
  isMetadataFreeWebp,
  MAX_PHOTO_EDGE,
  processImage,
  THUMBNAIL_EDGE,
  UnsupportedImageError,
} from '../src/photos/image';
import { testImage } from './helpers';

// Synthetic metadata: a made-up camera and a made-up position, nothing real.
const exif = {
  IFD0: { Make: 'TestCameraMaker', Model: 'TestCameraModel' },
  IFD3: {
    GPSLatitudeRef: 'N',
    GPSLatitude: '1/1 2/1 3/1',
    GPSLongitudeRef: 'E',
    GPSLongitude: '4/1 5/1 6/1',
  },
};

describe('processImage', () => {
  it('strips EXIF, including the GPS location, from the photo and the thumbnail', async () => {
    const input = await testImage({ exif });
    const before = await sharp(input).metadata();
    expect(before.exif).toBeDefined();
    expect(input.includes('TestCameraMaker')).toBe(true);

    const { image, thumbnail } = await processImage(input);
    for (const stored of [image, thumbnail]) {
      const metadata = await sharp(stored.data).metadata();
      expect(metadata.format).toBe('webp');
      expect(metadata.exif).toBeUndefined();
      expect(metadata.xmp).toBeUndefined();
      expect(metadata.iptc).toBeUndefined();
      expect(metadata.icc).toBeUndefined();
      expect(stored.data.includes('TestCameraMaker')).toBe(false);
      expect(stored.data.includes('GPS')).toBe(false);
      expect(stored.data.includes('Exif')).toBe(false);
    }
  });

  it('applies the EXIF orientation to the pixels before dropping the tag', async () => {
    // Orientation 6: the stored pixels are landscape, the photo is portrait.
    const { image } = await processImage(
      await testImage({ width: 80, height: 40, orientation: 6 }),
    );
    expect([image.width, image.height]).toEqual([40, 80]);
    expect((await sharp(image.data).metadata()).orientation).toBeUndefined();
  });

  it('resizes to the long-edge limit, never enlarges, and makes a thumbnail', async () => {
    const large = await processImage(await testImage({ width: 3200, height: 1600 }));
    expect([large.image.width, large.image.height]).toEqual([MAX_PHOTO_EDGE, MAX_PHOTO_EDGE / 2]);
    expect([large.thumbnail.width, large.thumbnail.height]).toEqual([
      THUMBNAIL_EDGE,
      THUMBNAIL_EDGE / 2,
    ]);
    expect(large.sha256).toMatch(/^[0-9a-f]{64}$/);

    const small = await processImage(await testImage({ width: 64, height: 48, format: 'png' }));
    expect([small.image.width, small.image.height]).toEqual([64, 48]);
    expect([small.thumbnail.width, small.thumbnail.height]).toEqual([64, 48]);
  });

  it('accepts JPEG, PNG and WebP and rejects everything else', async () => {
    for (const format of ['jpeg', 'png', 'webp'] as const) {
      expect((await processImage(await testImage({ format }))).image.contentType).toBe(
        'image/webp',
      );
    }
    await expect(processImage(await testImage({ format: 'gif' }))).rejects.toThrow(
      UnsupportedImageError,
    );
    await expect(processImage(Buffer.from('not an image'))).rejects.toThrow(UnsupportedImageError);
    await expect(
      processImage(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>')),
    ).rejects.toThrow(UnsupportedImageError);
  });

  describe('a photo this server stored before (the copy tool)', () => {
    it('is stored byte for byte, without a second lossy encoding', async () => {
      const first = await processImage(await testImage({ width: 800, height: 600, exif }));
      expect(isMetadataFreeWebp(first.image.data)).toBe(true);
      const copy = await processImage(first.image.data);
      expect(copy.image.data.equals(first.image.data)).toBe(true);
      expect(copy.sha256).toBe(first.sha256);
      expect([copy.image.width, copy.image.height]).toEqual([800, 600]);
      expect([copy.thumbnail.width, copy.thumbnail.height]).toEqual([480, 360]);
    });

    it('re-encodes a WebP that carries metadata or is too large', async () => {
      const withExif = await sharp(await testImage({ width: 80, height: 60 }))
        .withExif(exif)
        .webp()
        .toBuffer();
      expect(withExif.includes('TestCameraMaker')).toBe(true);
      expect(isMetadataFreeWebp(withExif)).toBe(false);
      const stripped = await processImage(withExif);
      expect(stripped.image.data.equals(withExif)).toBe(false);
      expect(stripped.image.data.includes('TestCameraMaker')).toBe(false);
      expect((await sharp(stripped.image.data).metadata()).exif).toBeUndefined();

      const large = await testImage({ width: 3200, height: 1600, format: 'webp' });
      expect(isMetadataFreeWebp(large)).toBe(true);
      expect((await processImage(large)).image.width).toBe(MAX_PHOTO_EDGE);
    });

    it('does not trust a container with unknown chunks or trailing data', async () => {
      const clean = (await processImage(await testImage())).image.data;
      const chunk = (name: string, body: string) => {
        const header = Buffer.alloc(8);
        header.write(name, 'latin1');
        header.writeUInt32LE(body.length, 4);
        return Buffer.concat([header, Buffer.from(body, 'latin1')]);
      };
      const withChunk = (extra: Buffer) => {
        const file = Buffer.concat([clean, extra]);
        file.writeUInt32LE(file.length - 8, 4);
        return file;
      };
      for (const name of ['EXIF', 'XMP ', 'ICCP', 'ANIM', 'NOTE']) {
        expect(isMetadataFreeWebp(withChunk(chunk(name, 'secret location'))), name).toBe(false);
      }
      // Bytes after the end of the container, and a truncated file.
      expect(isMetadataFreeWebp(Buffer.concat([clean, Buffer.from('secret location')]))).toBe(
        false,
      );
      expect(isMetadataFreeWebp(clean.subarray(0, clean.length - 3))).toBe(false);
      expect(isMetadataFreeWebp(Buffer.from('RIFF'))).toBe(false);

      // Uploading such a file never stores the hidden bytes.
      const smuggled = withChunk(chunk('NOTE', 'secret location'));
      const stored = await processImage(smuggled).then(
        (processed) => processed.image.data,
        () => Buffer.alloc(0),
      );
      expect(stored.includes('secret location')).toBe(false);
    });
  });

  it('answers a broken upload with a 415', async () => {
    const jpeg = await testImage({ width: 400, height: 300 });
    const error = await processImage(jpeg.subarray(0, 200)).catch((err: unknown) => err);
    expect(error).toBeInstanceOf(UnsupportedImageError);
    expect((error as UnsupportedImageError).statusCode).toBe(415);
  });
});
