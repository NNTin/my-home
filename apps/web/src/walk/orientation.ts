import { normalizeAngle } from '../editor/geometry';
import { MAX_PITCH, yawFromCompass } from './figure';

/**
 * From the phone's orientation sensors to the figure's view. Plain numbers, no DOM, so every
 * step is unit-tested.
 *
 * The chain, with its sign conventions (also in docs/walking.md and docs/home-model.md):
 *
 * 1. **Camera direction.** `alpha`, `beta`, `gamma` (degrees) describe the phone as the rotation
 *    `Rz(alpha) · Rx(beta) · Ry(gamma)` from its own axes (x right, y to the top of the device,
 *    z out of the screen) to the earth's (east, north, up). The back camera looks along the
 *    phone's -z. Its direction gives the **bearing** (degrees clockwise from north) and the
 *    **pitch** (positive looking up). Using the whole rotation keeps the bearing steady when the
 *    phone tilts up or down, which reading `alpha` alone does not.
 * 2. **Magnetic to true north.** true bearing = magnetic bearing + declination (east positive)
 *    + the device's calibration offset.
 * 3. **True north to the plan.** plan heading (clockwise from the plan's -z) = true bearing +
 *    `building.northBearing`; the yaw is its negative in radians (`yawFromCompass`).
 */

const RAD = Math.PI / 180;

export interface DeviceAngles {
  alpha: number;
  beta: number;
  gamma: number;
}

export interface CameraOrientation {
  /** Degrees clockwise from the reference of `alpha` (north, for an absolute event); 0 to 360. */
  bearing: number;
  /** Radians, positive looking up. */
  pitch: number;
  /** Radians the picture is turned about the view direction; 0 when the screen is level. */
  roll: number;
}

/** Normalises degrees to [0, 360). */
export const degrees360 = (deg: number) => ((deg % 360) + 360) % 360;
/** Normalises degrees to (-180, 180]. */
export const degrees180 = (deg: number) => {
  const d = degrees360(deg);
  return d > 180 ? d - 360 : d;
};

/**
 * Where the back camera points, from the device angles and the screen orientation
 * (`screen.orientation.angle`: 0 portrait, 90 with the top of the device to the left, 270 to the
 * right, 180 upside down). The screen orientation does not change where the camera points; it
 * matters for the roll and for a phone lying flat, where the top of the screen gives the bearing.
 */
export function cameraOrientation(angles: DeviceAngles, screenAngle = 0): CameraOrientation {
  const [a, b, g] = [angles.alpha * RAD, angles.beta * RAD, angles.gamma * RAD];
  const [ca, sa, cb, sb, cg, sg] = [
    Math.cos(a),
    Math.sin(a),
    Math.cos(b),
    Math.sin(b),
    Math.cos(g),
    Math.sin(g),
  ];
  // Columns of the rotation: the phone's x, y and z axes in (east, north, up).
  const x = [ca * cg - sa * sb * sg, sa * cg + ca * sb * sg, -cb * sg] as const;
  const y = [-sa * cb, ca * cb, sb] as const;
  const z = [ca * sg + sa * sb * cg, sa * sg - ca * sb * cg, cb * cg] as const;
  const view = [-z[0], -z[1], -z[2]] as const;
  // The top of the picture on screen, in the phone's axes, turned by the screen orientation.
  const t = screenAngle * RAD;
  const top = [0, 1, 2].map((i) => Math.sin(t) * x[i]! + Math.cos(t) * y[i]!) as [
    number,
    number,
    number,
  ];

  const pitch = Math.asin(Math.max(-1, Math.min(1, view[2])));
  // Looking almost straight down or up, the view direction has no bearing: use the screen's top.
  const flat = Math.hypot(view[0], view[1]) < 0.2;
  const [east, north] = flat ? [top[0], top[1]] : [view[0], view[1]];
  const bearing = degrees360(Math.atan2(east, north) / RAD);

  // Roll: how far the picture's top is turned from "up" about the view direction.
  const right = [Math.cos(bearing * RAD), -Math.sin(bearing * RAD), 0] as const;
  const up = [
    -Math.sin(pitch) * Math.sin(bearing * RAD),
    -Math.sin(pitch) * Math.cos(bearing * RAD),
    Math.cos(pitch),
  ] as const;
  const dot = (p: readonly number[], q: readonly number[]) =>
    p[0]! * q[0]! + p[1]! * q[1]! + p[2]! * q[2]!;
  const roll = flat ? 0 : Math.atan2(dot(top, right), dot(top, up));
  return { bearing, pitch, roll: Object.is(roll, -0) ? 0 : roll };
}

/** The parts of a `DeviceOrientationEvent` that are read, including Safari's compass fields. */
export interface OrientationSample {
  alpha: number | null;
  beta: number | null;
  gamma: number | null;
  absolute: boolean;
  webkitCompassHeading?: number | undefined;
  webkitCompassAccuracy?: number | undefined;
}

export interface SensorReading {
  /** Magnetic bearing of the camera in degrees clockwise from magnetic north; 0 to 360. */
  magneticBearing: number;
  /** Radians; undefined when the event has no tilt angles. */
  pitch: number | undefined;
  roll: number | undefined;
  /** iOS: ± degrees, negative when the compass is unreliable. Undefined elsewhere. */
  accuracy: number | undefined;
}

/**
 * A compass reading from one orientation event, or undefined when the event cannot serve as a
 * compass. iOS reports the heading itself (`webkitCompassHeading`, for a phone held upright in
 * portrait), which is corrected by the screen orientation; its `alpha` is not earth-referenced
 * and is only used for the tilt. Elsewhere only an **absolute** event counts: a relative `alpha`
 * is never used as a compass.
 */
