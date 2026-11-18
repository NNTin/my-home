import {
  ApiError,
  CatalogUsageResponse,
  HomeModel,
  ListHomesResponse,
  ListOpeningOverridesResponse,
  ListPlacementsResponse,
  EmptyTrashResponse,
  HomeSettings,
  ListPhotoRequestsResponse,
  ListPhotosResponse,
  Photo,
  PhotoRequest,
  Placement,
  TrashResponse,
  type CreatePhotoMeta,
  type CreatePlacementBody,
  type PutHomeSettingsBody,
  type UpdatePhotoBody,
  type UpdatePlacementBody,
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

/** Typed API client; every response is validated with the shared schemas. */
export const fetchHomes = (signal?: AbortSignal): Promise<ListHomesResponse> =>
  request('GET', '/api/homes', ListHomesResponse, { signal });

export const fetchHome = (id: string, signal?: AbortSignal): Promise<HomeModel> =>
  request('GET', homeUrl(id), HomeModel, { signal });

/** How often each catalogue type is used in this environment, over all homes. */
export const catalogApi = {
  usage: (signal?: AbortSignal) =>
    request('GET', '/api/catalog/usage', CatalogUsageResponse, { signal }),
};

/**
 * A home's settings, stored on top of its git model (which every deploy replaces): the magnetic
 * declination. `put` throws an `ApiRequestError` with status 409 when `version` is stale.
 */
export const homeSettingsApi = {
  get: (homeId: string, signal?: AbortSignal) =>
    request('GET', `${homeUrl(homeId)}/settings`, HomeSettings, { signal }),
  put: (homeId: string, body: PutHomeSettingsBody) =>
    request('PUT', `${homeUrl(homeId)}/settings`, HomeSettings, { body }),
};
export type HomeSettingsApi = typeof homeSettingsApi;

const placementUrl = (homeId: string, id: string) =>
  `${homeUrl(homeId)}/placements/${encodeURIComponent(id)}`;

/**
 * The home's furniture: one placement set per home (docs/furniture.md). Writes answer 409 (an
 * `ApiRequestError`, body `UseConflict`) when `version` is stale; removing moves to the trash.
 */
export const placementsApi = {
  /** Every placement, the trashed ones included (so an undone delete can be restored). */
  list: (homeId: string, signal?: AbortSignal) =>
    request('GET', `${homeUrl(homeId)}/placements?include=removed`, ListPlacementsResponse, {
      signal,
    }),
  create: (homeId: string, body: CreatePlacementBody) =>
    request('POST', `${homeUrl(homeId)}/placements`, Placement, { body }),
  update: (homeId: string, id: string, body: UpdatePlacementBody) =>
    request('PATCH', placementUrl(homeId, id), Placement, { body }),
  remove: (homeId: string, id: string, version: number) =>
    request('DELETE', `${placementUrl(homeId, id)}?version=${version}`, Placement),
  restore: (homeId: string, id: string) =>
    request('POST', `${placementUrl(homeId, id)}/restore`, Placement),
};
export type PlacementsApi = typeof placementsApi;

/** Basic-parameter overrides of the home model's openings, roof windows and gates. */
export const openingOverridesApi = {
  list: (homeId: string, signal?: AbortSignal) =>
    request('GET', `${homeUrl(homeId)}/opening-overrides`, ListOpeningOverridesResponse, {
      signal,
    }),
};
export type OpeningOverridesApi = typeof openingOverridesApi;

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
    // Also what an expired sign-on looks like: its redirect to the login page is cross-origin.
    xhr.onerror = () => fail('no connection to the server (offline, or the sign-in has expired)');
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
        if (error.success) return fail(error.data.message, json);
        return fail(xhr.status === 413 ? '413, the photo is too large' : String(xhr.status), json);
      }
      // A sign-on page that answered in place of the api.
      if (json === undefined) return fail('the sign-in has expired: reload the page');
      const photo = Photo.safeParse(json);
      if (photo.success) resolve(photo.data);
      else fail('unexpected response', json);
    };
    xhr.send(form);
  });
}

/** Photos fetched per request: the largest page the api serves. */
export const PHOTO_PAGE_SIZE = 500;

const requestUrl = (id: string) => `/api/photo-requests/${encodeURIComponent(id)}`;

/** Photos, photo requests and their trash (docs/photos.md). Deleting is a soft delete. */
export const photosApi = {
  upload: uploadPhoto,
  /**
   * Every photo of the home that is not in the trash, newest first. The api pages its list; the
   * gallery filters, counts and draws markers from all of them, so every page is fetched.
   */
  async list(homeId: string, signal?: AbortSignal): Promise<ListPhotosResponse> {
    const items: Photo[] = [];
    for (;;) {
      const url = `${homeUrl(homeId)}/photos?limit=${PHOTO_PAGE_SIZE}&offset=${items.length}`;
      const page = await request('GET', url, ListPhotosResponse, { signal });
      items.push(...page.items);
      // An empty page ends the loop too, should photos be deleted while paging.
      if (items.length >= page.total || page.items.length === 0)
        return { items, total: items.length };
    }
  },
  update: (id: string, body: UpdatePhotoBody) => request('PATCH', photoUrl(id), Photo, { body }),
  remove: (id: string) => request('DELETE', photoUrl(id), Photo),
  restore: (id: string) => request('POST', `${photoUrl(id)}/restore`, Photo),
  purge: (id: string) => request('POST', `${photoUrl(id)}/purge`, undefined),
  imageUrl: (id: string) => `${photoUrl(id)}/image`,
  thumbnailUrl: (id: string) => `${photoUrl(id)}/thumbnail`,

  requests: (homeId: string, signal?: AbortSignal) =>
    request('GET', `${homeUrl(homeId)}/photo-requests?status=all`, ListPhotoRequestsResponse, {
      signal,
    }),
  cancelRequest: (id: string) => request('POST', `${requestUrl(id)}/cancel`, PhotoRequest),
  reopenRequest: (id: string) => request('POST', `${requestUrl(id)}/reopen`, PhotoRequest),
  removeRequest: (id: string) => request('DELETE', requestUrl(id), PhotoRequest),
  restoreRequest: (id: string) => request('POST', `${requestUrl(id)}/restore`, PhotoRequest),
  purgeRequest: (id: string) => request('POST', `${requestUrl(id)}/purge`, undefined),

  trash: (homeId: string, signal?: AbortSignal) =>
    request('GET', `${homeUrl(homeId)}/trash`, TrashResponse, { signal }),
  emptyTrash: (homeId: string) =>
    request('POST', `${homeUrl(homeId)}/trash/empty`, EmptyTrashResponse),
};
export type PhotosApi = typeof photosApi;
