import type { PhotoSensors } from '@my-home/shared';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { Figure } from './figure';
import {
  bearingOfYaw,
  calibrationOffset,
  clampPitch,
  degrees180,
  followTarget,
  sensorReading,
  tiltReading,
  type CompassSettings,
  type FollowTarget,
  type OrientationSample,
  type SensorReading,
} from './orientation';

/** How one of the two follow modes is doing. */
export type FollowStatus =
  /** Switched off: this part of the view is set by hand. */
  | 'off'
  /** Switched on, no usable sensor event yet. */
  | 'waiting'
  /** The phone drives this part of the view. */
  | 'on'
  /** Switched on, but the browser sends no usable data for it. */
  | 'no-events'
  /** Switched on, but the page is hidden or not focused; it resumes by itself. */
  | 'paused';

export interface CompassState {
  /** Whether this device reports its orientation at all. */
  supported: boolean;
  /** "Turn with phone": the compass sets the heading. */
  heading: FollowStatus;
  /** "Tilt with phone": the phone's tilt sets the pitch. Works without the compass. */
  tilt: FollowStatus;
  /** Why the last attempt to switch a mode on failed, if it did. */
  refusal: 'denied' | 'unavailable' | undefined;
  /** iOS: ± degrees, negative when unreliable. Undefined when the phone does not say. */
  accuracy: number | undefined;
  /** This device's calibration offset in degrees. */
  calibration: number;
  toggleHeading(): void;
  toggleTilt(): void;
  /** Turns the view by hand while the heading follows: changes the calibration offset. */
  adjustCalibration(degrees: number): void;
  /**
   * Calibrates against the model: the phone is pointing where the figure would look at `yaw`.
   * False when there is no compass reading to calibrate with.
   */
  calibrateTo(yaw: number): boolean;
  resetCalibration(): void;
  /** What to store with a photo taken now: the sensor snapshot, or a note that it was manual. */
  snapshot(): PhotoSensors;
}

/** A mode counts as silent when no usable event arrives within this time. */
export const NO_EVENTS_MS = 2000;
export const CALIBRATION_KEY = 'my-home.compass.calibration';

type PermissionRequest = { requestPermission?: () => Promise<'granted' | 'denied'> };

/** `screen.orientation.angle`, or the older `window.orientation`; 0 when neither exists. */
export function screenAngle(): number {
  const modern = typeof screen !== 'undefined' ? screen.orientation?.angle : undefined;
  if (typeof modern === 'number') return modern;
  const legacy = (window as unknown as { orientation?: number }).orientation;
  return typeof legacy === 'number' ? (legacy + 360) % 360 : 0;
}

function storedCalibration(): number {
  try {
    const value = Number(localStorage.getItem(CALIBRATION_KEY));
    return Number.isFinite(value) ? degrees180(value) : 0;
  } catch {
    return 0;
  }
}

function storeCalibration(value: number) {
  try {
    if (value === 0) localStorage.removeItem(CALIBRATION_KEY);
    else localStorage.setItem(CALIBRATION_KEY, String(value));
  } catch {
    // Private mode or a full store: the offset then lasts for this visit only.
  }
}

/** The latest of what the sensors said, per kind of reading. */
interface Last {
  /** The event the compass reading came from. */
  compass?: { sample: OrientationSample; reading: SensorReading; screenAngle: number };
  /** The event the tilt came from (any event with `beta` and `gamma`). */
  tilt?: { sample: OrientationSample; pitch: number; roll: number; screenAngle: number };
}

interface Options {
  /** `building.northBearing` and `building.magneticDeclination` of the home. */
  northBearing: number;
  declination: number;
  /** Where the smoothed view goes: the walk loop's follow target. */
  setFollow(target: FollowTarget | undefined): void;
  /** The figure as it stands now, for the snapshot. */
  getFigure(): Figure;
}

type Heard = 'waiting' | 'on' | 'silent';
const statusOf = (wanted: boolean, paused: boolean, heard: Heard): FollowStatus =>
  !wanted
    ? 'off'
    : paused
      ? 'paused'
      : heard === 'on'
        ? 'on'
        : heard === 'silent'
          ? 'no-events'
          : 'waiting';

/**
 * The phone's orientation sensors drive the figure's view, in two independent modes:
 *
 * - **heading**: the compass turns the figure, so facing a wall in the real room faces it in the
 *   model. Needs a compass reading (an absolute event, or Safari's heading).
 * - **tilt**: tilting the phone up and down tilts the view. Needs only gravity, so it works from
 *   any orientation event and also where the compass is unreliable.
 *
 * Sensor events only set a target; the walk loop eases the figure towards it (see `useWalk`).
 * The calibration offset is kept per device in localStorage.
 */
