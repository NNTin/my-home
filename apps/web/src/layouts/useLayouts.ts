import { LayoutFile, type Layout, type LayoutSummary } from '@my-home/shared';
import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import { layoutsApi, type LayoutsApi } from '../api';
import { editorReducer, initialEditorState, type EditorAction } from '../editor/editorState';
import { draftStore, lastLayout } from './drafts';
import { LayoutSaver, type SaverState } from './saver';

export const DEFAULT_LAYOUT_NAME = 'Default layout';

const errorMessage = (err: unknown) => (err instanceof Error ? err.message : String(err));

const toSummary = (l: Layout): LayoutSummary => ({
  id: l.id,
  homeId: l.homeId,
  name: l.name,
  schemaVersion: l.schemaVersion,
  version: l.version,
  itemCount: l.items.length,
  createdAt: l.createdAt,
  updatedAt: l.updatedAt,
});

/** A name not used by another layout: `base`, `base 2`, `base 3`, ... */
export function uniqueName(base: string, taken: string[]) {
  const names = new Set(taken);
  if (!names.has(base)) return base;
  for (let i = 2; ; i++) if (!names.has(`${base} ${i}`)) return `${base} ${i}`;
}

/**
 * The named layouts of a home and the editor state of the open one: loads the list (creating a
 * default layout for a home without any), reopens the last active layout, auto-saves edits
 * through `LayoutSaver`, and exposes the layout manager actions.
 */
export function useLayouts(homeId: string, api: LayoutsApi = layoutsApi) {
  const [layouts, setLayouts] = useState<LayoutSummary[]>([]);
  const [activeId, setActiveId] = useState<string>();
  const [name, setName] = useState('');
  const [editor, dispatch] = useReducer(editorReducer, undefined, () => initialEditorState());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>();
  const [saveState, setSaveState] = useState<SaverState>({
    status: 'saved',
    version: 1,
    restored: false,
  });

  const saver = useMemo(
    () =>
      new LayoutSaver({
        update: api.update,
        drafts: draftStore(),
        onChange: setSaveState,
        onSaved: (saved) =>
          setLayouts((list) => list.map((l) => (l.id === saved.id ? toSummary(saved) : l))),
      }),
    [api],
  );

  const nameRef = useRef(name);

  const run = useCallback(async (action: () => Promise<void>) => {
    try {
      setError(undefined);
      await action();
    } catch (err) {
      setError(errorMessage(err));
    }
  }, []);

  const show = useCallback(
    (layout: Layout) => {
      const opened = saver.open(layout);
      dispatch({ type: 'load', items: opened.items });
      nameRef.current = opened.name;
      setName(opened.name);
      setActiveId(layout.id);
      lastLayout.set(homeId, layout.id);
    },
    [homeId, saver],
  );

  const open = useCallback(
    (id: string) =>
      run(async () => {
        await saver.flush();
        show(await api.get(id));
      }),
    [api, run, saver, show],
  );

  // Load once per home; StrictMode's second mount must not create a second default layout.
  const started = useRef<string>(undefined);
  useEffect(() => {
    if (started.current === homeId) return;
    started.current = homeId;
    void run(async () => {
      let { items } = await api.list(homeId);
      if (items.length === 0) {
        const created = await api.create(homeId, { name: DEFAULT_LAYOUT_NAME });
        items = [toSummary(created)];
      }
      setLayouts(items);
      const last = lastLayout.get(homeId);
      const id = items.some((l) => l.id === last) ? last! : items[0]!.id;
      show(await api.get(id));
    }).finally(() => setLoading(false));
  }, [api, homeId, run, show]);

  // Save edits once a drag is released (live drag updates only move the item on screen).
  useEffect(() => {
    if (editor.revision === 0 || editor.drag) return;
    saver.edit({ name: nameRef.current, items: editor.items });
  }, [editor.items, editor.drag, editor.revision, saver]);

  // Leaving the page or the home: save what is pending (the draft covers a failed save), then
  // stop retrying. StrictMode remounts at once, so only close when still unmounted.
  const mounted = useRef(false);
  useEffect(() => {
    mounted.current = true;
    const onHide = () => {
      if (document.visibilityState === 'hidden') void saver.flush();
    };
    document.addEventListener('visibilitychange', onHide);
    return () => {
      mounted.current = false;
      document.removeEventListener('visibilitychange', onHide);
      void saver.flush().then(() => {
        if (!mounted.current) saver.close();
      });
    };
  }, [saver]);

  const add = (layout: Layout) => {
    setLayouts((list) => [...list.filter((l) => l.id !== layout.id), toSummary(layout)]);
    show(layout);
  };

  const actions = {
    open,
    create: () =>
      run(async () => {
        await saver.flush();
        const base = uniqueName(
          'Layout',
          layouts.map((l) => l.name),
        );
        add(await api.create(homeId, { name: base }));
      }),
    duplicate: () =>
      run(async () => {
        if (!activeId) return;
        await saver.flush();
        add(await api.duplicate(activeId));
      }),
    rename: (next: string) => {
      const trimmed = next.trim();
      nameRef.current = next;
      setName(next);
      if (!trimmed || !activeId) return;
      setLayouts((list) => list.map((l) => (l.id === activeId ? { ...l, name: trimmed } : l)));
      saver.edit({ name: trimmed, items: editor.items });
    },
    remove: () =>
      run(async () => {
        if (!activeId) return;
        await api.remove(activeId);
        saver.discard(activeId);
        const rest = layouts.filter((l) => l.id !== activeId);
        if (rest.length === 0) {
          const created = await api.create(homeId, { name: DEFAULT_LAYOUT_NAME });
          setLayouts([toSummary(created)]);
          show(created);
        } else {
          setLayouts(rest);
          show(await api.get(rest[0]!.id));
        }
      }),
    importFile: (file: Blob) =>
      run(async () => {
        let json: unknown;
        try {
          json = JSON.parse(await file.text());
        } catch {
          throw new Error('Import failed: the file is not valid JSON');
        }
        const parsed = LayoutFile.safeParse(json);
        if (!parsed.success) {
          const issue = parsed.error.issues[0];
          throw new Error(
            `Import failed: not a layout file (${issue?.path.join('.') || 'file'}: ${issue?.message})`,
          );
        }
        await saver.flush();
        add(await api.import(homeId, parsed.data));
      }),
    /** After a conflict: drop local edits and load the server copy. */
    reload: () =>
      run(async () => {
        if (!activeId) return;
        saver.discard(activeId);
        show(await api.get(activeId));
      }),
    /** After a conflict: replace the server copy with the local edits. */
    overwrite: () => run(() => saver.overwrite()),
    exportUrl: activeId ? api.exportUrl(activeId) : undefined,
    dispatch: dispatch as (action: EditorAction) => void,
  };

  return { loading, error, layouts, activeId, name, editor, saveState, actions };
}
export type LayoutsController = ReturnType<typeof useLayouts>;
