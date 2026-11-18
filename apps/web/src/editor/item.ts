import type { ParamValues, PlanPosition } from '@my-home/shared';

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
  params: ParamValues;
}
