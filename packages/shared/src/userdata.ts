import { z } from 'zod';
import {
  CatalogKind,
  formatCm,
  formatPercent,
  ParamValues,
  TypeId,
  type CatalogType,
} from './catalog';
import { Bearing, Id } from './home-model';
import { ApiError } from './homes';
import { PlanPosition } from './layouts';
import { Subject, SubjectQuery } from './subjects';

/**
 * What people change on a deployed environment, stored in the `userdata` schema (docs/userdata.md):
 * furniture placements, basic-parameter overrides of the openings in git, and the history of every
 * change with its actor. Positions are plan coordinates in metres (x east, z south) and
 * `rotationY` is three.js radians about +y, as in layouts.
 */

const Timestamp = z.iso.datetime({ offset: true });
const Name = z.string().trim().min(1).max(200);

/**
 * Who made a change: the owner (a browser session), an agent, the system (release job, imports), or
 * the seed from git that every deploy applies (`data/homes/<home>.seed.json`).
 */
export const Actor = z.enum(['owner', 'agent', 'system', 'seed']);
export type Actor = z.infer<typeof Actor>;

/**
 * How the actor was known: the SSO identity header (deployed hosts), the declared
 * `X-My-Home-Actor` header (local dev, tests, CI), or neither (`default`: owner).
 */
export const ActorSource = z.enum(['identity', 'declared', 'default']);
export type ActorSource = z.infer<typeof ActorSource>;

/**
 * A use's state as history stores it before and after a change (openings: `params` only; a
 * home's settings: `params: {}` and `magneticDeclination`).
 */
export const UseState = z.object({
  name: z.string().optional(),
  params: ParamValues,
  levelId: Id.optional(),
  roomId: Id.nullable().optional(),
  position: PlanPosition.optional(),
  rotationY: z.number().optional(),
  removed: z.boolean().optional(),
  /** Home settings only: the declination overlay, `null` = the home model's value. */
  magneticDeclination: Bearing.nullable().optional(),
});
export type UseState = z.infer<typeof UseState>;

/**
 * A piece of furniture placed in a home (a use stored in the database). `params` holds only the
 * basic-parameter overrides; `removedAt` set means it is in the trash.
 */
export const Placement = z.object({
  id: Id,
  homeId: Id,
  typeId: TypeId,
  name: z.string(),
  levelId: Id,
  roomId: Id.nullable(),
  position: PlanPosition,
  rotationY: z.number(),
  params: ParamValues,
  version: z.number().int().positive(),
  createdAt: Timestamp,
  updatedAt: Timestamp,
  removedAt: Timestamp.nullable(),
  /** When a placement in the trash is purged for good (with its history). */
  purgeAt: Timestamp.nullable(),
});
export type Placement = z.infer<typeof Placement>;

/** Basic-parameter overrides of a git use (opening, roof window, outbuilding opening, gate). */
export const OpeningOverride = z.object({
  homeId: Id,
  useId: Id,
  /** The use's type when the override was written; differs from the model after a git change. */
  typeId: TypeId,
  params: ParamValues,
  version: z.number().int().positive(),
  updatedAt: Timestamp,
});
export type OpeningOverride = z.infer<typeof OpeningOverride>;

export const UseStatus = z.enum(['ok', 'needs-attention']);
export type UseStatus = z.infer<typeof UseStatus>;

/** A where-used row (computed): a git use with its override, a placement, or an orphan. */
export const Use = z.object({
  id: Id,
  homeId: Id,
  typeId: TypeId,
  kind: CatalogKind,
  source: z.enum(['git', 'db']),
  name: z.string(),
  levelId: Id.nullable(),
  roomIds: z.array(Id),
  /** Where it is, for people: "Ground floor · Kitchen". */
  where: z.string(),
  overrides: ParamValues,
  effective: ParamValues,
  /** 0 = never overridden. */
  version: z.number().int().nonnegative(),
  status: UseStatus,
  problems: z.array(z.string()),
  updatedAt: Timestamp.nullable(),
  /** Placements only: set while it is in the trash. */
  removedAt: Timestamp.nullable(),
});
export type Use = z.infer<typeof Use>;

/** `home`: a home's settings (`useId` = the home id), see `HomeSettings`. */
export const UseKind = z.enum(['placement', 'opening', 'home']);
export type UseKind = z.infer<typeof UseKind>;

export const HistoryAction = z.enum(['create', 'update', 'remove', 'restore', 'undo', 'import']);
export type HistoryAction = z.infer<typeof HistoryAction>;

