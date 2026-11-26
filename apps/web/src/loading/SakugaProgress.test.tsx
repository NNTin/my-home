import { act, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { HOLD_MS, LEAVE_MS } from './loading';
import { SakugaProgress } from './SakugaProgress';

class FakeProgress extends HTMLElement {
  values: number[] = [];
  set(n: number) {
    this.values.push(n);
  }
}

afterEach(() => {
  vi.useRealTimers();
});

describe('SakugaProgress', () => {
  it("is the browser's own bar without progress.js, and ends when full", () => {
    const onEnd = vi.fn();
    const { rerender } = render(
      <SakugaProgress value={0.42} label="Upload progress" onEnd={onEnd} />,
    );
    expect(screen.getByRole('progressbar', { name: 'Upload progress' })).toHaveValue(0.42);
    expect(screen.getByText('42%')).toBeInTheDocument();
    expect(onEnd).not.toHaveBeenCalled();
    rerender(<SakugaProgress value={1} label="Upload progress" onEnd={onEnd} />);
    expect(onEnd).toHaveBeenCalledOnce();
  });

  it('drives <sakuga-progress>, and ends after its end has played', () => {
    customElements.define('sakuga-progress', FakeProgress);
    vi.useFakeTimers();
    const onEnd = vi.fn();
    const { container, rerender } = render(
      <SakugaProgress value={0.3} label="Upload progress" onEnd={onEnd} />,
    );
    const bar = container.querySelector('sakuga-progress') as FakeProgress;
    expect(bar.getAttribute('label')).toBe('Upload progress');
    expect(bar.values).toEqual([0.3]);
    rerender(<SakugaProgress value={1} label="Upload progress" onEnd={onEnd} />);
    expect(bar.values).toEqual([0.3, 1]);
    expect(onEnd).not.toHaveBeenCalled();
    act(() => {
      bar.dispatchEvent(new CustomEvent('sakuga:done'));
      vi.advanceTimersByTime(HOLD_MS);
    });
    expect(bar.hasAttribute('data-leaving')).toBe(true);
    act(() => vi.advanceTimersByTime(LEAVE_MS));
    expect(onEnd).toHaveBeenCalledOnce();
  });
});
