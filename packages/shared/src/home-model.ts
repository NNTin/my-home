import { z } from 'zod';
import { catalog } from './catalog/catalog';
import { TypeId } from './catalog/ids';
import type { CatalogType } from './catalog/types';

/**
 * The home model: the single source of truth for the building.
 *
 * Conventions: units are metres; Y-up, right-handed; ground level is `y = 0`. Plan coordinates
 * are `x` (east) and `z` (south, towards the street); a level's `elevation` is the top of its
 * floor slab. Every dimension carries its provenance so placeholder values can be refined later.
 */

export const HOME_SCHEMA_VERSION = 1;

export const DimensionSource = z
  .enum(['mock', 'estimated-from-photo', 'measured', 'geodata'])
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

export const Name = z.string().min(1).max(200);

/** The default: a flat slab of `building.roofThickness` on top of the highest level. */
export const FlatRoof = z.strictObject({ type: z.literal('flat') }).meta({ id: 'FlatRoof' });

/** A window lying in one plane of a gable roof (a skylight; not a dormer). */
export const RoofWindow = z
  .strictObject({
    id: Id,
    /** Human name, unique in the home, e.g. "Attic · south roof window". */
    name: Name,
    /** The catalogue type (`placement: 'roof'`), e.g. `window.roof`. */
    typeId: TypeId,
    /** Roof plane: `min` slopes down towards the lower across-ridge coordinate, `max` the higher. */
    side: z.enum(['min', 'max']),
    /** Distance along the ridge from the footprint's lower end to the window's near edge. */
    offset: NonNegativeDimension,
    /** Distance up the slope from the footprint edge (eaves side) to the window's lower edge. */
    fromEave: NonNegativeDimension,
    /** Size along the ridge. */
    width: PositiveDimension,
    /** Size along the slope. */
    length: PositiveDimension,
  })
  .meta({ id: 'RoofWindow' });
export type RoofWindow = z.infer<typeof RoofWindow>;

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
    windows: z.array(RoofWindow).optional(),
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
  /**
   * Magnetic declination at the home: how far magnetic north lies east (+) or west (-) of true
   * north, in degrees. A phone compass reports magnetic north; this turns it into true north.
   * Omitted means 0. Entered by the owner (from a declination chart), never derived from the
   * home's location by the app.
   */
  magneticDeclination: Bearing.optional(),
});
export type Building = z.infer<typeof Building>;

/** The building's roof, defaulting to a flat one for documents without `roof`. */
export const roofOf = (building: Pick<Building, 'roof'>): Roof => building.roof ?? { type: 'flat' };

/** True north in degrees clockwise from the plan's -z axis (0 when not set). */
export const northBearingOf = (building: Pick<Building, 'northBearing'>): number =>
  building.northBearing?.value ?? 0;

/** Magnetic declination in degrees, east positive (0 when not set). */
export const magneticDeclinationOf = (building: Pick<Building, 'magneticDeclination'>): number =>
  building.magneticDeclination?.value ?? 0;

/**
 * A plane that falls linearly across the bounding box of an outline: `elevation` at the high edge,
 * `lowElevation` at the edge it falls towards.
 */
export const Slope = z
  .strictObject({
    /** Plan direction the surface falls towards. */
    towards: z.enum(['+x', '-x', '+z', '-z']),
    lowElevation: Dimension,
  })
  .meta({ id: 'Slope', description: 'A surface falling linearly across its bounding box.' });
export type Slope = z.infer<typeof Slope>;

