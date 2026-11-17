import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { grabPhoto } from './CameraView';

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

  const withImageCapture = (photo: Blob | Error, size: [number, number]) => {
    vi.stubGlobal(
      'ImageCapture',
      class {
        takePhoto = () => (photo instanceof Error ? Promise.reject(photo) : Promise.resolve(photo));
      },
    );
    vi.stubGlobal(
      'createImageBitmap',
      vi.fn(() => Promise.resolve({ width: size[0], height: size[1], close: vi.fn() })),
    );
  };

  it('uses the frame of the video at its full size without ImageCapture', async () => {
    expect(await (await grabPhoto(video, track)).text()).toBe('frame 1080x1920');
  });

  it("takes the camera's full-resolution photo where ImageCapture is there", async () => {
    const photo = new Blob(['full photo']);
    withImageCapture(photo, [3000, 4000]);
    expect(await grabPhoto(video, track)).toBe(photo);
  });

  it('keeps to the frame when the photo is turned against the viewfinder or fails', async () => {
    withImageCapture(new Blob(['sideways']), [4000, 3000]);
    expect(await (await grabPhoto(video, track)).text()).toBe('frame 1080x1920');
    withImageCapture(new Error('not while streaming'), [3000, 4000]);
    expect(await (await grabPhoto(video, track)).text()).toBe('frame 1080x1920');
  });

  it('fails while the video has no picture yet', async () => {
    const empty = document.createElement('video');
    await expect(grabPhoto(empty)).rejects.toThrow(/no picture yet/);
  });
});
