import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { yawFromCompass, type Figure } from './figure';
import type { FollowTarget } from './orientation';
import {
  CALIBRATION_KEY,
  CAMERA_MODE_KEY,
  compassStatusText,
  NO_EVENTS_MS,
  screenAngle,
  storedCameraMode,
  useCompass,
  type CameraMode,
} from './useCompass';

const orientation = (type: string, init: object) => Object.assign(new Event(type), init);
/** An Android-style event: absolute alpha, phone upright in portrait facing `bearing`. */
const facing = (bearing: number, extra: object = {}) =>
  orientation('deviceorientationabsolute', {
    alpha: (360 - bearing) % 360,
    beta: 90,
    gamma: 0,
    absolute: true,
    ...extra,
  });
const send = (event: Event) => act(() => void window.dispatchEvent(event));
/** The follow targets the hook has set, leaving out the calls that stop the following. */
const targets = (setFollow: { mock: { calls: [FollowTarget | undefined][] } }) =>
  setFollow.mock.calls.map(([target]) => target).filter((target) => target !== undefined);
const figure: Figure = { x: 1, z: 2, y: 0, levelId: 'souterrain', yaw: 0.25, pitch: -0.1 };

function setup(
  options: { northBearing?: number; declination?: number; initialMode?: CameraMode } = {},
) {
  const setFollow = vi.fn<(target: FollowTarget | undefined) => void>();
  const { initialMode, ...settings } = options;
  const hook = renderHook(
    (props: { northBearing: number; declination: number }) =>
      useCompass({ ...props, setFollow, getFigure: () => figure, initialMode }),
    { initialProps: { northBearing: 0, declination: 0, ...settings } },
  );
  const lastYaw = () => setFollow.mock.lastCall?.[0]?.yaw;
  return { ...hook, setFollow, lastYaw };
}

