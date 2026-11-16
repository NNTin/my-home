import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { compassBearing, useCompass } from './useCompass';

const orientation = (type: string, init: object) => Object.assign(new Event(type), init);

describe('compassBearing', () => {
  it('uses the heading iOS reports', () => {
    expect(
      compassBearing(orientation('deviceorientation', { webkitCompassHeading: 123 }) as never),
    ).toBe(123);
  });

  it('turns an absolute alpha (counter-clockwise) into a bearing (clockwise)', () => {
    const event = (alpha: number) =>
      orientation('deviceorientationabsolute', { absolute: true, alpha }) as never;
    expect(compassBearing(event(0))).toBe(0);
    expect(compassBearing(event(90))).toBe(270);
    expect(compassBearing(event(270))).toBe(90);
  });

  it('ignores events that are not referenced to north', () => {
    expect(
      compassBearing(orientation('deviceorientation', { absolute: false, alpha: 90 }) as never),
    ).toBeUndefined();
  });
});

describe('useCompass', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('turns the figure with the phone while it is on', () => {
    vi.stubGlobal('DeviceOrientationEvent', class {});
    const setYaw = vi.fn();
    const { result } = renderHook(() => useCompass(20, setYaw));
    expect(result.current).toMatchObject({ supported: true, active: false });

    const east = orientation('deviceorientationabsolute', { absolute: true, alpha: 270 });
    act(() => void window.dispatchEvent(east));
    expect(setYaw).not.toHaveBeenCalled();

    act(() => result.current.toggle());
    expect(result.current.active).toBe(true);
    act(() => void window.dispatchEvent(east));
    // Bearing 90° with north 20° clockwise of -z: 110° clockwise of -z.
    expect(setYaw).toHaveBeenLastCalledWith(expect.closeTo((-110 * Math.PI) / 180, 6));

    act(() => result.current.toggle());
    setYaw.mockClear();
    act(() => void window.dispatchEvent(east));
    expect(setYaw).not.toHaveBeenCalled();
  });

  it('asks for permission where the browser requires it, and reports a refusal', async () => {
    const requestPermission = vi.fn().mockResolvedValue('denied');
    vi.stubGlobal('DeviceOrientationEvent', Object.assign(class {}, { requestPermission }));
    const { result } = renderHook(() => useCompass(0, vi.fn()));
    await act(async () => result.current.toggle());
    expect(requestPermission).toHaveBeenCalled();
    expect(result.current.active).toBe(false);
    expect(result.current.error).toMatch(/permission/);

    requestPermission.mockResolvedValue('granted');
    await act(async () => result.current.toggle());
    expect(result.current).toMatchObject({ active: true, error: undefined });
  });
});
