import type { HomeModel, HomeSummary } from '@my-home/shared';
import { lazy, Suspense, useEffect, useState } from 'react';
import { fetchHome, fetchHomes } from './api';
import { href, keptQuery, Link, useDocumentTitle, useRoute } from './routing';
import { Viewer } from './Viewer';
import { saveWalkSession } from './walk/walkSession';

// The catalogue pages are chunks of their own: the viewer's first load does not grow with them.
const CatalogPage = lazy(() => import('./catalog-page/CatalogPage'));
const PiecePage = lazy(() => import('./catalog-page/PiecePage'));

type State =
  | { status: 'loading' }
  | { status: 'empty' }
  | { status: 'error'; message: string }
  | { status: 'ready'; homes: HomeSummary[]; model: HomeModel };

const errorMessage = (err: unknown) => (err instanceof Error ? err.message : String(err));

/** `?home=<id>` picks a home; otherwise the first one the API lists. */
const homeFromUrl = () => new URLSearchParams(window.location.search).get('home');

/** The 3D viewer on `/`, as it has always been. */
function HomeViewer() {
  useDocumentTitle();
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

function NotFound() {
  useDocumentTitle('Not found');
  return (
    <div className="page not-found">
      <main>
        <h1>Page not found</h1>
        <p>There is nothing at this address.</p>
        <p>
          <Link to={href({ page: 'viewer' }, keptQuery())}>← Home</Link>
        </p>
      </main>
    </div>
  );
}

function PageLoading() {
  return (
    <div className="page" role="status">
      Loading…
    </div>
  );
}

/**
 * The app's pages by address: `/` the viewer, `/catalog` the catalogue, `/catalog/<kind>/<typeId>`
 * a piece (docs/catalog.md). Leaving `/` unmounts the viewer: coming back starts a fresh view.
 */
export function App() {
  const route = useRoute();

  // A walk is kept for a reload of the viewer (the camera app), not for a visit elsewhere.
  useEffect(() => {
    if (route.page !== 'viewer') saveWalkSession(undefined);
  }, [route.page]);

  if (route.page === 'viewer') return <HomeViewer />;
  return (
    <Suspense fallback={<PageLoading />}>
      {route.page === 'catalog' ? (
        <CatalogPage />
      ) : route.page === 'piece' ? (
        <PiecePage key={route.typeId} typeId={route.typeId} />
      ) : (
        <NotFound />
      )}
    </Suspense>
  );
}
