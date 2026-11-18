import { render, screen, within } from '@testing-library/react';
import { App } from '../App';
import { fakeApi, type FakeApiOptions } from './fakeApi';

/**
 * Opens a piece page at `path` (with its query and `#use=` anchor) on the fake api. The test file
 * must mock `../piece-page/Inspector` (no WebGL in jsdom), and `../scene/Scene` if it goes on to
 * the viewer.
 */
export function openPiece(path: string, options: FakeApiOptions = {}) {
  window.history.replaceState(null, '', path);
  const api = fakeApi(options);
  render(<App />);
  return api;
}

/** The where-used section. */
export const usesSection = () => within(screen.getByRole('region', { name: 'Uses' }));

/** The row of a use, by its DOM id (`use-<homeId>-<useId>`). */
export const rowOf = (homeId: string, useId: string) => {
  const row = document.getElementById(`use-${homeId}-${useId}`);
  if (!row) throw new Error(`no row for ${homeId}/${useId}`);
  return within(row);
};

/** `fetch` calls that are not GETs, as "METHOD url". */
export const writes = (api: ReturnType<typeof fakeApi>) =>
  api.fetch.mock.calls
    .filter(([, init]) => (init?.method ?? 'GET') !== 'GET')
    .map(([url, init]) => `${init!.method} ${url}`);

/** The JSON body of the last `method` call to a url matching `pattern`. */
export const lastBody = (api: ReturnType<typeof fakeApi>, method: string, pattern: RegExp) => {
  const calls = api.calls(method, pattern);
  const init = calls.at(-1)?.[1];
  return init?.body ? (JSON.parse(init.body as string) as unknown) : undefined;
};
