import { act } from '@testing-library/react';
import { vi } from 'vitest';
import { LANDSCAPE_QUERY, MOBILE_QUERY, type LayoutMode } from '../overlay/useLayoutMode';

/**
 * jsdom has no `matchMedia` (the app then uses the desktop layout). This stubs it so the media
 * queries of `useLayoutMode` answer for the given kind of screen, and returns a function that
 * changes the screen and tells the listeners, like turning the phone or resizing the window.
 * Undo it with `vi.unstubAllGlobals()`.
 */
export function stubScreen(initial: LayoutMode) {
  let mode = initial;
  const listeners = new Set<() => void>();
  const matches = (query: string) =>
    query === MOBILE_QUERY
      ? mode !== 'desktop'
      : query === LANDSCAPE_QUERY
        ? mode === 'landscape'
        : false;
  vi.stubGlobal('matchMedia', (query: string) => ({
    media: query,
    get matches() {
      return matches(query);
    },
    addEventListener: (_type: string, listener: () => void) => listeners.add(listener),
    removeEventListener: (_type: string, listener: () => void) => listeners.delete(listener),
  }));
  return (next: LayoutMode) =>
    act(() => {
      mode = next;
      for (const listener of listeners) listener();
    });
}

/** jsdom has no PointerEvent: a MouseEvent with a pointer id is what the handlers need. */
export function pointerEvent(type: string, x: number, y: number, pointerId = 1) {
  const event = new MouseEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y });
  Object.defineProperty(event, 'pointerId', { value: pointerId });
  return event;
}
