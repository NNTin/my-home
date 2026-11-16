import { z } from 'zod';
import { formatPath, Id } from './home-model';
import { ApiError } from './homes';

/**
 * Furniture layouts. A layout belongs to one home but references the building only by ids
 * (`levelId`, `roomId`), so it is stored separately from the home model and survives changes to
 * the building: items whose level or room no longer exists are kept and flagged by the viewer.
 *
 * Positions are plan coordinates in metres (x east, z south, like the home model); `rotationY`
 * is in radians about +y (counter-clockwise seen from above).
 */

export const LAYOUT_SCHEMA_VERSION = 1;

const Name = z.string().trim().min(1).max(200);
const Timestamp = z.iso.datetime({ offset: true });

export const PlanPosition = z.strictObject({ x: z.number(), z: z.number() });
export type PlanPosition = z.infer<typeof PlanPosition>;

export const LayoutItem = z.strictObject({
  id: Id,
  /** Item-type id from the web app's registry, e.g. `bed`. Unknown types are kept and flagged. */
  typeId: Id,
  levelId: Id,
  /** The room the item stands in, if any; recomputed when the item moves. */
  roomId: Id.optional(),
  position: PlanPosition,
  rotationY: z.number(),
  /** Free-form per-item settings for the item type (e.g. a colour); JSON values only. */
  props: z.record(z.string(), z.json()),
});
export type LayoutItem = z.infer<typeof LayoutItem>;

export const MAX_LAYOUT_ITEMS = 2000;

/** Item ids are unique within a layout. */
export const LayoutItems = z
  .array(LayoutItem)
  .max(MAX_LAYOUT_ITEMS)
  .superRefine((items, ctx) => {
    const seen = new Map<string, number>();
    items.forEach((item, i) => {
      const previous = seen.get(item.id);
      if (previous === undefined) seen.set(item.id, i);
      else {
        ctx.addIssue({
          code: 'custom',
          path: [i, 'id'],
          message: `Duplicate item id "${item.id}" (already used by ${formatPath([previous])})`,
        });
      }
    });
  });

export const Layout = z.object({
  id: Id,
  homeId: Id,
  name: Name,
  schemaVersion: z.literal(LAYOUT_SCHEMA_VERSION),
  /** Optimistic-concurrency version: starts at 1, incremented by every successful update. */
  version: z.number().int().positive(),
  items: LayoutItems,
  createdAt: Timestamp,
  updatedAt: Timestamp,
});
export type Layout = z.infer<typeof Layout>;

/** A layout without its items, as listed by `GET /api/homes/:homeId/layouts`. */
export const LayoutSummary = Layout.omit({ items: true }).extend({
  itemCount: z.number().int().nonnegative(),
});
export type LayoutSummary = z.infer<typeof LayoutSummary>;

export const ListLayoutsResponse = z.object({ items: z.array(LayoutSummary) });
export type ListLayoutsResponse = z.infer<typeof ListLayoutsResponse>;

export const LayoutHomeParams = z.object({ homeId: Id });
export type LayoutHomeParams = z.infer<typeof LayoutHomeParams>;

export const LayoutParams = z.object({ id: Id });
export type LayoutParams = z.infer<typeof LayoutParams>;

export const CreateLayoutBody = z.strictObject({
  name: Name,
  items: LayoutItems.default([]),
});
export type CreateLayoutBody = z.input<typeof CreateLayoutBody>;

/** Full replace. `version` is the version the client last saw; a mismatch is a 409. */
export const UpdateLayoutBody = z.strictObject({
  name: Name,
  items: LayoutItems,
  version: z.number().int().positive(),
});
export type UpdateLayoutBody = z.infer<typeof UpdateLayoutBody>;

/** Optional; a request without a body copies the name with a " (copy)" suffix. */
export const DuplicateLayoutBody = z.strictObject({ name: Name.optional() }).nullish();
export type DuplicateLayoutBody = z.input<typeof DuplicateLayoutBody>;

/**
 * A layout file, as written by `GET /api/layouts/:id/export` and read by
 * `POST /api/homes/:homeId/layouts/import`. Server-managed fields (`id`, `version`, timestamps)
 * may be present and are ignored on import; the target home comes from the URL.
 */
export const LayoutFile = z.object({
  schemaVersion: z.literal(LAYOUT_SCHEMA_VERSION),
  name: Name,
  homeId: Id.optional(),
  items: LayoutItems,
});
export type LayoutFile = z.infer<typeof LayoutFile>;

/** Body of a 409 from `PUT /api/layouts/:id`: the client's version is stale. */
export const LayoutConflict = ApiError.extend({
  statusCode: z.literal(409),
  currentVersion: z.number().int().positive(),
});
export type LayoutConflict = z.infer<typeof LayoutConflict>;
