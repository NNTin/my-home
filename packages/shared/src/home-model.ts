import { z } from 'zod';

/**
 * The home model: the single source of truth for the building.
 *
 * Conventions: units are metres; Y-up, right-handed; ground level is `y = 0`. Plan coordinates
 * are `x` (east) and `z` (south, towards the street); a level's `elevation` is the top of its
 * floor slab. Every dimension carries its provenance so placeholder values can be refined later.
 */

export const HOME_SCHEMA_VERSION = 1;

export const DimensionSource = z
  .enum(['mock', 'estimated-from-photo', 'measured'])
  .meta({ id: 'DimensionSource', description: 'Where a dimension value comes from.' });
export type DimensionSource = z.infer<typeof DimensionSource>;

const dimension = (value: z.ZodNumber, id: string, description: string) =>
  z
    .strictObject({
      value,
      source: DimensionSource,
      note: z.string().max(500).optional(),
    })
    .meta({ id, description });

/** A length or coordinate in metres with its provenance. */
export const Dimension = dimension(z.number(), 'Dimension', 'A value in metres with provenance.');
export type Dimension = z.infer<typeof Dimension>;

export const PositiveDimension = dimension(
  z.number().positive(),
  'PositiveDimension',
  'A strictly positive value in metres with provenance.',
);
export const NonNegativeDimension = dimension(
  z.number().nonnegative(),
  'NonNegativeDimension',
  'A non-negative value in metres with provenance.',
);

export const Id = z
  .string()
  .regex(/^[A-Za-z0-9][A-Za-z0-9_-]*$/, 'Ids use letters, digits, "-" and "_"')
  .max(64)
  .meta({ id: 'Id' });
export type Id = z.infer<typeof Id>;

/** A point on the ground plan (x east, z south). */
export const Point = z
  .strictObject({ x: Dimension, z: Dimension })
  .meta({ id: 'Point', description: 'A plan point (x east, z south) in metres.' });
export type Point = z.infer<typeof Point>;

export const Polygon = z
  .array(Point)
  .min(3)
  .meta({ id: 'Polygon', description: 'A simple polygon on the plan, at least 3 points.' });
export type Polygon = z.infer<typeof Polygon>;

/** A compass bearing in degrees with provenance. */
export const Bearing = z
  .strictObject({
    value: z.number().min(-360).max(360),
    source: DimensionSource,
    note: z.string().max(500).optional(),
  })
  .meta({ id: 'Bearing', description: 'An angle in degrees with provenance.' });
export type Bearing = z.infer<typeof Bearing>;

/** A roof pitch in degrees with provenance. */
export const Pitch = z
  .strictObject({
    value: z.number().gt(0).lt(80),
    source: DimensionSource,
    note: z.string().max(500).optional(),
  })
  .meta({ id: 'Pitch', description: 'A roof pitch in degrees (0 to 80) with provenance.' });
export type Pitch = z.infer<typeof Pitch>;

const Name = z.string().min(1).max(200);

/** The default: a flat slab of `building.roofThickness` on top of the highest level. */
export const FlatRoof = z.strictObject({ type: z.literal('flat') }).meta({ id: 'FlatRoof' });

/**
 * A gable (saddle) roof over the highest level, which becomes an attic. It spans the bounding
 * rectangle of the footprint; `building.roofThickness` is the thickness of the roof planes.
 */
export const GableRoof = z
  .strictObject({
    type: z.literal('gable'),
    /** Direction of the ridge on the plan: `x` (east-west) or `z` (north-south). */
    ridgeAxis: z.enum(['x', 'z']),
    pitch: Pitch,
    /** Height of the roof's underside above the attic floor, at the footprint edge (eaves side). */
    kneeWallHeight: NonNegativeDimension,
    /** How far the roof reaches past the footprint, on all four sides. */
    overhang: NonNegativeDimension,
  })
  .meta({ id: 'GableRoof' });
export type GableRoof = z.infer<typeof GableRoof>;

export const Roof = z.discriminatedUnion('type', [FlatRoof, GableRoof]).meta({ id: 'Roof' });
export type Roof = z.infer<typeof Roof>;

export const Building = z.strictObject({
  id: Id,
  name: Name,
  /** Outline of the exterior walls (centre lines), used for slabs and the terrain cut. */
  footprint: Polygon,
  roofThickness: PositiveDimension,
  /** Roof over the highest level; a flat roof when omitted. */
  roof: Roof.optional(),
  /**
   * Where true north is: degrees clockwise (seen from above) from the plan's -z axis.
   * Omitted means 0, i.e. true north is -z.
   */
  northBearing: Bearing.optional(),
});
export type Building = z.infer<typeof Building>;

/** The building's roof, defaulting to a flat one for documents without `roof`. */
export const roofOf = (building: Pick<Building, 'roof'>): Roof => building.roof ?? { type: 'flat' };

/** True north in degrees clockwise from the plan's -z axis (0 when not set). */
export const northBearingOf = (building: Pick<Building, 'northBearing'>): number =>
  building.northBearing?.value ?? 0;

