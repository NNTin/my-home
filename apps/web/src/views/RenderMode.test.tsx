import { render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { App } from '../App';
import { fakeApi, homeSummary } from '../test/fakeApi';
import { renderRequest } from './RenderMode';

// jsdom has no WebGL: the canvas is a stub.
vi.mock('../scene/Scene', () => ({ Scene: () => <div data-testid="scene" /> }));
// The lazy chunk: a browser without WebGPU must never ask for it.
const loaded = vi.hoisted(() => ({ count: 0 }));
vi.mock('../render-mode/render-path', () => {
  loaded.count += 1;
  return { Gate: () => <div data-testid="gate" /> };
});

async function open(path: string) {
  fakeApi({ homes: [homeSummary('mock-home', 'Mock home')], models: {} });
  window.history.replaceState(null, '', path);
  render(<App />);
  await screen.findByRole('group', { name: 'Views' }, { timeout: 10_000 });
}

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
    expect(loaded.count).toBe(1);
  });
});
