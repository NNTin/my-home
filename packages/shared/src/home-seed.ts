import { z } from 'zod';
import { basicOverridesSchema, catalog, isPlacedKind, ParamValues, TypeId } from './catalog';
import { openingFitIssues } from './catalog/fit';
import { effectiveParams } from './catalog/effective';
import { modelUses } from './catalog/uses';
import { Id, type HomeModel } from './home-model';
import { PlanPosition } from './layouts';
import { Subject } from './subjects';
import { Actor, MAX_NOTE_LENGTH } from './userdata';

/**
 * A home's seed (`data/homes/<home>.seed.json`, docs/deployment.md § The seed comes from git): how
 * the catalogue is used in the home, versioned in git like the home file. Every deploy makes the
 * environment's `userdata` match it: the active placements with their basic params, the opening
 * overrides and the notes (on uses of the home and on types). Not in it: history, issued ids,
 * photos, photo requests and the home settings.
 *
 * The file is canonical (`formatSeed`): lists sorted by stable id, keys in a fixed order, params
 * sorted by key, so a pull request's diff shows only what changed.
 */

export const SEED_SCHEMA_VERSION = 1;

const Timestamp = z.iso.datetime({ offset: true });

/** An active placement: what the viewer draws. Its room follows from the position. */
export const SeedPlacement = z.strictObject({
  id: Id,
  typeId: TypeId,
  name: z.string().trim().min(1).max(200),
  levelId: Id,
  position: PlanPosition,
  rotationY: z.number(),
  params: ParamValues,
});
export type SeedPlacement = z.infer<typeof SeedPlacement>;

/** The basic-parameter overrides of a git use; `typeId` is the use's type in the home model. */
export const SeedOpeningOverride = z.strictObject({
  useId: Id,
  typeId: TypeId,
  params: ParamValues,
});
export type SeedOpeningOverride = z.infer<typeof SeedOpeningOverride>;

/** A note on a type (environment-wide) or on a use of this home, with who wrote it and when. */
export const SeedNote = z.strictObject({
  id: z.uuid(),
  subject: Subject,
  body: z.string().trim().min(1).max(MAX_NOTE_LENGTH),
  createdBy: Actor,
  updatedBy: Actor,
  createdAt: Timestamp,
  updatedAt: Timestamp,
});
export type SeedNote = z.infer<typeof SeedNote>;

export const HomeSeed = z.strictObject({
  schemaVersion: z.literal(SEED_SCHEMA_VERSION),
  homeId: Id,
  placements: z.array(SeedPlacement),
  openingOverrides: z.array(SeedOpeningOverride),
  notes: z.array(SeedNote),
});
export type HomeSeed = z.infer<typeof HomeSeed>;

const byKey = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

const sortedParams = (params: ParamValues): ParamValues =>
  Object.fromEntries(Object.entries(params).sort(([a], [b]) => byKey(a, b)));

const noteKey = (n: SeedNote) => `${n.subject.kind}\u0000${n.subject.id}\u0000${n.createdAt}`;

/**
 * The seed in canonical form: placements by id, overrides by use id, notes by subject, then
 * creation time and id; every object's keys in schema order and params by key.
 */
export function canonicalSeed(seed: HomeSeed): HomeSeed {
  return {
    schemaVersion: seed.schemaVersion,
    homeId: seed.homeId,
    placements: seed.placements
      .map((p) => ({
        id: p.id,
        typeId: p.typeId,
        name: p.name,
        levelId: p.levelId,
        position: { x: p.position.x, z: p.position.z },
        rotationY: p.rotationY,
        params: sortedParams(p.params),
      }))
      .sort((a, b) => byKey(a.id, b.id)),
    openingOverrides: seed.openingOverrides
      .map((o) => ({ useId: o.useId, typeId: o.typeId, params: sortedParams(o.params) }))
      .sort((a, b) => byKey(a.useId, b.useId)),
    notes: seed.notes
      .map((n) => ({
        id: n.id,
        subject: { kind: n.subject.kind, id: n.subject.id },
        body: n.body,
        createdBy: n.createdBy,
        updatedBy: n.updatedBy,
        createdAt: n.createdAt,
        updatedAt: n.updatedAt,
      }))
      .sort((a, b) => byKey(noteKey(a), noteKey(b)) || byKey(a.id, b.id)),
  };
}

/** The seed file's text: canonical, two-space JSON with a final newline (stable under Prettier). */
export const formatSeed = (seed: HomeSeed) => `${JSON.stringify(canonicalSeed(seed), null, 2)}\n`;

/**
 * The seed with every placement's and override's params as the api stores them (parsed with the
 * type's basic schema: colours lower-cased). Params that do not parse are kept: `seedIssues`
 * reports them.
 */
export function normalizeSeed(seed: HomeSeed): HomeSeed {
  const normalize = (typeId: string, params: ParamValues) => {
    const type = catalog.get(typeId);
    const parsed = type && basicOverridesSchema(type).safeParse(params);
    return parsed?.success ? parsed.data : params;
  };
  return canonicalSeed({
    ...seed,
    placements: seed.placements.map((p) => ({ ...p, params: normalize(p.typeId, p.params) })),
    openingOverrides: seed.openingOverrides.map((o) => ({
      ...o,
      params: normalize(o.typeId, o.params),
    })),
  });
}

/** An empty seed: a home with no placements, overrides or notes. */
export const emptySeed = (homeId: string): HomeSeed => ({
  schemaVersion: SEED_SCHEMA_VERSION,
  homeId,
  placements: [],
  openingOverrides: [],
  notes: [],
});

