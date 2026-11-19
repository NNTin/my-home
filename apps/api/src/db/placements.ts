import {
  basicOverridesSchema,
  catalog,
  effectiveParams,
  formatIssues,
  furnitureFitIssues,
  isPlacedKind,
  roomAt,
  type CatalogType,
  type HomeModel,
  type ParamValues,
  type Placement,
  type UseState,
} from '@my-home/shared';
import { and, asc, eq, isNull, like, lt } from 'drizzle-orm';
import { problem } from '../errors';
import type { Db } from './client';
import { recordHistory, sameJson, type HistoryActor, type Tx } from './history';
import { homeStore } from './homes';
import { history, issuedIds, placements, type PlacementRow } from './userdata-schema';

const DAY_MS = 24 * 60 * 60 * 1000;
const MAX_ID = 64;

export interface CreateInput {
  typeId: string;
  levelId: string;
  position: { x: number; z: number };
  rotationY: number;
  params: Record<string, unknown>;
  name?: string;
}

export interface UpdateInput {
  version: number;
  name?: string;
  levelId?: string;
  position?: { x: number; z: number };
  rotationY?: number;
  params?: Record<string, unknown>;
}

/** Every value of `key` anywhere in a home document (ids, names). */
function collect(value: unknown, key: string, into = new Set<string>()): Set<string> {
  if (Array.isArray(value)) for (const item of value) collect(item, key, into);
  else if (value && typeof value === 'object') {
    for (const [k, v] of Object.entries(value)) {
      if (k === key && typeof v === 'string') into.add(v);
      else collect(v, key, into);
    }
  }
  return into;
}

/** A placement's state as history stores it. */
export const placementState = (row: PlacementRow): UseState => ({
  name: row.name,
  params: row.params,
  levelId: row.levelId,
  roomId: row.roomId,
  position: { x: row.x, z: row.z },
  rotationY: row.rotationY,
  removed: row.removedAt !== null,
});

export const notFound = (kind: string, id: string) => problem(404, `${kind} "${id}" not found`);

/** A 409 `UseConflict`. */
export const conflict = (message: string, currentVersion: number, conflicts: string[] = []) =>
  problem(409, message, { currentVersion, conflicts });

const stale = (row: { version: number }, given: number) =>
  conflict(
    `Version ${given} is stale: the use is at version ${row.version}; reload and retry`,
    row.version,
    ['version'],
  );

/** Basic overrides of a type, or a 400 with the validation issues. */
export function validOverrides(type: CatalogType, params: unknown): ParamValues {
  const parsed = basicOverridesSchema(type).safeParse(params);
  if (parsed.success) return parsed.data;
  const issues = formatIssues(parsed.error).map((i) => ({
    path: i.path ? `params.${i.path}` : 'params',
    message: i.message,
  }));
  const first = issues[0]!;
  throw problem(400, `Invalid params: ${first.path}: ${first.message}`, { issues });
}

const furnitureType = (typeId: string): CatalogType => {
  const type = catalog.get(typeId);
  if (!type) throw problem(400, `Unknown type "${typeId}"`);
  if (!isPlacedKind(type)) {
    throw problem(400, `Type "${typeId}" is not a furniture or fixture type`);
  }
  return type;
};

const levelOf = (model: HomeModel, levelId: string) => {
  const level = model.levels.find((l) => l.id === levelId);
  if (!level) throw notFound('Level', levelId);
  return level;
};

const roomOf = (model: HomeModel, levelId: string, position: { x: number; z: number }) => {
  const ref = roomAt(model, levelId, position);
  return ref ? model.rooms.find((r) => r.id === ref.id) : undefined;
};

/**
 * Furniture placements of a home (`userdata.placements`). Every change runs in one transaction
 * with its history row. Removing moves a placement to the trash; only the retention purge
 * deletes rows (with their history); issued ids are kept forever.
 */
