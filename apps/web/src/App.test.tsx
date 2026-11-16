import { fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { App } from './App';
import type { SceneProps } from './scene/Scene';
import { fakeApi, homeSummary } from './test/fakeApi';
import { mockHome } from './test/fixtures';

// jsdom has no WebGL, so the R3F canvas is replaced with a stub that exposes what it would draw.
let lastScene: SceneProps | undefined;
vi.mock('./scene/Scene', () => ({
  Scene: (props: SceneProps) => {
    lastScene = props;
    return <div data-testid="scene" />;
  },
}));

const jsonResponse = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

function stubApi(
  homes = [homeSummary('mock-home', 'Mock home')],
  models: Record<string, unknown> = {},
) {
  return fakeApi({ homes, models }).fetch;
}

const levelsOf = () => new Set(lastScene?.scene.walls.map((w) => w.levelId));

describe('App', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    localStorage.clear();
    lastScene = undefined;
    window.history.replaceState(null, '', '/');
  });

  it('loads the first home from the API and renders all of it', async () => {
    const fetchMock = stubApi();
    render(<App />);

    expect(await screen.findByTestId('scene')).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith('/api/homes', expect.anything());
    expect(fetchMock).toHaveBeenCalledWith('/api/homes/mock-home', expect.anything());
    expect(screen.getByText('Mock home')).toBeInTheDocument();
    expect(levelsOf()).toEqual(new Set(['souterrain', 'ground-floor', 'first-floor']));
    expect(lastScene?.scene.roofPlanes).toHaveLength(2);
    expect(lastScene?.northBearing).toBe(0);
    expect(lastScene?.markers.map((m) => m.label)).toEqual(['N', 'E', 'S', 'W']);
    expect(lastScene?.scene.outdoorAreas.map((a) => a.name)).toEqual([
      'Souterrain garden',
      'Ground-floor garden',
      'Driveway',
    ]);
  });

  it('cuts away the upper levels to look into the souterrain', async () => {
    stubApi();
    render(<App />);
    const cutaway = within(await screen.findByRole('group', { name: 'Show up to level' }));

    fireEvent.click(cutaway.getByLabelText('Souterrain'));
    expect(levelsOf()).toEqual(new Set(['souterrain']));
    expect(lastScene?.scene.slabs.map((s) => s.id)).toEqual(['souterrain:floor']);
    // The orbit target moves down into the souterrain (floor at -1.2 m, 2.5 m high).
    expect(lastScene?.target[1]).toBeCloseTo(0.05);
  });

  it('cuts away the roof to look into the attic', async () => {
    stubApi();
    render(<App />);
    const cutaway = within(await screen.findByRole('group', { name: 'Show up to level' }));
    expect(cutaway.getByLabelText('Roof')).toBeChecked();

    fireEvent.click(cutaway.getByLabelText('First floor (attic)'));
    expect(lastScene?.scene.roofPlanes).toEqual([]);
    expect(levelsOf()).toEqual(new Set(['souterrain', 'ground-floor', 'first-floor']));
    expect(screen.getByText(/Add to First floor \(attic\)/)).toBeInTheDocument();

    fireEvent.click(cutaway.getByLabelText('Roof'));
    expect(lastScene?.scene.roofPlanes).toHaveLength(2);
  });

  it('toggles apartments, levels and outdoor areas', async () => {
    stubApi();
    render(<App />);
    const apartments = within(await screen.findByRole('group', { name: 'Apartments' }));
    fireEvent.click(apartments.getByLabelText('Ground-floor apartment'));
    expect(levelsOf().has('ground-floor')).toBe(false);

    const levels = within(screen.getByRole('group', { name: 'Levels' }));
    fireEvent.click(levels.getByLabelText('First floor (attic)'));
    expect(levelsOf()).toEqual(new Set(['souterrain']));
    expect(lastScene?.scene.roofPlanes).toEqual([]);

    const outdoor = within(screen.getByRole('group', { name: 'Outdoor' }));
    fireEvent.click(outdoor.getByLabelText('Driveway'));
    expect(lastScene?.scene.outdoorAreas.map((a) => a.id)).not.toContain('driveway');
    fireEvent.click(outdoor.getByLabelText('Terrain'));
    expect(lastScene?.scene.terrain).toEqual([]);
  });

  it('renders whichever home is selected, with no renderer changes', async () => {
    const tiny = { ...mockHome, id: 'tiny', name: 'Tiny home', outdoorAreas: [] };
    stubApi([homeSummary('mock-home', 'Mock home'), homeSummary('tiny', 'Tiny home')], { tiny });
    render(<App />);
    fireEvent.change(await screen.findByLabelText('Home'), { target: { value: 'tiny' } });
    await vi.waitFor(() => expect(lastScene?.scene.outdoorAreas).toEqual([]));
    expect(window.location.search).toBe('?home=tiny');
  });

  it('shows a hint when there are no homes', async () => {
    stubApi([]);
    render(<App />);
    expect(await screen.findByText(/No homes yet/)).toBeInTheDocument();
  });

  it('shows the API error message', async () => {
    stubApi();
    window.history.replaceState(null, '', '/?home=missing');
    render(<App />);
    expect(await screen.findByText(/API error: .*Home "missing" not found/)).toBeInTheDocument();
  });

  it('shows an error when the API fails', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({}, 500)));
    render(<App />);
    expect(await screen.findByText(/API error: GET \/api\/homes failed: 500/)).toBeInTheDocument();
  });
});
