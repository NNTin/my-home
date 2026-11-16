import { randomUUID } from 'node:crypto';
import {
  Layout,
  LAYOUT_SCHEMA_VERSION,
  type LayoutItem,
  type LayoutSummary,
  type UpdateLayoutBody,
} from '@my-home/shared';
import { and, asc, eq, sql } from 'drizzle-orm';
import type { Db } from './client';
import { homes, layouts, type LayoutRow } from './schema';

/**
 * The stored row as a Layout, re-parsed so keys come back in schema order (jsonb reorders them)
 * and rows written by an older schema fail loudly instead of reaching the client.
 */
const toLayout = (row: LayoutRow): Layout =>
  Layout.parse({
    id: row.id,
    homeId: row.homeId,
    name: row.name,
    schemaVersion: row.schemaVersion,
    version: row.version,
    items: row.items,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  });

export type UpdateResult =
  | { status: 'updated'; layout: Layout }
  | { status: 'conflict'; currentVersion: number }
  | { status: 'not-found' };

/** Data access for layouts. Callers pass bodies already validated with the shared schemas. */
export function layoutStore(db: Db) {
  const homeExists = async (homeId: string) =>
    (await db.select({ id: homes.id }).from(homes).where(eq(homes.id, homeId))).length > 0;

  const insert = async (homeId: string, name: string, items: LayoutItem[]) => {
    const [row] = await db
      .insert(layouts)
      .values({
        id: randomUUID(),
        homeId,
        name,
        schemaVersion: LAYOUT_SCHEMA_VERSION,
        version: 1,
        items,
      })
      .returning();
    return toLayout(row!);
  };

  return {
    homeExists,

    /** Summaries of a home's layouts, oldest first; undefined when the home does not exist. */
    async list(homeId: string): Promise<LayoutSummary[] | undefined> {
      if (!(await homeExists(homeId))) return undefined;
      const rows = await db
        .select({
          id: layouts.id,
          homeId: layouts.homeId,
          name: layouts.name,
          schemaVersion: layouts.schemaVersion,
          version: layouts.version,
          itemCount: sql<number>`jsonb_array_length(${layouts.items})`.mapWith(Number),
          createdAt: layouts.createdAt,
          updatedAt: layouts.updatedAt,
        })
        .from(layouts)
        .where(eq(layouts.homeId, homeId))
        .orderBy(asc(layouts.createdAt), asc(layouts.id));
      return rows.map((r) => ({
        ...r,
        schemaVersion: r.schemaVersion as typeof LAYOUT_SCHEMA_VERSION,
        createdAt: r.createdAt.toISOString(),
        updatedAt: r.updatedAt.toISOString(),
      }));
    },

    async get(id: string): Promise<Layout | undefined> {
      const [row] = await db.select().from(layouts).where(eq(layouts.id, id));
      return row && toLayout(row);
    },

    /** Creates a layout with a new id at version 1; undefined when the home does not exist. */
    async create(homeId: string, name: string, items: LayoutItem[]): Promise<Layout | undefined> {
      if (!(await homeExists(homeId))) return undefined;
      return insert(homeId, name, items);
    },

    /** Replaces name and items if `version` is still current, and bumps the version. */
    async update(id: string, body: UpdateLayoutBody): Promise<UpdateResult> {
      const [row] = await db
        .update(layouts)
        .set({
          name: body.name,
          items: body.items,
          version: sql`${layouts.version} + 1`,
          updatedAt: new Date(),
        })
        .where(and(eq(layouts.id, id), eq(layouts.version, body.version)))
        .returning();
      if (row) return { status: 'updated', layout: toLayout(row) };
      const [current] = await db
        .select({ version: layouts.version })
        .from(layouts)
        .where(eq(layouts.id, id));
      return current
        ? { status: 'conflict', currentVersion: current.version }
        : { status: 'not-found' };
    },

    /** Returns whether a layout was deleted. */
    async remove(id: string): Promise<boolean> {
      const rows = await db.delete(layouts).where(eq(layouts.id, id)).returning({ id: layouts.id });
      return rows.length > 0;
    },

    /** Copies a layout (same home and items) under a new id; undefined when it does not exist. */
    async duplicate(id: string, name?: string): Promise<Layout | undefined> {
      const source = await this.get(id);
      if (!source) return undefined;
      return insert(source.homeId, name ?? `${source.name} (copy)`.slice(0, 200), source.items);
    },
  };
}
export type LayoutStore = ReturnType<typeof layoutStore>;