export const Change = z.object({ field: z.string(), text: z.string() });
export type Change = z.infer<typeof Change>;

/** One change of a use, newest first in lists; `changes` is its description for people. */
export const HistoryEntry = z.object({
  id: z.uuid(),
  homeId: Id,
  useId: Id,
  useKind: UseKind,
  action: HistoryAction,
  actor: Actor,
  actorSource: ActorSource,
  /** The SSO username when known. */
  actorName: z.string().nullable(),
  at: Timestamp,
  before: UseState.nullable(),
  after: UseState.nullable(),
  changes: z.array(Change),
  undoesId: z.uuid().nullable(),
  undoneById: z.uuid().nullable(),
  canUndo: z.boolean(),
});
export type HistoryEntry = z.infer<typeof HistoryEntry>;

/**
 * Per-home settings stored in the database on top of the home model from git, so the sync on
 * every deploy keeps them. `magneticDeclination: null` uses the model's value.
 */
export const HomeSettings = z.object({
  homeId: Id,
  magneticDeclination: Bearing.nullable(),
  /** 0 = never set. */
  version: z.number().int().nonnegative(),
  updatedAt: Timestamp.nullable(),
});
export type HomeSettings = z.infer<typeof HomeSettings>;

/** `version: 0` creates the settings; `magneticDeclination: null` goes back to the model's value. */
export const PutHomeSettingsBody = z.strictObject({
  version: z.number().int().nonnegative(),
  magneticDeclination: Bearing.nullable(),
});
export type PutHomeSettingsBody = z.infer<typeof PutHomeSettingsBody>;

// Requests and responses.

export const UseHomeParams = z.object({ homeId: Id });
export const HomeSettingsParams = UseHomeParams;
export const PlacementParams = z.object({ homeId: Id, id: Id });
export const UseParams = z.object({ homeId: Id, useId: Id });
export const HistoryEntryParams = z.object({ homeId: Id, useId: Id, entryId: z.uuid() });

export const WhoAmIResponse = z.object({
  username: z.string().nullable(),
  actor: Actor,
  actorSource: ActorSource,
});
export type WhoAmIResponse = z.infer<typeof WhoAmIResponse>;

const ParamSpecSummary = z.looseObject({
  type: z.enum(['color', 'length', 'count', 'number', 'fraction', 'choice']),
  tier: z.enum(['basic', 'design']),
  label: z.string(),
  default: z.union([z.string(), z.number()]),
  min: z.number().optional(),
  max: z.number().optional(),
  step: z.number().optional(),
  unit: z.string().optional(),
  options: z.array(z.object({ value: z.string(), label: z.string() })).optional(),
});

/** A catalogue type as the api lists it: metadata and parameter specs (tier and limits). */
export const CatalogTypeSummary = z.object({
  id: TypeId,
  kind: CatalogKind,
  family: z.enum(['window', 'door', 'gate', 'furniture', 'kitchen', 'appliance', 'fixture']),
  name: z.string(),
  description: z.string(),
  icon: z.string(),
  category: z.string().optional(),
  placement: z.enum(['wall', 'roof', 'fence', 'floor']),
  mounting: z.enum(['floor', 'wall', 'ceiling']).optional(),
  elevation: z.number().optional(),
  openingTypes: z.array(z.string()).optional(),
  params: z.record(z.string(), ParamSpecSummary),
  snapping: z.object({ wall: z.enum(['back', 'any', 'none']) }).optional(),
  footprint: z.enum(['rectangle', 'ellipse']).optional(),
});
export type CatalogTypeSummary = z.infer<typeof CatalogTypeSummary>;

export const ListCatalogTypesResponse = z.object({ items: z.array(CatalogTypeSummary) });
export type ListCatalogTypesResponse = z.infer<typeof ListCatalogTypesResponse>;

/** Per type: its git uses in every stored home plus the active placements. */
export const CatalogUsageResponse = z.object({ counts: z.record(z.string(), z.number().int()) });
export type CatalogUsageResponse = z.infer<typeof CatalogUsageResponse>;

export const ListUsesQuery = z.object({
  typeId: TypeId.optional(),
  status: UseStatus.optional(),
});
export type ListUsesQuery = z.infer<typeof ListUsesQuery>;

export const ListUsesResponse = z.object({ items: z.array(Use) });
export type ListUsesResponse = z.infer<typeof ListUsesResponse>;

