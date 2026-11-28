import { describe, expect, it } from 'vitest';
import { ACTIONS, actionFor, chordOf, keptByTarget, keyLabel } from './actions';

const press = (key: string, mods: Partial<KeyboardEvent> = {}) =>
  chordOf({ key, ctrlKey: false, metaKey: false, shiftKey: false, altKey: false, ...mods });

describe('the viewer’s actions (HUD v2 #204)', () => {
  it('reads a key press as a chord: letters by their printed character, symbols as typed', () => {
    expect(press('v')).toBe('v');
    expect(press('W', { shiftKey: true })).toBe('Shift+w');
    expect(press('?', { shiftKey: true })).toBe('?');
    expect(press('z', { ctrlKey: true })).toBe('Mod+z');
    expect(press('Z', { ctrlKey: true, shiftKey: true })).toBe('Mod+Shift+z');
    expect(press('Escape')).toBe('Escape');
    expect(press('Shift', { shiftKey: true })).toBeUndefined();
  });

  it('finds the action of a mode; one key can mean the same in modes that overlap', () => {
    expect(actionFor('v', 'orbit')?.id).toBe('views');
    expect(actionFor('v', 'edit')?.id).toBe('views');
    expect(actionFor('v', 'walk')).toBeUndefined();
    expect(actionFor('m', 'walk')?.id).toBe('map');
    expect(actionFor('n', 'edit')).toBeUndefined();
    expect(actionFor('Shift+w', 'orbit')?.id).toBe('walk');
    expect(actionFor('Escape', 'walk')?.id).toBe('escape');
    expect(actionFor('?', 'edit')?.id).toBe('help');
    // Duplicate is Shift+D; Ctrl+D is the browser's bookmark and nobody's here.
    expect(actionFor('Shift+d', 'edit')?.id).toBe('duplicate');
    expect(actionFor('Mod+d', 'edit')).toBeUndefined();
    expect(actionFor('Mod+Shift+z', 'edit')?.id).toBe('redo');
    expect(actionFor('Ctrl+y', 'edit')?.id).toBe('redo');
    // Delete, or Backspace: a Mac laptop has no forward Delete (#218 review).
    expect(actionFor('Delete', 'edit')?.id).toBe('delete');
    expect(actionFor('Backspace', 'edit')?.id).toBe('delete');
    expect(actionFor('Backspace', 'orbit')).toBeUndefined();
    // Held movement is the walk's own, never a command.
    expect(actionFor('w', 'walk')).toBeUndefined();
  });

  it('leaves the keys of fields, editable text and composition alone, also inside a shadow root', () => {
    const event = (target: EventTarget, init: KeyboardEventInit = {}) => {
      const e = new KeyboardEvent('keydown', { key: 'r', bubbles: true, composed: true, ...init });
      Object.defineProperty(e, 'composedPath', { value: () => [target] });
      return e;
    };
    expect(keptByTarget(event(document.createElement('input')))).toBe(true);
    expect(keptByTarget(event(document.createElement('textarea')))).toBe(true);
    const editable = document.createElement('div');
    editable.contentEditable = 'true';
    Object.defineProperty(editable, 'isContentEditable', { value: true });
    expect(keptByTarget(event(editable))).toBe(true);
    // A Sakuga element's own field: the composed path's first target is in its shadow root.
    const host = document.createElement('div');
    const inner = host.attachShadow({ mode: 'open' }).appendChild(document.createElement('input'));
    expect(keptByTarget(event(inner))).toBe(true);
    expect(keptByTarget(event(document.body, { isComposing: true }))).toBe(true);
    const checkbox = Object.assign(document.createElement('input'), { type: 'checkbox' });
    expect(keptByTarget(event(checkbox))).toBe(false);
    expect(keptByTarget(event(document.body))).toBe(false);
  });

  it('gives every action a name and keys for the help and the settings', () => {
    for (const a of ACTIONS) {
      expect(a.name.length, a.id).toBeGreaterThan(0);
      expect(a.keys.length, a.id).toBeGreaterThan(0);
    }
    expect(keyLabel('Mod+Shift+Z')).toBe('Ctrl+Shift+Z');
    expect(keyLabel('ArrowUp')).toBe('↑');
    expect(keyLabel('Shift+D')).toBe('Shift+D');
  });
});
