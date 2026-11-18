import {
  catalog,
  describeChanges,
  effectiveParams,
  modelUses,
  openingFitIssues,
  roomAt,
  type HistoryEntry,
  type HomeModel,
  type Note,
  type Use,
  type UseState,
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
 * and the trash, opening overrides (with versions, 409s and fit 422s), where-used, the history of
 * every write with its undo, notes, and photos (with their subjects) and photo requests with their
 * trash. Tests inspect `placements` and change them with `touch` to simulate edits by an agent or
 * another tab.
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
  history?: HistoryEntry[];
  notes?: Note[];
  /** Who `GET /api/whoami` says writes; also the `actor` of the history it records. */
  actor?: 'owner' | 'agent';
}

export function fakeApi({
  homes = [homeSummary('mock-home', 'Mock home')],
  models = {},
  placements: initialPlacements = [],
  overrides = [],
  photos: initialPhotos = [],
  requests: initialRequests = [],
  usage = {},
  history: initialHistory = [],
  notes: initialNotes = [],
  actor: initialActor = 'owner',
}: FakeApiOptions = {}) {
  let actor = initialActor;
  const overrideRows = new Map(overrides.map((o) => [`${o.homeId}/${o.useId}`, o]));
  const historyRows: HistoryEntry[] = [...initialHistory];
  const notes = new Map(initialNotes.map((n) => [n.id, n]));
  let serial = 0;
  const uuid = () => `00000000-0000-4000-8000-${String(++serial).padStart(12, '0')}`;
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

  const placementState = (p: Placement): UseState => ({
    name: p.name,
    params: p.params,
    levelId: p.levelId,
    roomId: p.roomId,
    position: p.position,
    rotationY: p.rotationY,
    removed: p.removedAt !== null,
  });
  /** The use's state as history stores it; undefined when there is no such use. */
  const stateOf = (homeId: string, useId: string): UseState | undefined => {
    const p = placements.get(useId);
    if (p && p.homeId === homeId) return placementState(p);
    const o = overrideRows.get(`${homeId}/${useId}`);
    if (o) return { params: o.params };
    const model = modelOf(homeId);
    return model && modelUses(model).some((u) => u.id === useId) ? { params: {} } : undefined;
  };
  const typeOfUse = (homeId: string, useId: string) => {
    const p = placements.get(useId);
    const typeId =
      p?.typeId ?? modelUses(modelOf(homeId) ?? mockHome).find((u) => u.id === useId)?.typeId;
    return typeId === undefined ? undefined : catalog.get(typeId);
  };
  /** Fields an entry changed: `name`, `removed` and each `params.<key>`. */
  const changed = (e: Pick<HistoryEntry, 'before' | 'after'>) => {
    const before = e.before ?? { ...e.after!, removed: true };
    const after = e.after!;
    const keys = new Set([...Object.keys(before.params), ...Object.keys(after.params)]);
    return [
      ...(['name', 'removed'] as const).filter((f) => before[f] !== after[f]),
      ...[...keys].filter((k) => before.params[k] !== after.params[k]).map((k) => `params.${k}`),
    ];
  };
  const read = (state: UseState, field: string) =>
    field.startsWith('params.')
      ? state.params[field.slice(7)]
      : (state as Record<string, unknown>)[field];
  const undoTarget = (e: HistoryEntry, current: UseState): UseState => {
    const before = e.before ?? { ...e.after!, removed: true };
    const target = { ...current, params: { ...current.params } };
    for (const field of changed(e)) {
      const value = read(before, field);
      if (field.startsWith('params.')) {
        if (value === undefined) delete target.params[field.slice(7)];
        else target.params[field.slice(7)] = value as string | number;
      } else (target as Record<string, unknown>)[field] = value;
    }
    return target;
  };
  const apply = (homeId: string, useId: string, state: UseState) => {
    const p = placements.get(useId);
    if (p && p.homeId === homeId) {
      const at = now();
      placements.set(useId, {
        ...p,
        name: state.name ?? p.name,
        params: state.params,
        removedAt: state.removed ? at : null,
        purgeAt: state.removed ? new Date(Date.parse(at) + RETENTION_MS).toISOString() : null,
        version: p.version + 1,
        updatedAt: at,
      });
      return;
    }
    const o = overrideRows.get(`${homeId}/${useId}`)!;
    overrideRows.set(`${homeId}/${useId}`, {
      ...o,
      params: state.params,
      version: o.version + 1,
      updatedAt: now(),
    });
  };
  const record = (
    homeId: string,
    useId: string,
    useKind: HistoryEntry['useKind'],
    action: HistoryEntry['action'],
    before: UseState | null,
    after: UseState,
    undoesId: string | null = null,
  ) => {
    const entry: HistoryEntry = {
      id: uuid(),
      homeId,
      useId,
      useKind,
      action,
      actor,
      actorSource: 'declared',
      actorName: null,
      at: now(),
      before,
      after,
      changes: describeChanges(typeOfUse(homeId, useId), before, after),
      undoesId,
      undoneById: null,
      canUndo: false,
    };
    historyRows.push(entry);
    return entry;
  };
  /** Newest first, with `undoneById` and `canUndo` as the api works them out. */
  const entriesOf = (homeId: string, useId: string): HistoryEntry[] => {
    const current = stateOf(homeId, useId);
    const rows = historyRows.filter((e) => e.homeId === homeId && e.useId === useId);
    return rows
      .map((e) => {
        const undoneById = rows.find((r) => r.undoesId === e.id)?.id ?? e.undoneById;
        const fields = e.after ? changed(e) : [];
        const canUndo =
          current !== undefined &&
          undoneById === null &&
          fields.length > 0 &&
          fields.every((f) => read(current, f) === read(e.after!, f));
        return { ...e, undoneById, canUndo };
      })
      .reverse();
  };
  const placementUse = (model: HomeModel, p: Placement): Use => {
    const type = catalog.get(p.typeId);
    const level = model.levels.find((l) => l.id === p.levelId);
    const room = model.rooms.find((r) => r.id === p.roomId);
    const problems = [
      ...(level ? [] : [`level "${p.levelId}" is not in the home model`]),
      ...(p.roomId !== null && !room ? [`room "${p.roomId}" is not in the home model`] : []),
    ];
    return {
      id: p.id,
      homeId: p.homeId,
      typeId: p.typeId,
      kind: 'furniture',
      source: 'db',
      name: p.name,
      levelId: p.levelId,
      roomIds: p.roomId === null ? [] : [p.roomId],
      where: [level?.name ?? p.levelId, room?.name].filter(Boolean).join(' · '),
      overrides: p.params,
      effective: type ? effectiveParams(type, p.params).values : p.params,
      version: p.version,
      status: problems.length > 0 ? 'needs-attention' : 'ok',
      problems,
      updatedAt: p.updatedAt,
      removedAt: p.removedAt,
    };
  };
  const trashedUses = (homeId: string) =>
    [...placements.values()]
      .filter((p) => p.homeId === homeId && p.removedAt !== null)
      .map((p) => placementUse(modelOf(homeId)!, p));
  /** As the api's where-used: git uses with their overrides, orphans, then active placements. */
  const usesOf = (homeId: string, model: HomeModel): Use[] => {
    const git = modelUses(model);
    const ids = new Set(git.map((u) => u.id));
    const rows = [...overrideRows.values()].filter((o) => o.homeId === homeId);
    const levelName = (id: string | null) => model.levels.find((l) => l.id === id)?.name;
    const gitUses = git.map((u): Use => {
      const o = rows.find((r) => r.useId === u.id);
      const type = catalog.get(u.typeId)!;
      const { values, ignored } = effectiveParams(type, o?.params);
      const problems = [
        ...(o && o.typeId !== u.typeId ? [`type changed from ${o.typeId}`] : []),
        ...(ignored.length > 0 ? [`ignored: ${ignored.join(', ')}`] : []),
        ...(u.hole ? openingFitIssues(type, values, u.hole) : []),
      ];
      const rooms = u.roomIds.map((id) => model.rooms.find((r) => r.id === id)?.name ?? id);
      return {
        id: u.id,
        homeId,
        typeId: u.typeId,
        kind: 'openings',
        source: 'git',
        name: u.name,
        levelId: u.levelId,
        roomIds: u.roomIds,
        where:
          u.placement === 'fence'
            ? 'Outside'
            : [levelName(u.levelId), ...rooms].filter(Boolean).join(' · '),
        overrides: o?.params ?? {},
        effective: values,
        version: o?.version ?? 0,
        status: problems.length > 0 ? 'needs-attention' : 'ok',
        problems,
        updatedAt: o?.updatedAt ?? null,
        removedAt: null,
      };
    });
    const orphans = rows
      .filter((o) => !ids.has(o.useId))
      .map((o): Use => {
        const type = catalog.get(o.typeId);
        return {
          id: o.useId,
          homeId,
          typeId: o.typeId,
          kind: 'openings',
          source: 'git',
          name: o.useId,
          levelId: null,
          roomIds: [],
          where: 'not in the home model',
          overrides: o.params,
          effective: type ? effectiveParams(type, o.params).values : o.params,
          version: o.version,
          status: 'needs-attention',
          problems: ['not in the home model any more'],
          updatedAt: o.updatedAt,
          removedAt: null,
        };
      });
    const active = [...placements.values()]
      .filter((p) => p.homeId === homeId && p.removedAt === null)
      .map((p) => placementUse(model, p));
    return [...gitUses, ...orphans, ...active];
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
      return json({ items: [...overrideRows.values()].filter((o) => o.homeId === homeId) });
    }
    if ((m = /^\/api\/homes\/([^/]+)\/opening-overrides\/([^/]+)$/.exec(url))) {
      const [homeId, useId] = [decodeURIComponent(m[1]!), decodeURIComponent(m[2]!)];
      const use = modelUses(modelOf(homeId)!).find((u) => u.id === useId);
      if (!use) return notFound(`Use "${useId}" not found`);
      const current = overrideRows.get(`${homeId}/${useId}`);
      if (body.version !== (current?.version ?? 0)) return conflict(current?.version ?? 0);
      const type = catalog.get(use.typeId)!;
      const issues = use.hole
        ? openingFitIssues(type, effectiveParams(type, body.params).values, use.hole)
        : [];
      if (issues.length > 0) {
        return json(
          {
            statusCode: 422,
            error: 'Unprocessable Entity',
            message: issues[0],
            issues: issues.map((message) => ({ path: 'params', message })),
          },
          422,
        );
      }
      const next: OpeningOverride = {
        homeId,
        useId,
        typeId: use.typeId,
        params: body.params,
        version: (current?.version ?? 0) + 1,
        updatedAt: now(),
      };
      overrideRows.set(`${homeId}/${useId}`, next);
      record(
        homeId,
        useId,
        'opening',
        'update',
        { params: current?.params ?? {} },
        {
          params: next.params,
        },
      );
      return json(next);
    }
    if (url === '/api/whoami') {
      return json({ username: null, actor, actorSource: 'declared' });
    }
    if ((m = /^\/api\/homes\/([^/]+)\/uses\?typeId=(.+)$/.exec(url))) {
      const [homeId, typeId] = [decodeURIComponent(m[1]!), decodeURIComponent(m[2]!)];
      const model = modelOf(homeId);
      if (!model) return notFound(`Home "${homeId}" not found`);
      return json({ items: usesOf(homeId, model).filter((u) => u.typeId === typeId) });
    }
    if ((m = /^\/api\/homes\/([^/]+)\/uses\/([^/]+)\/history(?:\/([^/]+)\/undo)?$/.exec(url))) {
      const [homeId, useId] = [decodeURIComponent(m[1]!), decodeURIComponent(m[2]!)];
      if (!m[3]) return json({ items: entriesOf(homeId, useId) });
      const entry = entriesOf(homeId, useId).find((e) => e.id === decodeURIComponent(m![3]!));
      if (!entry) return notFound('History entry not found');
      const current = stateOf(homeId, useId)!;
      if (!entry.canUndo) {
        return json(
          {
            statusCode: 409,
            error: 'Conflict',
            message: 'Changed again later: undo the later change first',
            currentVersion: 1,
            conflicts: ['frameColor changed again later: undo the later change first'],
          },
          409,
        );
      }
      const target = undoTarget(entry, current);
      apply(homeId, useId, target);
      const done = record(homeId, useId, entry.useKind, 'undo', current, target, entry.id);
      const use = [...usesOf(homeId, modelOf(homeId)!), ...trashedUses(homeId)].find(
        (u) => u.id === useId,
      )!;
      return json({ entry: entriesOf(homeId, useId).find((e) => e.id === done.id), use });
    }
    if ((m = /^\/api\/notes(?:\/([^/?]+))?(?:\?(.*))?$/.exec(url))) {
      if (!m[1] && method === 'GET') {
        const query = new URLSearchParams(m[2]);
        const [kind, ...rest] = query.get('subject')!.split(':');
        const id = rest.join(':');
        return json({
          items: [...notes.values()].filter(
            (n) =>
              n.subject.kind === kind &&
              n.subject.id === id &&
              (kind === 'type' || n.homeId === query.get('homeId')),
          ),
        });
      }
      if (!m[1]) {
        const at = now();
        const note: Note = {
          id: uuid(),
          homeId: body.homeId ?? null,
          subject: body.subject,
          body: String(body.body).trim(),
          createdBy: actor,
          updatedBy: actor,
          createdAt: at,
          updatedAt: at,
        };
        notes.set(note.id, note);
        return json(note, 201);
      }
      const note = notes.get(decodeURIComponent(m[1]));
      if (!note) return notFound('Note not found');
      if (method === 'DELETE') {
        notes.delete(note.id);
        return new Response(null, { status: 204 });
      }
      const next = { ...note, body: String(body.body).trim(), updatedBy: actor, updatedAt: now() };
      notes.set(note.id, next);
      return json(next);
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
        record(homeId, created.id, 'placement', 'create', null, placementState(created));
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
      record(
        homeId,
        id,
        'placement',
        m[3] ? 'restore' : method === 'DELETE' ? 'remove' : 'update',
        placementState(current),
        placementState(next),
      );
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
      if (action === 'PATCH' && body?.subjects) {
        patch.PATCH = {
          ...body,
          subjects: (body.subjects as { kind: string; id: string }[]).map((s) => ({
            ...s,
            name: null,
            status: 'current',
          })),
        };
      }
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
    overrides: overrideRows,
    history: historyRows,
    notes,
    photos,
    requests,
    /** Who the following writes are recorded as. */
    setActor(next: 'owner' | 'agent') {
      actor = next;
    },
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
