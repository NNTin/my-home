import type { Layout, LayoutItem, Photo, PhotoRequest } from '@my-home/shared';
import { vi } from 'vitest';
import { mockHome } from './fixtures';

/**
 * In-memory stand-in for the api behind `fetch`, enough for the web app: homes (read-only),
 * layouts with versions and 409s, and photos and photo requests with their trash. Tests inspect and change `layouts` directly to simulate edits
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
  photos?: Photo[];
  requests?: PhotoRequest[];
}

export function fakeApi({
  homes = [homeSummary('mock-home', 'Mock home')],
  models = {},
  layouts: initial = [],
  photos: initialPhotos = [],
  requests: initialRequests = [],
}: FakeApiOptions = {}) {
  const photos = new Map(initialPhotos.map((p) => [p.id, p]));
  const requests = new Map(initialRequests.map((r) => [r.id, r]));
  const RETENTION_MS = 30 * 86_400_000;
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
    if (
      (m = /^\/api\/homes\/([^/]+)\/(photos|photo-requests|trash|trash\/empty)(\?.*)?$/.exec(url))
    ) {
      const of = <T extends { homeId: string }>(items: Map<string, T>) =>
        [...items.values()].filter((i) => i.homeId === decodeURIComponent(m![1]!));
      const live = of(photos).filter((p) => p.deletedAt === null);
      const linked = (r: PhotoRequest) => ({
        ...r,
        photoIds: live.filter((p) => p.requestId === r.id).map((p) => p.id),
      });
      if (m[2] === 'photos') {
        const query = new URLSearchParams(m[3]);
        const offset = Number(query.get('offset') ?? 0);
        const limit = Math.min(Number(query.get('limit') ?? 100), 500);
        return json({ items: live.slice(offset, offset + limit), total: live.length });
      }
      if (m[2] === 'photo-requests') {
        return json({
          items: of(requests)
            .filter((r) => r.deletedAt === null)
            .map(linked),
        });
      }
      const deleted = {
        photos: of(photos).filter((p) => p.deletedAt !== null),
        requests: of(requests).filter((r) => r.deletedAt !== null),
      };
      if (m[2] === 'trash') return json({ ...deleted, retentionDays: 30 });
      for (const p of deleted.photos) photos.delete(p.id);
      for (const r of deleted.requests) requests.delete(r.id);
      return json({ purgedPhotos: deleted.photos.length, purgedRequests: deleted.requests.length });
    }
    if ((m = /^\/api\/(photos|photo-requests)\/([^/]+)(?:\/(\w+))?$/.exec(url))) {
      const items: Map<string, Photo | PhotoRequest> = m[1] === 'photos' ? photos : requests;
      const id = decodeURIComponent(m[2]!);
      const item = items.get(id);
      if (!item) return notFound(`"${id}" not found`);
      const action = m[3] ?? method;
      if (action === 'purge') {
        if (item.deletedAt === null) {
          return json({ statusCode: 409, error: 'Conflict', message: 'not in the trash' }, 409);
        }
        items.delete(id);
        return new Response(null, { status: 204 });
      }
      const at = now();
      const patch: Record<string, object> = {
        PATCH: body ?? {},
        DELETE: { deletedAt: at, purgeAt: new Date(Date.parse(at) + RETENTION_MS).toISOString() },
        restore: { deletedAt: null, purgeAt: null },
        cancel: { status: 'cancelled', closedAt: at },
        reopen: { status: 'open', closedAt: null },
      };
      const updated = { ...item, ...patch[action], updatedAt: at } as Photo | PhotoRequest;
      items.set(id, updated);
      return json(updated);
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
    photos,
    requests,
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
