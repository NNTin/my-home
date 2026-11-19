import {
  catalog,
  effectiveParams,
  furnitureFitIssues,
  heightFitIssues,
  HomeModel,
  mountIssues,
  modelUses,
  openingFitIssues,
  type HistoryEntry,
  type HomeSettings,
  type ListUsesQuery,
  type ModelUse,
  type Use,
  type UseState,
} from '@my-home/shared';
import { and, count, eq, isNull } from 'drizzle-orm';
import type { Db } from './client';
import {
  conflictText,
  listHistoryRows,
  recordHistory,
  toHistoryEntry,
  undoPlan,
  type HistoryActor,
} from './history';
import { homeSettingsStore, settingsState } from './home-settings';
import { homeStore } from './homes';
import { openingOverrideStore, overrideState } from './opening-overrides';
import { conflict, notFound, placementState, placementStore } from './placements';
import { homes } from './schema';
import {
  history,
  openingOverrides,
  placements,
  type HomeSettingsRow,
  type OpeningOverrideRow,
  type PlacementRow,
} from './userdata-schema';

const iso = (date: Date | null) => (date ? date.toISOString() : null);

/** "Ground floor · Kitchen", "First floor · roof", the outbuilding's name, "Outside". */
function whereOf(model: HomeModel, use: ModelUse): string {
  const level = model.levels.find((l) => l.id === use.levelId);
  switch (use.placement) {
    case 'wall': {
      const rooms = use.roomIds.map((id) => model.rooms.find((r) => r.id === id)?.name ?? id);
      return [level?.name ?? use.levelId ?? '', ...rooms].filter((s) => s !== '').join(' · ');
    }
    case 'roof':
      return `${level?.name ?? use.levelId} · roof`;
    case 'outbuilding':
      return (
        model.outbuildings?.find((b) => b.openings?.some((o) => o.id === use.id))?.name ??
        'Outbuilding'
      );
    case 'fence':
      return 'Outside';
  }
}

const ignoredProblem = (ignored: string[]) =>
  ignored.length > 0 ? [`ignored: ${ignored.join(', ')}`] : [];

const withStatus = (use: Omit<Use, 'status'>): Use => ({
  ...use,
  status: use.problems.length > 0 ? 'needs-attention' : 'ok',
});

/** A git use with its override (if any). */
function gitUse(homeId: string, model: HomeModel, use: ModelUse, o?: OpeningOverrideRow): Use {
  const type = catalog.get(use.typeId)!;
  const { values, ignored } = effectiveParams(type, o?.params);
  const problems: string[] = [];
  if (o && o.typeId !== use.typeId) problems.push(`type changed from ${o.typeId}`);
  problems.push(...ignoredProblem(ignored));
  if (use.hole) problems.push(...openingFitIssues(type, values, use.hole));
  return withStatus({
    id: use.id,
    homeId,
    typeId: use.typeId,
    kind: type.kind,
    source: 'git',
    name: use.name,
    levelId: use.levelId,
    roomIds: use.roomIds,
    where: whereOf(model, use),
    overrides: o?.params ?? {},
    effective: values,
    version: o?.version ?? 0,
    problems,
    updatedAt: iso(o?.updatedAt ?? null),
    removedAt: null,
  });
}

/** An override whose use id is no longer in the model. */
function orphanOverride(homeId: string, o: OpeningOverrideRow): Use {
  const type = catalog.get(o.typeId);
  return withStatus({
    id: o.useId,
    homeId,
    typeId: o.typeId,
    kind: type?.kind ?? 'openings',
    source: 'git',
    name: o.useId,
    levelId: null,
    roomIds: [],
    where: 'not in the home model',
    overrides: o.params,
    effective: type ? effectiveParams(type, o.params).values : o.params,
    version: o.version,
    problems: ['not in the home model any more'],
    updatedAt: iso(o.updatedAt),
    removedAt: null,
  });
}

/**
 * A placement; problems when its type, level or room is gone, its wall or ceiling is gone, or it
 * does not fit its room or under its ceiling.
 */
function placementUse(model: HomeModel, p: PlacementRow): Use {
  const type = catalog.get(p.typeId);
  const level = model.levels.find((l) => l.id === p.levelId);
  const room =
    p.roomId === null
      ? undefined
      : model.rooms.find((r) => r.id === p.roomId && r.levelId === p.levelId);
  const problems: string[] = [];
  if (!type) problems.push(`type "${p.typeId}" is not in the catalogue`);
  if (!level) problems.push(`level "${p.levelId}" is not in the home model`);
  if (p.roomId !== null && !room) problems.push(`room "${p.roomId}" is not in the home model`);
  const effective = type ? effectiveParams(type, p.params) : { values: p.params, ignored: [] };
  problems.push(...ignoredProblem(effective.ignored));
  if (type && room) {
    problems.push(
      ...furnitureFitIssues(
        type,
        effective.values,
        { x: p.x, z: p.z, rotationY: p.rotationY },
        room,
      ),
    );
  }
  if (type && level) {
    const at = { levelId: p.levelId, x: p.x, z: p.z, rotationY: p.rotationY };
    problems.push(...mountIssues(model, effective.values, at, p.mounting, p.roomId));
    problems.push(...heightFitIssues(model, type, effective.values, at, p.mounting, p.elevation));
  }
  return withStatus({
    id: p.id,
    homeId: p.homeId,
    typeId: p.typeId,
    kind: type?.kind ?? 'furniture',
    source: 'db',
    name: p.name,
    levelId: p.levelId,
    roomIds: p.roomId === null ? [] : [p.roomId],
    where: [level?.name ?? p.levelId, room?.name].filter(Boolean).join(' · '),
    overrides: p.params,
    effective: effective.values,
    version: p.version,
    problems,
    updatedAt: iso(p.updatedAt),
    removedAt: iso(p.removedAt),
  });
}

