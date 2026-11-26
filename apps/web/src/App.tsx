import type { HomeModel, HomeSummary } from '@my-home/shared';
import { lazy, Suspense, useEffect, useState } from 'react';
import { fetchHome, fetchHomes } from './api';
import { beginLoading, stopLoading, loadingProgress } from './loading/loading';
import { href, keptQuery, Link, useDocumentTitle, useRoute } from './routing';
import { Viewer } from './Viewer';
import { saveWalkSession } from './walk/walkSession';

/** A lazy page's chunk, followed by the loading screen while it comes. */
function loadPage<T>(load: () => Promise<T>): () => Promise<T> {
  return () => {
    beginLoading('page');
    const chunk = load();
    chunk.then(
      () => loadingProgress('page'),
      () => stopLoading(),
    );
    return chunk;
  };
}

// The catalogue pages are chunks of their own: the viewer's first load does not grow with them.
const CatalogPage = lazy(loadPage(() => import('./catalog-page/CatalogPage')));
const PiecePage = lazy(loadPage(() => import('./piece-page/PiecePage')));

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
    // The loading screen follows the home's data, then the view (Viewer, scene/Frame.tsx).
    beginLoading('viewer');
    (async () => {
      const { items } = await fetchHomes(signal);
      loadingProgress('homes');
      const id = homeId ?? items[0]?.id;
      if (!id) {
        stopLoading();
        return setState({ status: 'empty' });
      }
      const model = await fetchHome(id, signal);
      loadingProgress('home');
      setState({ status: 'ready', homes: items, model });
    })().catch((err: unknown) => {
      if (signal.aborted) return;
      stopLoading();
      setState({ status: 'error', message: errorMessage(err) });
    });
    return () => {
      controller.abort();
      // Left before the view was in (another page, or another home): this load is over. A remount
      // (StrictMode, a new homeId) begins a fresh one right after.
      stopLoading('viewer');
    };
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
      ) : state.status === 'loading' ? null : (
        // While it loads, the loading screen (#boot, loading/loading.ts) is the status.
        <section className="overlay" aria-label="Status">
          <h1>my-home</h1>
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
  useEffect(() => stopLoading(), []);
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

/** A lazy page on its way: the loading screen (`loadPage`) shows its progress. */
function PageLoading() {
  return <div className="page" />;
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
