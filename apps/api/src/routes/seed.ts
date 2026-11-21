import {
  ApiError,
  formatSeed,
  HomeSeed,
  normalizeSeed,
  SEED_ACTOR_NAME,
  SeedParams,
  SeedSyncReport,
  seedIssues,
} from '@my-home/shared';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { resolveActor } from '../actor';
import type { Config } from '../config';
import type { Db } from '../db/client';
import { homeStore } from '../db/homes';
import { exportSeed, syncSeeds } from '../db/seed-sync';
import { problem } from '../errors';

/** Every deploy applies git's seed again (docs/deployment.md § The seed comes from git). */
export const SEED_REPLACED_ON_DEPLOY =
  '299 - "Replaced from data/homes/<home>.seed.json on the next deploy"';

/**
 * A home's seed: the placements, opening overrides and notes in the canonical seed format.
 * `GET` exports the environment's state (what `seed.sh <env> export` writes to git); `PUT`
 * imports a seed the way the release job applies git's, with history rows by `system` named
 * `seed import by <who>`.
 */
export const seedRoutes =
  (db: Db, config: Pick<Config, 'agentUsernames'>): FastifyPluginAsyncZod =>
  async (app) => {
    const model = async (homeId: string, reader: Db = db) => {
      const found = await homeStore(reader).get(homeId);
      if (!found) throw problem(404, `Home "${homeId}" not found`);
      return found;
    };

    // Text, so the file in git is byte for byte what the api answers.
    app.get('/homes/:homeId/seed', { schema: { params: SeedParams } }, async (request, reply) => {
      // Include the model: READ COMMITTED would still allow each SELECT to see a different state.
      const seed = await db.transaction(
        async (tx) => exportSeed(tx, await model(request.params.homeId, tx)),
        { isolationLevel: 'repeatable read', accessMode: 'read only' },
      );
      return reply.type('application/json; charset=utf-8').send(formatSeed(seed));
    });

    app.put(
      '/homes/:homeId/seed',
      {
        schema: {
          params: SeedParams,
          body: HomeSeed,
          response: { 200: SeedSyncReport, 400: ApiError, 404: ApiError },
        },
      },
      async (request, reply) => {
        const m = await model(request.params.homeId);
        const issues = seedIssues(request.body, m);
        if (issues.length > 0) {
          throw problem(400, `Invalid seed: ${issues[0]!.path}: ${issues[0]!.message}`, { issues });
        }
        const who = resolveActor(request.headers, config);
        const seed = normalizeSeed(request.body);
        const report = await syncSeeds(db, [{ model: m, seed }], {
          actor: 'system',
          source: 'default',
          username: `${SEED_ACTOR_NAME} import by ${who.username ?? who.actor}`,
        });
        return reply.header('warning', SEED_REPLACED_ON_DEPLOY).send(report);
      },
    );
  };
