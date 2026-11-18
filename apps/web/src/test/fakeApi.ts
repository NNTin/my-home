import {
  catalog,
  roomAt,
  type HomeModel,
  type HomeSettings,
  type OpeningOverride,
  type Photo,
  type PhotoRequest,
  type Placement,
} from '@my-home/shared';
import { vi } from 'vitest';
import { mockHome } from './fixtures';

/**
 * In-memory stand-in for the api behind `fetch`, enough for the web app: homes, their settings
 * (applied to the home as the api does) with versions and 409s, placements with versions, 409s
 * and the trash, opening overrides, and photos and photo requests with their trash. Tests inspect
 * `placements` and change them with `touch` to simulate edits by an agent or another tab.
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
  placements?: Placement[];
  overrides?: OpeningOverride[];
  photos?: Photo[];
  requests?: PhotoRequest[];
  /** `GET /api/catalog/usage`; `'error'` answers 500. */
  usage?: Record<string, number> | 'error';
}

export function fakeApi({
  homes = [homeSummary('mock-home', 'Mock home')],
  models = {},
  placements: initialPlacements = [],
  overrides = [],
  photos: initialPhotos = [],
  requests: initialRequests = [],
  usage = {},
}: FakeApiOptions = {}) {
  const photos = new Map(initialPhotos.map((p) => [p.id, p]));
  const requests = new Map(initialRequests.map((r) => [r.id, r]));
  const RETENTION_MS = 30 * 86_400_000;
  let clock = Date.parse('2026-01-01T00:00:00.000Z');
  const now = () => new Date((clock += 1000)).toISOString();
  const placements = new Map(initialPlacements.map((p) => [p.id, p]));
  const settings = new Map<string, HomeSettings>();
  const conflict = (currentVersion: number) =>
    json(
      {
        statusCode: 409,
        error: 'Conflict',
        message: 'stale',
        currentVersion,
        conflicts: ['version'],
      },
      409,
    );
  const modelOf = (id: string) =>
    (models[id] ?? (id === 'mock-home' ? mockHome : undefined)) as HomeModel | undefined;
  /** As the api: `<level>-<variant>-<n>`, named "<Room> · <Type>". */
  const createPlacement = (homeId: string, body: Record<string, unknown>): Placement => {
    const type = catalog.get(body.typeId as string)!;
    const levelId = body.levelId as string;
    const position = body.position as { x: number; z: number };
    const model = modelOf(homeId)!;
    const room = roomAt(model, levelId, position);
    const roomName = room && model.rooms.find((r) => r.id === room.id)?.name;
    const variant = type.id.split('.')[1]!;
    let k = 1;
    while (placements.has(`${levelId}-${variant}-${k}`)) k++;
    const at = now();
    return {
      id: `${levelId}-${variant}-${k}`,
      homeId,
      typeId: type.id,
      name: (body.name as string | undefined) ?? `${roomName ?? levelId} · ${type.name}`,
      levelId,
      roomId: room?.id ?? null,
      position,
      rotationY: (body.rotationY as number | undefined) ?? 0,
      params: (body.params as Placement['params'] | undefined) ?? {},
      version: 1,
      createdAt: at,
      updatedAt: at,
      removedAt: null,
      purgeAt: null,
    };
  };

  const handle = async (url: string, init: RequestInit = {}) => {
    const method = init.method ?? 'GET';
    const body = init.body ? JSON.parse(init.body as string) : undefined;
    let m: RegExpExecArray | null;

    if (url === '/api/homes') return json({ items: homes });
    if (url === '/api/catalog/usage') {
      if (usage === 'error')
        return json({ statusCode: 500, error: 'Internal Server Error', message: 'down' }, 500);
      return json({ counts: usage });
    }
    if ((m = /^\/api\/homes\/([^/]+)\/opening-overrides$/.exec(url))) {
      const homeId = decodeURIComponent(m[1]!);
      return json({ items: overrides.filter((o) => o.homeId === homeId) });
    }
    if (
      (m = /^\/api\/homes\/([^/]+)\/placements(?:\/([^/?]+)(\/restore)?)?(?:\?(.*))?$/.exec(url))
    ) {
      const homeId = decodeURIComponent(m[1]!);
      const query = new URLSearchParams(m[4]);
      if (!m[2]) {
        if (method === 'GET') {
          const all = [...placements.values()].filter((p) => p.homeId === homeId);
          return json({
            items: query.get('include') === 'removed' ? all : all.filter((p) => !p.removedAt),
          });
        }
        const created = createPlacement(homeId, body);
        placements.set(created.id, created);
        return json(created, 201);
      }
      const id = decodeURIComponent(m[2]);
      const current = placements.get(id);
      if (!current || current.homeId !== homeId) return notFound(`Placement "${id}" not found`);
      const at = now();
      let next: Placement;
      if (m[3]) {
        if (!current.removedAt) return conflict(current.version);
        next = { ...current, removedAt: null, purgeAt: null };
      } else if (method === 'DELETE') {
        if (current.removedAt || Number(query.get('version')) !== current.version) {
          return conflict(current.version);
        }
        next = {
          ...current,
          removedAt: at,
          purgeAt: new Date(Date.parse(at) + RETENTION_MS).toISOString(),
        };
      } else {
        if (current.removedAt || body.version !== current.version) return conflict(current.version);
        const patch = { ...(body as Record<string, unknown>) };
        delete patch.version;
        next = { ...current, ...(patch as Partial<Placement>) };
        if (patch.position) {
          const model = modelOf(homeId)!;
          next.roomId = roomAt(model, next.levelId, next.position)?.id ?? null;
        }
      }
      next = { ...next, version: current.version + 1, updatedAt: at };
      placements.set(id, next);
      return json(next);
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
    if ((m = /^\/api\/homes\/([^/]+)\/settings$/.exec(url))) {
      const homeId = decodeURIComponent(m[1]!);
      const current = settings.get(homeId) ?? {
        homeId,
        magneticDeclination: null,
        version: 0,
        updatedAt: null,
      };
      if (method === 'GET') return json(current);
      if (body.version !== current.version) {
        return json(
          {
            statusCode: 409,
            error: 'Conflict',
            message: 'stale',
            currentVersion: current.version,
            conflicts: ['version'],
          },
          409,
        );
      }
      const next = {
        homeId,
        magneticDeclination: body.magneticDeclination,
        version: current.version + 1,
        updatedAt: now(),
      };
      settings.set(homeId, next);
      return json(next);
    }
    if ((m = /^\/api\/homes\/([^/]+)$/.exec(url))) {
      const id = decodeURIComponent(m[1]!);
      // A saved home replaces the stored one, as `PUT /api/homes/:id` does.
      if (method === 'PUT') models[id] = body;
      const model = modelOf(id);
      if (!model) return notFound(`Home "${id}" not found`);
      // The effective model: the declination setting on top of the stored one.
      const declination = settings.get(id)?.magneticDeclination;
      return json(
        declination
          ? { ...model, building: { ...model.building, magneticDeclination: declination } }
          : model,
      );
    }
    return notFound(`No route for ${method} ${url}`);
  };

  const fetchMock = vi.fn(handle);
  vi.stubGlobal('fetch', fetchMock);
  return {
    fetch: fetchMock,
    placements,
    photos,
    requests,
    /** Simulates an edit by an agent or another tab. */
    touch(id: string, patch: Partial<Placement> = {}) {
      const p = placements.get(id)!;
      placements.set(id, { ...p, ...patch, version: p.version + 1, updatedAt: now() });
    },
    calls: (method: string, pattern: RegExp) =>
      fetchMock.mock.calls.filter(
        ([url, init]) => (init?.method ?? 'GET') === method && pattern.test(url),
      ),
  };
}
