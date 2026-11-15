import { ListHomesResponse } from '@my-home/shared';

/** Typed client for the sample endpoint; responses are validated with the shared schema. */
export async function fetchHomes(signal?: AbortSignal): Promise<ListHomesResponse> {
  const res = await fetch('/api/homes', { signal });
  if (!res.ok) throw new Error(`GET /api/homes failed: ${res.status}`);
  return ListHomesResponse.parse(await res.json());
}
