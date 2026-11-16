import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import {
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
});
