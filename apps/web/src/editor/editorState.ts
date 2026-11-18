import type { EditorItem } from './item';
import { diff, emptyHistory, record, redo, remapId, undo, type History } from './history';

/**
 * Editor state as a pure reducer: the home's furniture items, the undo/redo history and the
 * selection. Callers compute new item lists with the operations in `operations.ts`; the reducer
 * records them as undoable commands. Drags update items live and become one command on release.
 */
export interface EditorState {
  items: EditorItem[];
  history: History;
  selectedId?: string;
  drag?: { id: string; before: EditorItem };
  /** Bumped on every change to `items`, so autosave can tell edits from loads. */
  revision: number;
}

export type EditorAction =
  | { type: 'load'; items: EditorItem[] }
  /** Items reloaded from the server while nothing was pending: no undo entry, selection kept. */
  | { type: 'refresh'; items: EditorItem[] }
  /**
   * The server's copy of one item, not an edit: a created item's stable id and name (`from` is its
   * temporary id), or an item reloaded after a conflict (`item` undefined: it is gone).
   */
  | { type: 'synced'; from: string; item: EditorItem | undefined }
  | { type: 'select'; id?: string }
  | { type: 'edit'; label: string; items: EditorItem[]; selectedId?: string | null }
  | { type: 'dragStart'; id: string }
  | { type: 'dragMove'; item: EditorItem }
  | { type: 'dragEnd' }
  | { type: 'dragCancel' }
  | { type: 'undo' }
  | { type: 'redo' };

export const initialEditorState = (items: EditorItem[] = []): EditorState => ({
  items,
  history: emptyHistory,
  revision: 0,
});

const keepSelection = (items: EditorItem[], id: string | undefined) =>
  id !== undefined && items.some((i) => i.id === id) ? id : undefined;

const withSelection = (state: EditorState, selectedId: string | undefined): EditorState => {
  const next = { ...state };
  if (selectedId === undefined) delete next.selectedId;
  else next.selectedId = selectedId;
  return next;
};

const withoutDrag = (state: EditorState): EditorState => {
  const next = { ...state };
  delete next.drag;
  return next;
};

export function editorReducer(state: EditorState, action: EditorAction): EditorState {
  switch (action.type) {
    case 'load':
      return { items: action.items, history: emptyHistory, revision: 0 };

    case 'refresh':
      return withSelection(
        { ...withoutDrag(state), items: action.items, history: emptyHistory, revision: 0 },
        keepSelection(action.items, state.selectedId),
      );

    case 'synced': {
      const { from, item } = action;
      const at = state.items.findIndex((i) => i.id === from);
      const items =
        at < 0
          ? state.items
          : item
            ? state.items.map((i, k) => (k === at ? item : i))
            : state.items.filter((_, k) => k !== at);
      const to = item?.id ?? from;
      let next: EditorState = { ...state, items };
      if (item && from !== to) {
        next.history = remapId(state.history, from, to, { name: item.name });
        if (state.drag?.id === from)
          next.drag = { id: to, before: { ...state.drag.before, id: to } };
        if (state.selectedId === from) next = withSelection(next, to);
      } else if (item && item.name) {
        next.history = remapId(state.history, from, from, { name: item.name });
      }
      return withSelection(next, keepSelection(items, next.selectedId));
    }

    case 'select':
      return withSelection(state, keepSelection(state.items, action.id));

    case 'edit': {
      const command = diff(action.label, state.items, action.items);
      if (command.changes.length === 0) return state;
      const next: EditorState = {
        ...withoutDrag(state),
        items: action.items,
        history: record(state.history, command),
        revision: state.revision + 1,
      };
      const selected =
        action.selectedId === null ? undefined : (action.selectedId ?? state.selectedId);
      return withSelection(next, keepSelection(action.items, selected));
    }

    case 'dragStart': {
      const before = state.items.find((i) => i.id === action.id);
      if (!before) return state;
      return { ...withSelection(state, action.id), drag: { id: action.id, before } };
    }

    case 'dragMove': {
      if (state.drag?.id !== action.item.id) return state;
      return {
        ...state,
        items: state.items.map((i) => (i.id === action.item.id ? action.item : i)),
        revision: state.revision + 1,
      };
    }

    case 'dragEnd': {
      if (!state.drag) return state;
      const { before } = state.drag;
      const after = state.items.find((i) => i.id === before.id);
      const command = diff('Move', [before], after ? [after] : []);
      return { ...withoutDrag(state), history: record(state.history, command) };
    }

    case 'dragCancel': {
      if (!state.drag) return state;
      const { before } = state.drag;
      // A press that moved nothing (a long press) is not an edit: nothing to save.
      if (state.items.includes(before)) return withoutDrag(state);
      return {
        ...withoutDrag(state),
        items: state.items.map((i) => (i.id === before.id ? before : i)),
        revision: state.revision + 1,
      };
    }

    case 'undo':
    case 'redo': {
      if (state.drag) return state;
      const result = (action.type === 'undo' ? undo : redo)(state.history, state.items);
      if (!result) return state;
      return withSelection(
        { ...state, items: result.items, history: result.history, revision: state.revision + 1 },
        keepSelection(result.items, state.selectedId),
      );
    }
  }
}

export const canUndo = (s: EditorState) => s.history.past.length > 0 && !s.drag;
export const canRedo = (s: EditorState) => s.history.future.length > 0 && !s.drag;
