import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { horizontalFov } from './figure';
import { cameraJpeg, jpegHeader } from '../test/jpeg';
import {
  focalLength35mm,
  jpegIsPortrait,
  jpegSize,
  prepareImage,
  rememberedFocalLength,
  takenAtOf,
} from './prepareImage';

/** A minimal JPEG with an EXIF block that records only FocalLengthIn35mmFilm. */
function jpegWithFocalLength(focal: number, littleEndian: boolean): ArrayBuffer {
  const tiff = new DataView(new ArrayBuffer(8 + 2 + 12 + 4 + 2 + 12 + 4));
  const le = littleEndian;
  tiff.setUint16(0, le ? 0x4949 : 0x4d4d);
  tiff.setUint16(2, 42, le);
  tiff.setUint32(4, 8, le); // IFD0 follows the header
  tiff.setUint16(8, 1, le); // one entry: the Exif IFD pointer
  tiff.setUint16(10, 0x8769, le);
  tiff.setUint16(12, 4, le);
  tiff.setUint32(14, 1, le);
  tiff.setUint32(18, 26, le); // Exif IFD at offset 26
  tiff.setUint16(26, 1, le); // one entry: FocalLengthIn35mmFilm (SHORT)
  tiff.setUint16(28, 0xa405, le);
  tiff.setUint16(30, 3, le);
  tiff.setUint32(32, 1, le);
  tiff.setUint16(36, focal, le);

  const app1 = new Uint8Array(4 + 6 + tiff.byteLength);
  const header = new DataView(app1.buffer);
  header.setUint16(0, 0xffe1);
  header.setUint16(2, app1.byteLength - 2);
  app1.set([0x45, 0x78, 0x69, 0x66, 0, 0], 4); // "Exif\0\0"
  app1.set(new Uint8Array(tiff.buffer), 10);
  // SOI, a JFIF-style APP0 to skip over, the EXIF APP1, EOI.
  const app0 = [0xff, 0xe0, 0x00, 0x04, 0x00, 0x00];
  return new Uint8Array([0xff, 0xd8, ...app0, ...app1, 0xff, 0xd9]).buffer;
}

describe('focalLength35mm', () => {
  it('reads the 35 mm focal length from EXIF in either byte order', () => {
    expect(focalLength35mm(jpegWithFocalLength(26, true))).toBe(26);
    expect(focalLength35mm(jpegWithFocalLength(13, false))).toBe(13);
  });

  it('returns undefined for files without it, and never throws on junk', () => {
    expect(focalLength35mm(new Uint8Array([0xff, 0xd8, 0xff, 0xd9]).buffer)).toBeUndefined();
    expect(focalLength35mm(new Uint8Array([0x89, 0x50, 0x4e, 0x47]).buffer)).toBeUndefined();
    expect(focalLength35mm(new ArrayBuffer(0))).toBeUndefined();
    expect(focalLength35mm(jpegWithFocalLength(0, true))).toBeUndefined();
    const truncated = jpegWithFocalLength(26, true).slice(0, 30);
    expect(focalLength35mm(truncated)).toBeUndefined();
  });
});

describe('jpegIsPortrait', () => {
  it('reads the frame size, turned by the EXIF orientation', () => {
    expect(jpegIsPortrait(jpegHeader(3000, 4000))).toBe(true);
    expect(jpegIsPortrait(jpegHeader(4000, 3000))).toBe(false);
    expect(jpegIsPortrait(jpegHeader(4000, 3000, 1))).toBe(false);
    expect(jpegIsPortrait(jpegHeader(4000, 3000, 6))).toBe(true);
    expect(jpegIsPortrait(jpegHeader(4000, 3000, 8))).toBe(true);
    expect(jpegIsPortrait(jpegHeader(3000, 4000, 5))).toBe(false);
  });

  it('says nothing about what is not a readable JPEG header', () => {
    expect(jpegIsPortrait(new TextEncoder().encode('not a jpeg').buffer)).toBeUndefined();
    expect(jpegIsPortrait(new Uint8Array([0xff, 0xd8, 0xff, 0xc0, 0, 11]).buffer)).toBeUndefined();
  });
});

