import { useEffect, useMemo, useReducer, useRef, useState } from 'react';
import { placementsApi } from '../api';
import { editorReducer, initialEditorState, type EditorAction } from '../editor/editorState';
import type { EditorItem } from '../editor/item';
import { PlacementSync, type OpStore, type PlacementsClient, type SyncState } from './sync';

const errorMessage = (err: unknown) => (err instanceof Error ? err.message : String(err));

/** Counts the times the tab became visible again (0 at first), so data edited elsewhere reloads. */
export function useVisibleAgain(): number {
  const [count, setCount] = useState(0);
  useEffect(() => {
    const onChange = () => {
      if (document.visibilityState === 'visible') setCount((n) => n + 1);
    };
    document.addEventListener('visibilitychange', onChange);
    return () => document.removeEventListener('visibilitychange', onChange);
  }, []);
  return count;
}

const sameItems = (a: readonly EditorItem[], b: readonly EditorItem[]) =>
  JSON.stringify(a) === JSON.stringify(b);

/**
 * The home's one placement set in the editor: loads `GET /placements`, replays changes this
 * browser had not saved yet, and saves every committed edit item by item through
 * `PlacementSync` (never during a drag). When the tab becomes visible again (`visibleAgain`) and
 * nothing is pending, the placements are reloaded, so agents' edits show up.
 */
export function usePlacements(
  homeId: string,
  visibleAgain: number,
  api: PlacementsClient = placementsApi,
  ops?: OpStore,
) {
  const [editor, dispatch] = useReducer(editorReducer, undefined, () => initialEditorState());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>();
  const [syncState, setSyncState] = useState<SyncState>({ status: 'saved', restored: false });

  const sync = useMemo(
    () =>
      new PlacementSync({
        homeId,
        api,
        ...(ops && { ops }),
        onChange: setSyncState,
        onSynced: (from, item) => dispatch({ type: 'synced', from, item }),
      }),
    [homeId, api, ops],
  );

  // Load once per home; StrictMode's second mount must not load (and replay) twice.
  const started = useRef<PlacementSync>(undefined);
  useEffect(() => {
    if (started.current === sync) return;
    started.current = sync;
    api
      .list(homeId)
      .then(({ items }) => {
        setError(undefined);
        dispatch({ type: 'load', items: sync.open(items) });
      })
      .catch((err: unknown) => setError(`Loading the furniture failed: ${errorMessage(err)}`))
      .finally(() => setLoading(false));
  }, [api, homeId, sync]);

  // Save committed edits; live drag updates only move the item on screen.
  useEffect(() => {
    if (loading || editor.drag) return;
    sync.edit(editor.items);
  }, [editor.items, editor.drag, loading, sync]);

  // Back in the tab: take what agents or other tabs changed meanwhile.
  const items = useRef(editor.items);
  useEffect(() => {
    items.current = editor.items;
  });
  useEffect(() => {
    if (visibleAgain === 0 || !sync.idle) return;
    let cancelled = false;
    api
      .list(homeId)
      .then(({ items: placements }) => {
        if (cancelled) return;
        const next = sync.refresh(placements);
        if (next && !sameItems(next, items.current)) dispatch({ type: 'refresh', items: next });
      })
      .catch(() => {
        // Offline: keep what is shown; the next visit retries.
      });
    return () => {
      cancelled = true;
    };
  }, [api, homeId, sync, visibleAgain]);

  // Leaving the home: stop retrying (pending changes stay in this browser). StrictMode remounts
  // at once, so only close when still unmounted.
  const mounted = useRef(false);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      void Promise.resolve().then(() => {
        if (!mounted.current) sync.close();
      });
    };
  }, [sync]);

  return {
    loading,
    error,
    editor,
    syncState,
    dispatch: dispatch as (action: EditorAction) => void,
  };
}
export type PlacementsController = ReturnType<typeof usePlacements>;
