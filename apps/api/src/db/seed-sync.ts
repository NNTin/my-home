import { readFile } from 'node:fs/promises';
import {
  canonicalSeed,
  describeIssues,
  formatIssues,
  HomeSeed,
  normalizeSeed,
  modelUses,
  roomAt,
  SEED_ACTOR_NAME,
  SEED_SCHEMA_VERSION,
  seedIssues,
  type HomeModel,
  type SeedNote,
  type SeedChanges,
  type SeedNoteChanges,
  type SeedPlacement,
  type SeedSyncReport,
  type UseState,
} from '@my-home/shared';
import { and, asc, eq, isNull } from 'drizzle-orm';
import type { Db } from './types';
import { recordHistory, sameJson, type HistoryActor, type Tx } from './history';
import { overrideState } from './opening-overrides';
import { placementState } from './placements';
import {
  imports,
  issuedIds,
  notes,
  openingOverrides,
  placements,
  type NoteRow,
} from './userdata-schema';

/**
 * The `userdata.imports` source of the named layouts' one-time import (#44, removed in #56). The
 * sync still records it as skipped for every seeded home, so an older api's release job never
 * imports layouts over a seeded placement set.
 */
const LAYOUTS_SOURCE = 'layouts';

/**
 * The actor of every change the release job's seed sync makes: `system` named `seed`, values the
 * previous api version can read (no new `Actor` value).
 */
export const SEED_ACTOR: HistoryActor = {
  actor: 'system',
  source: 'default',
  username: SEED_ACTOR_NAME,
};

/** `home.json` → `home.seed.json`: a home's seed lives next to its home file. */
export const seedFileOf = (homeFile: string) => homeFile.replace(/\.json$/, '.seed.json');

/** Whether a file in `data/homes` is a seed (not a home file). */
export const isSeedFile = (name: string) => name.endsWith('.seed.json');

/**
 * Reads and validates a seed file against its home model and the catalogue; `undefined` when the
 * file does not exist. Throws on an unreadable, invalid or mismatching seed.
 */
export async function readSeedFile(file: string, model: HomeModel): Promise<HomeSeed | undefined> {
  let text: string;
  try {
    text = await readFile(file, 'utf8');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
    throw new Error(`Cannot read seed file ${file}: ${(err as Error).message}`, { cause: err });
  }
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch (err) {
    throw new Error(`Cannot read seed file ${file}: ${(err as Error).message}`, { cause: err });
  }
  const parsed = HomeSeed.safeParse(json);
  if (!parsed.success) {
    throw new Error(`Invalid seed file ${file}:\n${describeIssues(formatIssues(parsed.error))}`);
  }
  const issues = seedIssues(parsed.data, model);
  if (issues.length > 0) throw new Error(`Invalid seed file ${file}:\n${describeIssues(issues)}`);
  return normalizeSeed(parsed.data);
}

const toSeedNote = (row: NoteRow): SeedNote => ({
  id: row.id,
  subject: { kind: row.subjectKind as SeedNote['subject']['kind'], id: row.subjectId },
  body: row.body,
  createdBy: row.createdBy as SeedNote['createdBy'],
  updatedBy: row.updatedBy as SeedNote['updatedBy'],
  createdAt: row.createdAt.toISOString(),
  updatedAt: row.updatedAt.toISOString(),
});

/**
 * The use ids whose notes the seed holds: the uses in the home model and the given (active or
 * seed) placements. Notes on anything else (a placement in the trash, a use that left the model)
 * are outside the seed: never exported, never changed by a sync, so they come back with a restore.
 */
const noteScope = (model: HomeModel, placementIds: Iterable<string>) =>
  new Set([...modelUses(model).map((u) => u.id), ...placementIds]);

/**
 * The environment's state of a home in seed form (canonical): its active placements, its
 * overrides with params (an emptied override row is the same as none), the active notes on its
 * model uses and active placements (`noteScope`) and the active type notes (environment-wide).
 * It always passes `seedIssues` for the same model, as far as the stored data is valid.
 */
