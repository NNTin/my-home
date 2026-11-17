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