export const ListPlacementsQuery = z.object({ include: z.literal('removed').optional() });
export type ListPlacementsQuery = z.infer<typeof ListPlacementsQuery>;

export const ListPlacementsResponse = z.object({ items: z.array(Placement) });
export type ListPlacementsResponse = z.infer<typeof ListPlacementsResponse>;

/**
 * A new piece of furniture or a fixture. The server assigns `id` and, unless given, `name`; it derives `roomId`
 * from the position (a sent `roomId` is ignored). `params` are basic overrides of the type.
 */
export const CreatePlacementBody = z.strictObject({
  typeId: TypeId,
  levelId: Id,
  roomId: Id.nullable().optional(),
  position: PlanPosition,
  rotationY: z.number().default(0),
  params: z.record(z.string(), z.unknown()).default({}),
  name: Name.optional(),
});
export type CreatePlacementBody = z.input<typeof CreatePlacementBody>;

/** A partial update guarded by `version`; `params` replaces the whole override object. */
export const UpdatePlacementBody = z.strictObject({
  version: z.number().int().positive(),
  name: Name.optional(),
  levelId: Id.optional(),
  roomId: Id.nullable().optional(),
  position: PlanPosition.optional(),
  rotationY: z.number().optional(),
  params: z.record(z.string(), z.unknown()).optional(),
});
export type UpdatePlacementBody = z.infer<typeof UpdatePlacementBody>;

export const RemovePlacementQuery = z.object({ version: z.coerce.number().int().positive() });
export type RemovePlacementQuery = z.infer<typeof RemovePlacementQuery>;

/** `version: 0` creates the override; `params` replaces it (an empty object keeps the row). */
export const PutOpeningOverrideBody = z.strictObject({
  version: z.number().int().nonnegative(),
  params: z.record(z.string(), z.unknown()),
});
export type PutOpeningOverrideBody = z.infer<typeof PutOpeningOverrideBody>;

export const ListOpeningOverridesResponse = z.object({ items: z.array(OpeningOverride) });
export type ListOpeningOverridesResponse = z.infer<typeof ListOpeningOverridesResponse>;

export const ListHistoryResponse = z.object({ items: z.array(HistoryEntry) });
export type ListHistoryResponse = z.infer<typeof ListHistoryResponse>;

export const UndoResponse = z.object({ entry: HistoryEntry, use: Use });
export type UndoResponse = z.infer<typeof UndoResponse>;

/** Undoing a change of a home's settings (`useId` = the home id) answers with the settings. */
export const UndoHomeSettingsResponse = z.object({ entry: HistoryEntry, settings: HomeSettings });
export type UndoHomeSettingsResponse = z.infer<typeof UndoHomeSettingsResponse>;

/** 409: the version is stale, or an undo conflicts with later changes (or was already done). */
export const UseConflict = ApiError.extend({
  currentVersion: z.number().int().nonnegative(),
  conflicts: z.array(z.string()),
});
export type UseConflict = z.infer<typeof UseConflict>;

// Notes.

export const MAX_NOTE_LENGTH = 4000;
const NoteBody = z.string().trim().min(1).max(MAX_NOTE_LENGTH);

/**
 * A free-text note on a catalogue type (environment-wide: `homeId` null) or on a use of a home.
 * Owner and agents may edit and delete any note; deleting is soft, and notes have no history.
 */
export const Note = z.object({
  id: z.uuid(),
  homeId: Id.nullable(),
  subject: Subject,
  body: NoteBody,
  createdBy: Actor,
  updatedBy: Actor,
  createdAt: Timestamp,
  updatedAt: Timestamp,
});
export type Note = z.infer<typeof Note>;

export const NoteParams = z.object({ id: z.uuid() });

/** `subject=type:<typeId>` (environment-wide) or `subject=use:<useId>&homeId=<id>`. */
export const ListNotesQuery = z.object({ subject: SubjectQuery, homeId: Id.optional() });
export type ListNotesQuery = z.input<typeof ListNotesQuery>;

/** Oldest first. */
export const ListNotesResponse = z.object({ items: z.array(Note) });
export type ListNotesResponse = z.infer<typeof ListNotesResponse>;

/** A use note needs its `homeId`; a type note must not have one. */
export const CreateNoteBody = z.strictObject({
  subject: Subject,
  homeId: Id.nullish(),
  body: NoteBody,
});
export type CreateNoteBody = z.input<typeof CreateNoteBody>;

