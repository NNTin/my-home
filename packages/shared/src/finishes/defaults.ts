import type {
  FinishUse,
  HomeModel,
  Outbuilding,
  OutbuildingKind,
  OutdoorArea,
  OutdoorAreaKind,
  Room,
  Stair,
} from '../home-model';
import { finishes } from './library';

/**
 * What a surface draws when the home names no finish for it (docs/design/realistic-render.md
 * §5.5). Defaults are plain indoors on purpose: a room nobody has refined looks neutral, not
 * falsely specific.
 */

/** A finish as a surface draws it: the id, the colour it is multiplied by, the turn of a floor. */
export interface ResolvedFinish {
  finish: string;
  tint: string;
  rotation: 0 | 90;
}

/** A default: a finish, and a tint where the default is not the finish's own colour. */
interface Fallback {
  finish: string;
  tint?: string;
}

export const DEFAULT_FINISHES = {
  floor: 'floor.neutral',
  walls: 'paint.plain',
  ceiling: 'paint.plain',
  facade: 'render.facade',
  roof: 'roof.clay-tile',
  stair: 'wood.oak-laminate',
  /** A stair's risers, sides and underside. */
  stairRisers: 'paint.plain',
  /** A stair's handrail, posts and the board its balusters stand on. */
  stairRailing: 'wood.veneer',
  /** The bars of a stair's railing. */
  stairBalusters: 'metal.brushed',
  /** The ground itself: terrain where nothing covers it, and where a section cuts it. */
  terrain: 'soil.plain',
  /** Cut faces of walls, slabs and furniture. */
  cut: 'cut.dark',
  /** Every inner surface of a level that is not modelled inside, and the floor slabs. */
  shell: 'shell.neutral',
} as const;

export const OUTDOOR_AREA_FINISHES: Record<OutdoorAreaKind, string> = {
  garden: 'grass.lawn',
  patio: 'paving.concrete-slab',
  path: 'paving.concrete-slab',
  driveway: 'paving.concrete-slab',
  road: 'asphalt.plain',
  gravel: 'gravel.fine',
  embankment: 'concrete.screed',
};

/** Outbuildings keep the colours they have always had, as tints of a plain or rendered wall. */
const OUTBUILDING_FINISHES: Record<OutbuildingKind, Fallback> = {
  garage: { finish: 'render.facade', tint: '#e4e0d6' },
  carport: { finish: 'render.facade', tint: '#e4e0d6' },
  porch: { finish: 'render.facade', tint: '#e4e0d6' },
  shed: { finish: 'paint.plain', tint: '#9a7b56' },
  compost: { finish: 'paint.plain', tint: '#3c4038' },
};

/** The flat roof of an outbuilding: plain grey, as it has always been. */
const OUTBUILDING_ROOF: Fallback = { finish: 'paint.plain', tint: '#a6a29b' };

const tintOf = (finish: string) => finishes.get(finish)?.tint ?? '#ffffff';

/**
 * A finish use resolved against its default. A use that names a finish the library does not have
 * (the schema rejects it; a stored home may be older than the library) falls back to the default.
 */
export function resolveFinish(use: FinishUse | undefined, fallback: Fallback): ResolvedFinish {
  if (use && finishes.get(use.finish)) {
    return {
      finish: use.finish,
      tint: use.tint ?? tintOf(use.finish),
      rotation: use.rotation ?? 0,
    };
  }
  return {
    finish: fallback.finish,
    tint: fallback.tint ?? tintOf(fallback.finish),
    rotation: 0,
  };
}

const plain = (finish: string): ResolvedFinish => resolveFinish(undefined, { finish });

/**
 * The level that is modelled inside: the lowest one (the souterrain of "Our home"). Only its rooms
 * take finishes; the rooms of every level above are neutral shells (§7.5).
 */