export interface SeedIssue {
  path: string;
  message: string;
}

/** Every id anywhere in a home document (a placement id must not clash with one). */
function modelIds(value: unknown, into = new Set<string>()): Set<string> {
  if (Array.isArray(value)) for (const item of value) modelIds(item, into);
  else if (value && typeof value === 'object') {
    for (const [k, v] of Object.entries(value)) {
      if (k === 'id' && typeof v === 'string') into.add(v);
      else modelIds(v, into);
    }
  }
  return into;
}

/**
 * Why a seed does not fit its home and the catalogue (empty when it does): every placement's type
 * is a furniture or fixture type, its params are valid basic params, its level exists and its id
 * is unique and not a home-model id; every override is of a use in the model, for the use's
 * current type, with valid params that fit the hole; every note's type is in the catalogue and
 * its use in the model or the seed's placements; ids are unique.
 */
export function seedIssues(seed: HomeSeed, model: HomeModel): SeedIssue[] {
  const issues: SeedIssue[] = [];
  const add = (path: string, message: string) => issues.push({ path, message });
  if (seed.homeId !== model.id) {
    add('homeId', `The seed is for home "${seed.homeId}", the home file is "${model.id}"`);
  }
  const levels = new Set(model.levels.map((l) => l.id));
  const ids = modelIds(model);
  const placed = new Set<string>();
  seed.placements.forEach((p, i) => {
    const at = `placements[${i}]`;
    if (placed.has(p.id)) add(`${at}.id`, `Duplicate placement id "${p.id}"`);
    placed.add(p.id);
    if (ids.has(p.id)) add(`${at}.id`, `"${p.id}" is already an id in the home model`);
    if (!levels.has(p.levelId)) add(`${at}.levelId`, `Level "${p.levelId}" is not in the home`);
    const type = catalog.get(p.typeId);
    if (!type) return add(`${at}.typeId`, `Type "${p.typeId}" is not in the catalogue`);
    if (!isPlacedKind(type)) {
      return add(`${at}.typeId`, `Type "${p.typeId}" is not a furniture or fixture type`);
    }
    const parsed = basicOverridesSchema(type).safeParse(p.params);
    if (!parsed.success) {
      for (const issue of parsed.error.issues) {
        add(`${at}.params${issue.path.map((k) => `.${String(k)}`).join('')}`, issue.message);
      }
    }
  });

  const uses = new Map(modelUses(model).map((u) => [u.id, u]));
  const overridden = new Set<string>();
  seed.openingOverrides.forEach((o, i) => {
    const at = `openingOverrides[${i}]`;
    if (overridden.has(o.useId)) add(`${at}.useId`, `Duplicate override of "${o.useId}"`);
    overridden.add(o.useId);
    const use = uses.get(o.useId);
    if (!use) return add(`${at}.useId`, `Use "${o.useId}" is not in the home model`);
    if (use.typeId !== o.typeId) {
      return add(
        `${at}.typeId`,
        `The use is a "${use.typeId}" in the home model, not "${o.typeId}"`,
      );
    }
    const type = catalog.get(o.typeId);
    if (!type) return add(`${at}.typeId`, `Type "${o.typeId}" is not in the catalogue`);
    const parsed = basicOverridesSchema(type).safeParse(o.params);
    if (!parsed.success) {
      for (const issue of parsed.error.issues) {
        add(`${at}.params${issue.path.map((k) => `.${String(k)}`).join('')}`, issue.message);
      }
      return;
    }
    if (use.hole) {
      for (const message of openingFitIssues(
        type,
        effectiveParams(type, o.params).values,
        use.hole,
      )) {
        add(`${at}.params`, message);
      }
    }
  });

  const noteIds = new Set<string>();
  seed.notes.forEach((n, i) => {
    const at = `notes[${i}]`;
    if (noteIds.has(n.id)) add(`${at}.id`, `Duplicate note id "${n.id}"`);
    noteIds.add(n.id);
    if (n.subject.kind === 'type' && !catalog.get(n.subject.id)) {
      add(`${at}.subject.id`, `Type "${n.subject.id}" is not in the catalogue`);
    }
    if (n.subject.kind === 'use' && !uses.has(n.subject.id) && !placed.has(n.subject.id)) {
      add(`${at}.subject.id`, `Use "${n.subject.id}" is neither in the home model nor placed`);
    }
  });
  return issues;
}

// Requests and responses.

export const SeedParams = z.object({ homeId: Id });

const Ids = z.array(z.string());

export const SeedNoteChanges = z.object({ created: Ids, updated: Ids, deleted: Ids });
export type SeedNoteChanges = z.infer<typeof SeedNoteChanges>;

/** What applying a seed changed in one home; every list empty = unchanged. */
export const SeedChanges = z.object({
  homeId: Id,
  placements: z.object({ created: Ids, updated: Ids, restored: Ids, removed: Ids }),
  /** `set`: created or changed; `cleared`: emptied, as the seed does not have it (rows are kept). */
  openingOverrides: z.object({ set: Ids, cleared: Ids }),
  /** Notes on the home's uses. */
  notes: SeedNoteChanges,
});
export type SeedChanges = z.infer<typeof SeedChanges>;

/** `PUT /api/homes/:homeId/seed`: what the import changed (type notes are environment-wide). */
export const SeedSyncReport = z.object({ homes: z.array(SeedChanges), typeNotes: SeedNoteChanges });
export type SeedSyncReport = z.infer<typeof SeedSyncReport>;
