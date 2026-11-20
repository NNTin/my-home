import { useCallback, useState } from 'react';

/**
 * The quality setting (docs/design/realistic-render.md §3.2): which tier is drawn when. `fast`
 * always draws fast frames, `auto` fast frames while the view moves and one beautiful frame at
 * rest, `beautiful` beautiful frames always. Until the beautiful tier exists (#111) every value
 * draws the fast tier.
 */
export const QUALITIES = ['fast', 'auto', 'beautiful'] as const;
export type Quality = (typeof QUALITIES)[number];

/** `localStorage` key of the value chosen on this device. */
export const QUALITY_KEY = 'my-home.quality';

export const parseQuality = (value: unknown): Quality | undefined =>
  QUALITIES.find((q) => q === value);

/** A phone refines when the view is still; a desktop is beautiful all the time. */
export const defaultQuality = (phone: boolean): Quality => (phone ? 'auto' : 'beautiful');

/** The URL (`?quality=`), then the value remembered on this device, then the device default. */
export function resolveQuality(source: {
  search: string;
  stored: string | null | undefined;
  phone: boolean;
}): Quality {
  return (
    parseQuality(new URLSearchParams(source.search).get('quality')) ??
    parseQuality(source.stored) ??
    defaultQuality(source.phone)
  );
}

/** What the control calls each value; a phone's words say what happens. */
export const qualityLabel = (quality: Quality, phone: boolean): string =>
  ({
    fast: 'Fast',
    auto: phone ? 'Automatic' : 'Auto',
    beautiful: phone ? 'Always beautiful' : 'Beautiful',
  })[quality];

function stored(): string | null {
  try {
    return window.localStorage.getItem(QUALITY_KEY);
  } catch {
    return null;
  }
}

/**
 * The setting for this visit and the action of the Quality control. The URL wins for one visit
 * and is not remembered; a value chosen in the control is remembered and wins from then on.
 */
export function useQuality(phone: boolean): [Quality, (quality: Quality) => void] {
  const [chosen, setChosen] = useState<Quality>();
  const choose = useCallback((quality: Quality) => {
    setChosen(quality);
    try {
      window.localStorage.setItem(QUALITY_KEY, quality);
    } catch {
      // Storage is off: the choice lasts for this visit.
    }
  }, []);
  const quality =
    chosen ?? resolveQuality({ search: window.location.search, stored: stored(), phone });
  return [quality, choose];
}