export const TerrainPatch = z.strictObject({
  id: Id,
  name: Name,
  outline: Polygon,
  holes: z.array(Polygon).optional(),
  /** Height of the patch's top surface (its high edge when sloped). */
  elevation: Dimension,
  /** Makes the top a slope instead of flat at `elevation`. */
  slope: Slope.optional(),
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

/** A way into an apartment: the door or stair it leads through and the room it arrives in. */
export const Entrance = z
  .strictObject({
    id: Id,
    name: Name,
    /** The apartment's room this entrance leads into. */
    roomId: Id,
    /** The opening (door) or stair that is passed to get in. */
    viaId: Id,
    description: z.string().max(2000).optional(),
  })
  .meta({ id: 'Entrance' });
export type Entrance = z.infer<typeof Entrance>;

export const Apartment = z.strictObject({
  id: Id,
  name: Name,
  levelIds: z.array(Id).min(1),
  description: z.string().max(2000).optional(),
  /** Every way into the apartment; omitted means not recorded. */
  entrances: z.array(Entrance).optional(),
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

/** `door` is drawn open, `french-door` glazed to the floor, `garage-door` closed. */
export const OpeningType = z.enum(['door', 'window', 'french-door', 'garage-door']);
export type OpeningType = z.infer<typeof OpeningType>;

export const Opening = z.strictObject({
  id: Id,
  /** Human name, unique in the home, e.g. "Bed room · east window" (docs/home-model.md § Naming). */
  name: Name,
  /** The catalogue type (`placement: 'wall'`), e.g. `window.casement`. */
  typeId: TypeId,
  wallId: Id,
  /** Coarse kind the builder draws by; must be one of the type's `openingTypes`. */
  type: OpeningType,
  /** Distance along the wall from its `start` to the near edge of the opening. */
  offset: NonNegativeDimension,
  width: PositiveDimension,
  height: PositiveDimension,
  /** Height of the bottom edge above the floor; 0 for doors. */
  sill: NonNegativeDimension,
});
export type Opening = z.infer<typeof Opening>;

/**
 * `gravel` is a gravel or drainage strip, such as the one along a facade; `embankment` a steep
 * bank or retaining slope that divides two levels and is not walked on.
 */
export const OutdoorAreaKind = z.enum([
  'garden',
  'driveway',
  'patio',
  'path',
  'road',
  'gravel',
  'embankment',
]);
export type OutdoorAreaKind = z.infer<typeof OutdoorAreaKind>;

export const OutdoorArea = z.strictObject({
  id: Id,
  name: Name,
  kind: OutdoorAreaKind,
  /** Apartment the area belongs to; omitted for shared areas. */
  ownerApartmentId: Id.optional(),
  outline: Polygon,
  /** Height of the surface (its high edge when sloped). */
  elevation: Dimension,
  slope: Slope.optional(),
});
export type OutdoorArea = z.infer<typeof OutdoorArea>;

/** A `compost` is a closed compost bin: a low box with a lid. */
export const OutbuildingKind = z.enum(['garage', 'carport', 'shed', 'porch', 'compost']);
export type OutbuildingKind = z.infer<typeof OutbuildingKind>;

/** An opening in an outbuilding wall: the footprint edge from point `edge` to the next one. */
export const OutbuildingOpening = z
  .strictObject({
    id: Id,
    /** Human name, unique in the home, e.g. "Garage · garage door". */
    name: Name,
    /** The catalogue type (`placement: 'wall'`), e.g. `door.garage`. */
    typeId: TypeId,
    type: OpeningType,
    /** Index of the footprint point the edge starts at (an index, not a length). */
    edge: z.number().int().nonnegative(),
    /** Distance along the edge from its start point to the near edge of the opening. */
    offset: NonNegativeDimension,
    width: PositiveDimension,
    height: PositiveDimension,
    sill: NonNegativeDimension,
  })
  .meta({ id: 'OutbuildingOpening' });
export type OutbuildingOpening = z.infer<typeof OutbuildingOpening>;

/**
 * A simple structure next to the building, such as a garage: walls along every footprint edge and
 * a flat roof. It has no levels or rooms.
 */
export const Outbuilding = z
  .strictObject({
    id: Id,
    name: Name,
    kind: OutbuildingKind,
    /** Wall centre lines. */
    footprint: Polygon,
    floorElevation: Dimension,
    /** From the floor to the top of the flat roof. */
    height: PositiveDimension,
    wallThickness: PositiveDimension,
    roofThickness: PositiveDimension,
    /** Indexes of footprint edges without a wall (a carport's sides, or against the house). */
    openEdges: z.array(z.number().int().nonnegative()).optional(),
    openings: z.array(OutbuildingOpening).optional(),
  })
  .meta({ id: 'Outbuilding' });
export type Outbuilding = z.infer<typeof Outbuilding>;

/**
 * A stair from one level up to another. `path` is its walking line going up: straight flights
 * between consecutive points, with a square landing (`width` on each side) at every turning
 * point, so turns must be right angles. The builder spreads the steps over the rise.
 */
export const Stair = z
  .strictObject({
    id: Id,
    name: Name,
    /** Level the stair starts on; it is shown and hidden with this level. */
    levelId: Id,
    /** Level it leads up to; that level's floor gets a stairwell opening. */
    toLevelId: Id,
    apartmentId: Id.optional(),
    path: z.array(Point).min(2),
    width: PositiveDimension,
  })
  .meta({ id: 'Stair' });
export type Stair = z.infer<typeof Stair>;

/** `privacy` is a mesh fence with a privacy screen; a `gate` is a framed leaf in a fence line. */
export const FenceKind = z.enum(['chain-link', 'privacy', 'trellis', 'gate']);
export type FenceKind = z.infer<typeof FenceKind>;

/** A fence along a line on the plan, standing on the ground. */
export const Fence = z
  .strictObject({
    id: Id,
    name: Name,
    kind: FenceKind,
    /** The catalogue type (`placement: 'fence'`): required for a gate, absent for other kinds. */
    typeId: TypeId.optional(),
    path: z.array(Point).min(2),
    /** Ground height at the start of `path`. */
    elevation: Dimension,
    /** Ground height at the end of `path` when the ground falls or rises along the fence. */
    endElevation: Dimension.optional(),
    height: PositiveDimension,
  })
  .meta({ id: 'Fence' });
export type Fence = z.infer<typeof Fence>;

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
  /** Garages, sheds and carports; omitted means none. */
  outbuildings: z.array(Outbuilding).optional(),
  /** Omitted means none. */
  stairs: z.array(Stair).optional(),
  /** Omitted means none. */
  fences: z.array(Fence).optional(),
});

/** Tolerance for comparing lengths (1 mm). */
const EPS = 1e-3;

export const wallLength = (wall: Pick<Wall, 'start' | 'end'>) =>
  Math.hypot(wall.end.x.value - wall.start.x.value, wall.end.z.value - wall.start.z.value);

/** Distance from a plan point to the nearest edge of a polygon. */
export function distanceToOutline(x: number, z: number, outline: Polygon): number {
  return Math.min(
    ...outline.map((a, i) => {
      const b = outline[(i + 1) % outline.length]!;
      const [ax, az, dx, dz] = [a.x.value, a.z.value, b.x.value - a.x.value, b.z.value - a.z.value];
      const length2 = dx * dx + dz * dz;
      const t = length2 ? Math.min(1, Math.max(0, ((x - ax) * dx + (z - az) * dz) / length2)) : 0;
      return Math.hypot(x - ax - t * dx, z - az - t * dz);
    }),
  );
}

/** Whether a plan point lies inside a simple polygon. */
export function insideOutline(x: number, z: number, outline: Polygon): boolean {
  let inside = false;
  outline.forEach((a, i) => {
    const b = outline[(i + 1) % outline.length]!;
    const [ax, az, bx, bz] = [a.x.value, a.z.value, b.x.value, b.z.value];
    if (az > z !== bz > z && x < ax + ((z - az) / (bz - az)) * (bx - ax)) inside = !inside;
  });
  return inside;
}

/**
 * Whether an opening stands on a wall along the room's outline (both its edges within half the
 * wall's thickness of it), so it leads into, or looks out of, that room.
 */
export function openingTouchesRoom(
  opening: Pick<Opening, 'offset' | 'width'>,
  wall: Wall,
  room: Room,
): boolean {
  if (wall.levelId !== room.levelId) return false;
  const length = wallLength(wall);
  const reach = wall.thickness.value / 2 + EPS;
  return [opening.offset.value, opening.offset.value + opening.width.value].every((along) => {
    const t = length ? along / length : 0;
    const x = wall.start.x.value + (wall.end.x.value - wall.start.x.value) * t;
    const z = wall.start.z.value + (wall.end.z.value - wall.start.z.value) * t;
    return distanceToOutline(x, z, room.outline) <= reach;
  });
}

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
  // The home's own id too: the api uses it as the use id of the home's settings history.
  claim(model.id, ['id']);
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
  model.apartments.forEach((a, i) =>
    a.entrances?.forEach((e, j) => claim(e.id, ['apartments', i, 'entrances', j, 'id'])),
  );
  model.outbuildings?.forEach((b, i) => {
    claim(b.id, ['outbuildings', i, 'id']);
    b.openings?.forEach((o, j) => claim(o.id, ['outbuildings', i, 'openings', j, 'id']));
  });
  model.stairs?.forEach((s, i) => claim(s.id, ['stairs', i, 'id']));
  model.fences?.forEach((f, i) => claim(f.id, ['fences', i, 'id']));
  const roof = model.building.roof;
  if (roof?.type === 'gable') {
    roof.windows?.forEach((w, i) => claim(w.id, ['building', 'roof', 'windows', i, 'id']));
  }

  const levels = new Set(model.levels.map((l) => l.id));
  const apartments = new Map(model.apartments.map((a) => [a.id, a]));
  const walls = new Map(model.walls.map((w) => [w.id, w]));
  const missing = (kind: string, id: string) => `Unknown ${kind} "${id}"`;

  const checkSlope = (slope: Slope | undefined, elevation: number, path: (string | number)[]) => {
    if (slope && slope.lowElevation.value >= elevation) {
      issue([...path, 'slope', 'lowElevation'], 'A slope must fall: lowElevation below elevation');
    }
  };
  model.terrain.patches.forEach((p, i) => {
    const path = ['terrain', 'patches', i];
    const lowest = Math.min(p.elevation.value, p.slope?.lowElevation.value ?? Infinity);
    if (lowest <= model.terrain.bottomElevation.value) {
      issue([...path, 'elevation'], 'Patch must be above terrain.bottomElevation');
    }
    checkSlope(p.slope, p.elevation.value, path);
  });
  model.outdoorAreas.forEach((a, i) => checkSlope(a.slope, a.elevation.value, ['outdoorAreas', i]));

  model.apartments.forEach((a, i) =>
    a.levelIds.forEach((id, j) => {
      if (!levels.has(id)) issue(['apartments', i, 'levelIds', j], missing('level', id));
    }),
  );

  const rooms = new Map(model.rooms.map((r) => [r.id, r]));
  const openings = new Map(model.openings.map((o) => [o.id, o]));
  const stairs = new Map((model.stairs ?? []).map((s) => [s.id, s]));
  const doorTouches = (door: Opening, room: Room) => {
    const wall = walls.get(door.wallId);
    return wall !== undefined && openingTouchesRoom(door, wall, room);
  };
  /** Whether a stair starts or arrives in the room. */
  const stairTouches = (stair: Stair, room: Room) => {
    const end =
      stair.levelId === room.levelId
        ? stair.path[0]
        : stair.toLevelId === room.levelId
          ? stair.path.at(-1)
          : undefined;
    return end !== undefined && insideOutline(end.x.value, end.z.value, room.outline);
  };
  model.apartments.forEach((a, i) =>
    a.entrances?.forEach((e, j) => {
      const path = ['apartments', i, 'entrances', j];
      const room = rooms.get(e.roomId);
      if (!room) issue([...path, 'roomId'], missing('room', e.roomId));
      else if (room.apartmentId !== a.id) {
        issue([...path, 'roomId'], `Room "${room.id}" is not in apartment "${a.id}"`);
      }
      const door = openings.get(e.viaId);
      const stair = stairs.get(e.viaId);
      if (!door && !stair) issue([...path, 'viaId'], missing('opening or stair', e.viaId));
      else if (door?.type === 'window') {
        issue([...path, 'viaId'], `Entrance "${e.id}" leads through "${door.id}", a window`);
      } else if (room && door && !doorTouches(door, room)) {
        issue([...path, 'viaId'], `Door "${door.id}" is not on a wall of room "${room.id}"`);
      } else if (room && stair && !stairTouches(stair, room)) {
        issue([...path, 'viaId'], `Stair "${stair.id}" does not start or end in room "${room.id}"`);
      }
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

  model.outbuildings?.forEach((b, i) => {
    b.openEdges?.forEach((edge, j) => {
      if (edge >= b.footprint.length) {
        issue(['outbuildings', i, 'openEdges', j], `Outbuilding "${b.id}" has no edge ${edge}`);
      }
    });
    const byEdge = new Map<number, { from: number; to: number; id: string }[]>();
    b.openings?.forEach((o, j) => {
      const path = ['outbuildings', i, 'openings', j];
      const start = b.footprint[o.edge];
      const end = b.footprint[(o.edge + 1) % b.footprint.length];
      if (!start || !end) {
        issue([...path, 'edge'], `Outbuilding "${b.id}" has no edge ${o.edge}`);
        return;
      }
      if (b.openEdges?.includes(o.edge)) {
        issue([...path, 'edge'], `Opening "${o.id}" is on open edge ${o.edge} of "${b.id}"`);
        return;
      }
      const length = wallLength({ start, end });
      const from = o.offset.value;
      const to = from + o.width.value;
      if (to > length + EPS) {
        issue(
          [...path, 'width'],
          `Opening "${o.id}" spans ${fmt(from)} to ${fmt(to)} but edge ${o.edge} is only ${fmt(length)} long`,
        );
      }
      if (o.sill.value + o.height.value > b.height.value - b.roofThickness.value + EPS) {
        issue([...path, 'height'], `Opening "${o.id}" reaches into the roof of "${b.id}"`);
      }
      const list = byEdge.get(o.edge) ?? [];
      for (const other of list) {
        if (from < other.to - EPS && other.from < to - EPS) {
          issue([...path, 'offset'], `Opening "${o.id}" overlaps opening "${other.id}"`);
        }
      }
      list.push({ from, to, id: o.id });
      byEdge.set(o.edge, list);
    });
  });

  const elevations = new Map(model.levels.map((l) => [l.id, l.elevation.value]));
  model.stairs?.forEach((s, i) => {
    const path = ['stairs', i];
    const from = elevations.get(s.levelId);
    const to = elevations.get(s.toLevelId);
    if (from === undefined) issue([...path, 'levelId'], missing('level', s.levelId));
    if (to === undefined) issue([...path, 'toLevelId'], missing('level', s.toLevelId));
    else if (from !== undefined && to <= from) {
      issue([...path, 'toLevelId'], `Stair "${s.id}" must lead up to a higher level`);
    }
    if (s.apartmentId !== undefined && !apartments.has(s.apartmentId)) {
      issue([...path, 'apartmentId'], missing('apartment', s.apartmentId));
    }
    const last = s.path.length - 2;
    for (let j = 0; j <= last; j++) {
      const [a, b, c] = [s.path[j]!, s.path[j + 1]!, s.path[j + 2]];
      // A landing takes half the stair width from each end of a flight that meets one.
      const landings = (j > 0 ? 1 : 0) + (j < last ? 1 : 0);
      if (wallLength({ start: a, end: b }) < (landings * s.width.value) / 2 + EPS) {
        issue([...path, 'path', j + 1], `Stair "${s.id}" has a flight too short for its landings`);
      }
      if (!c) continue;
      const dot =
        (b.x.value - a.x.value) * (c.x.value - b.x.value) +
        (b.z.value - a.z.value) * (c.z.value - b.z.value);
      if (Math.abs(dot) > EPS) {
        issue([...path, 'path', j + 1], `Stair "${s.id}" must turn at right angles`);
      }
    }
  });

  model.fences?.forEach((f, i) => {
    for (let j = 0; j + 1 < f.path.length; j++) {
      if (wallLength({ start: f.path[j]!, end: f.path[j + 1]! }) < EPS) {
        issue(['fences', i, 'path', j + 1], `Fence "${f.id}" repeats a point`);
      }
    }
  });

  checkTypesAndNames(model, issue);

  if (roof?.type === 'gable' && roof.windows?.length) {
    const xs = model.building.footprint.map((p) => p.x.value);
    const zs = model.building.footprint.map((p) => p.z.value);
    const span = (v: number[]) => Math.max(...v) - Math.min(...v);
    const [along, across] = roof.ridgeAxis === 'x' ? [span(xs), span(zs)] : [span(zs), span(xs)];
    const slopeLength = across / 2 / Math.cos((roof.pitch.value * Math.PI) / 180);
    roof.windows.forEach((w, i) => {
      const path = ['building', 'roof', 'windows', i];
      if (w.offset.value + w.width.value > along + EPS) {
        issue([...path, 'width'], `Roof window "${w.id}" reaches past the end of the roof`);
      }
      if (w.fromEave.value + w.length.value > slopeLength + EPS) {
        issue([...path, 'length'], `Roof window "${w.id}" reaches past the ridge`);
      }
    });
  }
}

const openingTypePlural: Record<OpeningType, string> = {
  door: 'doors',
  window: 'windows',
  'french-door': 'French doors',
  'garage-door': 'garage doors',
};
const article = (word: string) => (/^[aeiou]/i.test(word) ? `an ${word}` : `a ${word}`);

/** Catalogue types of the uses (`typeId`), where they sit, and unique names. */
function checkTypesAndNames(
  model: z.infer<typeof HomeModelShape>,
  issue: (path: (string | number)[], message: string) => void,
) {
  const placementName = { wall: 'a wall', roof: 'a roof', fence: 'a fence line', floor: 'a floor' };
  /** The type for `typeId` when it exists and sits where `placement` says, else undefined. */
  const typeAt = (
    typeId: string,
    placement: CatalogType['placement'],
    path: (string | number)[],
  ): CatalogType | undefined => {
    const type = catalog.get(typeId);
    if (!type) issue([...path, 'typeId'], `Unknown piece type "${typeId}"`);
    else if (type.placement !== placement) {
      issue(
        [...path, 'typeId'],
        `Type "${typeId}" goes in ${placementName[type.placement]}, not in ${placementName[placement]}`,
      );
    } else return type;
    return undefined;
  };
  const checkOpeningType = (
    o: { id: string; type: OpeningType; typeId: string },
    path: (string | number)[],
  ) => {
    const type = typeAt(o.typeId, 'wall', path);
    if (type?.openingTypes && !type.openingTypes.includes(o.type)) {
      const allowed = type.openingTypes.map((t) => openingTypePlural[t]).join(' and ');
      issue(
        [...path, 'typeId'],
        `Opening "${o.id}" is ${article(o.type.replace('-', ' '))} but type "${o.typeId}" is for ${allowed}`,
      );
    }
  };

  // Names are unique (case-insensitive) across every use, so a name alone finds it.
  const names = new Map<string, string>();
  const claimName = (name: string, path: (string | number)[]) => {
    const key = name.trim().toLowerCase();
    const previous = names.get(key);
    if (previous)
      issue([...path, 'name'], `Duplicate name "${name}" (already used by ${previous})`);
    else names.set(key, formatPath(path));
  };

  model.openings.forEach((o, i) => {
    checkOpeningType(o, ['openings', i]);
    claimName(o.name, ['openings', i]);
  });
  model.outbuildings?.forEach((b, i) =>
    b.openings?.forEach((o, j) => {
      checkOpeningType(o, ['outbuildings', i, 'openings', j]);
      claimName(o.name, ['outbuildings', i, 'openings', j]);
    }),
  );
  const roof = model.building.roof;
  if (roof?.type === 'gable') {
    roof.windows?.forEach((w, i) => {
      const path = ['building', 'roof', 'windows', i];
      typeAt(w.typeId, 'roof', path);
      claimName(w.name, path);
    });
  }
  model.fences?.forEach((f, i) => {
    const path = ['fences', i];
    if (f.kind !== 'gate') {
      if (f.typeId !== undefined) {
        issue([...path, 'typeId'], `Fence "${f.id}" is a ${f.kind} fence and takes no typeId`);
      }
      return;
    }
    if (f.typeId === undefined) issue([...path, 'typeId'], `Gate "${f.id}" needs a typeId`);
    else typeAt(f.typeId, 'fence', path);
    claimName(f.name, path);
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
