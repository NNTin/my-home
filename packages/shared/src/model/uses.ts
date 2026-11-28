import { type HomeModel, openingTouchesRoom, wallLength } from './home-model';
import type { TypeId } from '../catalog/ids';

/** A use of a catalogue type that lives in the home model (git), not in the database. */
export interface ModelUse {
  id: string;
  typeId: TypeId;
  name: string;
  kind: 'openings';
  placement: 'wall' | 'roof' | 'fence' | 'outbuilding';
  /** The level of the wall (roof windows: the highest level, under the roof); null outside. */
  levelId: string | null;
  /** Rooms the opening touches (both rooms for an interior door). */
  roomIds: string[];
  /** For fit checks: the opening's width and height (a gate: its fence line's length). */
  hole?: { width: number; height: number };
}

/** Every opening, outbuilding opening, roof window and gate of a home, in document order. */
export function modelUses(model: HomeModel): ModelUse[] {
  const walls = new Map(model.walls.map((w) => [w.id, w]));
  const uses: ModelUse[] = model.openings.map((o) => {
    const wall = walls.get(o.wallId);
    return {
      id: o.id,
      typeId: o.typeId,
      name: o.name,
      kind: 'openings',
      placement: 'wall',
      levelId: wall?.levelId ?? null,
      roomIds: wall
        ? model.rooms.filter((r) => openingTouchesRoom(o, wall, r)).map((r) => r.id)
        : [],
      hole: { width: o.width.value, height: o.height.value },
    };
  });
  for (const b of model.outbuildings ?? []) {
    for (const o of b.openings ?? []) {
      uses.push({
        id: o.id,
        typeId: o.typeId,
        name: o.name,
        kind: 'openings',
        placement: 'outbuilding',
        levelId: null,
        roomIds: [],
        hole: { width: o.width.value, height: o.height.value },
      });
    }
  }
  const roof = model.building.roof;
  if (roof?.type === 'gable') {
    const top = model.levels.reduce((a, b) => (b.elevation.value > a.elevation.value ? b : a));
    for (const w of roof.windows ?? []) {
      uses.push({
        id: w.id,
        typeId: w.typeId,
        name: w.name,
        kind: 'openings',
        placement: 'roof',
        levelId: top.id,
        roomIds: [],
        hole: { width: w.width.value, height: w.length.value },
      });
    }
  }
  for (const f of model.fences ?? []) {
    if (f.typeId === undefined) continue;
    const length = f.path
      .slice(1)
      .reduce((sum, p, i) => sum + wallLength({ start: f.path[i]!, end: p }), 0);
    uses.push({
      id: f.id,
      typeId: f.typeId,
      name: f.name,
      kind: 'openings',
      placement: 'fence',
      levelId: null,
      roomIds: [],
      hole: { width: length, height: f.height.value },
    });
  }
  return uses;
}