export async function exportSeed(db: Db | Tx, model: HomeModel): Promise<HomeSeed> {
  const homeId = model.id;
  const placed = await db
    .select()
    .from(placements)
    .where(and(eq(placements.homeId, homeId), isNull(placements.removedAt)))
    .orderBy(asc(placements.id));
  const overrides = await db
    .select()
    .from(openingOverrides)
    .where(eq(openingOverrides.homeId, homeId))
    .orderBy(asc(openingOverrides.useId));
  const useNotes = await db
    .select()
    .from(notes)
    .where(and(eq(notes.homeId, homeId), isNull(notes.deletedAt)));
  const typeNotes = await db
    .select()
    .from(notes)
    .where(and(isNull(notes.homeId), isNull(notes.deletedAt)));
  const inScope = noteScope(
    model,
    placed.map((p) => p.id),
  );
  return canonicalSeed({
    schemaVersion: SEED_SCHEMA_VERSION,
    homeId,
    placements: placed.map((p) => ({
      id: p.id,
      typeId: p.typeId,
      name: p.name,
      levelId: p.levelId,
      position: { x: p.x, z: p.z },
      rotationY: p.rotationY,
      mounting: p.mounting,
      elevation: p.elevation,
      params: p.params,
    })),
    openingOverrides: overrides
      .filter((o) => Object.keys(o.params).length > 0)
      .map((o) => ({ useId: o.useId, typeId: o.typeId, params: o.params })),
    notes: [
      ...useNotes.filter((n) => n.subjectKind === 'use' && inScope.has(n.subjectId)),
      ...typeNotes,
    ].map(toSeedNote),
  });
}

export type NoteChanges = SeedNoteChanges;

const noteChanges = (): NoteChanges => ({ created: [], updated: [], deleted: [] });

/** How many things a sync changed. */
export const seedChangeCount = (c: SeedChanges | NoteChanges): number =>
  'homeId' in c
    ? Object.values(c.placements).flat().length +
      Object.values(c.openingOverrides).flat().length +
      seedChangeCount(c.notes)
    : c.created.length + c.updated.length + c.deleted.length;

/** The state a seed placement gives a use, its room derived from the position. */
const seedState = (model: HomeModel, p: SeedPlacement): UseState => ({
  name: p.name,
  params: p.params,
  levelId: p.levelId,
  roomId: roomAt(model, p.levelId, p.position)?.id ?? null,
  position: { x: p.position.x, z: p.position.z },
  rotationY: p.rotationY,
  mounting: p.mounting ?? 'floor',
  elevation: p.elevation ?? 0,
  removed: false,
});

async function syncPlacements(
  tx: Tx,
  model: HomeModel,
  seed: HomeSeed,
  actor: HistoryActor,
  changes: SeedChanges['placements'],
) {
  const homeId = model.id;
  const rows = await tx
    .select()
    .from(placements)
    .where(eq(placements.homeId, homeId))
    .for('update');
  const byId = new Map(rows.map((r) => [r.id, r]));
  const wanted = new Set(seed.placements.map((p) => p.id));
  const now = new Date();

  // Every seed id counts as issued, so the app never hands one out again.
  if (seed.placements.length > 0) {
    await tx
      .insert(issuedIds)
      .values(seed.placements.map((p) => ({ homeId, id: p.id })))
      .onConflictDoNothing();
  }

  for (const p of seed.placements) {
    const target = seedState(model, p);
    const values = {
      typeId: p.typeId,
      name: p.name,
      levelId: p.levelId,
      roomId: target.roomId ?? null,
      x: p.position.x,
      z: p.position.z,
      rotationY: p.rotationY,
      mounting: target.mounting ?? 'floor',
      elevation: target.elevation ?? 0,
      params: p.params,
    };
    const row = byId.get(p.id);
    if (!row) {
      const [inserted] = await tx
        .insert(placements)
        .values({ homeId, id: p.id, ...values })
        .returning();
      await recordHistory(tx, {
        homeId,
        useId: p.id,
        useKind: 'placement',
        action: 'create',
        actor,
        before: null,
        after: placementState(inserted!),
      });
      changes.created.push(p.id);
      continue;
    }
    const before = placementState(row);
    if (row.typeId === p.typeId && sameJson(before, target)) continue;
    const [updated] = await tx
      .update(placements)
      .set({ ...values, removedAt: null, version: row.version + 1, updatedAt: now })
      .where(and(eq(placements.homeId, homeId), eq(placements.id, p.id)))
      .returning();
    const restored = row.removedAt !== null;
    await recordHistory(tx, {
      homeId,
      useId: p.id,
      useKind: 'placement',
      action: restored ? 'restore' : 'update',
      actor,
      before,
      after: placementState(updated!),
    });
    (restored ? changes.restored : changes.updated).push(p.id);
  }

  // Active placements the seed does not have go to the trash: restorable, and in the history.
  for (const row of rows) {
    if (wanted.has(row.id) || row.removedAt !== null) continue;
    const [removed] = await tx
      .update(placements)
      .set({ removedAt: now, version: row.version + 1, updatedAt: now })
      .where(and(eq(placements.homeId, homeId), eq(placements.id, row.id)))
      .returning();
    await recordHistory(tx, {
      homeId,
      useId: row.id,
      useKind: 'placement',
      action: 'remove',
      actor,
      before: placementState(row),
      after: placementState(removed!),
    });
    changes.removed.push(row.id);
  }
}

