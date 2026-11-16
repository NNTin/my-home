import { ApiError, HomeModel, ListHomesResponse } from '@my-home/shared';

async function getJson<T>(url: string, schema: { parse(value: unknown): T }, signal?: AbortSignal) {
  const res = await fetch(url, { signal });
  if (!res.ok) {
    const body = ApiError.safeParse(await res.json().catch(() => undefined));
    throw new Error(`GET ${url} failed: ${body.success ? body.data.message : res.status}`);
  }
  return schema.parse(await res.json());
}

/** Typed API client; every response is validated with the shared schemas. */
export const fetchHomes = (signal?: AbortSignal): Promise<ListHomesResponse> =>
  getJson('/api/homes', ListHomesResponse, signal);

export const fetchHome = (id: string, signal?: AbortSignal): Promise<HomeModel> =>
  getJson(`/api/homes/${encodeURIComponent(id)}`, HomeModel, signal);
