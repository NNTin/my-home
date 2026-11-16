import { describe, expect, it } from 'vitest';
import { shortcutFor } from './shortcuts';

const key = (
  k: string,
  mods: Partial<Record<'ctrlKey' | 'metaKey' | 'shiftKey' | 'altKey', boolean>> = {},
  target?: EventTarget,
) =>
  shortcutFor({
    key: k,
    ctrlKey: false,
    metaKey: false,
    shiftKey: false,
    altKey: false,
    target,
    ...mods,
  });

describe('shortcutFor', () => {
  it('maps the editor shortcuts', () => {
    expect(key('r')).toBe('rotate');
    expect(key('R', { shiftKey: true })).toBe('rotate-back');
    expect(key('Delete')).toBe('delete');
    expect(key('Backspace')).toBe('delete');
    expect(key('z', { ctrlKey: true })).toBe('undo');
    expect(key('Z', { ctrlKey: true, shiftKey: true })).toBe('redo');
    expect(key('y', { ctrlKey: true })).toBe('redo');
    expect(key('z', { metaKey: true })).toBe('undo');
    expect(key('d', { ctrlKey: true })).toBe('duplicate');
    expect(key('Escape')).toBe('deselect');
    expect(key('x')).toBeUndefined();
    expect(key('r', { ctrlKey: true })).toBeUndefined();
  });

  it('leaves text fields alone', () => {
    const input = document.createElement('input');
    expect(key('r', {}, input)).toBeUndefined();
    expect(key('z', { ctrlKey: true }, document.createElement('textarea'))).toBeUndefined();
    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    expect(key('r', {}, checkbox)).toBe('rotate');
  });
});
