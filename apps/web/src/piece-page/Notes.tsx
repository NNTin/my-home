import { MAX_NOTE_LENGTH, type Note, type Subject } from '@my-home/shared';
import { useEffect, useId, useState } from 'react';
import { notesApi } from '../api';
import { SkButton } from '../hud/SkButton';
import { SkField } from '../hud/SkField';

const BY = { owner: 'you', agent: 'an agent', system: 'the system' } as const;

const when = (iso: string) =>
  new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });

function NoteItem({ note, onChanged }: { note: Note; onChanged(): void }) {
  const [draft, setDraft] = useState<string>();
  const [error, setError] = useState<string>();
  const run = async (action: () => Promise<unknown>) => {
    try {
      await action();
      setDraft(undefined);
      setError(undefined);
      onChanged();
    } catch (err) {
      setError((err as Error).message);
    }
  };
  return (
    <li className="note-item">
      {draft === undefined ? (
        <p className="note-body">{note.body}</p>
      ) : (
        <SkField size="compact">
          <textarea
            aria-label="Edit the note"
            value={draft}
            rows={3}
            maxLength={MAX_NOTE_LENGTH}
            onChange={(e) => setDraft(e.target.value)}
          />
        </SkField>
      )}
      <p className="piece-note">
        By {BY[note.createdBy]}, {when(note.createdAt)}
        {note.updatedAt !== note.createdAt && ` · edited by ${BY[note.updatedBy]}`}
      </p>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <div className="buttons">
        {draft === undefined ? (
          <SkButton size="compact" variant="secondary" onClick={() => setDraft(note.body)}>
            Edit note
          </SkButton>
        ) : (
          <>
            <SkButton
              size="compact"
              variant="secondary"
              disabled={draft.trim() === '' || draft.trim() === note.body}
              onClick={() => void run(() => notesApi.update(note.id, draft.trim()))}
            >
              Save note
            </SkButton>
            <SkButton size="compact" variant="secondary" onClick={() => setDraft(undefined)}>
              Cancel
            </SkButton>
          </>
        )}
        <SkButton
          size="compact"
          variant="secondary"
          onClick={() => void run(() => notesApi.remove(note.id))}
        >
          Delete note
        </SkButton>
      </div>
    </li>
  );
}

/**
 * The free-text notes on a type (environment-wide) or on one use of a home: listed oldest first,
 * added, edited and deleted (notes only; photos are never deleted here).
 */
export function Notes({ subject, homeId }: { subject: Subject; homeId?: string }) {
  const id = useId();
  const [notes, setNotes] = useState<Note[]>();
  const [error, setError] = useState<string>();
  const [text, setText] = useState('');
  const [turn, setTurn] = useState(0);
  const { kind, id: subjectId } = subject;

  useEffect(() => {
    const controller = new AbortController();
    notesApi
      .list({ kind, id: subjectId }, homeId, controller.signal)
      .then(({ items }) => setNotes(items))
      .catch((err: unknown) => {
        if (!controller.signal.aborted) setError((err as Error).message);
      });
    return () => controller.abort();
  }, [kind, subjectId, homeId, turn]);

  const reload = () => setTurn((t) => t + 1);
  const add = async () => {
    try {
      await notesApi.create({
        subject,
        ...(homeId !== undefined && { homeId }),
        body: text.trim(),
      });
      setText('');
      setError(undefined);
      reload();
    } catch (err) {
      setError((err as Error).message);
    }
  };

  return (
    <div className="notes" role="group" aria-labelledby={id}>
      <h4 id={id}>Notes</h4>
      {notes?.length === 0 && <p className="piece-note">No notes yet.</p>}
      {notes && notes.length > 0 && (
        <ul className="note-list">
          {notes.map((note) => (
            <NoteItem key={note.id} note={note} onChanged={reload} />
          ))}
        </ul>
      )}
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <form
        className="note-add"
        onSubmit={(e) => {
          e.preventDefault();
          if (text.trim() !== '') void add();
        }}
      >
        <SkField size="compact">
          <textarea
            aria-label="New note"
            placeholder="Add a note…"
            value={text}
            rows={2}
            maxLength={MAX_NOTE_LENGTH}
            onChange={(e) => setText(e.target.value)}
          />
        </SkField>
        <SkButton size="compact" variant="secondary" type="submit" disabled={text.trim() === ''}>
          Add note
        </SkButton>
      </form>
    </div>
  );
}
