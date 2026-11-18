import { UseConflict, type HistoryEntry } from '@my-home/shared';
import { useEffect, useState } from 'react';
import { ApiRequestError, usesApi } from '../api';

const ACTORS = { owner: 'You', agent: 'Agent', system: 'System' } as const;
/** The same, inside a sentence: "undone by you at …". */
const BY = { owner: 'you', agent: 'an agent', system: 'the system' } as const;
const ACTIONS = {
  create: 'placed',
  update: 'changed',
  remove: 'moved to the trash',
  restore: 'restored',
  undo: 'undone',
  import: 'imported',
} as const;

const UNITS: [Intl.RelativeTimeFormatUnit, number][] = [
  ['year', 365 * 86_400],
  ['month', 30 * 86_400],
  ['week', 7 * 86_400],
  ['day', 86_400],
  ['hour', 3600],
  ['minute', 60],
];

/** "5 minutes ago", "yesterday", "now". */
export function relativeTime(iso: string, now = Date.now()): string {
  const seconds = Math.round((Date.parse(iso) - now) / 1000);
  const format = new Intl.RelativeTimeFormat('en', { numeric: 'auto' });
  for (const [unit, size] of UNITS) {
    if (Math.abs(seconds) >= size) return format.format(Math.round(seconds / size), unit);
  }
  return format.format(0, 'second');
}

const exactTime = (iso: string) =>
  new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'medium' });

function Who({ entry }: { entry: HistoryEntry }) {
  return (
    <span className="history-who">
      {ACTORS[entry.actor]}
      {entry.actorSource !== 'identity' && (
        <span
          className="declared"
          title={
            entry.actorSource === 'declared'
              ? 'Declared by the client, not from the sign-on'
              : 'Not known: recorded as the owner'
          }
        >
          {' '}
          ({entry.actorSource})
        </span>
      )}
    </span>
  );
}

const whatOf = (entry: HistoryEntry) =>
  entry.changes.length > 0 ? entry.changes.map((c) => c.text).join(', ') : ACTIONS[entry.action];

/**
 * The history of one use, newest first: when, who (you or an agent) and what. **Undo** takes one
 * click, without a confirmation: the undo is recorded too and can itself be undone.
 */
export function History({
  homeId,
  useId,
  refreshKey,
  onUndone,
}: {
  homeId: string;
  useId: string;
  /** Changes when the use was saved, so the list follows. */
  refreshKey: string;
  /** After an undo: the home's uses are loaded again. */
  onUndone(): Promise<void>;
}) {
  const [entries, setEntries] = useState<HistoryEntry[]>();
  const [error, setError] = useState<string>();
  const [undoError, setUndoError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [turn, setTurn] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    usesApi
      .history(homeId, useId, controller.signal)
      .then(({ items }) => {
        setEntries(items);
        setError(undefined);
      })
      .catch((err: unknown) => {
        if (!controller.signal.aborted) setError((err as Error).message);
      });
    return () => controller.abort();
  }, [homeId, useId, refreshKey, turn]);

  const undo = async (entry: HistoryEntry) => {
    setBusy(true);
    setUndoError(undefined);
    try {
      await usesApi.undo(homeId, useId, entry.id);
      await onUndone();
    } catch (err) {
      const conflict =
        err instanceof ApiRequestError && err.status === 409
          ? UseConflict.safeParse(err.body)
          : undefined;
      setUndoError(
        conflict?.success
          ? conflict.data.conflicts.includes('already undone')
            ? 'Already undone.'
            : 'Changed again later: undo the later change first.'
          : (err as Error).message,
      );
    } finally {
      setBusy(false);
      setTurn((t) => t + 1);
    }
  };

  const byId = new Map(entries?.map((e) => [e.id, e]));
  return (
    <section className="use-history" aria-label="History">
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {undoError && (
        <p className="error" role="alert">
          {undoError}
        </p>
      )}
      {entries === undefined && !error && <p>Loading the history…</p>}
      {entries?.length === 0 && <p>No changes yet: the use has its type's defaults.</p>}
      {entries && entries.length > 0 && (
        <ol className="history-list">
          {entries.map((entry) => {
            const undoneBy = entry.undoneById ? byId.get(entry.undoneById) : undefined;
            return (
              <li key={entry.id} className={entry.undoneById ? 'undone' : undefined}>
                <time dateTime={entry.at} title={exactTime(entry.at)}>
                  {relativeTime(entry.at)}
                </time>{' '}
                · <Who entry={entry} /> ·{' '}
                <span className="history-what">
                  {entry.undoneById ? <s>{whatOf(entry)}</s> : whatOf(entry)}
                  {entry.action === 'undo' && entry.changes.length > 0 && ' (undo)'}
                </span>
                {entry.undoneById && (
                  <span className="history-undone">
                    {' '}
                    undone
                    {undoneBy && ` by ${BY[undoneBy.actor]} at ${exactTime(undoneBy.at)}`}
                  </span>
                )}
                {entry.canUndo && (
                  <button
                    type="button"
                    className="button history-undo"
                    disabled={busy}
                    aria-label={`Undo: ${whatOf(entry)}`}
                    onClick={() => void undo(entry)}
                  >
                    Undo
                  </button>
                )}
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}
