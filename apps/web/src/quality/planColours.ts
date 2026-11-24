import { useCallback, useState } from 'react';

/**
 * "Plan colours" (docs/design/realistic-render.md §5.5): room floors in the pastel colours that
 * tell rooms apart, instead of their finishes. A view option, off by default and remembered on
 * this device.
 */

/** `localStorage` key of the value chosen on this device. */
export const PLAN_COLOURS_KEY = 'my-home.plan-colours';

function stored(): boolean {
  try {
    return window.localStorage.getItem(PLAN_COLOURS_KEY) === 'on';
  } catch {
    return false;
  }
}

/** Whether plan colours are on, and the action of the View panel's switch. */
export function usePlanColours(): [boolean, (on: boolean) => void] {
  const [on, setOn] = useState(stored);
  const choose = useCallback((value: boolean) => {
    setOn(value);
    try {
      window.localStorage.setItem(PLAN_COLOURS_KEY, value ? 'on' : 'off');
    } catch {
      // Storage is off: the choice lasts for this visit.
    }
  }, []);
  return [on, choose];
}
