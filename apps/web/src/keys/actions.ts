/**
 * The viewer's actions and their keys (HUD v2 #204, docs/design/hud-v2/hotkeys.md): one list for the shortcuts, the help
 * in Tools and, later, the keyboard settings (#205). An action has a stable id, a name, the modes it belongs to and its
 * default chords; the viewer decides whether it is available and runs it, as its visible control does.
 */

/** The mode the viewer is in; `viewer` actions work in all of them. */
export type Context = 'viewer' | 'orbit' | 'walk' | 'edit';

export type ActionId =
  | 'help'
  | 'escape'
  | 'views'
  | 'map'
  | 'north'
  | 'walk'
  | 'forward'
  | 'back'
  | 'strafe-left'
  | 'strafe-right'
  | 'turn-left'
  | 'turn-right'
  | 'rotate'
  | 'rotate-back'
  | 'duplicate'
  | 'delete'
  | 'undo'
  | 'redo';

export interface Action {
  id: ActionId;
  /** Its accessible name, in the help and on hints. */
  name: string;
  /** The help's group. */
  group: 'Viewer' | 'Orbit' | 'Walk' | 'Edit';
  contexts: readonly Context[];
  /** `hold`: movement, held down (useWalk reads it); `press`: one command per press. */
  kind: 'press' | 'hold';
  /**
   * Its chords: `Shift+D`, `Mod+Z` (Ctrl, or Cmd on a Mac), `Ctrl+Y`, `Escape`, `ArrowUp`; a letter is its printed
   * character, lower case; `?` is the character, whatever the layout needs to type it.
   */
  keys: readonly string[];
}

export const ACTIONS: readonly Action[] = [
  {
    id: 'help',
    name: 'Keyboard shortcuts',
    group: 'Viewer',
    contexts: ['viewer'],
    kind: 'press',
    keys: ['?'],
  },
  {
    id: 'escape',
    name: 'Close what is open, cancel, deselect or leave Walk',
    group: 'Viewer',
    contexts: ['viewer'],
    kind: 'press',
    keys: ['Escape'],
  },
  {
    id: 'views',
    name: 'Open Views',
    group: 'Orbit',
    contexts: ['orbit', 'edit'],
    kind: 'press',
    keys: ['v'],
  },
  {
    id: 'map',
    name: 'Open or close the map',
    group: 'Orbit',
    contexts: ['orbit', 'walk'],
    kind: 'press',
    keys: ['m'],
  },
  {
    id: 'north',
    name: 'Turn the view north-up',
    group: 'Orbit',
    contexts: ['orbit'],
    kind: 'press',
    keys: ['n'],
  },
  {
    id: 'walk',
    name: 'Enter Walk',
    group: 'Orbit',
    contexts: ['orbit'],
    kind: 'press',
    keys: ['Shift+W'],
  },
  {
    id: 'forward',
    name: 'Walk forward',
    group: 'Walk',
    contexts: ['walk'],
    kind: 'hold',
    keys: ['w', 'ArrowUp'],
  },
  {
    id: 'back',
    name: 'Walk back',
    group: 'Walk',
    contexts: ['walk'],
    kind: 'hold',
    keys: ['s', 'ArrowDown'],
  },
  {
    id: 'strafe-left',
    name: 'Step left',
    group: 'Walk',
    contexts: ['walk'],
    kind: 'hold',
    keys: ['a'],
  },
  {
    id: 'strafe-right',
    name: 'Step right',
    group: 'Walk',
    contexts: ['walk'],
    kind: 'hold',
    keys: ['d'],
  },
  {
    id: 'turn-left',
    name: 'Turn left',
    group: 'Walk',
    contexts: ['walk'],
    kind: 'hold',
    keys: ['q', 'ArrowLeft'],
  },
  {
    id: 'turn-right',
    name: 'Turn right',
    group: 'Walk',
    contexts: ['walk'],
    kind: 'hold',
    keys: ['e', 'ArrowRight'],
  },
  {
    id: 'rotate',
    name: 'Rotate the selected item',
    group: 'Edit',
    contexts: ['edit'],
    kind: 'press',
    keys: ['r'],
  },
  {
    id: 'rotate-back',
    name: 'Rotate it back',
    group: 'Edit',
    contexts: ['edit'],
    kind: 'press',
    keys: ['Shift+R'],
  },
  {
    id: 'duplicate',
    name: 'Duplicate it',
    group: 'Edit',
    contexts: ['edit'],
    kind: 'press',
    keys: ['Shift+D'],
  },
  {
    id: 'delete',
    name: 'Delete it',
    group: 'Edit',
    contexts: ['edit'],
    kind: 'press',
    keys: ['Delete'],
  },
  { id: 'undo', name: 'Undo', group: 'Edit', contexts: ['edit'], kind: 'press', keys: ['Mod+Z'] },
  {
    id: 'redo',
    name: 'Redo',
    group: 'Edit',
    contexts: ['edit'],
    kind: 'press',
    keys: ['Mod+Shift+Z', 'Ctrl+Y'],
  },
];

