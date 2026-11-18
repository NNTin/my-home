/**
 * The header of a JPEG of `width` x `height`: an EXIF block with only the orientation (when
 * given), then the frame size. Enough for the readers in `prepareImage`; no pixels.
 */
export function jpegHeader(width: number, height: number, orientation?: number): ArrayBuffer {
  const bytes: number[] = [0xff, 0xd8];
  if (orientation !== undefined) {
    // APP1: "Exif\0\0", a big-endian TIFF header, IFD0 with one SHORT entry (0x0112).
    const tiff = [0x4d, 0x4d, 0, 42, 0, 0, 0, 8, 0, 1, 0x01, 0x12, 0, 3, 0, 0, 0, 1];
    tiff.push(orientation >> 8, orientation & 0xff, 0, 0, 0, 0, 0, 0);
    const body = [0x45, 0x78, 0x69, 0x66, 0, 0, ...tiff];
    bytes.push(0xff, 0xe1, (body.length + 2) >> 8, (body.length + 2) & 0xff, ...body);
  }
  // SOF0: length 11, precision 8, height, width, one component.
  bytes.push(0xff, 0xc0, 0, 11, 8, height >> 8, height & 0xff, width >> 8, width & 0xff);
  bytes.push(1, 1, 0x11, 0, 0xff, 0xd9);
  return new Uint8Array(bytes).buffer;
}

/**
 * The header of a camera JPEG: the frame size, plus EXIF with the orientation and the 35 mm
 * equivalent focal length where given (little-endian TIFF, as phones write it).
 */
export function cameraJpeg(options: {
  width: number;
  height: number;
  orientation?: number;
  focal?: number;
}): ArrayBuffer {
  const { width, height, orientation, focal } = options;
  const entries: [tag: number, type: number, value: number][] = [];
  if (orientation !== undefined) entries.push([0x0112, 3, orientation]);
  const ifd0Size = 2 + 12 * (entries.length + (focal === undefined ? 0 : 1)) + 4;
  if (focal !== undefined) entries.push([0x8769, 4, 8 + ifd0Size]);
  const tiff = new DataView(new ArrayBuffer(8 + ifd0Size + (focal === undefined ? 0 : 18)));
  tiff.setUint16(0, 0x4949);
  tiff.setUint16(2, 42, true);
  tiff.setUint32(4, 8, true);
  tiff.setUint16(8, entries.length, true);
  entries.forEach(([tag, type, value], i) => {
    const at = 10 + i * 12;
    tiff.setUint16(at, tag, true);
    tiff.setUint16(at + 2, type, true);
    tiff.setUint32(at + 4, 1, true);
    if (type === 3) tiff.setUint16(at + 8, value, true);
    else tiff.setUint32(at + 8, value, true);
  });
  if (focal !== undefined) {
    const exif = 8 + ifd0Size;
    tiff.setUint16(exif, 1, true);
    tiff.setUint16(exif + 2, 0xa405, true);
    tiff.setUint16(exif + 4, 3, true);
    tiff.setUint32(exif + 6, 1, true);
    tiff.setUint16(exif + 10, focal, true);
  }
  const body = [0x45, 0x78, 0x69, 0x66, 0, 0, ...new Uint8Array(tiff.buffer)];
  const bytes = [0xff, 0xd8, 0xff, 0xe1, (body.length + 2) >> 8, (body.length + 2) & 0xff, ...body];
  bytes.push(0xff, 0xc0, 0, 11, 8, height >> 8, height & 0xff, width >> 8, width & 0xff);
  bytes.push(1, 1, 0x11, 0, 0xff, 0xd9);
  return new Uint8Array(bytes).buffer;
}
