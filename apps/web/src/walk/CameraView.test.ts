import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { grabPhoto } from './CameraView';
import { jpegHeader } from '../test/jpeg';

describe('grabPhoto', () => {
  const track = {} as MediaStreamTrack;
  let video: HTMLVideoElement;
  beforeEach(() => {
    video = document.createElement('video');
    Object.defineProperty(video, 'videoWidth', { value: 1080 });
    Object.defineProperty(video, 'videoHeight', { value: 1920 });
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
      drawImage: vi.fn(),
    } as unknown as CanvasRenderingContext2D);
    vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation(function (
      this: HTMLCanvasElement,
      done,
    ) {
      done(new Blob([`frame ${this.width}x${this.height}`]));
    });
  });
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  const decode = vi.fn();
  const withImageCapture = (photo: Blob | Error) => {
    vi.stubGlobal(
      'ImageCapture',
      class {
        takePhoto = () => (photo instanceof Error ? Promise.reject(photo) : Promise.resolve(photo));
      },
    );
    // The photo is never decoded: its header says which way up it is.
    vi.stubGlobal('createImageBitmap', decode);
  };

  it('uses the frame of the video at its full size without ImageCapture', async () => {
    expect(await (await grabPhoto(video, track)).text()).toBe('frame 1080x1920');
  });

  it("takes the camera's full-resolution photo where ImageCapture is there", async () => {
    const photo = new Blob([jpegHeader(3000, 4000)]);
    withImageCapture(photo);
    expect(await grabPhoto(video, track)).toBe(photo);
    // Taken across, and turned upright by its EXIF orientation: also the right way up.
    const turned = new Blob([jpegHeader(4000, 3000, 6)]);
    withImageCapture(turned);
    expect(await grabPhoto(video, track)).toBe(turned);
    expect(decode).not.toHaveBeenCalled();
  });

  it('keeps to the frame when the photo is turned against the viewfinder, unreadable or fails', async () => {
    withImageCapture(new Blob([jpegHeader(4000, 3000)]));
    expect(await (await grabPhoto(video, track)).text()).toBe('frame 1080x1920');
    withImageCapture(new Blob(['no jpeg header']));
    expect(await (await grabPhoto(video, track)).text()).toBe('frame 1080x1920');
    withImageCapture(new Error('not while streaming'));
    expect(await (await grabPhoto(video, track)).text()).toBe('frame 1080x1920');
  });

  it('fails while the video has no picture yet', async () => {
    const empty = document.createElement('video');
    await expect(grabPhoto(empty)).rejects.toThrow(/no picture yet/);
  });
});
