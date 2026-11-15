import { render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { App } from './App';

// jsdom has no WebGL, so the R3F canvas is replaced with a stub.
vi.mock('./scene/Scene', () => ({ Scene: () => <div data-testid="scene" /> }));

const jsonResponse = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

describe('App', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('renders the scene and the homes fetched from the API', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({
        items: [
          {
            id: '0b5c7a44-0a43-4c35-8a4c-1f1a2f0f4f11',
            name: 'Mock home',
            createdAt: '2026-01-01T00:00:00.000Z',
            updatedAt: '2026-01-01T00:00:00.000Z',
          },
        ],
      }),
    );
    vi.stubGlobal('fetch', fetchMock);

    render(<App />);

    expect(screen.getByTestId('scene')).toBeInTheDocument();
    expect(await screen.findByText('Mock home')).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith('/api/homes', expect.anything());
  });

  it('shows an error when the API fails', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({}, 500)));
    render(<App />);
    expect(await screen.findByText(/API error/)).toBeInTheDocument();
  });
});
