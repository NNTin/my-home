import { describe, expect, it } from 'vitest';
import { facing, MAX_PITCH, yawFromCompass } from './figure';
import {
  accuracyLabel,
  bearingOfYaw,
  calibrationOffset,
  cameraOrientation,
  clampPitch,
  degrees180,
  easeAngle,
  followTarget,
  sensorReading,
  tiltReading,
  trueBearing,
} from './orientation';

const deg = (radians: number) => (radians * 180) / Math.PI;
const rad = (degrees: number) => (degrees * Math.PI) / 180;
const near = (actual: number, expected: number) =>
  expect(degrees180(actual - expected)).toBeCloseTo(0, 4);

/** Device angles of a phone whose axes point along the given earth directions (east, north, up). */
function anglesFor(x: number[], y: number[], z: number[]) {
  // R = Rz(alpha)·Rx(beta)·Ry(gamma) has columns x, y, z: read the angles back from them.
  const beta = Math.asin(y[2]!);
  const alpha = Math.atan2(-y[0]!, y[1]!);
  const gamma = Math.atan2(-x[2]!, z[2]!);
  return { alpha: (deg(alpha) + 360) % 360, beta: deg(beta), gamma: deg(gamma) };
}

describe('camera direction from the device angles', () => {
  it('upright in portrait: the bearing is where the back camera points', () => {
    for (const bearing of [0, 45, 90, 180, 270, 359]) {
      const o = cameraOrientation({ alpha: (360 - bearing) % 360, beta: 90, gamma: 0 });
      near(o.bearing, bearing);
      expect(o.pitch).toBeCloseTo(0);
      expect(o.roll).toBeCloseTo(0);
    }
  });

  it('tilting the phone changes the pitch and leaves the bearing alone', () => {
    for (const bearing of [0, 90, 200]) {
      // beta 90 is upright; less looks down at the floor, more looks up.
      const down = cameraOrientation({ alpha: 360 - bearing, beta: 60, gamma: 0 });
      near(down.bearing, bearing);
      expect(deg(down.pitch)).toBeCloseTo(-30);
      const up = cameraOrientation({ alpha: 360 - bearing, beta: 120, gamma: 0 });
      near(up.bearing, bearing);
      expect(deg(up.pitch)).toBeCloseTo(30);
    }
  });

  it('is the same view in landscape, either way round', () => {
    // Facing north, top of the device to the left (west): x up, y west, z towards the viewer (south).
    const left = anglesFor([0, 0, 1], [-1, 0, 0], [0, -1, 0]);
    const viaLeft = cameraOrientation(left, 90);
    near(viaLeft.bearing, 0);
    expect(viaLeft.pitch).toBeCloseTo(0);
    expect(viaLeft.roll).toBeCloseTo(0);
    // Top of the device to the right (east): x down, y east.
    const right = anglesFor([0, 0, -1], [1, 0, 0], [0, -1, 0]);
    const viaRight = cameraOrientation(right, 270);
    near(viaRight.bearing, 0);
    expect(viaRight.roll).toBeCloseTo(0);
    // The same device pose read with the wrong screen angle only shows as a quarter turn of roll.
    expect(Math.abs(deg(cameraOrientation(left, 0).roll))).toBeCloseTo(90);
    near(cameraOrientation(left, 0).bearing, 0);
  });

  it('landscape facing east, tilted down 20°', () => {
    const c = Math.cos(rad(20));
    const s = Math.sin(rad(20));
    // View (the phone's -z) is east and 20° down; the top of the device points north.
    const angles = anglesFor([-s, 0, c], [0, 1, 0], [-c, 0, s]);
    const o = cameraOrientation(angles, 90);
    near(o.bearing, 90);
    expect(deg(o.pitch)).toBeCloseTo(-20);
    expect(o.roll).toBeCloseTo(0);
  });

  it('lying flat, the top of the screen gives the bearing', () => {
    near(cameraOrientation({ alpha: 0, beta: 0, gamma: 0 }).bearing, 0);
    near(cameraOrientation({ alpha: 270, beta: 0, gamma: 0 }).bearing, 90);
    near(cameraOrientation({ alpha: 270, beta: 0, gamma: 0 }, 90).bearing, 180);
    expect(deg(cameraOrientation({ alpha: 0, beta: 0, gamma: 0 }).pitch)).toBeCloseTo(-90);
  });
});

