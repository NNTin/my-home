import { useCallback, useSyncExternalStore } from 'react';

/**
 * How the viewer lays out its controls: `desktop` keeps the two floating panels; a phone gets
 * the full-screen view with a top bar and a sheet, at the bottom when held upright (`portrait`)
 * and at the side when held across (`landscape`).
 */
export type LayoutMode = 'desktop' | 'portrait' | 'landscape';

/**
 * Small or touch-first screens. A phone held across is wider than 768 px, so a low screen counts
 * too, also without a touch screen (a small browser window, a screenshot at 844x390).
 */
export const MOBILE_QUERY = '(max-width: 768px), (max-height: 500px), (pointer: coarse)';
export const LANDSCAPE_QUERY = '(orientation: landscape)';

/** Whether a media query matches, following changes. False where `matchMedia` is missing. */
export function useMediaQuery(query: string): boolean {
  const subscribe = useCallback(
    (onChange: () => void) => {
      const list = window.matchMedia?.(query);
      list?.addEventListener('change', onChange);
      return () => list?.removeEventListener('change', onChange);
    },
    [query],
  );
  return useSyncExternalStore(subscribe, () => window.matchMedia?.(query).matches ?? false);
}

export function useLayoutMode(): LayoutMode {
  const mobile = useMediaQuery(MOBILE_QUERY);
  const landscape = useMediaQuery(LANDSCAPE_QUERY);
  if (!mobile) return 'desktop';
  return landscape ? 'landscape' : 'portrait';
}
