import {
  basicOverridesSchema,
  catalog,
  HomeModel,
  LEGACY_FURNITURE_TYPE_IDS,
  TypeId,
  type LayoutItem,
  type ParamValues,
} from '@my-home/shared';
import { and, desc, eq, sql } from 'drizzle-orm';
import type { Db } from './client';
import type { HistoryActor } from './history';
import { placementStore } from './placements';
import { homes, layouts } from './schema';
import { imports, placements } from './userdata-schema';

export const LAYOUTS_SOURCE = 'layouts';

const SYSTEM: HistoryActor = { actor: 'system', source: 'default', username: null };

export interface LayoutImport {
  homeId: string;
  status: 'imported' | 'skipped';
  /** Why it was skipped: `placements exist`. */
  reason?: string;
  layoutId?: string;
  layoutName?: string;
  items: number;
  /** `<item id>.<key>` of every prop that was not a valid basic parameter. */
  droppedParams: string[];
}

/**
 * The type id a layout item becomes: `bed` → `furniture.bed`. An unknown legacy id is kept as
 * `furniture.<id>` (shown as needs-attention: the type is not in the catalogue); one that cannot
 * form a type id becomes `furniture.unknown`.
 */
export function importedTypeId(legacy: string): string {
  const mapped = LEGACY_FURNITURE_TYPE_IDS[legacy];
  if (mapped) return mapped;
  const kept = `furniture.${legacy.toLowerCase()}`;
  return TypeId.safeParse(kept).success ? kept : 'furniture.unknown';
}

/** The props of an item that are valid basic parameters of its type; the rest are listed. */
export function importedParams(
  typeId: string,
  props: LayoutItem['props'],
): { params: ParamValues; dropped: string[] } {
  const type = catalog.get(typeId);
  const params: ParamValues = {};
  const dropped: string[] = [];
  // Sorted: jsonb does not keep the key order.
  for (const [key, value] of Object.entries(props).sort(([a], [b]) => a.localeCompare(b))) {
    const ok = type
      ? basicOverridesSchema(type).safeParse({ [key]: value }).success
      : typeof value === 'string' || typeof value === 'number';
    if (ok) params[key] = value as string | number;
    else dropped.push(key);
  }
  return { params, dropped };
}

/**
 * The one-time import of the named layouts (#3) into a home's placement set (#44), run by the
 * release job after the sync and on server start with `MIGRATE_ON_START`. For each home with
 * layouts and without an `imports` row `(home, 'layouts')`:
 * - with no placements at all (trashed ones included): the most recently updated layout's items
 *   become placements (`import` history rows by `system`);
 * - otherwise nothing is imported (the placement set is already in use).
 * Either way the `imports` row is written, so it never runs again for that home, even after the
 * trash is purged. The layouts are left untouched in `public`.
 */
export async function importLayouts(
  db: Db,
  options: { retentionDays: number },
): Promise<LayoutImport[]> {
  const store = placementStore(db, options);
  const homeIds = await db
    .selectDistinct({ homeId: layouts.homeId })
    .from(layouts)
    .orderBy(layouts.homeId);
  const results: LayoutImport[] = [];
  for (const { homeId } of homeIds) {
    const result = await db.transaction(async (tx): Promise<LayoutImport | undefined> => {
      const [layout] = await tx
        .select()
        .from(layouts)
        .where(eq(layouts.homeId, homeId))
        .orderBy(desc(layouts.updatedAt), desc(layouts.id))
        .limit(1);
      const [home] = await tx.select().from(homes).where(eq(homes.id, homeId));
      const model = home && HomeModel.safeParse(home.model);
      // A home that cannot be read is not claimed, so a later run retries it.
      if (!layout || !model?.success) return undefined;

      // Claim the import: a concurrent run waits on the key, then finds it taken.
      const claimed = await tx
        .insert(imports)
        .values({ homeId, source: LAYOUTS_SOURCE })
        .onConflictDoNothing()
        .returning({ homeId: imports.homeId });
      if (claimed.length === 0) return undefined;

      const [{ count } = { count: 0 }] = await tx
        .select({ count: sql<number>`count(*)::int` })
        .from(placements)
        .where(eq(placements.homeId, homeId));
      const base = { homeId, layoutId: layout.id, layoutName: layout.name };
      if (count > 0) {
        const skipped = {
          ...base,
          status: 'skipped' as const,
          reason: 'placements exist',
          items: 0,
          droppedParams: [],
        };
        await tx
          .update(imports)
          .set({ detail: { ...skipped } })
          .where(and(eq(imports.homeId, homeId), eq(imports.source, LAYOUTS_SOURCE)));
        return skipped;
      }
      const m = model.data;
      const droppedParams: string[] = [];
      const ids: string[] = [];
      for (const item of layout.items) {
        const typeId = importedTypeId(item.typeId);
        const { params, dropped } = importedParams(typeId, item.props);
        droppedParams.push(...dropped.map((key) => `${item.id}.${key}`));
        const level = m.levels.find((l) => l.id === item.levelId);
        const row = await store.insert(
          tx,
          homeId,
          m,
          {
            typeId,
            levelId: item.levelId,
            position: item.position,
            rotationY: item.rotationY,
            params,
          },
          SYSTEM,
          'import',
          {
            typeName: catalog.get(typeId)?.name ?? item.typeId,
            levelName: level?.name ?? item.levelId,
          },
        );
        ids.push(row.id);
      }
      const imported = {
        ...base,
        status: 'imported' as const,
        items: layout.items.length,
        droppedParams,
      };
      await tx
        .update(imports)
        .set({ detail: { ...imported, placementIds: ids } })
        .where(and(eq(imports.homeId, homeId), eq(imports.source, LAYOUTS_SOURCE)));
      return imported;
    });
    if (result) results.push(result);
  }
  return results;
}

/** The release log lines of an import run. */
export function describeImports(results: LayoutImport[]): { info: string[]; warn: string[] } {
  const info: string[] = [];
  const warn: string[] = [];
  for (const r of results) {
    if (r.status === 'skipped') {
      info.push(
        `release: home "${r.homeId}": layouts not imported (${r.reason}); layout "${r.layoutName}" left in public`,
      );
      continue;
    }
    const n = `${r.items} item${r.items === 1 ? '' : 's'}`;
    info.push(`release: home "${r.homeId}": imported layout "${r.layoutName}" (${n})`);
    if (r.droppedParams.length > 0) {
      warn.push(
        `release: home "${r.homeId}": dropped invalid layout props: ${r.droppedParams.join(', ')}`,
      );
    }
  }
  return { info, warn };
}
