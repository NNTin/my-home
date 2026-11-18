import type { ParamValues } from '@my-home/shared';
import { useEffect, useState } from 'react';
import { openingOverridesApi, type OpeningOverridesApi } from '../api';

export type OverrideMap = ReadonlyMap<string, ParamValues>;

const EMPTY: OverrideMap = new Map();

/**
 * The home's opening overrides (`GET /opening-overrides`) as `useId → params`, for
 * `buildHome(model, overrides)`. Reloaded when the tab becomes visible again; the map keeps its
 * identity while nothing changed, so the house is not rebuilt. A failed load draws the house
 * from the model alone; invalid or stale overrides are ignored by `effectiveParams`.
 */
export function useOpeningOverrides(
  homeId: string,
  visibleAgain: number,
  api: OpeningOverridesApi = openingOverridesApi,
): OverrideMap {
  const [overrides, setOverrides] = useState<{ key: string; map: OverrideMap }>({
    key: '[]',
    map: EMPTY,
  });
  useEffect(() => {
    const controller = new AbortController();
    api
      .list(homeId, controller.signal)
      .then(({ items }) => {
        const entries = items.map((o) => [o.useId, o.params] as const);
        const key = JSON.stringify(entries);
        setOverrides((current) => (current.key === key ? current : { key, map: new Map(entries) }));
      })
      .catch(() => {
        // Offline or aborted: keep what is drawn.
      });
    return () => controller.abort();
  }, [api, homeId, visibleAgain]);
  return overrides.map;
}
