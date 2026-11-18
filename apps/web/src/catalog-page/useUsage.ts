import { useEffect, useState } from 'react';
import { catalogApi } from '../api';

export type Usage =
  | { status: 'loading' }
  | { status: 'ready'; counts: Readonly<Record<string, number>> }
  | { status: 'error' };

/** How often each type is used in this environment (`GET /api/catalog/usage`). */
export function useUsage(): Usage {
  const [usage, setUsage] = useState<Usage>({ status: 'loading' });
  useEffect(() => {
    const controller = new AbortController();
    catalogApi
      .usage(controller.signal)
      .then(({ counts }) => setUsage({ status: 'ready', counts }))
      .catch(() => {
        if (!controller.signal.aborted) setUsage({ status: 'error' });
      });
    return () => controller.abort();
  }, []);
  return usage;
}
