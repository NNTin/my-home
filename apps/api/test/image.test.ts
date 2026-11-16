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

  describe('nothing of the uploaded file itself is stored', () => {
    const SECRET = 'secret location';
    const chunk = (name: string, body: Buffer) => {
      const header = Buffer.alloc(8);
      header.write(name, 'latin1');
      header.writeUInt32LE(body.length, 4);
      return Buffer.concat([header, body, Buffer.alloc(body.length % 2)]);
    };
    /** Rebuilds a WebP from its chunks, each changed by `change`, with a correct RIFF size. */
    const rebuild = (file: Buffer, change: (name: string, body: Buffer) => Buffer[]) => {
      const chunks: Buffer[] = [];
      for (let offset = 12; offset < file.length;) {
        const size = file.readUInt32LE(offset + 4);
        const name = file.toString('latin1', offset, offset + 4);
        chunks.push(...change(name, file.subarray(offset + 8, offset + 8 + size)));
        offset += 8 + size + (size % 2);
      }
      const body = Buffer.concat([Buffer.from('WEBP', 'latin1'), ...chunks]);
      const header = Buffer.alloc(8);
      header.write('RIFF', 'latin1');
      header.writeUInt32LE(body.length, 4);
      return Buffer.concat([header, body]);
    };
    const stored = async () => (await processImage(await testImage({ exif }))).image.data;
    const lossless = () =>
      sharp({ create: { width: 64, height: 48, channels: 3, background: '#c87828' } })
        .webp({ lossless: true })
        .toBuffer();

    it('re-encodes a photo this server stored before (the copy tool), keeping its size', async () => {
      const first = await processImage(await testImage({ width: 800, height: 600 }));
      const copy = await processImage(first.image.data);
      expect([copy.image.width, copy.image.height]).toEqual([800, 600]);
      expect((await sharp(copy.image.data).metadata()).format).toBe('webp');
    });

    // Each of these files decodes fine: a container check alone would let the bytes through.
    it.each([
      [
        'behind the bitstream inside a lossy pixel chunk',
        async () =>
          rebuild(await stored(), (name, body) => [
            chunk(name, name === 'VP8 ' ? Buffer.concat([body, Buffer.from(SECRET)]) : body),
          ]),
      ],
      [
        'behind the bitstream inside a lossless pixel chunk',
        async () =>
          rebuild(await lossless(), (name, body) => [
            chunk(name, name === 'VP8L' ? Buffer.concat([body, Buffer.from(SECRET)]) : body),
          ]),
      ],
      [
        'in a second pixel chunk that decoders ignore',
        async () =>
          rebuild(await stored(), (name, body) => [
            chunk(name, body),
            chunk('VP8L', Buffer.from(SECRET)),
          ]),
      ],
      [
        'in an unknown chunk',
        async () =>
          rebuild(await stored(), (name, body) => [
            chunk(name, body),
            chunk('NOTE', Buffer.from(SECRET)),
          ]),
      ],
      [
        'after the end of the container',
        async () => Buffer.concat([await stored(), Buffer.from(SECRET)]),
      ],
    ])('drops bytes hidden %s', async (_where, build) => {
      const upload = await build();
      expect(upload.includes(SECRET)).toBe(true);
      // Stored re-encoded, or refused: never as it came.
      let result: Awaited<ReturnType<typeof processImage>>;
      try {
        result = await processImage(upload);
      } catch (err) {
        expect(err).toBeInstanceOf(UnsupportedImageError);
        return;
      }
      for (const image of [result.image, result.thumbnail]) {
        expect(image.data.includes(SECRET)).toBe(false);
        expect(image.data.equals(upload)).toBe(false);
      }
    });
  });

  it('answers a broken upload with a 415', async () => {
    const jpeg = await testImage({ width: 400, height: 300 });
    const error = await processImage(jpeg.subarray(0, 200)).catch((err: unknown) => err);
    expect(error).toBeInstanceOf(UnsupportedImageError);
    expect((error as UnsupportedImageError).statusCode).toBe(415);
  });
});