export function placementStore(db: Db, options: { retentionDays: number }) {
  const retentionMs = options.retentionDays * DAY_MS;
  const homes = homeStore(db);

  const toPlacement = (row: PlacementRow): Placement => ({
    id: row.id,
    homeId: row.homeId,
    typeId: row.typeId,
    name: row.name,
    levelId: row.levelId,
    roomId: row.roomId,
    position: { x: row.x, z: row.z },
    rotationY: row.rotationY,
    params: row.params,
    version: row.version,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    removedAt: row.removedAt ? row.removedAt.toISOString() : null,
    purgeAt: row.removedAt ? new Date(row.removedAt.getTime() + retentionMs).toISOString() : null,
  });

  const model = async (homeId: string) => {
    const found = await homes.get(homeId);
    if (!found) throw notFound('Home', homeId);
    return found;
  };

  const lockRow = async (tx: Tx, homeId: string, id: string) => {
    const [row] = await tx
      .select()
      .from(placements)
      .where(and(eq(placements.homeId, homeId), eq(placements.id, id)))
      .for('update');
    if (!row) throw notFound('Placement', id);
    return row;
  };

  /**
   * `<apartment>-<type>-<n>`: the apartment of the room (without `apt-`), else the level; the
   * type id's variant; 1 + the highest issued `n` of that prefix, skipping home-model ids. Issued
   * in the transaction and never reused.
   */
  const issueId = async (
    tx: Tx,
    homeId: string,
    m: HomeModel,
    typeId: string,
    levelId: string,
    room: HomeModel['rooms'][number] | undefined,
  ) => {
    const area = room?.apartmentId?.replace(/^apt-/, '') || levelId;
    const variant = typeId.slice(typeId.indexOf('.') + 1);
    const prefixFor = (n: number) =>
      `${area.slice(0, Math.max(1, MAX_ID - variant.length - String(n).length - 2))}-${variant}`;
    const taken = collect(m, 'id');
    const highest = async (prefix: string) => {
      const rows = await tx
        .select({ id: issuedIds.id })
        .from(issuedIds)
        .where(
          and(
            eq(issuedIds.homeId, homeId),
            like(issuedIds.id, `${prefix.replace(/[\\%_]/g, '\\$&')}-%`),
          ),
        );
      const pattern = new RegExp(`^${prefix.replace(/[-]/g, '\\-')}-(\\d+)$`);
      return Math.max(0, ...rows.map((r) => Number(pattern.exec(r.id)?.[1] ?? 0)));
    };
    let n = (await highest(prefixFor(1))) + 1;
    for (;;) {
      const id = `${prefixFor(n)}-${n}`;
      if (!taken.has(id)) {
        const inserted = await tx
          .insert(issuedIds)
          .values({ homeId, id })
          .onConflictDoNothing()
          .returning({ id: issuedIds.id });
        if (inserted.length > 0) return id;
      }
      n++;
    }
  };

  /** "<Room> · <Type>" (outside a room: the level's name), numbered when the name is taken. */
  const autoName = async (
    tx: Tx,
    homeId: string,
    m: HomeModel,
    typeName: string,
    place: string,
  ) => {
    const taken = collect(m, 'name');
    const rows = await tx
      .select({ name: placements.name })
      .from(placements)
      .where(eq(placements.homeId, homeId));
    for (const row of rows) taken.add(row.name);
    const base = `${place} · ${typeName}`;
    if (!taken.has(base)) return base;
    for (let k = 2; ; k++) if (!taken.has(`${base} ${k}`)) return `${base} ${k}`;
  };

  const store = {
    toPlacement,

    async list(homeId: string, includeRemoved: boolean): Promise<Placement[]> {
      await model(homeId);
      const rows = await db
        .select()
        .from(placements)
        .where(
          and(
            eq(placements.homeId, homeId),
            includeRemoved ? undefined : isNull(placements.removedAt),
          ),
        )
        .orderBy(asc(placements.createdAt), asc(placements.id));
      return rows.map(toPlacement);
    },

    async create(homeId: string, input: CreateInput, actor: HistoryActor): Promise<Placement> {
      const m = await model(homeId);
      const type = furnitureType(input.typeId);
      const level = levelOf(m, input.levelId);
      const params = validOverrides(type, input.params);
      const row = await db.transaction((tx) =>
        store.insert(tx, homeId, m, { ...input, typeId: type.id, params }, actor, 'create', {
          typeName: type.name,
          levelName: level.name,
        }),
      );
      return toPlacement(row);
    },

    /**
     * Inserts a placement with an issued id (and a server name unless given) and its history row,
     * in `tx`. The input is not validated: `create` checks it first; the layout import keeps
     * unknown types and gone levels as they are (they show as needs-attention).
     */
    async insert(
      tx: Tx,
      homeId: string,
      m: HomeModel,
      input: Omit<CreateInput, 'params'> & { params: ParamValues },
      actor: HistoryActor,
      action: 'create' | 'import',
      names: { typeName: string; levelName: string },
    ): Promise<PlacementRow> {
      const room = m.levels.some((l) => l.id === input.levelId)
        ? roomOf(m, input.levelId, input.position)
        : undefined;
      const id = await issueId(tx, homeId, m, input.typeId, input.levelId, room);
      const name =
        input.name ??
        (await autoName(tx, homeId, m, names.typeName, room?.name ?? names.levelName));
      const [inserted] = await tx
        .insert(placements)
        .values({
          homeId,
          id,
          typeId: input.typeId,
          name,
          levelId: input.levelId,
          roomId: room?.id ?? null,
          x: input.position.x,
          z: input.position.z,
          rotationY: input.rotationY,
          params: input.params,
        })
        .returning();
      await recordHistory(tx, {
        homeId,
        useId: id,
        useKind: 'placement',
        action,
        actor,
        before: null,
        after: placementState(inserted!),
      });
      return inserted!;
    },

    async update(
      homeId: string,
      id: string,
      input: UpdateInput,
      actor: HistoryActor,
    ): Promise<Placement> {
      const m = await model(homeId);
      const row = await db.transaction(async (tx) => {
        const current = await lockRow(tx, homeId, id);
        if (current.removedAt) {
          throw conflict(`Placement "${id}" is in the trash: restore it first`, current.version, [
            'removed',
          ]);
        }
        if (current.version !== input.version) throw stale(current, input.version);
        const type = catalog.get(current.typeId);
        let params = current.params;
        if (input.params !== undefined) {
          if (!type) throw problem(422, `Type "${current.typeId}" is no longer in the catalogue`);
          params = validOverrides(type, input.params);
        }
        const levelId = input.levelId ?? current.levelId;
        if (input.levelId !== undefined) levelOf(m, levelId);
        const position = input.position ?? { x: current.x, z: current.z };
        const moved = input.position !== undefined || levelId !== current.levelId;
        const room = moved
          ? roomOf(m, levelId, position)
          : m.rooms.find((r) => r.id === current.roomId);
        const roomId = moved ? (room?.id ?? null) : current.roomId;
        const rotationY = input.rotationY ?? current.rotationY;

        // A size change must not push a footprint that fitted its room out of it.
        if (type && room && !sameJson(params, current.params)) {
          const at = { ...position, rotationY };
          const fitted = furnitureFitIssues(
            type,
            effectiveParams(type, current.params).values,
            at,
            room,
          );
          const issues = furnitureFitIssues(type, effectiveParams(type, params).values, at, room);
          if (fitted.length === 0 && issues.length > 0) {
            throw problem(422, issues[0]!, {
              issues: issues.map((message) => ({ path: 'params', message })),
            });
          }
        }

        const next = {
          name: input.name ?? current.name,
          levelId,
          roomId,
          x: position.x,
          z: position.z,
          rotationY,
          params,
        };
        const before = placementState(current);
        if (sameJson(placementState({ ...current, ...next }), before)) {
          return current; // nothing changed: no new version, no history
        }
        const [updated] = await tx
          .update(placements)
          .set({ ...next, version: current.version + 1, updatedAt: new Date() })
          .where(and(eq(placements.homeId, homeId), eq(placements.id, id)))
          .returning();
        await recordHistory(tx, {
          homeId,
          useId: id,
          useKind: 'placement',
          action: 'update',
          actor,
          before,
          after: placementState(updated!),
        });
        return updated!;
      });
      return toPlacement(row);
    },

    /** Moves a placement to the trash (`removed`) or back (`restored`). */
    async setRemoved(
      homeId: string,
      id: string,
      removed: boolean,
      actor: HistoryActor,
      version?: number,
    ): Promise<Placement> {
      await model(homeId);
      const row = await db.transaction(async (tx) => {
        const current = await lockRow(tx, homeId, id);
        if ((current.removedAt !== null) === removed) {
          throw conflict(
            removed
              ? `Placement "${id}" is already in the trash`
              : `Placement "${id}" is not in the trash`,
            current.version,
            ['removed'],
          );
        }
        if (version !== undefined && current.version !== version) throw stale(current, version);
        const [updated] = await tx
          .update(placements)
          .set({
            removedAt: removed ? new Date() : null,
            version: current.version + 1,
            updatedAt: new Date(),
          })
          .where(and(eq(placements.homeId, homeId), eq(placements.id, id)))
          .returning();
        await recordHistory(tx, {
          homeId,
          useId: id,
          useKind: 'placement',
          action: removed ? 'remove' : 'restore',
          actor,
          before: placementState(current),
          after: placementState(updated!),
        });
        return updated!;
      });
      return toPlacement(row);
    },

    /** The locked row and its state, for an undo in `tx`; undefined once purged. */
    async lockState(tx: Tx, homeId: string, id: string) {
      const [row] = await tx
        .select()
        .from(placements)
        .where(and(eq(placements.homeId, homeId), eq(placements.id, id)))
        .for('update');
      return row && { row, state: placementState(row) };
    },

    /** Writes a state computed by an undo (no validation: it is a state the use had before). */
    async applyState(tx: Tx, row: PlacementRow, state: UseState) {
      const [updated] = await tx
        .update(placements)
        .set({
          name: state.name ?? row.name,
          levelId: state.levelId ?? row.levelId,
          roomId: state.roomId === undefined ? row.roomId : state.roomId,
          x: state.position?.x ?? row.x,
          z: state.position?.z ?? row.z,
          rotationY: state.rotationY ?? row.rotationY,
          params: state.params,
          removedAt: state.removed ? (row.removedAt ?? new Date()) : null,
          version: row.version + 1,
          updatedAt: new Date(),
        })
        .where(and(eq(placements.homeId, row.homeId), eq(placements.id, row.id)))
        .returning();
      return updated!;
    },

    /**
     * Deletes placements that have been in the trash longer than the retention period, with
     * their history, in every home. Their ids stay in `issued_ids`, so they are never reused.
     */
    async purgeExpired(now = new Date()) {
      const cutoff = new Date(now.getTime() - retentionMs);
      return db.transaction(async (tx) => {
        const purged = await tx
          .delete(placements)
          .where(lt(placements.removedAt, cutoff))
          .returning({ homeId: placements.homeId, id: placements.id });
        for (const p of purged) {
          await tx
            .delete(history)
            .where(
              and(
                eq(history.homeId, p.homeId),
                eq(history.useId, p.id),
                eq(history.useKind, 'placement'),
              ),
            );
        }
        return { purgedPlacements: purged.length };
      });
    },
  };
  return store;
}
export type PlacementStore = ReturnType<typeof placementStore>;