export function sensorReading(
  sample: OrientationSample,
  screenAngle = 0,
): SensorReading | undefined {
  const tilt =
    sample.beta !== null && sample.gamma !== null
      ? cameraOrientation(
          { alpha: sample.alpha ?? 0, beta: sample.beta, gamma: sample.gamma },
          screenAngle,
        )
      : undefined;
  if (typeof sample.webkitCompassHeading === 'number' && sample.webkitCompassHeading >= 0) {
    return {
      magneticBearing: degrees360(sample.webkitCompassHeading + screenAngle),
      pitch: tilt?.pitch,
      roll: tilt?.roll,
      accuracy: sample.webkitCompassAccuracy,
    };
  }
  if (!sample.absolute || sample.alpha === null) return undefined;
  return {
    // Without tilt angles the phone is taken as lying flat: its top points along 360 - alpha.
    magneticBearing: tilt?.bearing ?? degrees360(360 - sample.alpha - screenAngle),
    pitch: tilt?.pitch,
    roll: tilt?.roll,
    accuracy: undefined,
  };
}

export interface CompassSettings {
  /** `building.northBearing`: true north in degrees clockwise from the plan's -z. */
  northBearing: number;
  /** `building.magneticDeclination`: magnetic north east (+) of true north, degrees. */
  declination: number;
  /** The device's calibration offset in degrees, added to the bearing. */
  calibration: number;
}

/** True bearing of a magnetic one: plus the declination, plus the device's calibration offset. */
export const trueBearing = (
  magneticBearing: number,
  s: Pick<CompassSettings, 'declination' | 'calibration'>,
) => degrees360(magneticBearing + s.declination + s.calibration);

export interface FollowTarget {
  /** Plan yaw in radians; undefined when the heading is not following the phone. */
  yaw: number | undefined;
  /** Pitch in radians, within the figure's limits; undefined when the tilt is not following. */
  pitch: number | undefined;
}

/** A tilt within what the figure can look up and down. */
export const clampPitch = (pitch: number) => Math.max(-MAX_PITCH, Math.min(MAX_PITCH, pitch));

/**
 * The phone's tilt from one orientation event, or undefined when it reports none. The tilt comes
 * from gravity (`beta`, `gamma`), so it needs no compass: a relative event serves as well as an
 * absolute one, and the screen orientation does not change it.
 */
export function tiltReading(
  sample: Pick<OrientationSample, 'alpha' | 'beta' | 'gamma'>,
  screenAngle = 0,
): { pitch: number; roll: number } | undefined {
  if (sample.beta === null || sample.gamma === null) return undefined;
  const { pitch, roll } = cameraOrientation(
    { alpha: sample.alpha ?? 0, beta: sample.beta, gamma: sample.gamma },
    screenAngle,
  );
  return { pitch, roll };
}

/** The figure's view for a sensor reading: the whole chain from the phone to the plan. */
export function followTarget(
  reading: SensorReading,
  settings: CompassSettings,
): FollowTarget & { yaw: number } {
  return {
    yaw: yawFromCompass(trueBearing(reading.magneticBearing, settings), settings.northBearing),
    pitch: reading.pitch === undefined ? undefined : clampPitch(reading.pitch),
  };
}

/** The compass bearing the figure faces at a plan yaw: the inverse of `yawFromCompass`. */
export const bearingOfYaw = (yaw: number, northBearing: number) =>
  degrees360((-yaw * 180) / Math.PI - northBearing);

/**
 * The calibration offset that makes the compass agree with the model: the owner points the phone
 * at something whose direction in the model is known (`modelYaw`, e.g. towards a door), and the
 * offset is what must be added to the uncalibrated true bearing to get there. Degrees in
 * (-180, 180].
 */
export function calibrationOffset(
  modelYaw: number,
  magneticBearing: number,
  settings: Pick<CompassSettings, 'northBearing' | 'declination'>,
): number {
  const wanted = bearingOfYaw(modelYaw, settings.northBearing);
  return degrees180(wanted - magneticBearing - settings.declination);
}

/** A 90° turn settles within about 0.3 s (four time constants). */
export const SMOOTHING_SECONDS = 0.075;
/** Changes smaller than this do not start the view moving: a phone held still gives a still view. */
export const DEAD_BAND = 1.5 * RAD;
/** Once moving, the view goes on until it is this close to where the phone points. */
export const REST_BAND = 0.2 * RAD;

export interface Eased {
  value: number;
  /** Whether the view is on its way to the target; pass it back in with the next step. */
  moving: boolean;
}

/**
 * One step of a low-pass filter on the circle: moves `current` towards `target` along the shorter
 * way round, so passing north (0°/360°) is no different from any other direction.
 *
 * At rest, a change within the dead-band is ignored, so sensor jitter does not shake the view.
 * A larger change starts it moving, and it then goes all the way to the target before it rests
 * again, so it never stops short at the edge of the band (where jitter would move it after all).
 */
export function easeAngle(
  current: number,
  target: number,
  dt: number,
  moving: boolean,
  seconds = SMOOTHING_SECONDS,
): Eased {
  const diff = normalizeAngle(target - current);
  if (!moving && Math.abs(diff) <= DEAD_BAND) return { value: current, moving: false };
  const value = normalizeAngle(current + diff * (1 - Math.exp(-dt / seconds)));
  return { value, moving: Math.abs(normalizeAngle(target - value)) > REST_BAND };
}

/** How good an iOS compass reading is, for the status line. */
export function accuracyLabel(accuracy: number | undefined): { text: string; poor: boolean } {
  if (accuracy === undefined) return { text: 'accuracy unknown', poor: false };
  if (accuracy < 0) return { text: 'compass unreliable', poor: true };
  return { text: `±${Math.round(accuracy)}°`, poor: accuracy > 20 };
}
