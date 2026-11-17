import { useState } from 'react';

/** Set once the hints were dismissed in this browser. */
export const HINTS_SEEN_KEY = 'my-home.hints.seen';

/** `?hints=off` opens the viewer without them (screenshots, tests), without marking them seen. */
const switchedOff = () => new URLSearchParams(window.location.search).get('hints') === 'off';

function seen(): boolean {
  try {
    return window.localStorage.getItem(HINTS_SEEN_KEY) !== null;
  } catch {
    // Storage may be blocked; then the hints simply show again next time.
    return false;
  }
}

/**
 * First-run hints on a phone: how to move the view, where the panels are and how to start
 * walking. Shown once per browser, until dismissed.
 */
export function Hints({ side }: { side: boolean }) {
  const [open, setOpen] = useState(() => !switchedOff() && !seen());
  if (!open) return null;
  const dismiss = () => {
    setOpen(false);
    try {
      window.localStorage.setItem(HINTS_SEEN_KEY, new Date().toISOString());
    } catch {
      // Not remembered, then.
    }
  };
  return (
    <aside className="hints" aria-label="How to use the viewer">
      <ul>
        <li>
          <span aria-hidden="true">☝️</span> Drag to turn the view. Pinch to zoom, and drag with two
          fingers to move it.
        </li>
        <li>
          <span aria-hidden="true">🗂</span> Tap a tab {side ? 'at the side' : 'below'} to open a
          panel, and tap it again to close it.
        </li>
        <li>
          <span aria-hidden="true">🚶</span> <strong>Walk</strong> lets you walk through the home
          and take photos.
        </li>
      </ul>
      <button type="button" onClick={dismiss}>
        Got it
      </button>
    </aside>
  );
}
