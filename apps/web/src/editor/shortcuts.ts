export type ShortcutAction =
  'rotate' | 'rotate-back' | 'delete' | 'duplicate' | 'undo' | 'redo' | 'deselect';

interface KeyLike {
  key: string;
  ctrlKey: boolean;
  metaKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
  target?: EventTarget | null;
}

/** Text fields keep their own keys (typing "r" in a layout name must not rotate an item). */
const isTextInput = (target: EventTarget | null | undefined) => {
  if (!target || typeof (target as HTMLElement).tagName !== 'string') return false;
  const el = target as HTMLElement;
  if (el.isContentEditable) return true;
  if (el.tagName === 'TEXTAREA' || el.tagName === 'SELECT') return true;
  return (
    el.tagName === 'INPUT' &&
    !['checkbox', 'radio', 'button'].includes((el as HTMLInputElement).type)
  );
};

/**
 * Editor shortcuts: `R` / `Shift+R` rotate, `Delete` / `Backspace` delete, `Ctrl+D` duplicate,
 * `Ctrl+Z` undo, `Ctrl+Shift+Z` / `Ctrl+Y` redo, `Escape` deselect (`Cmd` on macOS).
 */
export function shortcutFor(e: KeyLike): ShortcutAction | undefined {
  if (isTextInput(e.target) || e.altKey) return undefined;
  const mod = e.ctrlKey || e.metaKey;
  const key = e.key.toLowerCase();
  if (mod) {
    if (key === 'z') return e.shiftKey ? 'redo' : 'undo';
    if (key === 'y') return 'redo';
    if (key === 'd') return 'duplicate';
    return undefined;
  }
  if (key === 'r') return e.shiftKey ? 'rotate-back' : 'rotate';
  if (key === 'delete' || key === 'backspace') return 'delete';
  if (key === 'escape') return 'deselect';
  return undefined;
}
