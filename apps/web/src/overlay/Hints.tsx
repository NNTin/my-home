import { useState } from 'react';
import { HudIcon } from '../hud/HudIcon';
import { SkButton } from '../hud/SkButton';

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
    // At once: "Got it" is a primary, and its front effects (ドン, the clouds) play on over the view. The panel's
    // shrink-away comes with sakuga-panel (docs/design/hud.md §5.4); Sakuga's clock is too slow on a slow device
    // to time the closing by (B19).
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
          <HudIcon name="view" /> Drag to turn the view. Pinch to zoom, and drag with two fingers to
          move it.
        </li>
        <li>
          <HudIcon name="more" /> Tap a tab {side ? 'at the side' : 'below'} to open a panel, and
          tap it again to close it.
        </li>
        <li>
          <HudIcon name="walk" /> <strong>Walk</strong> lets you walk through the home and take
          photos.
        </li>
      </ul>
      <SkButton size="compact" className="hints-ok" onClick={dismiss}>
        Got it
      </SkButton>
    </aside>
  );
}
