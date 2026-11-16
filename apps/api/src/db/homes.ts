import { HomeModel, HOME_SCHEMA_VERSION, type HomeSummary } from '@my-home/shared';
import { asc, eq } from 'drizzle-orm';
import type { Db } from './client';
import { homes, type HomeRow } from './schema';

const toSummary = (
  row: Pick<HomeRow, 'id' | 'name' | 'schemaVersion' | 'createdAt' | 'updatedAt'>,
): HomeSummary => ({
  id: row.id,
  name: row.name,
  schemaVersion: row.schemaVersion,
  createdAt: row.createdAt.toISOString(),
  updatedAt: row.updatedAt.toISOString(),
});

const columns = (model: HomeModel) => ({
  name: model.name,
  schemaVersion: HOME_SCHEMA_VERSION,
  model,
});

/** Data access for homes. Callers pass models already validated with the shared schema. */
export function homeStore(db: Db) {
  return {
    async list(limit: number): Promise<HomeSummary[]> {
      const rows = await db
        .select({
          id: homes.id,
          name: homes.name,
          schemaVersion: homes.schemaVersion,
          createdAt: homes.createdAt,
          updatedAt: homes.updatedAt,
        })
        .from(homes)
        .orderBy(asc(homes.createdAt), asc(homes.id))
        .limit(limit);
      return rows.map(toSummary);
    },

    /**
     * The stored model, re-parsed so keys come back in schema order (jsonb reorders them) and
     * documents written by an older schema fail loudly instead of reaching the viewer.
     */
    async get(id: string): Promise<HomeModel | undefined> {
      const [row] = await db.select({ model: homes.model }).from(homes).where(eq(homes.id, id));
      return row && HomeModel.parse(row.model);
    },

    /** Inserts the model unless a home with its id exists; returns whether it was inserted. */
    async insert(model: HomeModel): Promise<boolean> {
      const rows = await db
        .insert(homes)
        .values({ id: model.id, ...columns(model) })
        .onConflictDoNothing({ target: homes.id })
        .returning({ id: homes.id });
      return rows.length > 0;
    },

    /** Replaces an existing home; returns false when there is none. */
    async replace(model: HomeModel): Promise<boolean> {
      const rows = await db
        .update(homes)
        .set({ ...columns(model), updatedAt: new Date() })
        .where(eq(homes.id, model.id))
        .returning({ id: homes.id });
      return rows.length > 0;
    },

    /** Inserts or replaces; returns `created` or `replaced`. */
    async upsert(model: HomeModel): Promise<'created' | 'replaced'> {
      if (await this.insert(model)) return 'created';
      await this.replace(model);
      return 'replaced';
    },
  };
}
export type HomeStore = ReturnType<typeof homeStore>;