/**
 * Where-used: the uses of a home (git openings with their overrides, placements, orphans), the
 * history of a use with its undo, and the per-type usage counts of the catalogue.
 */
export function useStore(db: Db, options: { retentionDays: number }) {
  const homeRows = homeStore(db);
  const placementRows = placementStore(db, options);
  const overrideRows = openingOverrideStore(db);
  const settingsRows = homeSettingsStore(db);

  const model = async (homeId: string) => {
    const found = await homeRows.get(homeId);
    if (!found) throw notFound('Home', homeId);
    return found;
  };

  /** Every use of a home: git uses, orphan overrides, then active placements. */
  const uses = async (homeId: string, m: HomeModel): Promise<Use[]> => {
    const overrides = await db
      .select()
      .from(openingOverrides)
      .where(eq(openingOverrides.homeId, homeId));
    const active = await db
      .select()
      .from(placements)
      .where(and(eq(placements.homeId, homeId), isNull(placements.removedAt)));
    const byUse = new Map(overrides.map((o) => [o.useId, o]));
    const git = modelUses(m);
    const inModel = new Set(git.map((u) => u.id));
    active.sort(
      (a, b) => a.createdAt.getTime() - b.createdAt.getTime() || a.id.localeCompare(b.id),
    );
    return [
      ...git.map((u) => gitUse(homeId, m, u, byUse.get(u.id))),
      ...overrides.filter((o) => !inModel.has(o.useId)).map((o) => orphanOverride(homeId, o)),
      ...active.map((p) => placementUse(m, p)),
    ];
  };

  /** One use, a placement in the trash included; undefined when there is no such use. */
  const useOf = async (homeId: string, m: HomeModel, useId: string): Promise<Use | undefined> => {
    const [p] = await db
      .select()
      .from(placements)
      .where(and(eq(placements.homeId, homeId), eq(placements.id, useId)));
    if (p) return placementUse(m, p);
    return (await uses(homeId, m)).find((u) => u.id === useId);
  };

  /** What history needs about a use: its kind, type and current state. */
  const subject = async (homeId: string, m: HomeModel, useId: string) => {
    // A home's own id stands for its settings (opening and placement ids never equal a home id).
    if (useId === homeId) {
      return { kind: 'home' as const, typeId: undefined, state: await settingsRows.state(homeId) };
    }
    const [p] = await db
      .select()
      .from(placements)
      .where(and(eq(placements.homeId, homeId), eq(placements.id, useId)));
    if (p) return { kind: 'placement' as const, typeId: p.typeId, state: placementState(p) };
    const [o] = await db
      .select()
      .from(openingOverrides)
      .where(and(eq(openingOverrides.homeId, homeId), eq(openingOverrides.useId, useId)));
    const git = modelUses(m).find((u) => u.id === useId);
    if (!o && !git) return undefined;
    return {
      kind: 'opening' as const,
      typeId: git?.typeId ?? o!.typeId,
      state: o ? overrideState(o) : ({ params: {} } satisfies UseState),
    };
  };

  const names = (m: HomeModel) => ({
    roomName: (id: string) => m.rooms.find((r) => r.id === id)?.name,
    levelName: (id: string) => m.levels.find((l) => l.id === id)?.name,
  });

  const entries = async (homeId: string, m: HomeModel, useId: string): Promise<HistoryEntry[]> => {
    const s = await subject(homeId, m, useId);
    if (!s) throw notFound('Use', useId);
    const rows = await listHistoryRows(db, homeId, useId);
    const undoneBy = new Map(rows.filter((r) => r.undoesId).map((r) => [r.undoesId!, r.id]));
    return rows.map((row) =>
      toHistoryEntry(row, {
        type: s.typeId === undefined ? undefined : catalog.get(s.typeId),
        current: s.state,
        undoneById: undoneBy.get(row.id) ?? null,
        ...names(m),
      }),
    );
  };

  return {
    async list(homeId: string, query: ListUsesQuery): Promise<Use[]> {
      const all = await uses(homeId, await model(homeId));
      return all.filter(
        (u) =>
          (query.typeId === undefined || u.typeId === query.typeId) &&
          (query.status === undefined || u.status === query.status),
      );
    },

    async history(homeId: string, useId: string): Promise<HistoryEntry[]> {
      return entries(homeId, await model(homeId), useId);
    },

    /**
     * Undoes one history entry field by field (see `undoPlan`) and records the undo. 409 when a
     * field changed again later, when there is nothing to undo, or when it was already undone
     * (also under a race: the unique index on `undoes_id`).
     */
    async undo(
      homeId: string,
      useId: string,
      entryId: string,
      actor: HistoryActor,
    ): Promise<
      { entry: HistoryEntry; use: Use } | { entry: HistoryEntry; settings: HomeSettings }
    > {
      const m = await model(homeId);
      const [entry] = await db
        .select()
        .from(history)
        .where(and(eq(history.id, entryId), eq(history.homeId, homeId), eq(history.useId, useId)));
      if (!entry) throw notFound('History entry', entryId);
      let undoId: string;
      try {
        undoId = await db.transaction(async (tx) => {
          const locked =
            entry.useKind === 'placement'
              ? await placementRows.lockState(tx, homeId, useId)
              : entry.useKind === 'home'
                ? await settingsRows.lockState(tx, homeId)
                : await overrideRows.lockState(tx, homeId, useId);
          if (!locked) throw notFound('Use', useId);
          const version = locked.row.version;
          const [undone] = await tx
            .select({ id: history.id })
            .from(history)
            .where(eq(history.undoesId, entryId));
          if (undone) {
            throw conflict('This change was already undone', version, ['already undone']);
          }
          const plan = undoPlan(entry, locked.state);
          if (plan.fields.length === 0) throw conflict('Nothing to undo', version, []);
          if (plan.conflicts.length > 0) {
            throw conflict(
              'Changed again later: undo the later change first',
              version,
              plan.conflicts.map(conflictText),
            );
          }
          const written =
            entry.useKind === 'placement'
              ? placementState(
                  await placementRows.applyState(tx, locked.row as PlacementRow, plan.target),
                )
              : entry.useKind === 'home'
                ? settingsState(
                    await settingsRows.applyState(tx, locked.row as HomeSettingsRow, plan.target),
                  )
                : overrideState(
                    await overrideRows.applyState(
                      tx,
                      locked.row as OpeningOverrideRow,
                      plan.target,
                    ),
                  );
          const row = await recordHistory(tx, {
            homeId,
            useId,
            useKind: entry.useKind as 'placement' | 'opening' | 'home',
            action: 'undo',
            actor,
            before: locked.state,
            after: written,
            undoesId: entryId,
          });
          return row.id;
        });
      } catch (err) {
        if (isUniqueViolation(err)) {
          // A concurrent undo of the same entry won: report the version it left behind.
          const now = await subject(homeId, m, useId);
          const [row] =
            now?.kind === 'home'
              ? [await settingsRows.find(homeId)]
              : now?.kind === 'placement'
                ? await db
                    .select({ version: placements.version })
                    .from(placements)
                    .where(and(eq(placements.homeId, homeId), eq(placements.id, useId)))
                : await db
                    .select({ version: openingOverrides.version })
                    .from(openingOverrides)
                    .where(
                      and(eq(openingOverrides.homeId, homeId), eq(openingOverrides.useId, useId)),
                    );
          throw conflict('This change was already undone', row?.version ?? 0, ['already undone']);
        }
        throw err;
      }
      const all = await entries(homeId, m, useId);
      const done = all.find((e) => e.id === undoId)!;
      if (entry.useKind === 'home') {
        return { entry: done, settings: await settingsRows.find(homeId) };
      }
      const use = await useOf(homeId, m, useId);
      return { entry: done, use: use! };
    },

    /** Per type: its git uses in every stored home plus the active placements. */
    async usage(): Promise<Record<string, number>> {
      const counts: Record<string, number> = Object.fromEntries(
        catalog.types.map((t) => [t.id, 0]),
      );
      for (const row of await db.select({ model: homes.model }).from(homes)) {
        const parsed = HomeModel.safeParse(row.model);
        if (!parsed.success) continue;
        for (const use of modelUses(parsed.data))
          counts[use.typeId] = (counts[use.typeId] ?? 0) + 1;
      }
      const placed = await db
        .select({ typeId: placements.typeId, n: count() })
        .from(placements)
        .where(isNull(placements.removedAt))
        .groupBy(placements.typeId);
      for (const { typeId, n } of placed) counts[typeId] = (counts[typeId] ?? 0) + n;
      return counts;
    },

    useOf: async (homeId: string, useId: string) => useOf(homeId, await model(homeId), useId),
  };
}
export type UseStore = ReturnType<typeof useStore>;

/** A unique-index violation (Postgres 23505), possibly wrapped by drizzle. */
function isUniqueViolation(err: unknown): boolean {
  for (let e = err; e && typeof e === 'object'; e = (e as { cause?: unknown }).cause) {
    if ((e as { code?: unknown }).code === '23505') return true;
  }
  return false;
}
