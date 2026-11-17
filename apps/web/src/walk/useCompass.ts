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

/**
 * Who sets the view's angle while walking. `sensors`: the phone's orientation drives heading and
 * tilt and the owner only walks. `manual`: the sensors are not listened to at all, and the owner
 * turns and tilts by hand.
 */
export type CameraMode = 'manual' | 'sensors';

/** How the sensors are doing for one part of the view (heading or tilt). */
export type FollowStatus =
  /** Manual mode: this part of the view is set by hand. */
  | 'off'
  /** Sensor mode, no usable sensor event yet. */
  | 'waiting'
  /** The phone drives this part of the view. */
  | 'on'
  /** Sensor mode, but the page is hidden or not focused; it resumes by itself. */
  | 'paused';

/** Why Sensor mode fell back to Manual. */
export type Refusal =
  /** The browser (iOS) asked and the owner said no. */
  | 'denied'
  /** The permission request failed. */
  | 'unavailable'
  /** The browser sent no usable compass or tilt data in time. */
  | 'no-events';

export interface CompassState {
  /** Whether this device reports its orientation at all. */
  supported: boolean;
  /** The camera mode in force; Manual until Sensor mode is allowed. */
  mode: CameraMode;
  /** The compass sets the heading. */
  heading: FollowStatus;
  /** The phone's tilt sets the pitch. */
  tilt: FollowStatus;
  /** Following is held back from outside (a photo is being reviewed); not a fault. */
  held: boolean;
  /** Why the last switch to Sensor mode fell back to Manual, if it did. */
  refusal: Refusal | undefined;
  /** iOS: ± degrees, negative when unreliable. Undefined when the phone does not say. */
  accuracy: number | undefined;
  /** This device's calibration offset in degrees. */
  calibration: number;
  /** Switches the camera mode; Sensor mode asks for permission first where the browser wants that. */
  setMode(mode: CameraMode): void;
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
/** The camera mode chosen last on this device. */
export const CAMERA_MODE_KEY = 'my-home.walk.cameraMode';

type PermissionRequest = { requestPermission?: () => Promise<'granted' | 'denied'> };

/** Whether switching the sensors on needs a tap that asks for permission (iOS). */
export const needsPermission = () =>
  typeof DeviceOrientationEvent !== 'undefined' &&
  typeof (DeviceOrientationEvent as unknown as PermissionRequest).requestPermission === 'function';

/** The camera mode chosen last on this device; Manual when none was. */
export function storedCameraMode(): CameraMode {
  try {
    return localStorage.getItem(CAMERA_MODE_KEY) === 'sensors' ? 'sensors' : 'manual';
  } catch {
    return 'manual';
  }
}

function storeCameraMode(mode: CameraMode) {
  try {
    if (mode === 'manual') localStorage.removeItem(CAMERA_MODE_KEY);
    else localStorage.setItem(CAMERA_MODE_KEY, mode);
  } catch {
    // Private mode or a full store: the choice then lasts for this visit only.
  }
}

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
  /**
   * Stops following for as long as it is true, with Sensor mode left on: while a photo is being
   * reviewed, the view must stay where it was when the photo was taken.
   */
  held?: boolean;
  /**
   * The mode to start in. Sensor mode starts at once where the browser asks no permission, and
   * where it grants it without a tap (Chrome on Android); an iPhone wants a tap on the switch, so
   * it starts in Manual mode, without a complaint.
   */
  initialMode?: CameraMode;
}

type Heard = 'waiting' | 'on';
const statusOf = (wanted: boolean, paused: boolean, heard: Heard): FollowStatus =>
  !wanted ? 'off' : paused ? 'paused' : heard;

/**
 * The phone's orientation sensors drive the figure's view in Sensor mode:
 *
 * - **heading**: the compass turns the figure, so facing a wall in the real room faces it in the
 *   model. Needs a compass reading (an absolute event, or Safari's heading).
 * - **tilt**: tilting the phone up and down tilts the view. Needs only gravity.
 *
 * Sensor events only set a target; the walk loop eases the figure towards it (see `useWalk`).
 * In Manual mode nothing listens to the sensors. When Sensor mode is refused or no data arrives,
 * it falls back to Manual and says why. The mode and the calibration offset are kept per device
 * in localStorage.
 */
