import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { vi } from 'vitest';
import type { HomeScene } from '../builder/buildHome';
import { visibleScene, type Visibility } from '../builder/visibility';
import { LANDSCAPE_QUERY, MOBILE_QUERY, type LayoutMode } from '../hud/useLayoutMode';

/**
 * jsdom has no `matchMedia` (the app then uses the desktop layout). This stubs it so the media
 * queries of `useLayoutMode` answer for the given kind of screen, and returns a function that
 * changes the screen and tells the listeners, like turning the phone or resizing the window
 * (await its `listening()` first). Undo it with `vi.unstubAllGlobals()`.
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
  const turn = (next: LayoutMode) => {
    // A turn nobody hears would leave the page as it was: fail here, not at the next assertion.
    if (listeners.size === 0)
      throw new Error('Nothing listens to the screen yet: await turn.listening()');
    act(() => {
      mode = next;
      for (const listener of listeners) listener();
    });
  };
  /**
   * Resolves once the page listens to the screen. `useSyncExternalStore` subscribes in an effect,
   * and after a render outside `act` (one that `findBy…` waited for) React may run that effect a
   * little after the page is in the DOM: on a busy machine, after the test has moved on.
   */
  const listening = () =>
    waitFor(() => {
      if (listeners.size === 0) throw new Error('Nothing listens to the screen yet');
    });
  return Object.assign(turn, { listening });
}

/** jsdom has no PointerEvent: a MouseEvent with a pointer id is what the handlers need. */
export function pointerEvent(
  type: string,
  x: number,
  y: number,
  pointerId = 1,
  /** `pointerType: 'mouse'` with `buttons` for what only a mouse does (moving with no button down). */
  extra: { pointerType?: string; buttons?: number } = {},
) {
  const event = new MouseEvent(type, {
    bubbles: true,
    cancelable: true,
    clientX: x,
    clientY: y,
    buttons: extra.buttons ?? 0,
  });
  Object.defineProperty(event, 'pointerId', { value: pointerId });
  if (extra.pointerType) Object.defineProperty(event, 'pointerType', { value: extra.pointerType });
  return event;
}

/**
 * What a mocked `Scene` would draw: it is handed the whole home with a visibility, and hides
 * per batch.
 */
export const shownScene = (props: { scene: HomeScene; visibility?: Visibility | undefined }) =>
  props.visibility ? visibleScene(props.scene, props.visibility) : props.scene;

/** Open the level chip and return the existing segmented selector. */
export function openLevelPicker() {
  const trigger = screen.getByRole('button', { name: /^Level: / });
  if (trigger.getAttribute('aria-expanded') !== 'true') fireEvent.click(trigger);
  return within(screen.getByRole('radiogroup', { name: 'Show up to level' }));
}
