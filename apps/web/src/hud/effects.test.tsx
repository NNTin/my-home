// The "Effects" switch (docs/design/hud.md §10.4): on by default, remembered on the device; off is calm (C3).
import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { QualityControl } from '../overlay/QualityControl';
import { EFFECTS_KEY } from './effects';

afterEach(() => {
  window.localStorage.clear();
  vi.useRealTimers();
  delete (window as { SakugaFX?: unknown }).SakugaFX;
});

/** The core as far as the setting uses it: `calm` (C3); no `later`, so the wait runs on the page's timers. */
const stubSakuga = () => ((window as { SakugaFX?: { calm: boolean } }).SakugaFX = { calm: false });

describe('the Effects switch', () => {
  it('is on by default, in the Quality group, and a flip off is remembered on the device', () => {
    render(<QualityControl quality="auto" onChange={() => {}} phone={false} />);
    const effects = screen.getByRole('switch', { name: 'Effects' });
    expect(effects).toBeChecked();
    fireEvent.click(effects);
    expect(effects).not.toBeChecked();
    expect(window.localStorage.getItem(EFFECTS_KEY)).toBe('off');
  });

  it('starts off on a device that said so', () => {
    window.localStorage.setItem(EFFECTS_KEY, 'off');
    render(<QualityControl quality="auto" onChange={() => {}} phone />);
    expect(screen.getByRole('switch', { name: 'Effects' })).not.toBeChecked();
  });

  it('stops the effects after its flip when switched off', () => {
    vi.useFakeTimers();
    const fx = stubSakuga();
    render(<QualityControl quality="auto" onChange={() => {}} phone={false} />);
    fireEvent.click(screen.getByRole('switch', { name: 'Effects' }));
    expect(fx.calm).toBe(false); // its own flip plays first
    vi.advanceTimersByTime(2000);
    expect(fx.calm).toBe(true);
  });

  it('keeps the effects on when switched off and on again within the flip', () => {
    vi.useFakeTimers();
    const fx = stubSakuga();
    render(<QualityControl quality="auto" onChange={() => {}} phone={false} />);
    const effects = screen.getByRole('switch', { name: 'Effects' });
    fireEvent.click(effects);
    vi.advanceTimersByTime(500);
    fireEvent.click(effects);
    vi.advanceTimersByTime(2000);
    expect(effects).toBeChecked();
    expect(fx.calm).toBe(false);
  });
});