export const TerrainPatch = z.strictObject({
  id: Id,
  name: Name,
  outline: Polygon,
  holes: z.array(Polygon).optional(),
  /** Height of the patch's top surface. */
  elevation: Dimension,
});
export type TerrainPatch = z.infer<typeof TerrainPatch>;

export const Terrain = z.strictObject({
  /** Reference ground level, normally 0. */
  groundElevation: Dimension,
  /** Patches are solid blocks of ground from `bottomElevation` up to their own elevation. */
  bottomElevation: Dimension,
  patches: z.array(TerrainPatch).min(1),
});
export type Terrain = z.infer<typeof Terrain>;

export const Level = z.strictObject({
  id: Id,
  name: Name,
  /** Top of the floor slab. Negative for levels below ground. */
  elevation: Dimension,
  /** Clear height from the floor to the underside of the slab above. */
  height: PositiveDimension,
  /** Thickness of this level's floor slab (below `elevation`). */
  slabThickness: PositiveDimension,
});
export type Level = z.infer<typeof Level>;

export const Apartment = z.strictObject({
  id: Id,
  name: Name,
  levelIds: z.array(Id).min(1),
  description: z.string().max(2000).optional(),
});
export type Apartment = z.infer<typeof Apartment>;

export const Room = z.strictObject({
  id: Id,
  name: Name,
  levelId: Id,
  apartmentId: Id.optional(),
  /** Floor polygon. */
  outline: Polygon,
});
export type Room = z.infer<typeof Room>;

export const WallKind = z.enum(['exterior', 'interior']);
export type WallKind = z.infer<typeof WallKind>;

export const Wall = z.strictObject({
  id: Id,
  levelId: Id,
  apartmentId: Id.optional(),
  kind: WallKind,
  /** Centre line from `start` to `end`; the wall stands on the level's floor. */
  start: Point,
  end: Point,
  thickness: PositiveDimension,
  height: PositiveDimension,
});
export type Wall = z.infer<typeof Wall>;

export const OpeningType = z.enum(['door', 'window']);
export type OpeningType = z.infer<typeof OpeningType>;

export const Opening = z.strictObject({
  id: Id,
  wallId: Id,
  type: OpeningType,
  /** Distance along the wall from its `start` to the near edge of the opening. */
  offset: NonNegativeDimension,
  width: PositiveDimension,
  height: PositiveDimension,
  /** Height of the bottom edge above the floor; 0 for doors. */
  sill: NonNegativeDimension,
});
export type Opening = z.infer<typeof Opening>;

export const OutdoorAreaKind = z.enum(['garden', 'driveway', 'patio', 'path']);
export type OutdoorAreaKind = z.infer<typeof OutdoorAreaKind>;

export const OutdoorArea = z.strictObject({
  id: Id,
  name: Name,
  kind: OutdoorAreaKind,
  /** Apartment the area belongs to; omitted for shared areas. */
  ownerApartmentId: Id.optional(),
  outline: Polygon,
  elevation: Dimension,
});
export type OutdoorArea = z.infer<typeof OutdoorArea>;

const HomeModelShape = z.strictObject({
  $schema: z.string().optional(),
  schemaVersion: z.literal(HOME_SCHEMA_VERSION),
  id: Id,
  name: Name,
  description: z.string().max(2000).optional(),
  building: Building,
  terrain: Terrain,
  levels: z.array(Level).min(1),
  apartments: z.array(Apartment),
  rooms: z.array(Room),
  walls: z.array(Wall),
  openings: z.array(Opening),
  outdoorAreas: z.array(OutdoorArea),
});

/** Tolerance for comparing lengths (1 mm). */
const EPS = 1e-3;

export const wallLength = (wall: Pick<Wall, 'start' | 'end'>) =>
  Math.hypot(wall.end.x.value - wall.start.x.value, wall.end.z.value - wall.start.z.value);

const fmt = (n: number) => `${Math.round(n * 1000) / 1000} m`;