describe('a compass reading from an orientation event', () => {
  const event = (overrides: object) => ({
    alpha: null,
    beta: null,
    gamma: null,
    absolute: false,
    ...overrides,
  });

  it('uses an absolute alpha (Android)', () => {
    const reading = sensorReading(event({ alpha: 270, beta: 90, gamma: 0, absolute: true }))!;
    near(reading.magneticBearing, 90);
    expect(reading.pitch).toBeCloseTo(0);
    expect(reading.accuracy).toBeUndefined();
  });

  it('never uses a relative alpha as a compass', () => {
    expect(
      sensorReading(event({ alpha: 270, beta: 90, gamma: 0, absolute: false })),
    ).toBeUndefined();
    expect(
      sensorReading(event({ alpha: null, beta: 90, gamma: 0, absolute: true })),
    ).toBeUndefined();
  });

  it('uses the heading and accuracy Safari reports (iOS), with the tilt from beta and gamma', () => {
    const reading = sensorReading(
      event({
        alpha: 42,
        beta: 70,
        gamma: 0,
        webkitCompassHeading: 120,
        webkitCompassAccuracy: 15,
      }),
    )!;
    near(reading.magneticBearing, 120);
    expect(deg(reading.pitch!)).toBeCloseTo(-20);
    expect(reading.accuracy).toBe(15);
  });

  it('corrects the iOS heading by the screen orientation', () => {
    const sample = event({ alpha: 0, beta: 0, gamma: -90, webkitCompassHeading: 30 });
    near(sensorReading(sample, 0)!.magneticBearing, 30);
    near(sensorReading(sample, 90)!.magneticBearing, 120);
    near(sensorReading(sample, 270)!.magneticBearing, 300);
    near(
      sensorReading(event({ webkitCompassHeading: 350, beta: 90, gamma: 0 }), 90)!.magneticBearing,
      80,
    );
  });

  it('works without tilt angles: bearing only', () => {
    const reading = sensorReading(event({ alpha: 300, absolute: true }))!;
    near(reading.magneticBearing, 60);
    expect(reading.pitch).toBeUndefined();
  });
});

describe('tilt on its own', () => {
  it('needs no compass: a relative event gives the same pitch as an absolute one', () => {
    for (const alpha of [0, 17, 250, null]) {
      const tilt = tiltReading({ alpha, beta: 60, gamma: 0 })!;
      expect(deg(tilt.pitch)).toBeCloseTo(-30);
    }
    expect(deg(tiltReading({ alpha: 0, beta: 90, gamma: 0 })!.pitch)).toBeCloseTo(0);
    expect(deg(tiltReading({ alpha: 0, beta: 135, gamma: 0 })!.pitch)).toBeCloseTo(45);
  });

  it('is the same in landscape: tilting the phone up looks up', () => {
    // Landscape, top of the device to the left, camera level: beta 0, gamma -90.
    expect(deg(tiltReading({ alpha: 90, beta: 0, gamma: -90 }, 90)!.pitch)).toBeCloseTo(0);
    // The same pose with the camera tipped down by 25°, then up by 25°: in landscape it is gamma
    // (and the flip of beta) that carries the tilt.
    expect(deg(tiltReading({ alpha: 90, beta: 0, gamma: -65 }, 90)!.pitch)).toBeCloseTo(-25);
    expect(deg(tiltReading({ alpha: 90, beta: 180, gamma: 65 }, 90)!.pitch)).toBeCloseTo(25);
  });

  it('is undefined without tilt angles, and is clamped to what the figure can look', () => {
    expect(tiltReading({ alpha: 10, beta: null, gamma: null })).toBeUndefined();
    expect(clampPitch(tiltReading({ alpha: 0, beta: 0, gamma: 0 })!.pitch)).toBe(-MAX_PITCH);
    expect(clampPitch(tiltReading({ alpha: 0, beta: 179, gamma: 0 })!.pitch)).toBe(MAX_PITCH);
  });
});

describe('from the compass to the plan', () => {
  const settings = { northBearing: 20, declination: 3, calibration: -7 };

  it('adds the declination (east positive) and the calibration offset to get the true bearing', () => {
    expect(trueBearing(100, { declination: 3, calibration: 0 })).toBe(103);
    expect(trueBearing(100, { declination: -4, calibration: 0 })).toBe(96);
    expect(trueBearing(100, settings)).toBe(96);
    expect(trueBearing(358, { declination: 3, calibration: 2 })).toBe(3);
  });

  it('plan heading = true bearing + northBearing', () => {
    const reading = { magneticBearing: 74, pitch: 0.1, roll: 0, accuracy: undefined };
    // 74 + 3 - 7 = 70 true; + 20 = 90 clockwise of -z: looking along +x.
    const target = followTarget(reading, settings);
    expect(target.yaw).toBeCloseTo(yawFromCompass(70, 20));
    expect(facing(target.yaw).map((v) => Math.round(v * 1000) / 1000 + 0)).toEqual([1, 0]);
    expect(target.pitch).toBeCloseTo(0.1);
  });

  it('clamps the pitch to what the figure can look, and passes on a missing tilt', () => {
    const steep = { magneticBearing: 0, roll: 0, accuracy: undefined };
    expect(followTarget({ ...steep, pitch: 1.55 }, settings).pitch).toBe(MAX_PITCH);
    expect(followTarget({ ...steep, pitch: -1.55 }, settings).pitch).toBe(-MAX_PITCH);
    expect(followTarget({ ...steep, pitch: undefined }, settings).pitch).toBeUndefined();
  });

  it('turns a yaw back into the bearing it faces', () => {
    for (const bearing of [0, 70, 180, 359]) {
      near(bearingOfYaw(yawFromCompass(bearing, 20), 20), bearing);
    }
  });

  it('calibrates: the offset that makes the phone agree with a known direction in the model', () => {
    // The owner points at a door that lies at plan heading 90 (true bearing 70 with north at 20).
    const doorYaw = yawFromCompass(70, 20);
    // The phone says magnetic 60; with 3° declination that is 63 true: 7° short.
    const offset = calibrationOffset(doorYaw, 60, settings);
    expect(offset).toBeCloseTo(7);
    const calibrated = followTarget(
      { magneticBearing: 60, pitch: 0, roll: 0, accuracy: undefined },
      { ...settings, calibration: offset },
    );
    expect(calibrated.yaw).toBeCloseTo(doorYaw);
    // Across north, the offset stays small.
    expect(
      calibrationOffset(yawFromCompass(2, 0), 357, { northBearing: 0, declination: 0 }),
    ).toBeCloseTo(5);
    expect(
      calibrationOffset(yawFromCompass(357, 0), 2, { northBearing: 0, declination: 0 }),
    ).toBeCloseTo(-5);
  });
});

