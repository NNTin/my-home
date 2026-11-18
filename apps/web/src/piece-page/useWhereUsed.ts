import type { CatalogType, HomeSummary } from '@my-home/shared';
import { useCallback, useEffect, useRef, useState } from 'react';
import { fetchHome, fetchHomes, photosApi, placementsApi, usesApi } from '../api';
import type { HomeData } from './uses';

export type WhereUsedState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; homes: HomeData[] };

const message = (err: unknown) => (err instanceof Error ? err.message : String(err));

/** One home's data for the page; a failure is kept on the home instead of failing the page. */
async function loadHome(type: CatalogType, home: HomeSummary, signal?: AbortSignal) {
  try {
    const [model, uses, placements, photos, requests] = await Promise.all([
      fetchHome(home.id, signal),
      usesApi.list(home.id, type.id, signal),
      type.kind === 'furniture' ? placementsApi.list(home.id, signal) : { items: [] },
      photosApi.list(home.id, signal),
      photosApi.requests(home.id, signal),
    ]);
    return {
      home,
      model,
      uses: uses.items,
      placements: placements.items,
      photos: photos.items,
      requests: requests.items,
    } satisfies HomeData;
  } catch (err) {
    if (signal?.aborted) throw err;
    return {
      home,
      model: undefined,
      uses: [],
      placements: [],
      photos: [],
      requests: [],
      error: message(err),
    } satisfies HomeData;
  }
}

/**
 * The uses of a type in every home of this environment, with the homes' models, placements,
 * photos and photo requests. `reload(homeId)` fetches one home again (after a write); a newer
 * reload of the same home wins over an older, slower one, and a failed one keeps the data shown
 * (with `notice`) rather than replacing it with an error. It resolves to whether it worked.
 */
export function useWhereUsed(type: CatalogType) {
  const [state, setState] = useState<WhereUsedState>({ status: 'loading' });

  useEffect(() => {
    const controller = new AbortController();
    const { signal } = controller;
    (async () => {
      const { items } = await fetchHomes(signal);
      const homes = await Promise.all(items.map((home) => loadHome(type, home, signal)));
      if (!signal.aborted) setState({ status: 'ready', homes });
    })().catch((err: unknown) => {
      if (!signal.aborted) setState({ status: 'error', message: message(err) });
    });
    return () => controller.abort();
  }, [type]);

  const turns = useRef(new Map<string, number>());
  const reload = useCallback(
    async (homeId: string) => {
      const turn = (turns.current.get(homeId) ?? 0) + 1;
      turns.current.set(homeId, turn);
      const current = state.status === 'ready' ? state.homes : [];
      const home = current.find((h) => h.home.id === homeId)?.home;
      if (!home) return false;
      const fresh = await loadHome(type, home);
      if (turns.current.get(homeId) !== turn) return fresh.error === undefined;
      setState((s) =>
        s.status === 'ready'
          ? {
              ...s,
              homes: s.homes.map((h) => {
                if (h.home.id !== homeId) return h;
                // A failed reload keeps what was loaded (a save before it did work), with a notice.
                if (fresh.error !== undefined && h.error === undefined) {
                  return { ...h, notice: fresh.error };
                }
                return fresh;
              }),
            }
          : s,
      );
      return fresh.error === undefined;
    },
    [state, type],
  );

  return { state, reload };
}
