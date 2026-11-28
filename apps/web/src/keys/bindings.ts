import { useSyncExternalStore } from 'react';
import {
  actionFor,
  ACTIONS,
  keyLabel,
  matchesKeys,
  normalizeChord,
  type Action,
  type ActionId,
  type Context,
} from './actions';

/**
 * The bindings that apply (HUD v2 #205, hotkeys.md § Discovery and configuration): each action's two slots, its
 * defaults unless this browser changed them. Saved per browser, versioned; a slot cleared on purpose (`null`) stays
 * distinct from one never touched (absent). A bad or unknown saved entry falls back to its default and costs no other.
 */

export const BINDINGS_KEY = 'my-home.keys';
const VERSION = 1;
/** Two slots per action, so an arrow or a platform alternate can stay. */
export const SLOTS = 2;

type Saved = Partial<Record<ActionId, (string | null)[]>>;

/** Escape's cancel is fixed: it never moves (hotkeys.md). */
export const FIXED: ReadonlySet<ActionId> = new Set(['escape']);

let saved: Saved = load();
/** Storage refused (private mode, full): changes last for this visit. */
export let persistent = true;
let version = 0;
const listeners = new Set<() => void>();

function load(): Saved {
  try {
    const raw = JSON.parse(localStorage.getItem(BINDINGS_KEY) ?? 'null') as {
      v?: number;
      bindings?: Record<string, unknown>;
    } | null;
    if (!raw || raw.v !== VERSION || typeof raw.bindings !== 'object' || !raw.bindings) return {};
    const out: Saved = {};
    for (const action of ACTIONS) {
      const slots = raw.bindings[action.id];
      // Each entry on its own: a bad one is the default again, the others stay.
      if (!Array.isArray(slots) || slots.length > SLOTS || FIXED.has(action.id)) continue;
      if (!slots.every((s) => s === null || (typeof s === 'string' && !reserved(s)))) continue;
      out[action.id] = slots as (string | null)[];
    }
    return out;
  } catch {
    return {};
  }
}

function save() {
  try {
    localStorage.setItem(BINDINGS_KEY, JSON.stringify({ v: VERSION, bindings: saved }));
    persistent = true;
  } catch {
    persistent = false;
  }
  version++;
  for (const listener of listeners) listener();
}

/** An action's slots as they apply: the saved ones, or its defaults. `null`: empty. */
export function slotsOf(id: ActionId): (string | null)[] {
  const action = ACTIONS.find((a) => a.id === id)!;
  const own = saved[id];
  const defaults = action.keys.map(normalizeChord);
  return Array.from({ length: SLOTS }, (_, i) => (own ? (own[i] ?? null) : (defaults[i] ?? null)));
}

/** An action's chords that apply now. */
export const bindingsOf = (id: ActionId): string[] =>
  slotsOf(id).filter((c): c is string => c !== null);

/** Whether this browser changed an action's keys. */
export const customized = (id: ActionId) => saved[id] !== undefined;

/**
 * Keys a binding may not take: a lone modifier, Tab, Enter, Space, Escape (the fixed cancel), Alt chords (menus,
 * layouts' characters), the browser's own chords and the function keys.
 */
const BROWSER = new Set([
  'a',
  'c',
  'd',
  'f',
  'l',
  'n',
  'o',
  'p',
  'q',
  'r',
  's',
  't',
  'v',
  'w',
  'x',
  'tab',
  'shift+t',
  'shift+n',
  'shift+tab',
]);
export function reserved(chord: string): boolean {
  if (['Tab', 'Shift+Tab', 'Enter', ' ', 'Escape', 'Shift+Escape'].includes(chord)) return true;
  if (/(^|\+)Alt\+/.test(chord) || /^F\d+$/.test(chord.replace(/^.*\+/, ''))) return true;
  const mod = /^(Mod|Ctrl)\+(.+)$/.exec(chord);
  return mod !== null && BROWSER.has(mod[2]!.toLowerCase());
}

/** Two actions can be active together: their modes meet, or one works everywhere. */
const overlap = (a: Action, b: Action) =>
  a.contexts.includes('viewer') ||
  b.contexts.includes('viewer') ||
  a.contexts.some((c: Context) => b.contexts.includes(c));

/** The other action that already has `chord` where `id` would use it; none: free to take. */
export function conflictFor(id: ActionId, chord: string): Action | undefined {
  const me = ACTIONS.find((a) => a.id === id)!;
  return ACTIONS.find((a) => a.id !== id && overlap(me, a) && bindingsOf(a.id).includes(chord));
}

/**
 * Sets a slot (`null` clears it). With `taking`, the other action's slot with the same chord is cleared in the same
 * write: a reassignment is one change, never half of one.
 */
export function setSlot(id: ActionId, slot: number, chord: string | null, taking?: ActionId) {
  if (FIXED.has(id) || (chord !== null && reserved(chord))) return;
  const next: Saved = { ...saved, [id]: slotsOf(id).map((c, i) => (i === slot ? chord : c)) };
  if (taking && chord !== null) next[taking] = slotsOf(taking).map((c) => (c === chord ? null : c));
  saved = next;
  save();
}

/**
 * Back to its defaults. If a default is another action's now, nothing changes and that action is returned, unless
 * `reassign`: then its slot is cleared as the defaults come back, in one change.
 */
export function resetAction(id: ActionId, reassign = false): Action | undefined {
  const defaults = ACTIONS.find((a) => a.id === id)!.keys.map(normalizeChord);
  const rest: Saved = { ...saved };
  delete rest[id];
  const clashes = defaults.flatMap((c) => {
    const other = conflictFor(id, c);
    return other ? [[other, c] as const] : [];
  });
  if (clashes.length && !reassign) return clashes[0]![0];
  const next = rest;
  for (const [other, chord] of clashes)
    next[other.id] = slotsOf(other.id).map((c) => (c === chord ? null : c));
  saved = next;
  save();
  return undefined;
}

/** Every action back to its defaults. */
export function restoreAll() {
  saved = {};
  save();
}

/** Whether any action was changed (a full reset asks first then). */
export const anyCustomized = () => Object.keys(saved).length > 0;

/** For tests: read the storage again. */
export function reloadBindings() {
  saved = load();
  version++;
  for (const listener of listeners) listener();
}

/** Re-renders on a change of the bindings. */
export function useBindings(): number {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => version,
    () => version,
  );
}

/** The action a key press runs in a mode, by the bindings that apply. */
export const boundAction = (chord: string, context: Exclude<Context, 'viewer'>) =>
  actionFor(chord, context, (a) => bindingsOf(a.id));

/** The held movement action of a key (Walk), by the bindings that apply. */
export const heldAction = (chord: string): ActionId | undefined =>
  ACTIONS.find((a) => a.kind === 'hold' && matchesKeys(bindingsOf(a.id), chord))?.id;

/** The current binding written for a control's hint: " (V)"; nothing when it has none. */
export function hint(id: ActionId): string {
  const first = bindingsOf(id)[0];
  return first ? ` (${keyLabel(first)})` : '';
}
