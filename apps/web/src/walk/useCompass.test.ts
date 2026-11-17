import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { yawFromCompass, type Figure } from './figure';
import type { FollowTarget } from './orientation';
import {
  CALIBRATION_KEY,
  compassStatusText,
  NO_EVENTS_MS,
  screenAngle,
  useCompass,
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

function setup(options: { northBearing?: number; declination?: number } = {}) {
  const setFollow = vi.fn<(target: FollowTarget | undefined) => void>();
  const hook = renderHook(
    (props: { northBearing: number; declination: number }) =>
      useCompass({ ...props, setFollow, getFigure: () => figure }),
    { initialProps: { northBearing: 0, declination: 0, ...options } },
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

  it('follows the phone once it is switched on: bearing + declination + northBearing', () => {
    const { result, setFollow, lastYaw } = setup({ northBearing: 20, declination: 3 });
    expect(result.current).toMatchObject({ supported: true, heading: 'off', tilt: 'off' });
    send(facing(90));
    expect(targets(setFollow)).toEqual([]);

    act(() => result.current.toggleHeading());
    expect(result.current).toMatchObject({ heading: 'waiting', tilt: 'off' });
    send(facing(90));
    expect(result.current).toMatchObject({ heading: 'on', tilt: 'off', accuracy: undefined });
    // Magnetic 90 + 3 declination = 93 true; + 20 = 113 clockwise of -z.
    expect(lastYaw()).toBeCloseTo(yawFromCompass(93, 20));
    // The tilt is its own mode: off, the phone's tilt is not followed.
    expect(setFollow.mock.lastCall![0]!.pitch).toBeUndefined();

    act(() => result.current.toggleTilt());
    send(facing(90, { beta: 60 }));
    expect(result.current.tilt).toBe('on');
    expect(setFollow.mock.lastCall![0]!.pitch).toBeCloseTo((-30 * Math.PI) / 180);
    // Tilting the phone leaves the heading alone.
    expect(lastYaw()).toBeCloseTo(yawFromCompass(93, 20));
  });

  it('stops following when it is switched off', () => {
    const { result, setFollow } = setup();
    act(() => result.current.toggleHeading());
    send(facing(10));
    act(() => result.current.toggleHeading());
    expect(result.current).toMatchObject({ heading: 'off', tilt: 'off' });
    expect(setFollow).toHaveBeenLastCalledWith(undefined);
    setFollow.mockClear();
    send(facing(200));
    expect(targets(setFollow)).toEqual([]);
  });

  it('never follows a relative event, and says so when nothing usable arrives', () => {
    vi.useFakeTimers();
    const { result, setFollow } = setup();
    act(() => result.current.toggleHeading());
    send(orientation('deviceorientation', { alpha: 123, beta: 90, gamma: 0, absolute: false }));
    expect(targets(setFollow)).toEqual([]);
    expect(result.current.heading).toBe('waiting');
    expect(compassStatusText(result.current)).toBe('Waiting for the sensors…');
    act(() => void vi.advanceTimersByTime(NO_EVENTS_MS + 10));
    expect(result.current.heading).toBe('no-events');
    expect(compassStatusText(result.current)).toMatch(/No compass data/);
    // A late first event still switches it on.
    send(facing(45));
    expect(result.current.heading).toBe('on');
    expect(compassStatusText(result.current)).toBe('');
  });

  it('asks for permission where the browser requires it, and reports a refusal', async () => {
    const requestPermission = vi.fn().mockResolvedValue('denied');
    vi.stubGlobal('DeviceOrientationEvent', Object.assign(class {}, { requestPermission }));
    const { result } = setup();
    expect(requestPermission).not.toHaveBeenCalled();
    await act(async () => result.current.toggleHeading());
    expect(result.current).toMatchObject({ heading: 'off', refusal: 'denied' });
    expect(compassStatusText(result.current)).toMatch(/permission/);

    requestPermission.mockRejectedValueOnce(new Error('no sensors'));
    await act(async () => result.current.toggleHeading());
    expect(result.current.refusal).toBe('unavailable');

    requestPermission.mockResolvedValue('granted');
    await act(async () => result.current.toggleHeading());
    expect(result.current).toMatchObject({ heading: 'waiting', refusal: undefined });
    // The tilt rides on the same permission: no second prompt.
    await act(async () => result.current.toggleTilt());
    expect(result.current.tilt).toBe('waiting');
    expect(requestPermission).toHaveBeenCalledTimes(3);
  });

  it('uses the heading and accuracy Safari reports, corrected for landscape', () => {
    const { result, lastYaw } = setup();
    act(() => result.current.toggleHeading());
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
    act(() => result.current.toggleHeading());
    send(facing(10));
    expect(result.current.heading).toBe('on');

    const visibility = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');
    act(() => void document.dispatchEvent(new Event('visibilitychange')));
    expect(result.current.heading).toBe('paused');
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

  describe('tilt on its own', () => {
    const relative = (beta: number, gamma = 0) =>
      orientation('deviceorientation', { alpha: 17, beta, gamma, absolute: false });

    it('follows the tilt of the phone from relative events, with the heading left alone', () => {
      const { result, setFollow } = setup();
      act(() => result.current.toggleTilt());
      expect(result.current).toMatchObject({ tilt: 'waiting', heading: 'off' });
      send(relative(60));
      expect(result.current).toMatchObject({ tilt: 'on', heading: 'off' });
      expect(setFollow).toHaveBeenLastCalledWith({
        yaw: undefined,
        pitch: expect.closeTo(-Math.PI / 6, 5) as number,
      });
      send(relative(120));
      expect(setFollow.mock.lastCall![0]!.pitch).toBeCloseTo(Math.PI / 6);
      // Flat on a table: straight down, held within what the figure can look.
      send(relative(0));
      expect(setFollow.mock.lastCall![0]!.pitch).toBeCloseTo(-1.45);

      act(() => result.current.toggleTilt());
      expect(result.current.tilt).toBe('off');
      expect(setFollow).toHaveBeenLastCalledWith(undefined);
    });

    it('keeps working when the compass gives nothing, and says which one is silent', () => {
      vi.useFakeTimers();
      const { result, setFollow } = setup();
      act(() => result.current.toggleHeading());
      act(() => result.current.toggleTilt());
      send(relative(75));
      act(() => void vi.advanceTimersByTime(NO_EVENTS_MS + 10));
      expect(result.current).toMatchObject({ heading: 'no-events', tilt: 'on' });
      expect(compassStatusText(result.current)).toMatch(/No compass data/);
      expect(setFollow.mock.lastCall![0]).toEqual({
        yaw: undefined,
        pitch: expect.closeTo((-15 * Math.PI) / 180, 5) as number,
      });
    });

    it('switching the heading off leaves the tilt following', () => {
      const { result, setFollow } = setup();
      act(() => result.current.toggleHeading());
      act(() => result.current.toggleTilt());
      send(facing(90, { beta: 80 }));
      expect(setFollow.mock.lastCall![0]!.yaw).toBeCloseTo(yawFromCompass(90, 0));
      act(() => result.current.toggleHeading());
      send(facing(180, { beta: 70 }));
      expect(result.current).toMatchObject({ heading: 'off', tilt: 'on' });
      expect(setFollow.mock.lastCall![0]).toEqual({
        yaw: undefined,
        pitch: expect.closeTo((-20 * Math.PI) / 180, 5) as number,
      });
    });
  });

  describe('calibration', () => {
    it('turns the view by hand: the offset changes, is shown, and is kept on this device', () => {
      const { result, lastYaw } = setup();
      act(() => result.current.toggleHeading());
      send(facing(90));
      act(() => result.current.adjustCalibration(7));
      expect(result.current.calibration).toBe(7);
      // At once, without waiting for the next sensor event.
      expect(lastYaw()).toBeCloseTo(yawFromCompass(97, 0));
      act(() => result.current.adjustCalibration(-2.26));
      expect(result.current.calibration).toBe(4.7);
      expect(localStorage.getItem(CALIBRATION_KEY)).toBe('4.7');
      send(facing(180));
      expect(lastYaw()).toBeCloseTo(yawFromCompass(184.7, 0));

      act(() => result.current.resetCalibration());
      expect(result.current.calibration).toBe(0);
      expect(localStorage.getItem(CALIBRATION_KEY)).toBeNull();
      expect(lastYaw()).toBeCloseTo(yawFromCompass(180, 0));
    });

    it('calibrates against a direction known from the model', () => {
      const { result, lastYaw } = setup({ northBearing: 20, declination: 3 });
      expect(result.current.calibrateTo(0)).toBe(false);
      act(() => result.current.toggleHeading());
      send(facing(60));
      // The phone points at a door that the model has at true bearing 70.
      const doorYaw = yawFromCompass(70, 20);
      let done = false;
      act(() => void (done = result.current.calibrateTo(doorYaw)));
      expect(done).toBe(true);
      expect(result.current.calibration).toBe(7);
      expect(lastYaw()).toBeCloseTo(doorYaw);
    });

    it('starts with the offset stored on this device', () => {
      localStorage.setItem(CALIBRATION_KEY, '-12.5');
      const { result, lastYaw } = setup();
      expect(result.current.calibration).toBe(-12.5);
      act(() => result.current.toggleHeading());
      send(facing(100));
      expect(lastYaw()).toBeCloseTo(yawFromCompass(87.5, 0));
      localStorage.setItem(CALIBRATION_KEY, 'nonsense');
      expect(setup().result.current.calibration).toBe(0);
    });

    it('applies a new declination from the home at once', () => {
      const { result, lastYaw, rerender } = setup();
      act(() => result.current.toggleHeading());
      send(facing(100));
      rerender({ northBearing: 0, declination: 4 });
      expect(lastYaw()).toBeCloseTo(yawFromCompass(104, 0));
    });
  });

  describe('snapshot for a photo', () => {
    it('records what the sensors said and the settings that were applied', () => {
      const { result } = setup({ northBearing: 20, declination: 3 });
      act(() => result.current.toggleHeading());
      act(() => result.current.adjustCalibration(-7));
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
        tilt: false,
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
      act(() => result.current.toggleHeading());
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
      // Switched on, but no reading yet: still manual.
      act(() => result.current.toggleHeading());
      expect(result.current.snapshot().source).toBe('manual');
    });
  });
});
