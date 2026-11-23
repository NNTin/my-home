import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FrameGovernor } from './governor';
import { PerfReadout } from './PerfReadout';

const clipboard = (value: unknown) =>
  Object.defineProperty(navigator, 'clipboard', { value, configurable: true });

const lowView = (low: boolean) =>
  vi.stubGlobal(
    'matchMedia',
    vi.fn(() => ({ matches: low })),
  );

let governor: FrameGovernor;

const show = () =>
  render(
    <div>
      <canvas width={800} height={600} />
      <PerfReadout governor={governor} phone view={() => 'orbit, whole house with roof'} />
    </div>,
  );

beforeEach(() => {
  governor = new FrameGovernor();
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => Response.json({ status: 'ok', uptime: 1, commit: 'abc1234def' })),
  );
  lowView(false);
});

afterEach(() => {
  cleanup();
  governor.dispose();
  vi.unstubAllGlobals();
  vi.useRealTimers();
  clipboard(undefined);
});

describe('PerfReadout', () => {
  it('copies the report with one click and says so for a moment', async () => {
    const writeText = vi.fn(async (_text: string) => undefined);
    clipboard({ writeText });
    show();
    await waitFor(() => expect(fetch).toHaveBeenCalledWith('/api/health/live', expect.anything()));
    const frames = governor.perf().frames;
    await act(async () => undefined);
    vi.useFakeTimers();
    fireEvent.click(screen.getByRole('button', { name: 'Copy' }));
    await act(async () => undefined);
    expect(writeText).toHaveBeenCalledOnce();
    const text = writeText.mock.calls[0]![0];
    expect(text).toContain('| `?perf=1` | Measured | Budget (phone) |');
    expect(text).toContain('| Commit | abc1234 | |');
    expect(text).toContain('| Mode | orbit, whole house with roof | |');
    expect(text).toContain('| Canvas | 800×600 px | |');
    expect(text).toContain('| Draw calls, last 3 s | 0 (0 frames) | 0 while resting |');
    expect(screen.getByRole('button', { name: 'Copied' })).toBeTruthy();
    expect(screen.queryByRole('textbox')).toBeNull();
    // Copying asked the governor for nothing: no frame.
    expect(governor.perf().frames).toBe(frames);
    act(() => void vi.advanceTimersByTime(2000));
    expect(screen.getByRole('button', { name: 'Copy' })).toBeTruthy();
  });

  it('shows the report selected when there is no clipboard', async () => {
    show();
    fireEvent.click(screen.getByRole('button', { name: 'Copy' }));
    const text = await screen.findByRole<HTMLTextAreaElement>('textbox');
    expect(text.value).toContain('| `?perf=1` | Measured | Budget (phone) |');
    expect(text.readOnly).toBe(true);
    expect(document.activeElement).toBe(text);
    expect([text.selectionStart, text.selectionEnd]).toEqual([0, text.value.length]);
    expect(screen.getByRole('button', { name: 'Copy' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(screen.queryByRole('textbox')).toBeNull();
  });

  it('shows the report selected when the clipboard refuses', async () => {
    clipboard({ writeText: vi.fn(async () => Promise.reject(new Error('denied'))) });
    show();
    fireEvent.click(screen.getByRole('button', { name: 'Copy' }));
    expect((await screen.findByRole<HTMLTextAreaElement>('textbox')).value).toContain('| Commit |');
  });

  it('copies without a commit when the api does not answer', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => Promise.reject(new Error('offline'))),
    );
    const writeText = vi.fn(async (_text: string) => undefined);
    clipboard({ writeText });
    show();
    fireEvent.click(screen.getByRole('button', { name: 'Copy' }));
    await waitFor(() => expect(writeText).toHaveBeenCalled());
    expect(writeText.mock.calls[0]![0]).toContain('| Commit | unknown | |');
  });

  it('folds, and starts folded in a low view, where it can still copy', () => {
    const first = show();
    expect(screen.getByLabelText('Performance')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /Perf/ }));
    expect(screen.queryByLabelText('Performance')).toBeNull();
    first.unmount();
    lowView(true);
    show();
    expect(screen.queryByLabelText('Performance')).toBeNull();
    expect(screen.getByRole('button', { name: /Perf/ }).getAttribute('aria-expanded')).toBe(
      'false',
    );
    expect(screen.getByRole('button', { name: 'Copy' })).toBeTruthy();
  });
});
