import { count, eq } from 'drizzle-orm';
import type { Db } from './client';
import { photoRequests, photos } from './media-schema';
import { homes } from './schema';
import {
  history,
  homeSettings,
  imports,
  issuedIds,
  notes,
  openingOverrides,
  placements,
} from './userdata-schema';

export interface PurgeReport {
  homeId: string;
  /** Rows removed per table: the stored home and the home's `userdata` rows. */
  removed: Record<string, number>;
  /** Photos and photo requests of the home: listed, never deleted (agents never delete photos). */
  photoIds: string[];
  photoRequests: number;
}

/**
 * Removes the stored home `homeId` and its `userdata` (placements, overrides, notes, history,
 * issued ids, settings, imports) in one transaction. Touches nothing of any other home. Photos and
 * photo requests are never deleted: they are only counted and their ids returned, for the log.
 */
export async function purgeHome(db: Db, homeId: string): Promise<PurgeReport> {
  return db.transaction(async (tx) => {
    const removed: Record<string, number> = {};
    const del = async (name: string, run: () => Promise<{ id?: unknown }[]>) => {
      removed[name] = (await run()).length;
    };
    await del('userdata.placements', () =>
      tx.delete(placements).where(eq(placements.homeId, homeId)).returning({ id: placements.id }),
    );
    await del('userdata.opening_overrides', () =>
      tx
        .delete(openingOverrides)
        .where(eq(openingOverrides.homeId, homeId))
        .returning({ id: openingOverrides.useId }),
    );
    await del('userdata.history', () =>
      tx.delete(history).where(eq(history.homeId, homeId)).returning({ id: history.id }),
    );
    await del('userdata.issued_ids', () =>
      tx.delete(issuedIds).where(eq(issuedIds.homeId, homeId)).returning({ id: issuedIds.id }),
    );
    await del('userdata.notes', () =>
      tx.delete(notes).where(eq(notes.homeId, homeId)).returning({ id: notes.id }),
    );
    await del('userdata.home_settings', () =>
      tx
        .delete(homeSettings)
        .where(eq(homeSettings.homeId, homeId))
        .returning({ id: homeSettings.homeId }),
    );
    await del('userdata.imports', () =>
      tx.delete(imports).where(eq(imports.homeId, homeId)).returning({ id: imports.source }),
    );
    await del('public.homes', () =>
      tx.delete(homes).where(eq(homes.id, homeId)).returning({ id: homes.id }),
    );
    const linked = await tx.select({ id: photos.id }).from(photos).where(eq(photos.homeId, homeId));
    const [requests] = await tx
      .select({ n: count() })
      .from(photoRequests)
      .where(eq(photoRequests.homeId, homeId));
    return {
      homeId,
      removed,
      photoIds: linked.map((p) => p.id),
      photoRequests: requests?.n ?? 0,
    };
  });
}
