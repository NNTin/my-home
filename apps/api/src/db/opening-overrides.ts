import {
  catalog,
  effectiveParams,
  modelUses,
  openingFitIssues,
  type OpeningOverride,
  type UseState,
} from '@my-home/shared';
import { and, asc, eq } from 'drizzle-orm';
import { problem } from '../core/errors';
import type { Db } from './types';
import { recordHistory, sameJson, type HistoryActor, type Tx } from './history';
import { homeStore } from './homes';
import { conflict, notFound, validOverrides } from './placements';
import { openingOverrides, type OpeningOverrideRow } from './userdata-schema';

export const toOpeningOverride = (row: OpeningOverrideRow): OpeningOverride => ({
  homeId: row.homeId,
  useId: row.useId,
  typeId: row.typeId,
  params: row.params,
  version: row.version,
  updatedAt: row.updatedAt.toISOString(),
});

export const overrideState = (row: Pick<OpeningOverrideRow, 'params'> | undefined): UseState => ({
  params: row?.params ?? {},
});

/**
 * Basic-parameter overrides of the uses that live in git (openings, roof windows, outbuilding
 * openings, gates), keyed by their stable id. Rows are never deleted: an empty `params` object
 * keeps the version and the history.
 */
export function openingOverrideStore(db: Db) {
  const homes = homeStore(db);

  return {
    async list(homeId: string): Promise<OpeningOverride[]> {
      if (!(await homes.get(homeId))) throw notFound('Home', homeId);
      const rows = await db
        .select()
        .from(openingOverrides)
        .where(eq(openingOverrides.homeId, homeId))
        .orderBy(asc(openingOverrides.useId));
      return rows.map(toOpeningOverride);
    },

    /**
     * Creates (`version: 0`) or replaces the override of a use in the current model. The params
     * are validated against the use's current type and must fit its hole.
     */
    async put(
      homeId: string,
      useId: string,
      input: { version: number; params: Record<string, unknown> },
      actor: HistoryActor,
    ): Promise<OpeningOverride> {
      const model = await homes.get(homeId);
      if (!model) throw notFound('Home', homeId);
      const use = modelUses(model).find((u) => u.id === useId);
      if (!use) throw problem(404, `Use "${useId}" is not in the home model of "${homeId}"`);
      const type = catalog.get(use.typeId)!;
      const params = validOverrides(type, input.params);
      const issues = use.hole
        ? openingFitIssues(type, effectiveParams(type, params).values, use.hole)
        : [];
      if (issues.length > 0) {
        throw problem(422, issues[0]!, {
          issues: issues.map((message) => ({ path: 'params', message })),
        });
      }

      const row = await db.transaction(async (tx) => {
        const [current] = await tx
          .select()
          .from(openingOverrides)
          .where(and(eq(openingOverrides.homeId, homeId), eq(openingOverrides.useId, useId)))
          .for('update');
        const currentVersion = current?.version ?? 0;
        if (currentVersion !== input.version) {
          throw conflict(
            `Version ${input.version} is stale: the override is at version ${currentVersion}; reload and retry`,
            currentVersion,
            ['version'],
          );
        }
        // Nothing changes: no new version, no history (as for placements).
        if (current && current.typeId === type.id && sameJson(current.params, params))
          return current;
        const [written] = current
          ? await tx
              .update(openingOverrides)
              .set({ typeId: type.id, params, version: current.version + 1, updatedAt: new Date() })
              .where(and(eq(openingOverrides.homeId, homeId), eq(openingOverrides.useId, useId)))
              .returning()
          : await tx
              .insert(openingOverrides)
              .values({ homeId, useId, typeId: type.id, params })
              // A concurrent first PUT may have created the row since the (empty) locking select.
              .onConflictDoNothing()
              .returning();
        if (!written) {
          throw conflict(
            `Version ${input.version} is stale: the override was just created; reload and retry`,
            1,
            ['version'],
          );
        }
        await recordHistory(tx, {
          homeId,
          useId,
          useKind: 'opening',
          action: 'update',
          actor,
          before: overrideState(current),
          after: overrideState(written),
        });
        return written;
      });
      return toOpeningOverride(row);
    },

    /** The locked row and its state, for an undo in `tx`. */
    async lockState(tx: Tx, homeId: string, useId: string) {
      const [row] = await tx
        .select()
        .from(openingOverrides)
        .where(and(eq(openingOverrides.homeId, homeId), eq(openingOverrides.useId, useId)))
        .for('update');
      return row && { row, state: overrideState(row) };
    },

    async applyState(tx: Tx, row: OpeningOverrideRow, state: UseState) {
      const [updated] = await tx
        .update(openingOverrides)
        .set({ params: state.params, version: row.version + 1, updatedAt: new Date() })
        .where(and(eq(openingOverrides.homeId, row.homeId), eq(openingOverrides.useId, row.useId)))
        .returning();
      return updated!;
    },
  };
}
export type OpeningOverrideStore = ReturnType<typeof openingOverrideStore>;