describe('smoothing', () => {
  /** Runs the filter for `seconds` at 60 frames a second, as the walk loop does. */
  const settle = (from: number, to: number, seconds: number, moving = false) => {
    let state = { value: from, moving };
    for (let t = 0; t < seconds; t += 1 / 60)
      state = easeAngle(state.value, to, 1 / 60, state.moving);
    return state;
  };

  it('settles a 90° turn within about 0.3 s', () => {
    const after = settle(0, rad(90), 0.3).value;
    expect(deg(after)).toBeGreaterThan(86);
    expect(deg(after)).toBeLessThanOrEqual(90);
    // And is well on its way after a tenth of a second, so it feels direct.
    expect(deg(settle(0, rad(90), 0.1).value)).toBeGreaterThan(60);
  });

  it('crosses north the short way, without a jump', () => {
    // From 350° to 10°: 20° of turning, never the long way round.
    let state = { value: yawFromCompass(350, 0), moving: false };
    const target = yawFromCompass(10, 0);
    let previous = state.value;
    for (let i = 0; i < 40; i++) {
      state = easeAngle(state.value, target, 1 / 60, state.moving);
      expect(Math.abs(deg(state.value - previous))).toBeLessThan(6);
      expect(Math.abs(degrees180(deg(state.value)))).toBeLessThanOrEqual(10.001);
      previous = state.value;
    }
    expect(Math.abs(degrees180(deg(state.value) - deg(target)))).toBeLessThan(0.5);
  });

  it('at rest, does not follow jitter inside the dead-band, in either direction', () => {
    const still = rad(40);
    for (const wobble of [1.4, -1.2, 0.8, -1.4]) {
      expect(easeAngle(still, still + rad(wobble), 1 / 60, false)).toEqual({
        value: still,
        moving: false,
      });
    }
  });

  it('once it moves, goes all the way and rests on the target, not at the edge of the band', () => {
    const still = rad(40);
    const started = easeAngle(still, still + rad(3), 1 / 60, false);
    expect(started.value).toBeGreaterThan(still);
    expect(started.moving).toBe(true);
    const rested = settle(still, still + rad(10), 1);
    expect(rested.moving).toBe(false);
    expect(Math.abs(deg(rested.value) - 50)).toBeLessThan(0.21);
    // Resting there, jitter of over a degree to either side leaves it alone.
    for (const wobble of [1.2, -1.2]) {
      expect(easeAngle(rested.value, still + rad(10 + wobble), 1 / 60, false).value).toBe(
        rested.value,
      );
    }
  });

  it('blends in from far away when a mode is switched on, even for a small difference', () => {
    // `moving: true` from the start: also a difference inside the dead-band is closed.
    expect(Math.abs(deg(settle(0, rad(1), 0.5, true).value) - 1)).toBeLessThan(0.21);
    expect(settle(0, rad(1), 0.5, false).value).toBe(0);
  });

  it('smooths the pitch the same way', () => {
    expect(deg(settle(0, rad(-30), 0.3).value)).toBeLessThan(-27);
  });
});

describe('accuracy', () => {
  it('describes what the phone reports', () => {
    expect(accuracyLabel(undefined)).toEqual({ text: 'accuracy unknown', poor: false });
    expect(accuracyLabel(12.4)).toEqual({ text: '±12°', poor: false });
    expect(accuracyLabel(35)).toEqual({ text: '±35°', poor: true });
    expect(accuracyLabel(-1)).toEqual({ text: 'compass unreliable', poor: true });
  });
});
