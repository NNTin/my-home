import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { PLAN_COLOURS_KEY, usePlanColours } from './planColours';

afterEach(() => window.localStorage.clear());

describe('usePlanColours', () => {
  it('is off by default', () => {
    expect(renderHook(() => usePlanColours()).result.current[0]).toBe(false);
  });

  it('is remembered on this device', () => {
    const first = renderHook(() => usePlanColours());
    act(() => first.result.current[1](true));
    expect(first.result.current[0]).toBe(true);
    expect(window.localStorage.getItem(PLAN_COLOURS_KEY)).toBe('on');
    expect(renderHook(() => usePlanColours()).result.current[0]).toBe(true);
    act(() => first.result.current[1](false));
    expect(renderHook(() => usePlanColours()).result.current[0]).toBe(false);
  });
});
