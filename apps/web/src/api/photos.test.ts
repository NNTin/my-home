import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiRequestError, photosApi } from './index';

const stored = {
  id: 'photo-1',
  homeId: 'mock-home',
  levelId: 'souterrain',
  pose: { position: { x: 1, y: 0.4, z: 2 }, yaw: 0.5, pitch: 0 },
  capturedRoomId: null,
  capturedRoomName: null,
  capturedRoomStatus: 'none',
  room: null,
  levelInModel: true,
  takenAt: '2026-01-01T00:00:00.000Z',
  note: '',
  tags: [],
  requestId: null,
  image: { contentType: 'image/webp', width: 4, height: 3, byteSize: 10 },
  thumbnail: { contentType: 'image/webp', width: 4, height: 3, byteSize: 10 },
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  deletedAt: null,
  purgeAt: null,
};

/** A stand-in for XMLHttpRequest that the test completes by hand. */
class FakeXhr {
  static last: FakeXhr;
  upload: { onprogress?: (e: object) => void } = {};
  onload?: () => void;
  onerror?: () => void;
  onabort?: () => void;
  status = 0;
  responseText = '';
  method = '';
  url = '';
  body?: FormData;
  constructor() {
    FakeXhr.last = this;
  }
  open(method: string, url: string) {
    this.method = method;
    this.url = url;
  }
  send(body: FormData) {
    this.body = body;
  }
  respond(status: number, body: unknown) {
    this.status = status;
    this.responseText = typeof body === 'string' ? body : JSON.stringify(body);
    this.onload?.();
  }
}

const meta = { levelId: 'souterrain', pose: stored.pose, note: 'North wall' };

describe('photosApi.upload', () => {
  afterEach(() => vi.unstubAllGlobals());

  const start = (onProgress?: (fraction: number) => void) => {
    vi.stubGlobal('XMLHttpRequest', FakeXhr);
    const image = new Blob(['bytes'], { type: 'image/jpeg' });
    const result = photosApi.upload('mock-home', meta, image, onProgress);
    return { result, xhr: FakeXhr.last, image };
  };

  it('posts the pose and the image as multipart form data and reports progress', async () => {
    const progress: number[] = [];
    const { result, xhr } = start((fraction) => progress.push(fraction));
    expect([xhr.method, xhr.url]).toEqual(['POST', '/api/homes/mock-home/photos']);
    expect(JSON.parse(xhr.body!.get('meta') as string)).toEqual(meta);
    expect((xhr.body!.get('image') as File).size).toBe(5);

    xhr.upload.onprogress?.({ lengthComputable: true, loaded: 25, total: 100 });
    xhr.upload.onprogress?.({ lengthComputable: false, loaded: 50, total: 0 });
    xhr.upload.onprogress?.({ lengthComputable: true, loaded: 100, total: 100 });
    expect(progress).toEqual([0.25, 1]);

    xhr.respond(201, stored);
    await expect(result).resolves.toMatchObject({ id: 'photo-1', pose: stored.pose });
  });

  it('rejects with the message of the api', async () => {
    const { result, xhr } = start();
    xhr.respond(415, {
      statusCode: 415,
      error: 'Unsupported Media Type',
      message: 'Unsupported image format "gif": upload a JPEG, PNG or WebP',
    });
    await expect(result).rejects.toThrow(/Unsupported image format/);
    await expect(result).rejects.toBeInstanceOf(ApiRequestError);
    await expect(result).rejects.toMatchObject({ status: 415 });
  });

  it('rejects on a proxy error page, a network error, a sign-on page and an unexpected body', async () => {
    const proxy = start();
    proxy.xhr.respond(413, '<html>Request Entity Too Large</html>');
    await expect(proxy.result).rejects.toThrow(/failed: 413, the photo is too large/);

    const offline = start();
    offline.xhr.onerror?.();
    await expect(offline.result).rejects.toThrow(/no connection.*sign-in has expired/);

    const signOn = start();
    signOn.xhr.respond(200, '<html>Sign in</html>');
    await expect(signOn.result).rejects.toThrow(/sign-in has expired: reload the page/);

    const odd = start();
    odd.xhr.respond(201, { id: 'photo-1' });
    await expect(odd.result).rejects.toThrow(/unexpected response/);
  });
});