describe('useCompass', () => {
  beforeEach(() => {
    vi.stubGlobal('DeviceOrientationEvent', class {});
    vi.spyOn(document, 'hasFocus').mockReturnValue(true);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    vi.useRealTimers();
    localStorage.clear();
    delete (window as { orientation?: number }).orientation;
  });
  const sensors = (result: { current: { setMode(mode: CameraMode): void } }) =>
    act(() => result.current.setMode('sensors'));

  it('starts in Manual mode and follows heading and tilt in Sensor mode', () => {
    const { result, setFollow, lastYaw } = setup({ northBearing: 20, declination: 3 });
    expect(result.current).toMatchObject({
      supported: true,
      mode: 'manual',
      heading: 'off',
      tilt: 'off',
    });
    send(facing(90));
    expect(targets(setFollow)).toEqual([]);

    sensors(result);
    expect(result.current).toMatchObject({ mode: 'sensors', heading: 'waiting', tilt: 'waiting' });
    send(facing(90, { beta: 60 }));
    expect(result.current).toMatchObject({ heading: 'on', tilt: 'on', accuracy: undefined });
    // Magnetic 90 + 3 declination = 93 true; + 20 = 113 clockwise of -z.
    expect(lastYaw()).toBeCloseTo(yawFromCompass(93, 20));
    expect(setFollow.mock.lastCall![0]!.pitch).toBeCloseTo((-30 * Math.PI) / 180);
    // Tilting the phone leaves the heading alone.
    send(facing(90, { beta: 120 }));
    expect(lastYaw()).toBeCloseTo(yawFromCompass(93, 20));
    expect(setFollow.mock.lastCall![0]!.pitch).toBeCloseTo(Math.PI / 6);
  });

  it('listens to no orientation events at all in Manual mode', () => {
    const add = vi.spyOn(window, 'addEventListener');
    const remove = vi.spyOn(window, 'removeEventListener');
    const orientationListeners = (spy: typeof add) =>
      spy.mock.calls.filter(([type]) => String(type).startsWith('deviceorientation')).length;
    const { result, setFollow } = setup();
    expect(orientationListeners(add)).toBe(0);
    sensors(result);
    expect(orientationListeners(add)).toBe(2);
    send(facing(10));
    act(() => result.current.setMode('manual'));
    expect(orientationListeners(remove)).toBe(2);
    expect(result.current).toMatchObject({ mode: 'manual', heading: 'off', tilt: 'off' });
    expect(setFollow).toHaveBeenLastCalledWith(undefined);
    setFollow.mockClear();
    send(facing(200));
    expect(targets(setFollow)).toEqual([]);
  });

  it('remembers the mode on this device, and starts in it where no tap is needed', async () => {
    const { result, unmount } = setup();
    sensors(result);
    expect(localStorage.getItem(CAMERA_MODE_KEY)).toBe('sensors');
    expect(storedCameraMode()).toBe('sensors');
    unmount();
    expect(setup({ initialMode: 'sensors' }).result.current.mode).toBe('sensors');
    // iOS needs a tap to allow the sensors: Manual until then (it refuses a request without one).
    vi.stubGlobal(
      'DeviceOrientationEvent',
      Object.assign(class {}, { requestPermission: vi.fn().mockResolvedValue('denied') }),
    );
    const ios = setup({ initialMode: 'sensors' });
    await act(async () => {});
    expect(ios.result.current).toMatchObject({ mode: 'manual', refusal: undefined });
    // Chrome has the function too and grants it without a tap.
    vi.stubGlobal(
      'DeviceOrientationEvent',
      Object.assign(class {}, { requestPermission: vi.fn().mockResolvedValue('granted') }),
    );
    const chrome = setup({ initialMode: 'sensors' });
    expect(chrome.result.current.mode).toBe('manual');
    await act(async () => {});
    expect(chrome.result.current.mode).toBe('sensors');
    // No sensors at all: Manual.
    vi.stubGlobal('DeviceOrientationEvent', undefined);
    expect(setup({ initialMode: 'sensors' }).result.current).toMatchObject({
      supported: false,
      mode: 'manual',
    });
    act(() => result.current.setMode('manual'));
    expect(localStorage.getItem(CAMERA_MODE_KEY)).toBeNull();
    localStorage.setItem(CAMERA_MODE_KEY, 'nonsense');
    expect(storedCameraMode()).toBe('manual');
  });

  it('never follows a relative event as a compass, and falls back to Manual without data', () => {
    vi.useFakeTimers();
    const { result, setFollow } = setup();
    sensors(result);
    send(orientation('deviceorientation', { alpha: 123, beta: 90, gamma: 0, absolute: false }));
    // The tilt is used, the relative alpha is not.
    expect(targets(setFollow).every((t) => t.yaw === undefined)).toBe(true);
    expect(result.current).toMatchObject({ heading: 'waiting', tilt: 'on' });
    expect(compassStatusText(result.current)).toBe('Waiting for the sensors…');
    act(() => void vi.advanceTimersByTime(NO_EVENTS_MS + 10));
    expect(result.current).toMatchObject({ mode: 'manual', refusal: 'no-events', heading: 'off' });
    expect(compassStatusText(result.current)).toMatch(/No motion sensor data.*back to Manual/);
    expect(setFollow).toHaveBeenLastCalledWith(undefined);
    expect(storedCameraMode()).toBe('manual');
    // Choosing again starts afresh and clears the message.
    sensors(result);
    expect(result.current).toMatchObject({ mode: 'sensors', refusal: undefined });
    send(facing(45));
    act(() => void vi.advanceTimersByTime(NO_EVENTS_MS + 10));
    expect(result.current).toMatchObject({ mode: 'sensors', heading: 'on', tilt: 'on' });
    expect(compassStatusText(result.current)).toBe('');
  });

  it('asks for permission where the browser requires it, and stays in Manual on a refusal', async () => {
    const requestPermission = vi.fn().mockResolvedValue('denied');
    vi.stubGlobal('DeviceOrientationEvent', Object.assign(class {}, { requestPermission }));
    const { result } = setup();
    expect(requestPermission).not.toHaveBeenCalled();
    await act(async () => result.current.setMode('sensors'));
    expect(result.current).toMatchObject({ mode: 'manual', heading: 'off', refusal: 'denied' });
    expect(compassStatusText(result.current)).toMatch(/did not allow.*Manual/);

    requestPermission.mockRejectedValueOnce(new Error('no sensors'));
    await act(async () => result.current.setMode('sensors'));
    expect(result.current.refusal).toBe('unavailable');
    expect(compassStatusText(result.current)).toMatch(/not available/);

    requestPermission.mockResolvedValue('granted');
    await act(async () => result.current.setMode('sensors'));
    expect(result.current).toMatchObject({
      mode: 'sensors',
      heading: 'waiting',
      refusal: undefined,
    });
    expect(requestPermission).toHaveBeenCalledTimes(3);
  });

  it('uses the heading and accuracy Safari reports, corrected for landscape', () => {
    const { result, lastYaw } = setup();
    sensors(result);
    const ios = (heading: number, accuracy: number) =>
      orientation('deviceorientation', {
        alpha: 42,
        beta: 90,
        gamma: 0,
        absolute: false,
        webkitCompassHeading: heading,
        webkitCompassAccuracy: accuracy,
      });
    send(ios(120, 14.6));
    expect(result.current).toMatchObject({ heading: 'on', accuracy: 15 });
    expect(lastYaw()).toBeCloseTo(yawFromCompass(120, 0));

    // Landscape, top of the device to the left: the camera looks 90° clockwise of that heading.
    (window as { orientation?: number }).orientation = 90;
    expect(screenAngle()).toBe(90);
    send(ios(120, -1));
    expect(lastYaw()).toBeCloseTo(yawFromCompass(210, 0));
    expect(result.current.accuracy).toBe(-1);
    (window as { orientation?: number }).orientation = -90;
    expect(screenAngle()).toBe(270);
  });

  it('pauses while the page is hidden and listens afresh when it returns', () => {
    const { result, setFollow } = setup();
    sensors(result);
    send(facing(10));
    expect(result.current.heading).toBe('on');

    const visibility = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');
    act(() => void document.dispatchEvent(new Event('visibilitychange')));
    expect(result.current).toMatchObject({ mode: 'sensors', heading: 'paused', tilt: 'paused' });
    expect(compassStatusText(result.current)).toMatch(/paused/);
    expect(setFollow).toHaveBeenLastCalledWith(undefined);
    setFollow.mockClear();
    send(facing(200));
    expect(targets(setFollow)).toEqual([]);
    // A photo taken now is not marked as measured.
    expect(result.current.snapshot().source).toBe('manual');

    visibility.mockReturnValue('visible');
    act(() => void document.dispatchEvent(new Event('visibilitychange')));
    expect(result.current.heading).toBe('waiting');
    send(facing(200));
    expect(result.current.heading).toBe('on');
    expect(setFollow.mock.lastCall![0]!.yaw).toBeCloseTo(yawFromCompass(200, 0));

    vi.mocked(document.hasFocus).mockReturnValue(false);
    act(() => void window.dispatchEvent(new Event('blur')));
    expect(result.current.heading).toBe('paused');
  });

  it('follows the tilt of the phone, held within what the figure can look', () => {
    const { result, setFollow } = setup();
    sensors(result);
    send(facing(0, { beta: 0 }));
    expect(setFollow.mock.lastCall![0]!.pitch).toBeCloseTo(-1.45);
  });

  describe('calibration', () => {
    it('calibrates against a direction known from the model, keeps it, and resets it', () => {
      const { result, lastYaw } = setup({ northBearing: 20, declination: 3 });
      expect(result.current.calibrateTo(0)).toBe(false);
      sensors(result);
      send(facing(60));
      // The phone points at a door that the model has at true bearing 70.
      const doorYaw = yawFromCompass(70, 20);
      let done = false;
      act(() => void (done = result.current.calibrateTo(doorYaw)));
      expect(done).toBe(true);
      expect(result.current.calibration).toBe(7);
      expect(localStorage.getItem(CALIBRATION_KEY)).toBe('7');
      // At once, without waiting for the next sensor event.
      expect(lastYaw()).toBeCloseTo(doorYaw);

      act(() => result.current.resetCalibration());
      expect(result.current.calibration).toBe(0);
      expect(localStorage.getItem(CALIBRATION_KEY)).toBeNull();
      expect(lastYaw()).toBeCloseTo(yawFromCompass(63, 20));
    });

    it('starts with the offset stored on this device', () => {
      localStorage.setItem(CALIBRATION_KEY, '-12.5');
      const { result, lastYaw } = setup();
      expect(result.current.calibration).toBe(-12.5);
      sensors(result);
      send(facing(100));
      expect(lastYaw()).toBeCloseTo(yawFromCompass(87.5, 0));
      localStorage.setItem(CALIBRATION_KEY, 'nonsense');
      expect(setup().result.current.calibration).toBe(0);
    });

    it('applies a new declination from the home at once', () => {
      const { result, lastYaw, rerender } = setup();
      sensors(result);
      send(facing(100));
      rerender({ northBearing: 0, declination: 4 });
      expect(lastYaw()).toBeCloseTo(yawFromCompass(104, 0));
    });
  });

  describe('snapshot for a photo', () => {
    it('records what the sensors said and the settings that were applied', () => {
      localStorage.setItem(CALIBRATION_KEY, '-7');
      const { result } = setup({ northBearing: 20, declination: 3 });
      sensors(result);
      send(facing(88.5, { beta: 84, gamma: -2 }));
      const snapshot = result.current.snapshot();
      expect(snapshot).toMatchObject({
        source: 'sensor',
        alpha: 271.5,
        beta: 84,
        gamma: -2,
        absolute: true,
        screenAngle: 0,
        declination: 3,
        calibrationOffset: -7,
        tilt: true,
        // The view the photo is saved with: the figure's (smoothed) yaw and pitch.
        yaw: 0.25,
        pitch: -0.1,
      });
      // A phone rolled a little (gamma -2) points its camera a little to the side.
      expect(Math.abs(snapshot.magneticBearing! - 88.5)).toBeLessThan(3);
      expect(snapshot.trueBearing).toBeCloseTo(((-0.25 * 180) / Math.PI - 20 + 360) % 360);
      expect(Date.parse(snapshot.capturedAt!)).not.toBeNaN();
      expect(snapshot).not.toHaveProperty('compassHeading');
      // Orientation only: nothing that says where the phone is.
      expect(Object.keys(snapshot).join(' ')).not.toMatch(/lat|lon|position|coord/i);
    });

    it('keeps the iOS heading and accuracy', () => {
      const { result } = setup();
      sensors(result);
      send(
        orientation('deviceorientation', {
          alpha: 42,
          beta: 80,
          gamma: 1,
          absolute: false,
          webkitCompassHeading: 120,
          webkitCompassAccuracy: 15,
        }),
      );
      expect(result.current.snapshot()).toMatchObject({
        source: 'sensor',
        compassHeading: 120,
        compassAccuracy: 15,
        absolute: false,
        magneticBearing: 120,
        tilt: true,
      });
    });

    it('says "manual" when the view was set by hand', () => {
      const { result } = setup();
      expect(result.current.snapshot()).toEqual({
        source: 'manual',
        yaw: 0.25,
        pitch: -0.1,
        capturedAt: expect.any(String) as string,
      });
      // Sensor mode, but no reading yet: still manual.
      sensors(result);
      expect(result.current.snapshot().source).toBe('manual');
      // Only the tilt so far (no compass event yet): the heading was set by hand.
      send(orientation('deviceorientation', { alpha: 1, beta: 80, gamma: 0, absolute: false }));
      expect(result.current.snapshot()).toMatchObject({ source: 'manual', tilt: true });
    });
  });
});
