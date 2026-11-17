import type { LayoutItem } from '@my-home/shared';
import { diff, emptyHistory, record, redo, undo, type History } from './history';

/**
 * Editor state as a pure reducer: the items of the open layout, the undo/redo history and the
 * selection. Callers compute new item lists with the operations in `operations.ts`; the reducer
 * records them as undoable commands. Drags update items live and become one command on release.
 */
export interface EditorState {
  items: LayoutItem[];
  history: History;
  selectedId?: string;
  drag?: { id: string; before: LayoutItem };
  /** Bumped on every change to `items`, so autosave can tell edits from loads. */
  revision: number;
}

export type EditorAction =
  | { type: 'load'; items: LayoutItem[] }
  | { type: 'select'; id?: string }
  | { type: 'edit'; label: string; items: LayoutItem[]; selectedId?: string | null }
  | { type: 'dragStart'; id: string }
  | { type: 'dragMove'; item: LayoutItem }
  | { type: 'dragEnd' }
  | { type: 'dragCancel' }
  | { type: 'undo' }
  | { type: 'redo' };

export const initialEditorState = (items: LayoutItem[] = []): EditorState => ({
  items,
  history: emptyHistory,
  revision: 0,
});

const keepSelection = (items: LayoutItem[], id: string | undefined) =>
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
