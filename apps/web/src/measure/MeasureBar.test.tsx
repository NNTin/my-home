import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { MeasureBar } from './MeasureBar';

const props = () => ({
  points: [],
  missed: false,
  cross: [0.5, 0.5] as const,
  onCross: vi.fn(),
  onPickCross: vi.fn(),
  onClear: vi.fn(),
  onDone: vi.fn(),
});

describe('the measure task bar (HUD v2 #206)', () => {
  it('aims the cross with the arrows, within the view, and keeps them from the shortcuts', () => {
    const p = props();
    const onWindow = vi.fn();
    window.addEventListener('keydown', onWindow);
    render(<MeasureBar {...p} cross={[0.97, 0.5]} />);
    const aim = screen.getByRole('button', { name: /Pick the point under the cross/ });
    expect(document.activeElement).toBe(aim);
    fireEvent.keyDown(aim, { key: 'ArrowRight', shiftKey: true });
    expect(p.onCross).toHaveBeenLastCalledWith([0.98, 0.5]);
    fireEvent.keyDown(aim, { key: 'ArrowDown' });
    expect(p.onCross).toHaveBeenLastCalledWith([0.97, 0.52]);
    expect(onWindow).not.toHaveBeenCalled();
    window.removeEventListener('keydown', onWindow);
    fireEvent.click(aim);
    expect(p.onPickCross).toHaveBeenCalledOnce();
  });

  it('shows the last point in the model’s axes, and Clear only with something to clear', () => {
    const p = props();
    const { rerender } = render(<MeasureBar {...p} />);
    expect(screen.getByRole('button', { name: 'Clear' })).toBeDisabled();
    rerender(<MeasureBar {...p} points={[[0.5, 0, -1.25]]} />);
    const coords = screen.getByLabelText('Point A, model coordinates');
    expect(coords).toHaveTextContent('x (east)0.50 m');
    expect(coords).toHaveTextContent('z (south)−1.25 m');
    fireEvent.click(screen.getByRole('button', { name: 'Clear' }));
    expect(p.onClear).toHaveBeenCalledOnce();
    fireEvent.click(screen.getByRole('button', { name: 'Done' }));
    expect(p.onDone).toHaveBeenCalledOnce();
  });
});
