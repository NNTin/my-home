import { useEffect } from 'react';

/** The on-screen keyboard is taken to be open when this share of the height is gone. */
const KEYBOARD_SHARE = 0.75;

/**
 * Keeps the app inside what is visible while the on-screen keyboard is open, so a field in the
 * sheet is never typed into blind. Where the browser only shrinks the *visual* viewport (iOS),
 * the page stays as high as before and the keyboard lies over its lower part: the visible height
 * goes into `--app-height`, and `keyboard-open` on the root element lets the stylesheet give the
 * open sheet all of it. Writes to the DOM only; nothing re-renders while the keyboard moves.
 */
export function useKeyboardViewport(enabled: boolean) {
  useEffect(() => {
    const viewport = window.visualViewport;
    const root = document.documentElement;
    if (!enabled || !viewport) return;
    // The full height for the current width; a new width (the phone was turned) starts over.
    let full = { width: viewport.width, height: viewport.height };
    const update = () => {
      if (viewport.width !== full.width || viewport.height > full.height)
        full = { width: viewport.width, height: viewport.height };
      const open = viewport.height < full.height * KEYBOARD_SHARE;
      root.classList.toggle('keyboard-open', open);
      if (open) root.style.setProperty('--app-height', `${Math.round(viewport.height)}px`);
      else root.style.removeProperty('--app-height');
      if (!open) return;
      // The browser may have scrolled the page to reveal the field; the app does not scroll.
      window.scrollTo(0, 0);
      const field = document.activeElement;
      if (field instanceof HTMLElement && field.closest('.sheet'))
        field.scrollIntoView?.({ block: 'nearest' });
    };
    update();
    viewport.addEventListener('resize', update);
    viewport.addEventListener('scroll', update);
    return () => {
      viewport.removeEventListener('resize', update);
      viewport.removeEventListener('scroll', update);
      root.classList.remove('keyboard-open');
      root.style.removeProperty('--app-height');
    };
  }, [enabled]);
}
