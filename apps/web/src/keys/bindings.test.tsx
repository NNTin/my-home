import { fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { KeyboardShortcuts } from '../overlay/KeyboardShortcuts';
import { chordOf } from './actions';
import {
  BINDINGS_KEY,
  bindingsOf,
  boundAction,
  conflictFor,
  heldAction,
  persistent,
  reloadBindings,
  resetAction,
  restoreAll,
  setSlot,
  slotsOf,
} from './bindings';

afterEach(() => {
  vi.restoreAllMocks();
  localStorage.clear();
  reloadBindings();
});

const stored = () => JSON.parse(localStorage.getItem(BINDINGS_KEY) ?? 'null');

describe('the keys that apply (HUD v2 #205)', () => {
  it('starts from the defaults; a change is saved per browser and survives a reload', () => {
    expect(bindingsOf('views')).toEqual(['v']);
    setSlot('views', 1, 'b');
    expect(bindingsOf('views')).toEqual(['v', 'b']);
    expect(stored()).toEqual({ v: 1, bindings: { views: ['v', 'b'] } });
    reloadBindings();
    expect(boundAction('b', 'orbit')?.id).toBe('views');
  });

  it('keeps a slot cleared on purpose apart from one never touched', () => {
    setSlot('delete', 1, null);
    reloadBindings();
    expect(slotsOf('delete')).toEqual(['Delete', null]);
    expect(boundAction('Backspace', 'edit')).toBeUndefined();
    // Restored: the defaults again.
    restoreAll();
    expect(slotsOf('delete')).toEqual(['Delete', 'Backspace']);
  });

  it('falls back to the default for a bad saved entry, keeping the good ones; another version is ignored', () => {
    localStorage.setItem(
      BINDINGS_KEY,
      JSON.stringify({
        v: 1,
        bindings: { views: [42], map: ['k'], north: ['Mod+t'], escape: ['x'] },
      }),
    );
    reloadBindings();
    expect(bindingsOf('views')).toEqual(['v']);
    expect(bindingsOf('map')).toEqual(['k']);
    // A reserved key and the fixed Escape are never taken from storage.
    expect(bindingsOf('north')).toEqual(['n']);
    expect(bindingsOf('escape')).toEqual(['Escape']);
    localStorage.setItem(BINDINGS_KEY, JSON.stringify({ v: 99, bindings: { map: ['k'] } }));
    reloadBindings();
    expect(bindingsOf('map')).toEqual(['m']);
  });

  it('lasts for the visit when the browser cannot keep it', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('full');
    });
    setSlot('views', 0, 'b');
    expect(bindingsOf('views')).toEqual(['b']);
    expect(persistent).toBe(false);
  });

  it("refuses the browser's and the page's keys, and Escape's cancel never moves", () => {
    for (const chord of ['Mod+t', 'Mod+w', 'Tab', 'Enter', 'Escape', 'Alt+x', 'F5']) {
      setSlot('views', 0, chord);
      expect(bindingsOf('views'), chord).toEqual(['v']);
    }
    setSlot('escape', 0, 'x');
    expect(bindingsOf('escape')).toEqual(['Escape']);
  });

  it('finds a clash only where both actions can be active; reassigning is one change', () => {
    expect(conflictFor('views', 'm')?.id).toBe('map');
    // Rotate (Edit) may reuse N (north-up, Orbit only): never active together.
    expect(conflictFor('rotate', 'n')).toBeUndefined();
    setSlot('rotate', 1, 'n');
    expect(boundAction('n', 'edit')?.id).toBe('rotate');
    expect(boundAction('n', 'orbit')?.id).toBe('north');
    setSlot('views', 0, 'm', 'map');
    expect(bindingsOf('views')).toEqual(['m']);
    expect(bindingsOf('map')).toEqual([]);
    expect(stored().bindings).toMatchObject({ views: ['m', null], map: [null, null] });
  });

  it('asks before a reset takes a default another action has now, then takes it in one change', () => {
    setSlot('map', 0, 'v', 'views');
    expect(resetAction('views')?.id).toBe('map');
    expect(bindingsOf('views')).toEqual([]);
    expect(resetAction('views', true)).toBeUndefined();
    expect(bindingsOf('views')).toEqual(['v']);
    expect(bindingsOf('map')).toEqual([]);
  });

  it('reads keys by their printed character, whatever the layout (QWERTZ, AZERTY)', () => {
    // QWERTZ: the key printed Z is where Y is on QWERTY; Ctrl and the printed Z undo.
    expect(
      boundAction(
        chordOf({ key: 'z', ctrlKey: true, metaKey: false, shiftKey: false, altKey: false })!,
        'edit',
      )?.id,
    ).toBe('undo');
    // AZERTY: Z walks forward only once bound to it; the printed key counts, not its place.
    setSlot('forward', 0, 'z');
    expect(heldAction('z')).toBe('forward');
    expect(heldAction('w')).toBeUndefined();
  });
});

describe('Tools → Keyboard shortcuts (HUD v2 #205)', () => {
  it('records a key on a slot, refuses a reserved one, offers retry or reassignment on a clash, clears and restores', () => {
    render(<KeyboardShortcuts open />);
    const slot = (name: RegExp) => screen.getByRole('button', { name });
    // Record B as Views' second key.
    fireEvent.click(slot(/^Open Views, key 2/));
    expect(slot(/^Open Views, key 2/)).toHaveTextContent('Press a key…');
    fireEvent.keyDown(slot(/^Open Views, key 2/), { key: 'b' });
    expect(bindingsOf('views')).toEqual(['v', 'b']);
    // Escape cancels a capture; Ctrl+T is refused.
    fireEvent.click(slot(/^Open Views, key 1/));
    fireEvent.keyDown(slot(/^Open Views, key 1/), { key: 't', ctrlKey: true });
    expect(screen.getByRole('alert')).toHaveTextContent("browser's");
    fireEvent.keyDown(slot(/^Open Views, key 1/), { key: 'Escape' });
    expect(bindingsOf('views')).toEqual(['v', 'b']);
    // M is the map's: retry or reassign.
    fireEvent.click(slot(/^Open Views, key 1/));
    fireEvent.keyDown(slot(/^Open Views, key 1/), { key: 'm' });
    const clash = screen.getByRole('alert');
    expect(clash).toHaveTextContent('Open or close the map');
    fireEvent.click(within(clash).getByRole('button', { name: 'Reassign' }));
    expect(bindingsOf('views')).toEqual(['m', 'b']);
    expect(bindingsOf('map')).toEqual([]);
    // Clear a slot; restore all asks first when something was changed.
    fireEvent.click(screen.getByRole('button', { name: 'Clear Open Views, key 2' }));
    expect(bindingsOf('views')).toEqual(['m']);
    fireEvent.click(screen.getByRole('button', { name: 'Restore all defaults' }));
    fireEvent.click(within(screen.getByRole('alert')).getByRole('button', { name: 'Restore' }));
    expect(bindingsOf('views')).toEqual(['v']);
    expect(bindingsOf('map')).toEqual(['m']);
  });
});