export const UpdateNoteBody = z.strictObject({ body: NoteBody });
export type UpdateNoteBody = z.input<typeof UpdateNoteBody>;

// Describing changes for people.

const DEG = 180 / Math.PI;

const formatValue = (type: CatalogType | undefined, key: string, value: string | number) => {
  const spec = type?.params[key];
  if (spec?.type === 'length' && typeof value === 'number') return formatCm(value);
  if (spec?.type === 'fraction' && typeof value === 'number') return formatPercent(value);
  if (spec?.type === 'choice')
    return spec.options.find((o) => o.value === value)?.label ?? String(value);
  if (typeof value === 'string') return value.toLowerCase();
  return String(value);
};

/** A param's value as drawn: the override, else the type's default. */
const paramValue = (type: CatalogType | undefined, params: ParamValues, key: string) =>
  params[key] ?? type?.params[key]?.default;

/**
 * The difference between two states of a use as short texts: "colour #f7f7f5 → #383e42",
 * "width 160.0 cm → 180.0 cm", "moved 1.0 m", "rotated 90°", "moved to Kitchen",
 * "renamed 'Bed' → 'Guest bed'". `before: null` is a creation ("placed").
 */
export function describeChanges(
  type: CatalogType | undefined,
  before: UseState | null,
  after: UseState | null,
  names: { roomName?: string; levelName?: string } = {},
): Change[] {
  if (!after) return [];
  if (!before) {
    return [{ field: 'created', text: names.roomName ? `placed in ${names.roomName}` : 'placed' }];
  }
  const changes: Change[] = [];
  if (before.name !== undefined && after.name !== undefined && before.name !== after.name) {
    changes.push({ field: 'name', text: `renamed '${before.name}' → '${after.name}'` });
  }
  if (before.levelId !== undefined && after.levelId !== undefined) {
    if (before.levelId !== after.levelId) {
      changes.push({ field: 'levelId', text: `moved to ${names.levelName ?? after.levelId}` });
    }
  }
  if (before.position && after.position) {
    const d = Math.hypot(
      after.position.x - before.position.x,
      after.position.z - before.position.z,
    );
    if (d > 0) changes.push({ field: 'position', text: `moved ${d.toFixed(1)} m` });
  }
  if (before.roomId !== undefined && after.roomId !== undefined) {
    if (before.roomId !== after.roomId) {
      changes.push({
        field: 'roomId',
        text:
          after.roomId === null
            ? 'moved out of every room'
            : `moved to ${names.roomName ?? after.roomId}`,
      });
    }
  }
  if (before.rotationY !== undefined && after.rotationY !== undefined) {
    let deg = ((after.rotationY - before.rotationY) * DEG) % 360;
    if (deg > 180) deg -= 360;
    if (deg <= -180) deg += 360;
    const rounded = Math.round(deg);
    if (rounded !== 0) changes.push({ field: 'rotationY', text: `rotated ${rounded}°` });
  }
  const keys = [...new Set([...Object.keys(before.params), ...Object.keys(after.params)])];
  const order = type ? Object.keys(type.params) : [];
  keys.sort((a, b) => {
    const [ia, ib] = [order.indexOf(a), order.indexOf(b)];
    return (ia < 0 ? Infinity : ia) - (ib < 0 ? Infinity : ib) || a.localeCompare(b);
  });
  for (const key of keys) {
    const [b, a] = [before.params[key], after.params[key]];
    if (b === a) continue;
    const label = (type?.params[key]?.label ?? key).toLowerCase();
    const from = paramValue(type, before.params, key);
    const to = paramValue(type, after.params, key);
    const show = (v: string | number | undefined) =>
      v === undefined ? 'unset' : formatValue(type, key, v);
    const reset = a === undefined && to !== undefined ? ' (default)' : '';
    changes.push({ field: `params.${key}`, text: `${label} ${show(from)} → ${show(to)}${reset}` });
  }
  if (after.magneticDeclination !== undefined) {
    const [b, a] = [before.magneticDeclination ?? null, after.magneticDeclination];
    const show = (v: Bearing | null) => (v === null ? 'from the home model' : `${v.value}°`);
    if (b?.value !== a?.value || b?.source !== a?.source) {
      changes.push({
        field: 'magneticDeclination',
        text: `magnetic declination ${show(b)} → ${show(a)}`,
      });
    }
  }
  if (before.removed !== after.removed && after.removed !== undefined) {
    changes.push({ field: 'removed', text: after.removed ? 'moved to the trash' : 'restored' });
  }
  return changes;
}
