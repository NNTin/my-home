import type { Layout, LayoutItem } from '@my-home/shared';
import { vi } from 'vitest';
import { mockHome } from './fixtures';

/**
 * In-memory stand-in for the api behind `fetch`, enough for the web app: homes (read-only) and
 * layouts with versions and 409s. Tests inspect and change `layouts` directly to simulate edits
 * from another tab.
 */

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const notFound = (message: string) => json({ statusCode: 404, error: 'Not Found', message }, 404);

export const homeSummary = (id: string, name: string) => ({
  id,
  name,
  schemaVersion: 1,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
});

export interface FakeApiOptions {
  homes?: ReturnType<typeof homeSummary>[];
  models?: Record<string, unknown>;
  layouts?: Partial<Layout>[];
}

export function fakeApi({
  homes = [homeSummary('mock-home', 'Mock home')],
  models = {},
  layouts: initial = [],
}: FakeApiOptions = {}) {
  let n = 0;
  let clock = Date.parse('2026-01-01T00:00:00.000Z');
  const now = () => new Date((clock += 1000)).toISOString();
  const layouts = new Map<string, Layout>();
  const add = (homeId: string, name: string, items: LayoutItem[], extra: Partial<Layout> = {}) => {
    const at = now();
    const layout: Layout = {
      id: `layout-${++n}`,
      homeId,
      name,
      schemaVersion: 1,
      version: 1,
      items,
      createdAt: at,
      updatedAt: at,
      ...extra,
    };
    layouts.set(layout.id, layout);
    return layout;
  };
  for (const l of initial) add(l.homeId ?? 'mock-home', l.name ?? 'Layout', l.items ?? [], l);

  const handle = async (url: string, init: RequestInit = {}) => {
    const method = init.method ?? 'GET';
    const body = init.body ? JSON.parse(init.body as string) : undefined;
    let m: RegExpExecArray | null;

    if (url === '/api/homes') return json({ items: homes });
    if ((m = /^\/api\/homes\/([^/]+)\/layouts(\/import)?$/.exec(url))) {
      const homeId = decodeURIComponent(m[1]!);
      if (method === 'GET') {
        const items = [...layouts.values()]
          .filter((l) => l.homeId === homeId)
          .map(({ items, ...l }) => ({ ...l, itemCount: items.length }));
        return json({ items });
      }
      return json(add(homeId, body.name, body.items ?? []), 201);
    }
    if ((m = /^\/api\/homes\/([^/]+)$/.exec(url))) {
      const id = decodeURIComponent(m[1]!);
      const model = id === 'mock-home' ? mockHome : models[id];
      return model ? json(model) : notFound(`Home "${id}" not found`);
    }
    if ((m = /^\/api\/layouts\/([^/]+)(\/duplicate)?$/.exec(url))) {
      const id = decodeURIComponent(m[1]!);
      const layout = layouts.get(id);
      if (!layout) return notFound(`Layout "${id}" not found`);
      if (m[2])
        return json(add(layout.homeId, body?.name ?? `${layout.name} (copy)`, layout.items), 201);
      if (method === 'GET') return json(layout);
      if (method === 'DELETE') {
        layouts.delete(id);
        return new Response(null, { status: 204 });
      }
      if (body.version !== layout.version) {
        return json(
          {
            statusCode: 409,
            error: 'Conflict',
            message: 'stale',
            currentVersion: layout.version,
          },
          409,
        );
      }
      const updated = {
        ...layout,
        name: body.name,
        items: body.items,
        version: layout.version + 1,
        updatedAt: now(),
      };
      layouts.set(id, updated);
      return json(updated);
    }
    return notFound(`No route for ${method} ${url}`);
  };

  const fetchMock = vi.fn(handle);
  vi.stubGlobal('fetch', fetchMock);
  return {
    fetch: fetchMock,
    layouts,
    /** Simulates an edit from another tab or device. */
    touch(id: string, patch: Partial<Layout> = {}) {
      const layout = layouts.get(id)!;
      layouts.set(id, { ...layout, ...patch, version: layout.version + 1, updatedAt: now() });
    },
    calls: (method: string, pattern: RegExp) =>
      fetchMock.mock.calls.filter(
        ([url, init]) => (init?.method ?? 'GET') === method && pattern.test(url),
      ),
  };
}