/** Cross-references and geometry checks that a JSON Schema cannot express. */
function checkSemantics(model: z.infer<typeof HomeModelShape>, ctx: z.RefinementCtx) {
  const issue = (path: (string | number)[], message: string) =>
    ctx.addIssue({ code: 'custom', path, message });

  // Ids are unique across the whole model so layouts and other documents can reference any entity.
  const seen = new Map<string, string>();
  const claim = (id: string, path: (string | number)[]) => {
    const where = formatPath(path.slice(0, -1));
    const previous = seen.get(id);
    if (previous) issue(path, `Duplicate id "${id}" (already used by ${previous})`);
    else seen.set(id, where || 'the home');
  };
  claim(model.building.id, ['building', 'id']);
  model.terrain.patches.forEach((p, i) => claim(p.id, ['terrain', 'patches', i, 'id']));
  const collections = [
    'levels',
    'apartments',
    'rooms',
    'walls',
    'openings',
    'outdoorAreas',
  ] as const;
  for (const key of collections) model[key].forEach((e, i) => claim(e.id, [key, i, 'id']));

  const levels = new Set(model.levels.map((l) => l.id));
  const apartments = new Map(model.apartments.map((a) => [a.id, a]));
  const walls = new Map(model.walls.map((w) => [w.id, w]));
  const missing = (kind: string, id: string) => `Unknown ${kind} "${id}"`;

  model.terrain.patches.forEach((p, i) => {
    if (p.elevation.value <= model.terrain.bottomElevation.value) {
      issue(['terrain', 'patches', i, 'elevation'], 'Patch must be above terrain.bottomElevation');
    }
  });

  model.apartments.forEach((a, i) =>
    a.levelIds.forEach((id, j) => {
      if (!levels.has(id)) issue(['apartments', i, 'levelIds', j], missing('level', id));
    }),
  );

  model.rooms.forEach((r, i) => {
    if (!levels.has(r.levelId)) issue(['rooms', i, 'levelId'], missing('level', r.levelId));
    if (r.apartmentId === undefined) return;
    const apartment = apartments.get(r.apartmentId);
    if (!apartment) issue(['rooms', i, 'apartmentId'], missing('apartment', r.apartmentId));
    else if (levels.has(r.levelId) && !apartment.levelIds.includes(r.levelId)) {
      issue(
        ['rooms', i, 'levelId'],
        `Room is on level "${r.levelId}" but apartment "${apartment.id}" is not`,
      );
    }
  });

  model.walls.forEach((w, i) => {
    if (!levels.has(w.levelId)) issue(['walls', i, 'levelId'], missing('level', w.levelId));
    if (w.apartmentId !== undefined && !apartments.has(w.apartmentId)) {
      issue(['walls', i, 'apartmentId'], missing('apartment', w.apartmentId));
    }
    if (wallLength(w) < EPS) issue(['walls', i, 'end'], 'Wall start and end are the same point');
  });

  const byWall = new Map<string, { index: number; from: number; to: number }[]>();
  model.openings.forEach((o, i) => {
    const wall = walls.get(o.wallId);
    if (!wall) {
      issue(['openings', i, 'wallId'], missing('wall', o.wallId));
      return;
    }
    const length = wallLength(wall);
    const from = o.offset.value;
    const to = from + o.width.value;
    if (to > length + EPS) {
      issue(
        ['openings', i, 'width'],
        `Opening "${o.id}" spans ${fmt(from)} to ${fmt(to)} but wall "${wall.id}" is only ${fmt(length)} long`,
      );
    }
    const top = o.sill.value + o.height.value;
    if (top > wall.height.value + EPS) {
      issue(
        ['openings', i, 'height'],
        `Opening "${o.id}" reaches ${fmt(top)} but wall "${wall.id}" is only ${fmt(wall.height.value)} high`,
      );
    }
    const list = byWall.get(wall.id) ?? [];
    for (const other of list) {
      if (from < other.to - EPS && other.from < to - EPS) {
        issue(
          ['openings', i, 'offset'],
          `Opening "${o.id}" overlaps opening "${model.openings[other.index]?.id}" on wall "${wall.id}"`,
        );
      }
    }
    list.push({ index: i, from, to });
    byWall.set(wall.id, list);
  });

  model.outdoorAreas.forEach((a, i) => {
    if (a.ownerApartmentId !== undefined && !apartments.has(a.ownerApartmentId)) {
      issue(['outdoorAreas', i, 'ownerApartmentId'], missing('apartment', a.ownerApartmentId));
    }
  });
}

export const HomeModel = HomeModelShape.superRefine(checkSemantics).meta({
  id: 'HomeModel',
  title: 'my-home home model',
  description:
    'A building with levels, apartments, rooms, walls, openings, terrain and outdoor areas. ' +
    'Units are metres; Y-up; ground level is y = 0.',
});
export type HomeModel = z.infer<typeof HomeModel>;

/** The JSON Schema for home files (see `pnpm schema:generate`). Cross-reference checks are zod-only. */
export function homeModelJsonSchema() {
  return z.toJSONSchema(HomeModel, { target: 'draft-2020-12', io: 'input' });
}

export interface ValidationIssue {
  /** Location in the document, e.g. `openings[2].width`; empty for the root. */
  path: string;
  message: string;
}

export function formatPath(path: readonly PropertyKey[]): string {
  return path
    .map((part, i) =>
      typeof part === 'number' ? `[${part}]` : `${i === 0 ? '' : '.'}${String(part)}`,
    )
    .join('');
}

export function formatIssues(error: z.ZodError): ValidationIssue[] {
  return error.issues.map((issue) => ({ path: formatPath(issue.path), message: issue.message }));
}

/** Multi-line, human readable summary of validation issues. */
export function describeIssues(issues: ValidationIssue[]): string {
  return issues.map((i) => `- ${i.path || '(root)'}: ${i.message}`).join('\n');
}
