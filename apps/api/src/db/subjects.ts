import { catalog, HomeModel, modelUses, type Subject, type SubjectRef } from '@my-home/shared';
import { eq } from 'drizzle-orm';
import type { Db } from './types';
import { homes } from './schema';
import { placements } from './userdata-schema';

/** What a use subject points at now: an opening in the model, or a placement (`removed`: in the trash). */
export interface SubjectUse {
  name: string;
  levelId: string | null;
  roomIds: string[];
  removed: boolean;
}

/**
 * Resolves subjects (types and uses) to their current names, caching what it reads per home.
 * Never fails: a home whose stored model this build cannot parse has no model uses, and every
 * unknown id is `missing`. A placement in the trash is `missing` too, but keeps its name.
 */
export function subjectResolver(db: Pick<Db, 'select'>) {
  const cache = new Map<string, Promise<Map<string, SubjectUse>>>();

  const load = async (homeId: string) => {
    const byId = new Map<string, SubjectUse>();
    const [row] = await db.select({ model: homes.model }).from(homes).where(eq(homes.id, homeId));
    const parsed = HomeModel.safeParse(row?.model);
    if (parsed.success) {
      for (const use of modelUses(parsed.data)) {
        byId.set(use.id, {
          name: use.name,
          levelId: use.levelId,
          roomIds: use.roomIds,
          removed: false,
        });
      }
    }
    const placed = await db.select().from(placements).where(eq(placements.homeId, homeId));
    for (const p of placed) {
      if (byId.has(p.id)) continue;
      byId.set(p.id, {
        name: p.name,
        levelId: p.levelId,
        roomIds: p.roomId === null ? [] : [p.roomId],
        removed: p.removedAt !== null,
      });
    }
    return byId;
  };
  const usesOf = (homeId: string) => {
    let uses = cache.get(homeId);
    if (!uses) {
      uses = load(homeId);
      cache.set(homeId, uses);
    }
    return uses;
  };

  return {
    /** The use with this id in the home, a placement in the trash included. */
    use: async (homeId: string, id: string) => (await usesOf(homeId)).get(id),

    /** Names and status of subjects; use subjects need the home they belong to. */
    async refs(homeId: string | null, subjects: Subject[]): Promise<SubjectRef[]> {
      const uses =
        homeId !== null && subjects.some((s) => s.kind === 'use')
          ? await usesOf(homeId)
          : new Map<string, SubjectUse>();
      return subjects.map((s) => {
        if (s.kind === 'type') {
          const type = catalog.get(s.id);
          return { ...s, name: type?.name ?? null, status: type ? 'current' : 'missing' };
        }
        const use = uses.get(s.id);
        return {
          ...s,
          name: use?.name ?? null,
          status: use && !use.removed ? 'current' : 'missing',
        };
      });
    },
  };
}
export type SubjectResolver = ReturnType<typeof subjectResolver>;
