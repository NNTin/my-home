import type { HomeModel, HomeSummary } from '@my-home/shared';
import { useEffect, useState } from 'react';
import { fetchHome, fetchHomes } from './api';
import { Viewer } from './Viewer';

type State =
  | { status: 'loading' }
  | { status: 'empty' }
  | { status: 'error'; message: string }
  | { status: 'ready'; homes: HomeSummary[]; model: HomeModel };

const errorMessage = (err: unknown) => (err instanceof Error ? err.message : String(err));

/** `?home=<id>` picks a home; otherwise the first one the API lists. */
const homeFromUrl = () => new URLSearchParams(window.location.search).get('home');

export function App() {
  const [state, setState] = useState<State>({ status: 'loading' });
  const [homeId, setHomeId] = useState<string | null>(homeFromUrl);

  useEffect(() => {
    const controller = new AbortController();
    const { signal } = controller;
    (async () => {
      const { items } = await fetchHomes(signal);
      const id = homeId ?? items[0]?.id;
      if (!id) return setState({ status: 'empty' });
      const model = await fetchHome(id, signal);
      setState({ status: 'ready', homes: items, model });
    })().catch((err: unknown) => {
      if (!signal.aborted) setState({ status: 'error', message: errorMessage(err) });
    });
    return () => controller.abort();
  }, [homeId]);

  const selectHome = (id: string) => {
    const url = new URL(window.location.href);
    url.searchParams.set('home', id);
    window.history.replaceState(null, '', url);
    setHomeId(id);
  };

  return (
    <main className="app">
      {state.status === 'ready' ? (
        <Viewer
          key={state.model.id}
          model={state.model}
          homes={state.homes}
          onSelectHome={selectHome}
        />
      ) : (
        <section className="overlay" aria-label="Status">
          <h1>my-home</h1>
          {state.status === 'loading' && <p>Loading home…</p>}
          {state.status === 'empty' && (
            <p>No homes yet. Run `pnpm db:seed` or import a home file.</p>
          )}
          {state.status === 'error' && <p className="error">API error: {state.message}</p>}
        </section>
      )}
    </main>
  );
}
