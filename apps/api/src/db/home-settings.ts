import type { HomeModel, HomeSettings, UseState } from '@my-home/shared';
import { eq } from 'drizzle-orm';
import type { Db } from './client';
import { recordHistory, sameJson, type HistoryActor, type Tx } from './history';
import { conflict, notFound } from './placements';
import { homes } from './schema';
import { homeSettings, type HomeSettingsRow } from './userdata-schema';

const toHomeSettings = (homeId: string, row: HomeSettingsRow | undefined): HomeSettings => ({
  homeId,
  magneticDeclination: row?.magneticDeclination ?? null,
  version: row?.version ?? 0,
  updatedAt: row ? row.updatedAt.toISOString() : null,
});

/** What history stores for a home's settings. */
export const settingsState = (
  row: Pick<HomeSettingsRow, 'magneticDeclination'> | undefined,
): UseState => ({ params: {}, magneticDeclination: row?.magneticDeclination ?? null });

/** The effective model: the git document with the settings stored on top of it. */
export function withSettings(model: HomeModel, settings: HomeSettings): HomeModel {
  if (!settings.magneticDeclination) return model;
  return {
    ...model,
    building: { ...model.building, magneticDeclination: settings.magneticDeclination },
  };
}

/**
 * Per-home settings in `userdata.home_settings`, on top of the home model from git: the sync on
 * every deploy replaces the model but never these. Changes are recorded in history with
 * `use_kind = 'home'` and `use_id` = the home id, so the uses' undo endpoint undoes them.
 */
export function homeSettingsStore(db: Db) {
  const find = async (tx: Db | Tx, homeId: string) => {
    const [row] = await tx.select().from(homeSettings).where(eq(homeSettings.homeId, homeId));
    return row;
  };

  const requireHome = async (homeId: string, tx: Tx | Db = db) => {
    const [row] = await tx.select({ id: homes.id }).from(homes).where(eq(homes.id, homeId));
    if (!row) throw notFound('Home', homeId);
  };

  return {
    /** The settings of a home (version 0 when never set); does not check that the home exists. */
    async find(homeId: string): Promise<HomeSettings> {
      return toHomeSettings(homeId, await find(db, homeId));
    },

    async get(homeId: string): Promise<HomeSettings> {
      await requireHome(homeId);
      return toHomeSettings(homeId, await find(db, homeId));
    },

    /** Sets the settings, guarded by `version` (0 creates them); a no-op writes nothing. */
    async put(
      homeId: string,
      input: { version: number; magneticDeclination: HomeSettings['magneticDeclination'] },
      actor: HistoryActor,
    ): Promise<HomeSettings> {
      const row = await db.transaction(async (tx) => {
        await requireHome(homeId, tx);
        const [current] = await tx
          .select()
          .from(homeSettings)
          .where(eq(homeSettings.homeId, homeId))
          .for('update');
        const currentVersion = current?.version ?? 0;
        if (currentVersion !== input.version) {
          throw conflict(
            `Version ${input.version} is stale: the settings are at version ${currentVersion}; reload and retry`,
            currentVersion,
            ['version'],
          );
        }
        const declination = input.magneticDeclination;
        if (sameJson(current?.magneticDeclination ?? null, declination)) return current;
        const [written] = current
          ? await tx
              .update(homeSettings)
              .set({
                magneticDeclination: declination,
                version: current.version + 1,
                updatedAt: new Date(),
              })
              .where(eq(homeSettings.homeId, homeId))
              .returning()
          : await tx
              .insert(homeSettings)
              .values({ homeId, magneticDeclination: declination })
              // A concurrent first PUT may have created the row since the (empty) locking select.
              .onConflictDoNothing()
              .returning();
        if (!written) {
          throw conflict(
            `Version ${input.version} is stale: the settings were just created; reload and retry`,
            1,
            ['version'],
          );
        }
        await recordHistory(tx, {
          homeId,
          useId: homeId,
          useKind: 'home',
          action: 'update',
          actor,
          before: settingsState(current),
          after: settingsState(written),
        });
        return written;
      });
      return toHomeSettings(homeId, row);
    },

    /** The current state for history (also when never set). */
    state: async (homeId: string) => settingsState(await find(db, homeId)),

    /** The locked row and its state, for an undo in `tx`. */
    async lockState(tx: Tx, homeId: string) {
      const [row] = await tx
        .select()
        .from(homeSettings)
        .where(eq(homeSettings.homeId, homeId))
        .for('update');
      return row && { row, state: settingsState(row) };
    },

    async applyState(tx: Tx, row: HomeSettingsRow, state: UseState) {
      const [updated] = await tx
        .update(homeSettings)
        .set({
          magneticDeclination: state.magneticDeclination ?? null,
          version: row.version + 1,
          updatedAt: new Date(),
        })
        .where(eq(homeSettings.homeId, row.homeId))
        .returning();
      return updated!;
    },

    toHomeSettings,
  };
}
export type HomeSettingsStore = ReturnType<typeof homeSettingsStore>;