describe('jpegSize', () => {
  it('reads the picture size as shown, turned by the EXIF orientation', () => {
    expect(jpegSize(jpegHeader(4000, 3000))).toEqual({ width: 4000, height: 3000 });
    expect(jpegSize(jpegHeader(4000, 3000, 6))).toEqual({ width: 3000, height: 4000 });
    expect(jpegSize(cameraJpeg({ width: 4000, height: 3000, orientation: 8, focal: 23 }))).toEqual({
      width: 3000,
      height: 4000,
    });
    expect(jpegSize(new TextEncoder().encode('not a jpeg').buffer)).toBeUndefined();
  });
});

// The 35 mm side goes on the long edge (`horizontalFov`): the owner's phone at 23 mm.
const UPRIGHT_23MM = 2 * Math.atan(13.5 / 23);
const ACROSS_23MM = 2 * Math.atan(18 / 23);

describe('prepareImage', () => {
  beforeEach(() => localStorage.clear());

  // jsdom cannot decode images, which is the fallback path of an unsupported browser.
  it('falls back to the file itself and still derives the field of view', async () => {
    const file = new Blob([jpegWithFocalLength(13, true)], { type: 'image/jpeg' });
    const prepared = await prepareImage(file);
    expect(prepared.blob).toBe(file);
    // No frame size in that header: a phone held upright.
    expect(prepared.fovH).toBeCloseTo(horizontalFov(3, 4, 13));
  });

  it('assumes a typical phone camera when the focal length is unknown', async () => {
    const prepared = await prepareImage(new Blob(['not an image']));
    expect(prepared.fovH).toBeCloseTo(horizontalFov(3000, 4000));
  });

  it('takes the orientation of a camera-app or gallery file from its header (portrait)', async () => {
    // Stored across with orientation 6, as phones save upright photos.
    const file = new File(
      [cameraJpeg({ width: 4000, height: 3000, orientation: 6, focal: 23 })],
      'a.jpg',
    );
    expect((await prepareImage(file)).fovH).toBeCloseTo(UPRIGHT_23MM, 6);
    const upright = new File([cameraJpeg({ width: 3000, height: 4000, focal: 23 })], 'b.jpg');
    expect((await prepareImage(upright)).fovH).toBeCloseTo(UPRIGHT_23MM, 6);
  });

  it('takes the orientation of a camera-app or gallery file from its header (landscape)', async () => {
    const file = new File(
      [cameraJpeg({ width: 4000, height: 3000, orientation: 1, focal: 23 })],
      'c.jpg',
    );
    expect((await prepareImage(file)).fovH).toBeCloseTo(ACROSS_23MM, 6);
    // Turned twice by 90° (orientation 8 of an upright picture): across again.
    const turned = new File(
      [cameraJpeg({ width: 3000, height: 4000, orientation: 8, focal: 23 })],
      'd.jpg',
    );
    expect((await prepareImage(turned)).fovH).toBeCloseTo(ACROSS_23MM, 6);
  });

  it("uses the in-page camera's size and zoom for a video frame, which has no EXIF", async () => {
    const frame = new Blob(['frame'], { type: 'image/jpeg' });
    expect((await prepareImage(frame, { width: 1440, height: 1920 })).fovH).toBeCloseTo(
      horizontalFov(1440, 1920, 26),
    );
    expect((await prepareImage(frame, { width: 1920, height: 1440 })).fovH).toBeCloseTo(
      horizontalFov(1920, 1440, 26),
    );
    expect((await prepareImage(frame, { width: 1440, height: 1920, zoom: 2 })).fovH).toBeCloseTo(
      horizontalFov(1440, 1920, 26, 2),
    );
  });

  it("remembers the phone's focal length from its last EXIF photo for later frames", async () => {
    expect(rememberedFocalLength()).toBe(26);
    await prepareImage(new Blob([cameraJpeg({ width: 3000, height: 4000, focal: 23 })]));
    expect(rememberedFocalLength()).toBe(23);
    const frame = new Blob(['frame'], { type: 'image/jpeg' });
    expect((await prepareImage(frame, { width: 1440, height: 1920 })).fovH).toBeCloseTo(
      UPRIGHT_23MM,
      6,
    );
    // A photo's own EXIF focal length is used as it is: no zoom on top.
    const still = new Blob([cameraJpeg({ width: 3000, height: 4000, focal: 23 })]);
    expect((await prepareImage(still, { zoom: 2 })).fovH).toBeCloseTo(UPRIGHT_23MM, 6);
  });
});

