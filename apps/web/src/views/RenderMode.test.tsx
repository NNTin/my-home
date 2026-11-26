import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { App } from '../App';
import { fakeApi, homeSummary } from '../test/fakeApi';
import { stubScreen } from '../test/screen';
import { renderRequest } from './RenderMode';

// jsdom has no WebGL: the canvas is a stub.
vi.mock('../scene/Scene', () => ({ Scene: () => <div data-testid="scene" /> }));
// The lazy chunk: a browser without WebGPU must never ask for it. A module is evaluated once a
// file, so what is counted is each time the app reaches into the chunk for one of its parts.
const loaded = vi.hoisted(() => ({ count: 0 }));
vi.mock('../render-mode/render-path', () => {
  const Gate = () => <div data-testid="gate" />;
  const RenderStill = ({ name, onClose }: { name: string; onClose(): void }) => (
    <div data-testid="still" data-name={name}>
      <button type="button" onClick={onClose}>
        Close
      </button>
    </div>
  );
  return {
    get Gate() {
      loaded.count += 1;
      return Gate;
    },
    get RenderStill() {
      loaded.count += 1;
      return RenderStill;
    },
  };
});

async function open(path: string) {
  fakeApi({ homes: [homeSummary('mock-home', 'Mock home')], models: {} });
  window.history.replaceState(null, '', path);
  render(<App />);
  return screen.findByRole('group', { name: 'Views' }, { timeout: 10_000 });
}

const withGpu = (info: { isFallbackAdapter?: boolean }) =>
  vi.stubGlobal('navigator', {
    ...navigator,
    userAgent: navigator.userAgent,
    gpu: { requestAdapter: () => Promise.resolve({ info }) },
  });
const renderButton = () => screen.getByRole('button', { name: 'Render' });

describe('the way into render mode', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    localStorage.clear();
    sessionStorage.clear();
    loaded.count = 0;
    window.history.replaceState(null, '', '/');
  });

  it('reads what the address asks for', () => {
    expect(renderRequest('?render=measure')).toEqual({ measure: true, anyAdapter: false });
    expect(renderRequest('?render=measure&adapter=any')).toEqual({
      measure: true,
      anyAdapter: true,
    });
    expect(renderRequest('?view=eye')).toEqual({ measure: false, anyAdapter: false });
  });

  it('is nothing in the viewer as it opens', async () => {
    await open('/');
    expect(document.querySelector('[data-render]')).toBeNull();
    expect(loaded.count).toBe(0);
  });

  it('tells a browser without WebGPU so, and downloads nothing for it', async () => {
    await open('/?render=measure');
    expect(await screen.findByText('This browser cannot make path-traced renders')).toHaveAttribute(
      'data-render',
      'unsupported',
    );
    expect(loaded.count).toBe(0);
    expect(screen.queryByTestId('gate')).toBeNull();
  });

  it('tells a browser whose WebGPU is drawn by the processor the same', async () => {
    vi.stubGlobal('navigator', {
      ...navigator,
      userAgent: navigator.userAgent,
      gpu: { requestAdapter: () => Promise.resolve({ info: { isFallbackAdapter: true } }) },
    });
    await open('/?render=measure');
    await screen.findByText('This browser cannot make path-traced renders');
    expect(loaded.count).toBe(0);
  });

  it('asks for the chunk once the browser has a graphics card for WebGPU', async () => {
    vi.stubGlobal('navigator', {
      ...navigator,
      userAgent: navigator.userAgent,
      gpu: { requestAdapter: () => Promise.resolve({ info: {} }) },
    });
    await open('/?render=measure');
    expect(await screen.findByTestId('gate', undefined, { timeout: 10_000 })).toBeInTheDocument();
    expect(loaded.count).toBeGreaterThan(0);
  });
});

describe('"Render" in the Views control', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    localStorage.clear();
    sessionStorage.clear();
    loaded.count = 0;
    window.history.replaceState(null, '', '/');
  });

  it('tells a browser without WebGPU so, keeps the view and downloads nothing', async () => {
    await open('/?view=cutaway');
    fireEvent.click(renderButton());
    expect(await screen.findByText('This browser cannot make path-traced renders')).toHaveAttribute(
      'role',
      'alert',
    );
    expect(loaded.count).toBe(0);
    expect(screen.queryByTestId('still')).toBeNull();
    // Render mode is off again, and the view is the one it was.
    await waitFor(() => expect(renderButton()).toHaveAttribute('aria-pressed', 'false'));
    expect(screen.getByRole('button', { name: 'Cutaway' })).toHaveAttribute('aria-pressed', 'true');
    expect(new URLSearchParams(window.location.search).get('view')).toBe('cutaway');
  });

  it('says the same where WebGPU is drawn by the processor', async () => {
    withGpu({ isFallbackAdapter: true });
    await open('/');
    fireEvent.click(renderButton());
    await screen.findByText('This browser cannot make path-traced renders');
    expect(loaded.count).toBe(0);
  });

  it('asks for the chunk only when pressed, and makes the still of the view on screen', async () => {
    withGpu({});
    await open('/?view=section');
    expect(loaded.count).toBe(0);
    fireEvent.click(renderButton());
    const still = await screen.findByTestId('still', undefined, { timeout: 10_000 });
    expect(loaded.count).toBeGreaterThan(0);
    expect(still).toHaveAttribute('data-name', 'section');
    expect(renderButton()).toHaveAttribute('aria-pressed', 'true');
    // "Close": back in the view it was, render mode off.
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    await waitFor(() => expect(screen.queryByTestId('still')).toBeNull());
    expect(renderButton()).toHaveAttribute('aria-pressed', 'false');
    expect(screen.getByRole('button', { name: 'Section' })).toHaveAttribute('aria-pressed', 'true');
  });

  it('names the still of the free view "free"', async () => {
    withGpu({});
    await open('/');
    fireEvent.click(renderButton());
    expect(await screen.findByTestId('still', undefined, { timeout: 10_000 })).toHaveAttribute(
      'data-name',
      'free',
    );
  });

  it('is not offered on a phone', async () => {
    stubScreen('portrait');
    withGpu({});
    await open('/?panel=view&sheet=full');
    expect(screen.queryByRole('button', { name: 'Render' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Save image' })).toBeInTheDocument();
  });
});
