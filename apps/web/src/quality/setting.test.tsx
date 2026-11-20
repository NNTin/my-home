import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import {
  defaultQuality,
  parseQuality,
  QUALITY_KEY,
  qualityLabel,
  resolveQuality,
  useQuality,
} from './setting';

afterEach(() => {
  window.localStorage.clear();
  window.history.replaceState(null, '', '/');
});

describe('the quality setting', () => {
  it('defaults to auto on a phone and beautiful on a desktop', () => {
    expect(defaultQuality(true)).toBe('auto');
    expect(defaultQuality(false)).toBe('beautiful');
  });

  it('resolves the URL first, then the remembered value, then the device default', () => {
    expect(resolveQuality({ search: '?quality=fast', stored: 'auto', phone: false })).toBe('fast');
    expect(resolveQuality({ search: '', stored: 'auto', phone: false })).toBe('auto');
    expect(resolveQuality({ search: '?home=x', stored: null, phone: false })).toBe('beautiful');
    expect(resolveQuality({ search: '', stored: undefined, phone: true })).toBe('auto');
  });

  it('ignores values it does not know', () => {
    expect(parseQuality('ultra')).toBeUndefined();
    expect(resolveQuality({ search: '?quality=ultra', stored: 'fast', phone: true })).toBe('fast');
    expect(resolveQuality({ search: '?quality=ultra', stored: 'x', phone: true })).toBe('auto');
  });

  it('a phone’s labels say what happens', () => {
    expect(['fast', 'auto', 'beautiful'].map((q) => qualityLabel(q as 'fast', true))).toEqual([
      'Fast',
      'Automatic',
      'Always beautiful',
    ]);
    expect(qualityLabel('auto', false)).toBe('Auto');
  });
});

describe('useQuality', () => {
  it('the URL wins for the visit and is not remembered', () => {
    window.localStorage.setItem(QUALITY_KEY, 'beautiful');
    window.history.replaceState(null, '', '/?quality=fast');
    const { result } = renderHook(() => useQuality(true));
    expect(result.current[0]).toBe('fast');
    expect(window.localStorage.getItem(QUALITY_KEY)).toBe('beautiful');
  });

  it('a value chosen in the control is remembered and wins over the URL', () => {
    window.history.replaceState(null, '', '/?quality=fast');
    const { result, unmount } = renderHook(() => useQuality(true));
    act(() => result.current[1]('beautiful'));
    expect(result.current[0]).toBe('beautiful');
    expect(window.localStorage.getItem(QUALITY_KEY)).toBe('beautiful');
    unmount();
    // The next visit, without the parameter.
    window.history.replaceState(null, '', '/');
    expect(renderHook(() => useQuality(true)).result.current[0]).toBe('beautiful');
  });

  it('falls back to the device default', () => {
    expect(renderHook(() => useQuality(true)).result.current[0]).toBe('auto');
    expect(renderHook(() => useQuality(false)).result.current[0]).toBe('beautiful');
  });
});
