import { useState } from 'react';
import { afterEffects } from '../loading/loading';
import { sakuga } from './sakuga';

/** Remembered on this device, like Quality (docs/design/hud.md §10.4). */
export const EFFECTS_KEY = 'my-home.effects';
/** The flip of the "Effects" switch, then the effects stop (the toggle's drawing is about 1.4 s). */
const FLIP_MS = 1500;
/** Each choice's number: a delayed "off" does nothing once a later choice came (switched back on meanwhile). */
let choice = 0;

function stored(): boolean {
  try {
    return window.localStorage.getItem(EFFECTS_KEY) !== 'off';
  } catch {
    return true;
  }
}

/** At start: effects off when this device said so (C3: `SakugaFX.calm`, as reduced motion). */
export function applyEffectsSetting(): void {
  const fx = sakuga();
  if (fx && !stored()) fx.calm = true;
}

/**
 * The "Effects" setting: on by default. Off is the same as reduced motion: no effects, the states still
 * change. Switching it off plays the switch's flip, then the effects stop; switching it on plays nothing.
 */
export function useEffectsSetting(): [boolean, (on: boolean) => void] {
  const [on, setOn] = useState(stored);
  const set = (next: boolean) => {
    setOn(next);
    try {
      window.localStorage.setItem(EFFECTS_KEY, next ? 'on' : 'off');
    } catch {
      // Not remembered, then.
    }
    const fx = sakuga();
    const mine = ++choice;
    if (!fx) return;
    if (next) fx.calm = false;
    else
      afterEffects(FLIP_MS, () => {
        if (mine === choice) fx.calm = true;
      });
  };
  return [on, set];
}