async function syncOverrides(
  tx: Tx,
  homeId: string,
  seed: HomeSeed,
  actor: HistoryActor,
  changes: SeedChanges['openingOverrides'],
) {
  const rows = await tx
    .select()
    .from(openingOverrides)
    .where(eq(openingOverrides.homeId, homeId))
    .for('update');
  const byId = new Map(rows.map((r) => [r.useId, r]));
  const wanted = new Set(seed.openingOverrides.map((o) => o.useId));
  const now = new Date();
  const write = async (useId: string, typeId: string, params: Record<string, string | number>) => {
    const row = byId.get(useId);
    const [written] = row
      ? await tx
          .update(openingOverrides)
          .set({ typeId, params, version: row.version + 1, updatedAt: now })
          .where(and(eq(openingOverrides.homeId, homeId), eq(openingOverrides.useId, useId)))
          .returning()
      : await tx.insert(openingOverrides).values({ homeId, useId, typeId, params }).returning();
    await recordHistory(tx, {
      homeId,
      useId,
      useKind: 'opening',
      action: 'update',
      actor,
      before: overrideState(row),
      after: overrideState(written),
    });
  };
  for (const o of seed.openingOverrides) {
    const row = byId.get(o.useId);
    if (row && row.typeId === o.typeId && sameJson(row.params, o.params)) continue;
    await write(o.useId, o.typeId, o.params);
    changes.set.push(o.useId);
  }
  // An override the seed does not have is emptied; the row, its version and history stay.
  for (const row of rows) {
    if (wanted.has(row.useId) || Object.keys(row.params).length === 0) continue;
    await write(row.useId, row.typeId, {});
    changes.cleared.push(row.useId);
  }
}

/**
 * Makes the notes of one home's uses (`homeId`, limited to the subjects in `scope`) or the type
 * notes (`homeId` null) match `wanted`: missing ones are created with the seed's id, author and
 * times, differing ones overwritten (a deleted one comes back), and active ones not in the seed
 * soft-deleted. Notes have no history.
 */
async function syncNotes(
  tx: Tx,
  homeId: string | null,
  wanted: SeedNote[],
  actor: HistoryActor,
  changes: NoteChanges,
  scope?: Set<string>,
) {
  const ids = new Set(wanted.map((n) => n.id));
  const now = new Date();
  for (const n of wanted) {
    const values = {
      homeId,
      subjectKind: n.subject.kind,
      subjectId: n.subject.id,
      body: n.body,
      createdBy: n.createdBy,
      updatedBy: n.updatedBy,
      createdAt: new Date(n.createdAt),
      updatedAt: new Date(n.updatedAt),
      deletedAt: null,
    };
    const [row] = await tx.select().from(notes).where(eq(notes.id, n.id)).for('update');
    if (!row) {
      await tx.insert(notes).values({ id: n.id, ...values });
      changes.created.push(n.id);
      continue;
    }
    const same =
      row.homeId === homeId &&
      row.deletedAt === null &&
      sameJson(toSeedNote(row), {
        ...n,
        createdAt: values.createdAt.toISOString(),
        updatedAt: values.updatedAt.toISOString(),
      });
    if (same) continue;
    await tx.update(notes).set(values).where(eq(notes.id, n.id));
    changes.updated.push(n.id);
  }
  const active = await tx
    .select({ id: notes.id, subjectKind: notes.subjectKind, subjectId: notes.subjectId })
    .from(notes)
    .where(
      and(
        homeId === null ? isNull(notes.homeId) : eq(notes.homeId, homeId),
        isNull(notes.deletedAt),
      ),
    )
    .for('update');
  for (const { id, subjectKind, subjectId } of active) {
    if (ids.has(id)) continue;
    if (scope && (subjectKind !== 'use' || !scope.has(subjectId))) continue;
    await tx.update(notes).set({ deletedAt: now, updatedBy: actor.actor }).where(eq(notes.id, id));
    changes.deleted.push(id);
  }
}

