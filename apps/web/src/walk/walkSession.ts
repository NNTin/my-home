import type { PhotoSensors } from '@my-home/shared';
import type { Figure } from './figure';
import type { CameraMode } from './useCompass';

/**
 * Walk mode, kept for this tab in sessionStorage so that it survives a reload.
 *
 * A phone browser often throws away a tab that sits in the background while the phone's camera
 * app is open, mostly a heavy one like this 3D view, and loads the page afresh when the camera
 * returns. The photo the camera handed back is lost then, and so would be everything about the
 * walk. With this the page comes back walking where the shutter was tapped and says what
 * happened, so the owner only has to take the photo again.
 */
export interface WalkSession {
  homeId: string;
  view: 'first' | 'third';
  figure: Figure;
  /**
   * The camera mode. Sessions saved before there was one have `heading` and `tilt` booleans
   * instead; either of them on reads as Sensor mode.
   */
  mode: CameraMode;
  /**
   * Set when the phone's camera app was opened and its photo has not come back yet: the pose and
   * sensors of the tap. Still set after a reload means the photo was lost on the way.
   */
  pending?: { figure: Figure; sensors: PhotoSensors; at: number };
  /** Note and tags typed for the photo being reviewed, offered again for the next one. */
  draft?: { note: string; tags: string[] };
  savedAt: number;
}

export const WALK_SESSION_KEY = 'my-home.walk.session';
/** Older than this, a saved walk is not picked up again: the owner has moved on. */
export const WALK_SESSION_MAX_AGE_MS = 2 * 60 * 60 * 1000;

const storage = (): Storage | undefined => {
  try {
    return window.sessionStorage;
  } catch {
    // Storage switched off (private mode in some browsers): walk mode then simply is not kept.
    return undefined;
  }
};

const isFigure = (value: unknown): value is Figure => {
  const f = value as Partial<Figure> | null;
  return (
    typeof f === 'object' &&
    f !== null &&
    [f.x, f.y, f.z, f.yaw, f.pitch].every((n) => typeof n === 'number' && Number.isFinite(n)) &&
    (f.levelId === undefined || typeof f.levelId === 'string')
  );
};

/** The walk saved for `homeId`, if there is a recent and readable one. */
export function loadWalkSession(homeId: string, now = Date.now()): WalkSession | undefined {
  let value: Partial<WalkSession> & { heading?: unknown; tilt?: unknown };
  try {
    value = JSON.parse(storage()?.getItem(WALK_SESSION_KEY) ?? 'null') as typeof value;
  } catch {
    return undefined;
  }
  if (
    !value ||
    value.homeId !== homeId ||
    (value.view !== 'first' && value.view !== 'third') ||
    !isFigure(value.figure) ||
    typeof value.savedAt !== 'number' ||
    now - value.savedAt > WALK_SESSION_MAX_AGE_MS
  ) {
    return undefined;
  }
  const pending =
    value.pending && isFigure(value.pending.figure) && typeof value.pending.at === 'number'
      ? value.pending
      : undefined;
  const draft =
    value.draft &&
    typeof value.draft.note === 'string' &&
    Array.isArray(value.draft.tags) &&
    value.draft.tags.every((t) => typeof t === 'string')
      ? value.draft
      : undefined;
  return {
    homeId,
    view: value.view,
    figure: value.figure,
    mode:
      value.mode === 'sensors' || value.mode === 'manual'
        ? value.mode
        : value.heading === true || value.tilt === true
          ? 'sensors'
          : 'manual',
    ...(pending && { pending }),
    ...(draft && { draft }),
    savedAt: value.savedAt,
  };
}

/** Saves the walk; `undefined` forgets it (walk mode was left). Never throws. */
export function saveWalkSession(session: Omit<WalkSession, 'savedAt'> | undefined): void {
  try {
    if (!session) storage()?.removeItem(WALK_SESSION_KEY);
    else storage()?.setItem(WALK_SESSION_KEY, JSON.stringify({ ...session, savedAt: Date.now() }));
  } catch {
    // Full or switched off: nothing to keep then.
  }
}