describe('prepareImage in a browser that can decode', () => {
  beforeEach(() => localStorage.clear());
  afterEach(() => vi.unstubAllGlobals());

  it('scales to the upload limit and puts transparent pixels on white before encoding JPEG', async () => {
    const calls: string[] = [];
    const context = {
      fillStyle: '',
      fillRect: (...args: number[]) => calls.push(`fill ${context.fillStyle} ${args.join(',')}`),
      drawImage: (_image: unknown, ...args: number[]) => calls.push(`draw ${args.join(',')}`),
    };
    const encoded = new Blob(['jpeg'], { type: 'image/jpeg' });
    const canvas = {
      width: 0,
      height: 0,
      getContext: () => context,
      toBlob: (done: (blob: Blob) => void, type: string, quality: number) => {
        calls.push(`encode ${type} ${quality}`);
        done(encoded);
      },
    };
    vi.spyOn(document, 'createElement').mockReturnValue(canvas as unknown as HTMLCanvasElement);
    const close = vi.fn();
    vi.stubGlobal(
      'createImageBitmap',
      vi.fn().mockResolvedValue({ width: 4000, height: 3000, close }),
    );

    const prepared = await prepareImage(new Blob(['png with transparency'], { type: 'image/png' }));
    expect(prepared.blob).toBe(encoded);
    expect([canvas.width, canvas.height]).toEqual([2560, 1920]);
    // White first, then the photo, then the encoding.
    expect(calls).toEqual([
      'fill #fff 0,0,2560,1920',
      'draw 0,0,2560,1920',
      'encode image/jpeg 0.9',
    ]);
    // Landscape: the wide field of view.
    expect(prepared.fovH).toBeCloseTo(horizontalFov(4000, 3000));
    expect(close).toHaveBeenCalled();
    vi.restoreAllMocks();
  });

  it('measures the decoded picture, turned upright, in both orientations', async () => {
    const context = { fillStyle: '', fillRect: vi.fn(), drawImage: vi.fn() };
    const canvas = {
      width: 0,
      height: 0,
      getContext: () => context,
      toBlob: (done: (blob: Blob) => void) => done(new Blob(['jpeg'])),
    };
    vi.spyOn(document, 'createElement').mockReturnValue(canvas as unknown as HTMLCanvasElement);
    // The header says across with orientation 6; the browser decodes it upright.
    const file = new Blob([cameraJpeg({ width: 4000, height: 3000, orientation: 6, focal: 23 })]);
    vi.stubGlobal(
      'createImageBitmap',
      vi.fn().mockResolvedValue({ width: 3000, height: 4000, close: vi.fn() }),
    );
    expect((await prepareImage(file)).fovH).toBeCloseTo(UPRIGHT_23MM, 6);
    vi.stubGlobal(
      'createImageBitmap',
      vi.fn().mockResolvedValue({ width: 4000, height: 3000, close: vi.fn() }),
    );
    const across = new Blob([cameraJpeg({ width: 4000, height: 3000, focal: 23 })]);
    expect((await prepareImage(across)).fovH).toBeCloseTo(ACROSS_23MM, 6);
    vi.restoreAllMocks();
  });
});

describe('takenAtOf', () => {
  const now = Date.parse('2026-06-01T12:00:00.000Z');

  it('uses the time the camera gave the file', () => {
    const file = new File(['x'], 'photo.jpg', {
      lastModified: Date.parse('2026-05-30T08:15:00.000Z'),
    });
    expect(takenAtOf(file, now)).toBe('2026-05-30T08:15:00.000Z');
  });

  it('falls back to now for a time in the future, no time, or a plain blob', () => {
    const future = new File(['x'], 'photo.jpg', { lastModified: now + 60_000 });
    expect(takenAtOf(future, now)).toBe('2026-06-01T12:00:00.000Z');
    expect(takenAtOf(new File(['x'], 'photo.jpg', { lastModified: 0 }), now)).toBe(
      '2026-06-01T12:00:00.000Z',
    );
    expect(takenAtOf(new Blob(['x']), now)).toBe('2026-06-01T12:00:00.000Z');
  });
});
