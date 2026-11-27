// The "Effects" switch (docs/design/hud.md §10.4): on by default, remembered on the device; off is calm (C3).
import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { QualityControl } from '../overlay/QualityControl';
import { EFFECTS_KEY } from './effects';

afterEach(() => window.localStorage.clear());

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
});