export function interiorLevelId(model: Pick<HomeModel, 'levels'>): string | undefined {
  return model.levels.reduce<HomeModel['levels'][number] | undefined>(
    (lowest, l) => (!lowest || l.elevation.value < lowest.elevation.value ? l : lowest),
    undefined,
  )?.id;
}

export interface RoomFinishes {
  floor: ResolvedFinish;
  walls: ResolvedFinish;
  ceiling: ResolvedFinish;
}

/** The neutral shell: what every room above the interior level draws, and a level without rooms. */
export const SHELL_FINISHES: RoomFinishes = {
  floor: plain(DEFAULT_FINISHES.shell),
  walls: plain(DEFAULT_FINISHES.shell),
  ceiling: plain(DEFAULT_FINISHES.shell),
};

/** The floor, walls and ceiling of a room: its own finishes, the defaults, or the neutral shell. */
export function roomFinishes(
  model: Pick<HomeModel, 'levels'>,
  room: Pick<Room, 'levelId' | 'finishes'>,
): RoomFinishes {
  if (room.levelId !== interiorLevelId(model)) return SHELL_FINISHES;
  return {
    floor: resolveFinish(room.finishes?.floor, { finish: DEFAULT_FINISHES.floor }),
    walls: resolveFinish(room.finishes?.walls, { finish: DEFAULT_FINISHES.walls }),
    ceiling: resolveFinish(room.finishes?.ceiling, { finish: DEFAULT_FINISHES.ceiling }),
  };
}

/** The facade and the roof of the building. */
export function buildingFinishes(building: Pick<HomeModel['building'], 'finishes'>) {
  return {
    facade: resolveFinish(building.finishes?.facade, { finish: DEFAULT_FINISHES.facade }),
    roof: resolveFinish(building.finishes?.roof, { finish: DEFAULT_FINISHES.roof }),
  };
}

export const outdoorAreaFinish = (area: Pick<OutdoorArea, 'kind' | 'finish'>): ResolvedFinish =>
  resolveFinish(area.finish, { finish: OUTDOOR_AREA_FINISHES[area.kind] });

/** An outbuilding's walls take its finish; its flat roof stays plain. */
export const outbuildingFinishes = (b: Pick<Outbuilding, 'kind' | 'finish'>) => ({
  walls: resolveFinish(b.finish, OUTBUILDING_FINISHES[b.kind]),
  roof: resolveFinish(undefined, OUTBUILDING_ROOF),
});

export interface StairFinishes {
  /** The treads and landings. */
  treads: ResolvedFinish;
  /** The risers, the sides and the underside. */
  risers: ResolvedFinish;
  /** The handrail, its posts and the board the balusters stand on. */
  railing: ResolvedFinish;
  balusters: ResolvedFinish;
}

export const stairFinishes = (
  stair: Pick<Stair, 'finish' | 'risers' | 'railing'>,
): StairFinishes => ({
  treads: resolveFinish(stair.finish, { finish: DEFAULT_FINISHES.stair }),
  risers: resolveFinish(stair.risers, { finish: DEFAULT_FINISHES.stairRisers }),
  railing: resolveFinish(stair.railing, { finish: DEFAULT_FINISHES.stairRailing }),
  balusters: plain(DEFAULT_FINISHES.stairBalusters),
});

export const TERRAIN_FINISH = plain(DEFAULT_FINISHES.terrain);
export const CUT_FINISH = plain(DEFAULT_FINISHES.cut);

/**
 * A copy of a home that names no finish: every surface then draws the default of its kind. For
 * telling what a home's own choices change, and for tests of the defaults.
 */
export function withoutFinishes(model: HomeModel): HomeModel {
  const bare = structuredClone(model);
  delete bare.building.finishes;
  for (const room of bare.rooms) delete room.finishes;
  for (const area of bare.outdoorAreas) delete area.finish;
  for (const outbuilding of bare.outbuildings ?? []) delete outbuilding.finish;
  for (const stair of bare.stairs ?? []) {
    delete stair.finish;
    delete stair.risers;
    delete stair.railing;
  }
  return bare;
}
