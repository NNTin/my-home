import { randomUUID } from 'node:crypto';
import {
  catalog,
  Note,
  type CreateNoteBody,
  type Subject,
  type UpdateNoteBody,
} from '@my-home/shared';
import { and, asc, eq, isNull, sql } from 'drizzle-orm';
import type { z } from 'zod';
import type { ResolvedActor } from '../actor';
import { problem } from '../errors';
import type { Db } from './client';
import { notFound } from './placements';
import { homes } from './schema';
import { subjectResolver } from './subjects';
import { notes, type NoteRow } from './userdata-schema';

const toNote = (row: NoteRow): Note =>
  Note.parse({
    id: row.id,
    homeId: row.homeId,
    subject: { kind: row.subjectKind, id: row.subjectId },
    body: row.body,
    createdBy: row.createdBy,
    updatedBy: row.updatedBy,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  });

/**
 * Notes on types (environment-wide) and uses (per home), in `userdata.notes`. Anyone may edit or
 * delete any note; a deleted note keeps its row (`deleted_at`) and is never listed again.
 */
export function noteStore(db: Db) {
  /** The home a note belongs to: none for a type, the given one for a use. */
  const scope = (subject: Subject, homeId: string | null | undefined) => {
    if (subject.kind === 'type') {
      if (homeId != null) {
        throw problem(400, 'A type note is environment-wide: leave out homeId', {
          issues: [{ path: 'homeId', message: 'Not allowed for a type subject' }],
        });
      }
      return null;
    }
    if (homeId == null) {
      throw problem(400, 'A use note needs its homeId', {
        issues: [{ path: 'homeId', message: 'Required for a use subject' }],
      });
    }
    return homeId;
  };

  const active = (id: string) => and(eq(notes.id, id), isNull(notes.deletedAt));

  return {
    /** Oldest first. */
    async list(subject: Subject, homeId: string | undefined): Promise<Note[]> {
      const home = subject.kind === 'type' ? null : scope(subject, homeId);
      const rows = await db
        .select()
        .from(notes)
        .where(
          and(
            eq(notes.subjectKind, subject.kind),
            eq(notes.subjectId, subject.id),
            home === null ? isNull(notes.homeId) : eq(notes.homeId, home),
            isNull(notes.deletedAt),
          ),
        )
        .orderBy(asc(notes.createdAt), asc(notes.id));
      return rows.map(toNote);
    },

    /** 400 for an unknown type, 404 for an unknown home or a use that is not in it. */
    async create(body: z.output<typeof CreateNoteBody>, actor: ResolvedActor): Promise<Note> {
      const homeId = scope(body.subject, body.homeId);
      if (body.subject.kind === 'type' && !catalog.get(body.subject.id)) {
        throw problem(400, `Type "${body.subject.id}" is not in the catalogue`, {
          issues: [{ path: 'subject.id', message: 'Unknown type' }],
        });
      }
      if (homeId !== null) {
        const [home] = await db.select({ id: homes.id }).from(homes).where(eq(homes.id, homeId));
        if (!home) throw notFound('Home', homeId);
        if (!(await subjectResolver(db).use(homeId, body.subject.id))) {
          throw notFound('Use', body.subject.id);
        }
      }
      const [row] = await db
        .insert(notes)
        .values({
          id: randomUUID(),
          homeId,
          subjectKind: body.subject.kind,
          subjectId: body.subject.id,
          body: body.body,
          createdBy: actor.actor,
          updatedBy: actor.actor,
        })
        .returning();
      return toNote(row!);
    },

    async update(
      id: string,
      body: z.output<typeof UpdateNoteBody>,
      actor: ResolvedActor,
    ): Promise<Note> {
      const [row] = await db
        .update(notes)
        .set({ body: body.body, updatedBy: actor.actor, updatedAt: sql`now()` })
        .where(active(id))
        .returning();
      if (!row) throw notFound('Note', id);
      return toNote(row);
    },

    /** Soft delete; a note that is already deleted is a 404. */
    async remove(id: string, actor: ResolvedActor): Promise<void> {
      const rows = await db
        .update(notes)
        .set({ deletedAt: sql`now()`, updatedBy: actor.actor })
        .where(active(id))
        .returning({ id: notes.id });
      if (rows.length === 0) throw notFound('Note', id);
    },
  };
}
export type NoteStore = ReturnType<typeof noteStore>;