export function useCompass({
  northBearing,
  declination,
  setFollow,
  getFigure,
  held = false,
  initialMode = 'manual',
}: Options): CompassState {
  const supported = typeof DeviceOrientationEvent !== 'undefined';
  const [wanted, setWanted] = useState(
    () => initialMode === 'sensors' && supported && !needsPermission(),
  );
  const [refusal, setRefusal] = useState<Refusal>();
  const [heardCompass, setHeardCompass] = useState<Heard>('waiting');
  const [heardTilt, setHeardTilt] = useState<Heard>('waiting');
  const [accuracy, setAccuracy] = useState<number>();
  const [calibration, setCalibrationState] = useState(storedCalibration);
  const [paused, setPaused] = useState(false);

  const last = useRef<Last>({});
  // Whether the sensors are being followed right now (Sensor mode, and not paused or held).
  const live = useRef(false);
  const settings = useRef<CompassSettings>({ northBearing, declination, calibration });

  // Sensor mode to come back to where the browser has a permission function: ask without a tap.
  // Chrome answers at once; Safari refuses a request that no tap started, and Manual stays.
  useEffect(() => {
    if (initialMode !== 'sensors' || !supported || !needsPermission()) return;
    let current = true;
    const request = (DeviceOrientationEvent as unknown as PermissionRequest).requestPermission!;
    Promise.resolve()
      .then(() => request.call(DeviceOrientationEvent))
      .then(
        (result) => {
          if (current && result === 'granted') setWanted(true);
        },
        () => {},
      );
    return () => {
      current = false;
    };
    // Only for the mode the walk starts in.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** Sends the latest readings to the walk loop with the current settings. */
  const apply = useCallback(() => {
    const { compass, tilt } = last.current;
    const yaw =
      live.current && compass ? followTarget(compass.reading, settings.current).yaw : undefined;
    const pitch = live.current && tilt ? clampPitch(tilt.pitch) : undefined;
    setFollow(yaw === undefined && pitch === undefined ? undefined : { yaw, pitch });
  }, [setFollow]);
  useEffect(() => {
    settings.current = { northBearing, declination, calibration };
    if (live.current) apply();
  }, [northBearing, declination, calibration, apply]);

  // After a hold the modes listen afresh, like after a pause.
  useEffect(() => {
    if (!held) return;
    return () => {
      last.current = {};
      setHeardCompass('waiting');
      setHeardTilt('waiting');
    };
  }, [held]);

  // Following pauses while the page is hidden or another window has the focus, and starts
  // listening afresh when it comes back.
  useEffect(() => {
    if (!wanted) return;
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
  }, [wanted]);

  useEffect(() => {
    // In Manual mode, and while paused or held, nothing listens; the cleanup of the last run has
    // stopped the following.
    if (!wanted || paused || held) return;
    live.current = true;
    apply();
    const heard = { compass: false, tilt: false };
    // Nothing usable in time (a desktop browser, a phone without a compass): back to Manual.
    const silent = setTimeout(() => {
      if (heard.compass && heard.tilt) return;
      storeCameraMode('manual');
      setRefusal('no-events');
      setWanted(false);
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
      const tilt = tiltReading(sample, angle);
      if (tilt) {
        last.current.tilt = { sample, ...tilt, screenAngle: angle };
        if (!heard.tilt) setHeardTilt('on');
        heard.tilt = true;
      }
      // A relative event next to the absolute ones is not a compass reading: it is left alone.
      const reading = sensorReading(sample, angle);
      if (reading) {
        last.current.compass = { sample, reading, screenAngle: angle };
        if (!heard.compass) setHeardCompass('on');
        heard.compass = true;
        setAccuracy(reading.accuracy === undefined ? undefined : Math.round(reading.accuracy));
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
      live.current = false;
      setFollow(undefined);
    };
  }, [wanted, paused, held, apply, setFollow]);

  const setMode = useCallback(
    (mode: CameraMode) => {
      if (mode === 'manual') {
        storeCameraMode('manual');
        setRefusal(undefined);
        setWanted(false);
        setPaused(false);
        last.current = {};
        return;
      }
      if (wanted || !supported) return;
      const start = () => {
        storeCameraMode('sensors');
        setRefusal(undefined);
        setHeardCompass('waiting');
        setHeardTilt('waiting');
        setWanted(true);
      };
      const request = (DeviceOrientationEvent as unknown as PermissionRequest).requestPermission;
      if (!request) return start();
      // iOS asks the user, and only from a tap.
      request.call(DeviceOrientationEvent).then(
        (result) => (result === 'granted' ? start() : setRefusal('denied')),
        () => setRefusal('unavailable'),
      );
    },
    [wanted, supported],
  );

  const setCalibration = useCallback((value: number) => {
    const rounded = Math.round(degrees180(value) * 10) / 10;
    storeCalibration(rounded);
    // The ref is updated at once, so a drag turns the view without waiting for a render.
    settings.current = { ...settings.current, calibration: rounded };
    setCalibrationState(rounded);
  }, []);
  const calibrateTo = useCallback(
    (yaw: number) => {
      const compass = live.current ? last.current.compass : undefined;
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
    const compass = live.current ? last.current.compass : undefined;
    const tilt = live.current ? last.current.tilt : undefined;
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
    mode: wanted ? 'sensors' : 'manual',
    heading: statusOf(wanted, paused || held, heardCompass),
    tilt: statusOf(wanted, paused || held, heardTilt),
    held,
    refusal,
    accuracy,
    calibration,
    setMode,
    calibrateTo,
    resetCalibration,
    snapshot,
  };
}

/** What the HUD says about the sensors; empty when there is nothing to say. */
export function compassStatusText(
  state: Pick<CompassState, 'heading' | 'tilt' | 'refusal'> & { held?: boolean },
): string {
  // Held on purpose: nothing to report.
  if (state.held) return '';
  if (state.refusal === 'denied') {
    return 'The phone did not allow its motion sensors: Manual mode. Drag the view to look around.';
  }
  if (state.refusal === 'unavailable') {
    return 'The motion sensors are not available: Manual mode. Drag the view to look around.';
  }
  if (state.refusal === 'no-events') {
    return 'No motion sensor data from this device: back to Manual. Drag the view to look around.';
  }
  if (state.heading === 'paused' || state.tilt === 'paused') {
    return 'Sensors paused while the page is in the background.';
  }
  if (state.heading === 'waiting' || state.tilt === 'waiting') return 'Waiting for the sensors…';
  return '';
}
