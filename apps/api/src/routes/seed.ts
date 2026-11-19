import {
  ApiError,
  formatSeed,
  HomeSeed,
  normalizeSeed,
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
 * imports a seed the way the release job applies git's, with history rows by `seed`.
 */
export const seedRoutes =
  (db: Db, config: Pick<Config, 'agentUsernames'>): FastifyPluginAsyncZod =>
  async (app) => {
    const homes = homeStore(db);
    const model = async (homeId: string) => {
      const found = await homes.get(homeId);
      if (!found) throw problem(404, `Home "${homeId}" not found`);
      return found;
    };

    // Text, so the file in git is byte for byte what the api answers.
    app.get('/homes/:homeId/seed', { schema: { params: SeedParams } }, async (request, reply) => {
      await model(request.params.homeId);
      const seed = await exportSeed(db, request.params.homeId);
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
          actor: 'seed',
          source: who.source,
          username: who.username,
        });
        return reply.header('warning', SEED_REPLACED_ON_DEPLOY).send(report);
      },
    );
  };