const isMac = () =>
  typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform ?? '');

/** The chord a key press makes, in the list's terms; undefined for a lone modifier. */
export function chordOf(
  e: Pick<KeyboardEvent, 'key' | 'ctrlKey' | 'metaKey' | 'shiftKey' | 'altKey'>,
): string | undefined {
  if (['Shift', 'Control', 'Meta', 'Alt', 'AltGraph', 'CapsLock'].includes(e.key)) return undefined;
  const printed = e.key.length === 1;
  const mod = isMac() ? e.metaKey : e.ctrlKey;
  const parts: string[] = [];
  if (mod) parts.push('Mod');
  else if (e.ctrlKey) parts.push('Ctrl');
  if (e.altKey) parts.push('Alt');
  // A printed symbol is typed with whatever Shift it needs ("?"); a letter with Shift is its own chord.
  const letter = printed && /\p{L}/u.test(e.key);
  if (e.shiftKey && (!printed || letter)) parts.push('Shift');
  parts.push(printed ? e.key.toLowerCase() : e.key);
  return parts.join('+');
}

/** Whether `chord` (a key press's) is one of an action's: `Mod` and Ctrl stand for each other off a Mac. */
export function matches(action: Action, chord: string): boolean {
  // Off a Mac, Mod is Ctrl: both sides are read that way (Ctrl+Y and Mod+Z alike).
  const plain = (c: string) => (isMac() ? c : c.replace(/^Mod\+/, 'Ctrl+'));
  return action.keys.some((k) => {
    const key = k
      .replace(/\+([A-Z])$/, (_, c: string) => `+${c.toLowerCase()}`)
      .replace(/^([A-Z])$/, (c) => c.toLowerCase());
    return plain(key) === plain(chord);
  });
}

/** The action of a key press in a mode, if one is bound to it there. */
export function actionFor(chord: string, context: Exclude<Context, 'viewer'>): Action | undefined {
  return ACTIONS.find(
    (a) =>
      a.kind === 'press' &&
      (a.contexts.includes('viewer') || a.contexts.includes(context)) &&
      matches(a, chord),
  );
}

/** The held keys' names (`w`, `arrowup`), for the walk's own movement. */
export const holdKeys = (id: ActionId): string[] =>
  ACTIONS.find((a) => a.id === id)!.keys.map((k) => k.toLowerCase());

/**
 * Keys a viewer shortcut must leave alone: typing in a field (also a field inside a Sakuga element's shadow root),
 * editable content, composing text (an input method), and a key already taken by what has the focus.
 */
export function keptByTarget(e: KeyboardEvent): boolean {
  if (e.isComposing || e.defaultPrevented) return true;
  const target = (e.composedPath?.()[0] ?? e.target) as HTMLElement | null;
  if (!target || typeof target.tagName !== 'string') return false;
  if (target.isContentEditable) return true;
  if (target.tagName === 'TEXTAREA' || target.tagName === 'SELECT') return true;
  return (
    target.tagName === 'INPUT' &&
    !['checkbox', 'radio', 'button', 'range', 'file'].includes((target as HTMLInputElement).type)
  );
}

/** How a chord is written for a person: `Ctrl+Z` (`⌘Z` on a Mac), `Shift+D`, `↑`, `?`. */
export function keyLabel(chord: string): string {
  const arrows: Record<string, string> = {
    ArrowUp: '↑',
    ArrowDown: '↓',
    ArrowLeft: '←',
    ArrowRight: '→',
  };
  return chord
    .split('+')
    .map((p) =>
      p === 'Mod'
        ? isMac()
          ? '⌘'
          : 'Ctrl'
        : (arrows[p] ?? (p.length === 1 ? p.toUpperCase() : p)),
    )
    .join(isMac() && chord.startsWith('Mod+') ? '' : '+');
}