export function useCompass({
  northBearing,
  declination,
  setFollow,
  getFigure,
}: Options): CompassState {
  const supported = typeof DeviceOrientationEvent !== 'undefined';
  const [wantHeading, setWantHeading] = useState(false);
  const [wantTilt, setWantTilt] = useState(false);
  const [refusal, setRefusal] = useState<'denied' | 'unavailable'>();
  const [heardCompass, setHeardCompass] = useState<Heard>('waiting');
  const [heardTilt, setHeardTilt] = useState<Heard>('waiting');
  const [accuracy, setAccuracy] = useState<number>();
  const [calibration, setCalibrationState] = useState(storedCalibration);
  const [paused, setPaused] = useState(false);
  const active = wantHeading || wantTilt;

  const last = useRef<Last>({});
  // What is being followed right now (switched on, and not paused).
  const live = useRef({ heading: false, tilt: false });
  const settings = useRef<CompassSettings>({ northBearing, declination, calibration });

  /** Sends the latest readings to the walk loop with the current settings. */
  const apply = useCallback(() => {
    const { compass, tilt } = last.current;
    const yaw =
      live.current.heading && compass
        ? followTarget(compass.reading, settings.current).yaw
        : undefined;
    const pitch = live.current.tilt && tilt ? clampPitch(tilt.pitch) : undefined;
    setFollow(yaw === undefined && pitch === undefined ? undefined : { yaw, pitch });
  }, [setFollow]);
  useEffect(() => {
    settings.current = { northBearing, declination, calibration };
    if (live.current.heading) apply();
  }, [northBearing, declination, calibration, apply]);

  // Following pauses while the page is hidden or another window has the focus, and starts
  // listening afresh when it comes back.
  useEffect(() => {
    if (!active) return;
    const update = () => {
      const away = document.visibilityState === 'hidden' || !document.hasFocus();
      // Readings from before a pause are too old to follow or to store with a photo.
      if (away) last.current = {};
      setPaused(away);
      setHeardCompass('waiting');
      setHeardTilt('waiting');
    };
    document.addEventListener('visibilitychange', update);
    window.addEventListener('blur', update);
    window.addEventListener('focus', update);
    return () => {
      document.removeEventListener('visibilitychange', update);
      window.removeEventListener('blur', update);
      window.removeEventListener('focus', update);
    };
  }, [active]);

  useEffect(() => {
    // While paused nothing listens; the cleanup of the last run has stopped the following.
    if (!active || paused) return;
    live.current = { heading: wantHeading, tilt: wantTilt };
    // A reading from a mode that has been switched off is not kept.
    if (!wantHeading) delete last.current.compass;
    if (!wantTilt) delete last.current.tilt;
    apply();
    const heard = { compass: false, tilt: false };
    const silent = setTimeout(() => {
      if (wantHeading && !heard.compass) setHeardCompass('silent');
      if (wantTilt && !heard.tilt) setHeardTilt('silent');
    }, NO_EVENTS_MS);
    const onOrientation = (event: Event) => {
      const e = event as DeviceOrientationEvent & {
        webkitCompassHeading?: number;
        webkitCompassAccuracy?: number;
      };
      const sample: OrientationSample = {
        alpha: e.alpha ?? null,
        beta: e.beta ?? null,
        gamma: e.gamma ?? null,
        absolute: e.absolute === true,
        webkitCompassHeading: e.webkitCompassHeading,
        webkitCompassAccuracy: e.webkitCompassAccuracy,
      };
      // The screen orientation is read with every event, so landscape needs no extra step.
      const angle = screenAngle();
      if (wantTilt) {
        const tilt = tiltReading(sample, angle);
        if (tilt) {
          last.current.tilt = { sample, ...tilt, screenAngle: angle };
          if (!heard.tilt) setHeardTilt('on');
          heard.tilt = true;
        }
      }
      if (wantHeading) {
        // A relative event next to the absolute ones is not a compass reading: it is left alone.
        const reading = sensorReading(sample, angle);
        if (reading) {
          last.current.compass = { sample, reading, screenAngle: angle };
          if (!heard.compass) setHeardCompass('on');
          heard.compass = true;
          setAccuracy(reading.accuracy === undefined ? undefined : Math.round(reading.accuracy));
        }
      }
      apply();
    };
    // Chrome sends compass-referenced events separately; Safari uses the plain event.
    window.addEventListener('deviceorientationabsolute', onOrientation);
    window.addEventListener('deviceorientation', onOrientation);
    return () => {
      clearTimeout(silent);
      window.removeEventListener('deviceorientationabsolute', onOrientation);
      window.removeEventListener('deviceorientation', onOrientation);
      live.current = { heading: false, tilt: false };
      setFollow(undefined);
    };
  }, [active, paused, wantHeading, wantTilt, apply, setFollow]);

  /** Switches a mode on (after asking for permission where the browser wants that) or off. */
  const toggle = useCallback(
    (
      wanted: boolean,
      set: (on: boolean) => void,
      heardSet: (heard: Heard) => void,
      other: boolean,
    ) => {
      if (wanted) {
        set(false);
        if (!other) setPaused(false);
        return;
      }
      const start = () => {
        setRefusal(undefined);
        heardSet('waiting');
        set(true);
      };
      const request = (DeviceOrientationEvent as unknown as PermissionRequest).requestPermission;
      // Already listening for the other mode: the permission is there.
      if (!request || other) return start();
      // iOS asks the user, and only from a tap. One answer covers heading and tilt.
      request.call(DeviceOrientationEvent).then(
        (result) => (result === 'granted' ? start() : setRefusal('denied')),
        () => setRefusal('unavailable'),
      );
    },
    [],
  );
  const toggleHeading = useCallback(
    () => toggle(wantHeading, setWantHeading, setHeardCompass, wantTilt),
    [toggle, wantHeading, wantTilt],
  );
  const toggleTilt = useCallback(
    () => toggle(wantTilt, setWantTilt, setHeardTilt, wantHeading),
    [toggle, wantHeading, wantTilt],
  );

  const setCalibration = useCallback((value: number) => {
    const rounded = Math.round(degrees180(value) * 10) / 10;
    storeCalibration(rounded);
    // The ref is updated at once, so a drag turns the view without waiting for a render.
    settings.current = { ...settings.current, calibration: rounded };
    setCalibrationState(rounded);
  }, []);
  const adjustCalibration = useCallback(
    (degrees: number) => {
      setCalibration(settings.current.calibration + degrees);
      apply();
    },
    [apply, setCalibration],
  );
  const calibrateTo = useCallback(
    (yaw: number) => {
      const compass = live.current.heading ? last.current.compass : undefined;
      if (!compass) return false;
      setCalibration(calibrationOffset(yaw, compass.reading.magneticBearing, settings.current));
      apply();
      return true;
    },
    [apply, setCalibration],
  );
  const resetCalibration = useCallback(() => {
    setCalibration(0);
    apply();
  }, [apply, setCalibration]);

  const snapshot = useCallback((): PhotoSensors => {
    const figure = getFigure();
    const capturedAt = new Date().toISOString();
    const compass = live.current.heading ? last.current.compass : undefined;
    const tilt = live.current.tilt ? last.current.tilt : undefined;
    const used = compass ?? tilt;
    // `sensor` says the heading was measured. A photo with only the tilt from the phone keeps
    // the raw tilt values, but its heading was set by hand.
    if (!used) return { source: 'manual', yaw: figure.yaw, pitch: figure.pitch, capturedAt };
    const { sample } = used;
    const { declination: applied, calibration: offset, northBearing: north } = settings.current;
    return {
      source: compass ? 'sensor' : 'manual',
      alpha: sample.alpha,
      beta: sample.beta,
      gamma: sample.gamma,
      absolute: sample.absolute,
      ...(sample.webkitCompassHeading !== undefined && {
        compassHeading: sample.webkitCompassHeading,
      }),
      ...(sample.webkitCompassAccuracy !== undefined && {
        compassAccuracy: sample.webkitCompassAccuracy,
      }),
      screenAngle: used.screenAngle,
      tilt: tilt !== undefined,
      ...(compass && {
        magneticBearing: compass.reading.magneticBearing,
        declination: applied,
        calibrationOffset: offset,
        // The smoothed view the photo is saved with, as a true bearing; the raw one is above.
        trueBearing: bearingOfYaw(figure.yaw, north),
      }),
      yaw: figure.yaw,
      pitch: figure.pitch,
      ...((tilt ?? compass?.reading)?.roll !== undefined && {
        roll: (tilt ?? compass?.reading)?.roll,
      }),
      capturedAt,
    };
  }, [getFigure]);

  return {
    supported,
    heading: statusOf(wantHeading, paused, heardCompass),
    tilt: statusOf(wantTilt, paused, heardTilt),
    refusal,
    accuracy,
    calibration,
    toggleHeading,
    toggleTilt,
    adjustCalibration,
    calibrateTo,
    resetCalibration,
    snapshot,
  };
}

/** What the HUD says about the sensors; empty when there is nothing to say. */
export function compassStatusText(
  state: Pick<CompassState, 'heading' | 'tilt' | 'refusal'>,
): string {
  if (state.refusal === 'denied') return 'The phone needs permission to read its motion sensors.';
  if (state.refusal === 'unavailable') return 'The motion sensors are not available.';
  if (state.heading === 'paused' || state.tilt === 'paused') {
    return 'Sensors paused while the page is in the background.';
  }
  const silent = [
    state.heading === 'no-events' ? 'compass' : undefined,
    state.tilt === 'no-events' ? 'tilt' : undefined,
  ].filter(Boolean);
  if (silent.length > 0) {
    return `No ${silent.join(' or ')} data from this device. Drag the view to look around.`;
  }
  if (state.heading === 'waiting' || state.tilt === 'waiting') return 'Waiting for the sensors…';
  return '';
}
