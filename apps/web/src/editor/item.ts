import type { ParamValues, PlacementMounting, PlanPosition } from '@my-home/shared';

/**
 * A piece of furniture as the editor holds it: a placement (`@my-home/shared` `Placement`) without
 * the server's bookkeeping. `typeId` is the catalogue type (`furniture.bed`); `params` its basic
 * overrides. A new item has a temporary id and an empty `name` until the server assigns both.
 * Versions are kept by the sync (`placements/sync.ts`), not here, so undo never restores a stale one.
 */
export interface EditorItem {
  id: string;
  typeId: string;
  name: string;
  levelId: string;
  /** The room the item stands in, if any; recomputed when the item moves. */
  roomId?: string;
  position: PlanPosition;
  rotationY: number;
  /** What it is fixed to; absent: on the floor (`mountingOfItem`). */
  mounting?: PlacementMounting;
  /** Height of its bottom above the level's floor in metres; absent: 0. Ignored under a ceiling. */
  elevation?: number;
  params: ParamValues;
}

export const mountingOfItem = (item: Pick<EditorItem, 'mounting'>): PlacementMounting =>
  item.mounting ?? 'floor';

export const elevationOfItem = (item: Pick<EditorItem, 'mounting' | 'elevation'>): number =>
  item.mounting === 'ceiling' ? 0 : (item.elevation ?? 0);

/** The item with its mounting and elevation, leaving out the defaults (floor, 0). */
export function withMounting(
  item: EditorItem,
  mounting: PlacementMounting,
  elevation: number,
): EditorItem {
  const next = { ...item };
  delete next.mounting;
  delete next.elevation;
  return {
    ...next,
    ...(mounting !== 'floor' && { mounting }),
    ...(mounting !== 'ceiling' && elevation !== 0 && { elevation }),
  };
}