export interface SeedInput {
  model: HomeModel;
  seed: HomeSeed;
}

/**
 * Makes each home's `userdata` match its seed, in one transaction (validate the seeds first, with
 * `readSeedFile` or `seedIssues`):
 * - placements: missing ones are created with the seed's id, differing ones updated (one in the
 *   trash is restored), active ones not in the seed moved to the trash; every seed id is added
 *   to `issued_ids`;
 * - opening overrides: set to the seed's params, those not in the seed emptied;
 * - notes on the homes' uses, and the type notes (the union of the seeds' type notes): created,
 *   overwritten or soft-deleted.
 * Every placement and override change writes a history row by `actor` (default: `SEED_ACTOR`, `system` named `seed`). An
 * unchanged seed changes nothing and writes no history. Photos, photo requests, history, the
 * home settings and other homes are not touched. Each synced home's one-time layout import is
 * claimed, so it never adds placements the seed does not have.
 */
export async function syncSeeds(
  db: Db,
  inputs: SeedInput[],
  actor: HistoryActor = SEED_ACTOR,
): Promise<SeedSyncReport> {
  const typeNotes = new Map<string, SeedNote>();
  for (const { seed } of inputs) {
    for (const note of seed.notes) {
      if (note.subject.kind !== 'type') continue;
      const other = typeNotes.get(note.id);
      if (other && !sameJson(other, note)) {
        throw new Error(`Type note "${note.id}" differs between two seeds`);
      }
      typeNotes.set(note.id, note);
    }
  }
  return db.transaction(async (tx) => {
    const report: SeedSyncReport = { homes: [], typeNotes: noteChanges() };
    for (const { model, seed } of inputs) {
      if (seed.homeId !== model.id) {
        throw new Error(`The seed of home "${seed.homeId}" was given for "${model.id}"`);
      }
      const changes: SeedChanges = {
        homeId: model.id,
        placements: { created: [], updated: [], restored: [], removed: [] },
        openingOverrides: { set: [], cleared: [] },
        notes: noteChanges(),
      };
      await syncPlacements(tx, model, seed, actor, changes.placements);
      await syncOverrides(tx, model.id, seed, actor, changes.openingOverrides);
      const useNotes = seed.notes.filter((n) => n.subject.kind === 'use');
      const scope = noteScope(
        model,
        seed.placements.map((p) => p.id),
      );
      await syncNotes(tx, model.id, useNotes, actor, changes.notes, scope);
      await tx
        .insert(imports)
        .values({
          homeId: model.id,
          source: LAYOUTS_SOURCE,
          detail: { status: 'skipped', reason: 'seeded from git' },
        })
        .onConflictDoNothing();
      report.homes.push(changes);
    }
    if (inputs.length > 0) {
      await syncNotes(tx, null, [...typeNotes.values()], actor, report.typeNotes);
    }
    return report;
  });
}

/** The release log's lines for a seed sync. */
export function describeSeedSync(report: SeedSyncReport): string[] {
  const list = (label: string, ids: string[]) =>
    ids.length > 0 ? [`${label} ${ids.length} (${ids.join(', ')})`] : [];
  const lines = report.homes.map((c) => {
    if (seedChangeCount(c) === 0) return `release: home "${c.homeId}" seed unchanged`;
    const parts = [
      ...list('placements created', c.placements.created),
      ...list('updated', c.placements.updated),
      ...list('restored', c.placements.restored),
      ...list('moved to the trash', c.placements.removed),
      ...list('overrides set', c.openingOverrides.set),
      ...list('overrides cleared', c.openingOverrides.cleared),
      ...list('notes created', c.notes.created),
      ...list('notes updated', c.notes.updated),
      ...list('notes deleted', c.notes.deleted),
    ];
    return `release: home "${c.homeId}" seed applied: ${parts.join('; ')}`;
  });
  if (seedChangeCount(report.typeNotes) > 0) {
    const t = report.typeNotes;
    const parts = [
      ...list('created', t.created),
      ...list('updated', t.updated),
      ...list('deleted', t.deleted),
    ];
    lines.push(`release: type notes from the seed: ${parts.join('; ')}`);
  }
  return lines;
}
