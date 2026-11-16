import {
  ApiError,
  HomeModel,
  Layout,
  LayoutConflict,
  ListHomesResponse,
  ListLayoutsResponse,
  Photo,
  type CreateLayoutBody,
  type CreatePhotoMeta,
  type UpdateLayoutBody,
  type UpdatePhotoBody,
} from '@my-home/shared';

interface Schema<T> {
  parse(value: unknown): T;
}

/** A non-2xx response; `message` reads `<METHOD> <url> failed: <api message or status>`. */
export class ApiRequestError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly body: unknown,
  ) {
    super(message);
    this.name = 'ApiRequestError';
  }
}

/** `PUT /api/layouts/:id` with a stale version. */
export class LayoutConflictError extends Error {
  constructor(readonly currentVersion: number) {
    super(`The layout was changed elsewhere (now at version ${currentVersion})`);
    this.name = 'LayoutConflictError';
  }
}

async function request<T>(
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE',
  url: string,
  schema: Schema<T> | undefined,
  { body, signal }: { body?: unknown; signal?: AbortSignal } = {},
): Promise<T> {
  const init: RequestInit = { signal };
  if (method !== 'GET') init.method = method;
  if (body !== undefined) {
    init.headers = { 'content-type': 'application/json' };
    init.body = JSON.stringify(body);
  }
  const res = await (method === 'GET' ? fetch(url, { signal }) : fetch(url, init));
  if (!res.ok) {
    const json: unknown = await res.json().catch(() => undefined);
    const conflict = res.status === 409 && LayoutConflict.safeParse(json);
    if (conflict && conflict.success) throw new LayoutConflictError(conflict.data.currentVersion);
    const error = ApiError.safeParse(json);
    throw new ApiRequestError(
      `${method} ${url} failed: ${error.success ? error.data.message : res.status}`,
      res.status,
      json,
    );
  }
  if (!schema) return undefined as T;
  return schema.parse(await res.json());
}

const homeUrl = (id: string) => `/api/homes/${encodeURIComponent(id)}`;
const layoutUrl = (id: string) => `/api/layouts/${encodeURIComponent(id)}`;

/** Typed API client; every response is validated with the shared schemas. */
export const fetchHomes = (signal?: AbortSignal): Promise<ListHomesResponse> =>
  request('GET', '/api/homes', ListHomesResponse, { signal });

export const fetchHome = (id: string, signal?: AbortSignal): Promise<HomeModel> =>
  request('GET', homeUrl(id), HomeModel, { signal });

export const layoutsApi = {
  list: (homeId: string, signal?: AbortSignal) =>
    request('GET', `${homeUrl(homeId)}/layouts`, ListLayoutsResponse, { signal }),
  get: (id: string, signal?: AbortSignal) => request('GET', layoutUrl(id), Layout, { signal }),
  create: (homeId: string, body: CreateLayoutBody) =>
    request('POST', `${homeUrl(homeId)}/layouts`, Layout, { body }),
  /** Throws `LayoutConflictError` when `body.version` is stale. */
  update: (id: string, body: UpdateLayoutBody) => request('PUT', layoutUrl(id), Layout, { body }),
  remove: (id: string) => request('DELETE', layoutUrl(id), undefined),
  duplicate: (id: string, name?: string) =>
    request('POST', `${layoutUrl(id)}/duplicate`, Layout, { body: name ? { name } : {} }),
  /** Creates a layout from a layout file (the parsed JSON of an export). */
  import: (homeId: string, file: unknown) =>
    request('POST', `${homeUrl(homeId)}/layouts/import`, Layout, { body: file }),
  exportUrl: (id: string) => `${layoutUrl(id)}/export`,
};
export type LayoutsApi = typeof layoutsApi;

const photoUrl = (id: string) => `/api/photos/${encodeURIComponent(id)}`;

/**
 * Uploads a photo with its pose. Uses XMLHttpRequest, the only way to follow upload progress:
 * `onProgress` gets the fraction sent, from 0 to 1.
 */
function uploadPhoto(
  homeId: string,
  meta: CreatePhotoMeta,
  image: Blob,
  onProgress?: (fraction: number) => void,
): Promise<Photo> {
  const url = `${homeUrl(homeId)}/photos`;
  const form = new FormData();
  form.set('meta', JSON.stringify(meta));
  form.set('image', image, 'photo');
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    const fail = (message: string, body?: unknown) =>
      reject(new ApiRequestError(`POST ${url} failed: ${message}`, xhr.status, body));
    xhr.open('POST', url);
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable && e.total > 0) onProgress?.(e.loaded / e.total);
    };
    xhr.onerror = () => fail('network error');
    xhr.onabort = () => fail('cancelled');
    xhr.onload = () => {
      let json: unknown;
      try {
        json = JSON.parse(xhr.responseText);
      } catch {
        json = undefined;
      }
      if (xhr.status < 200 || xhr.status >= 300) {
        const error = ApiError.safeParse(json);
        return fail(error.success ? error.data.message : String(xhr.status), json);
      }
      const photo = Photo.safeParse(json);
      if (photo.success) resolve(photo.data);
      else fail('unexpected response', json);
    };
    xhr.send(form);
  });
}

export const photosApi = {
  upload: uploadPhoto,
  update: (id: string, body: UpdatePhotoBody) => request('PATCH', photoUrl(id), Photo, { body }),
  imageUrl: (id: string) => `${photoUrl(id)}/image`,
  thumbnailUrl: (id: string) => `${photoUrl(id)}/thumbnail`,
};
export type PhotosApi = typeof photosApi;
