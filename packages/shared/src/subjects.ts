import { z } from 'zod';

/**
 * What a note, a photo or a photo request is about: a catalogue type (`window.casement`), or a use
 * of one in a home (an opening's id from the home model, or a placement id). Subjects are soft
 * references: they are kept when the model or the catalogue loses the id, and then resolve to
 * `missing`.
 */
export const SubjectKind = z.enum(['type', 'use']);
export type SubjectKind = z.infer<typeof SubjectKind>;

/** `id` is a `TypeId` for `type`, a use id (home-model `Id` or placement id) for `use`. */
export const Subject = z.object({ kind: SubjectKind, id: z.string().min(1).max(64) });
export type Subject = z.infer<typeof Subject>;

/**
 * A subject resolved on read: the type's or the use's current name, and whether it still exists
 * (`missing`: not in the catalogue, or not in the home's model or placements any more).
 */
export const SubjectRef = Subject.extend({
  name: z.string().nullable(),
  status: z.enum(['current', 'missing']),
});
export type SubjectRef = z.infer<typeof SubjectRef>;

/** `type:window.casement` or `use:souterrain-kitchen-window`. */
export const subjectKey = (subject: Subject) => `${subject.kind}:${subject.id}`;

export const MAX_SUBJECTS = 10;

/** A list of subjects without duplicates (the first of equal ones is kept). */
export const Subjects = z
  .array(Subject)
  .max(MAX_SUBJECTS)
  .transform((list) => {
    const seen = new Set<string>();
    return list.filter((s) => {
      const key = subjectKey(s);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  });

/** A subject in a query string, written as `type:<id>` or `use:<id>`. */
export const SubjectQuery = z
  .string()
  .regex(/^(type|use):.{1,64}$/, 'Use "type:<typeId>" or "use:<useId>"')
  .transform((value): Subject => {
    const at = value.indexOf(':');
    return { kind: value.slice(0, at) as SubjectKind, id: value.slice(at + 1) };
  });
