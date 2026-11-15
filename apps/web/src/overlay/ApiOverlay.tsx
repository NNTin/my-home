import type { Home } from '@my-home/shared';
import { useEffect, useState } from 'react';
import { fetchHomes } from '../api';

type State =
  { status: 'loading' } | { status: 'ready'; homes: Home[] } | { status: 'error'; message: string };

export function ApiOverlay() {
  const [state, setState] = useState<State>({ status: 'loading' });

  useEffect(() => {
    const controller = new AbortController();
    fetchHomes(controller.signal)
      .then(({ items }) => setState({ status: 'ready', homes: items }))
      .catch((err: unknown) => {
        if (controller.signal.aborted) return;
        setState({ status: 'error', message: err instanceof Error ? err.message : String(err) });
      });
    return () => controller.abort();
  }, []);

  return (
    <section className="overlay" aria-label="API status">
      <h1>my-home</h1>
      {state.status === 'loading' && <p>Loading homes…</p>}
      {state.status === 'error' && <p className="error">API error: {state.message}</p>}
      {state.status === 'ready' &&
        (state.homes.length === 0 ? (
          <p>No homes yet.</p>
        ) : (
          <>
            <p>Homes from the API:</p>
            <ul>
              {state.homes.map((home) => (
                <li key={home.id}>{home.name}</li>
              ))}
            </ul>
          </>
        ))}
    </section>
  );
}
