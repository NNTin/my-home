import { describe, expect, it } from 'vitest';
import { renderSupport } from './renderSupport';

describe('whether the browser can make path-traced renders', () => {
  it('cannot without WebGPU', async () => {
    expect(await renderSupport(undefined)).toBe('none');
  });

  it('cannot without an adapter, or when asking for one fails', async () => {
    expect(await renderSupport({ requestAdapter: () => Promise.resolve(null) })).toBe('none');
    expect(await renderSupport({ requestAdapter: () => Promise.reject(new Error('no')) })).toBe(
      'none',
    );
  });

  it('tells a graphics card from an adapter drawn by the processor', async () => {
    expect(await renderSupport({ requestAdapter: () => Promise.resolve({ info: {} }) })).toBe('ok');
    expect(
      await renderSupport({
        requestAdapter: () => Promise.resolve({ info: { isFallbackAdapter: true } }),
      }),
    ).toBe('software');
    expect(
      await renderSupport({ requestAdapter: () => Promise.resolve({ isFallbackAdapter: true }) }),
    ).toBe('software');
    expect(
      await renderSupport({
        requestAdapter: () => Promise.resolve({ info: { architecture: 'swiftshader' } }),
      }),
    ).toBe('software');
  });
});
