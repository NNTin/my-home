import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { App } from './App';
import type { SceneProps } from './scene/Scene';
import { fakeApi, homeSummary } from './test/fakeApi';
import { mockHome } from './test/fixtures';
import { WALK_SESSION_KEY } from './walk/walkSession';

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
    sessionStorage.clear();
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
  describe('walking', () => {
    it('starts walking in first person: the whole building, no panels, no room names', async () => {
      stubApi();
      render(<App />);
      fireEvent.click(await screen.findByRole('button', { name: /Walk and take photos/ }));

      expect(screen.getByRole('application', { name: 'Movement pad' })).toBeInTheDocument();
      expect(screen.queryByRole('region', { name: 'View controls' })).not.toBeInTheDocument();
      expect(lastScene?.walk?.view).toBe('first');
      // The figure starts on the lowest level of the mock home, inside a room.
      expect(lastScene?.walk?.figure.current).toMatchObject({ levelId: 'souterrain', y: -1.2 });
      expect(screen.getByRole('status', { name: 'Figure location' })).toHaveTextContent(
        /· Souterrain$/,
      );
      expect(levelsOf()).toEqual(new Set(['souterrain', 'ground-floor', 'first-floor']));
      expect(lastScene?.scene.roofPlanes).toHaveLength(2);
      expect(lastScene?.labels).toEqual([]);
    });

    it('cuts the building away at the level of the figure in the overview', async () => {
      stubApi();
      render(<App />);
      fireEvent.click(await screen.findByRole('button', { name: /Walk and take photos/ }));
      fireEvent.click(screen.getByRole('button', { name: 'Overview' }));

      expect(lastScene?.walk?.view).toBe('third');
      expect(levelsOf()).toEqual(new Set(['souterrain']));
      expect(lastScene?.scene.roofPlanes).toHaveLength(0);
      expect(lastScene?.labels.map((l) => l.name)).toContain('Hallway');
    });

    it('returns to the viewer as it was on exit', async () => {
      stubApi();
      render(<App />);
      const cutaway = within(await screen.findByRole('group', { name: 'Show up to level' }));
      fireEvent.click(cutaway.getByLabelText('Ground floor'));
      fireEvent.click(screen.getByRole('button', { name: /Walk and take photos/ }));
      fireEvent.click(screen.getByRole('button', { name: /Exit/ }));

      expect(lastScene?.walk).toBeUndefined();
      expect(screen.getByRole('region', { name: 'View controls' })).toBeInTheDocument();
      expect(levelsOf()).toEqual(new Set(['souterrain', 'ground-floor']));
    });

    it('saves the magnetic declination of the home from the calibration sheet', async () => {
      vi.stubGlobal('DeviceOrientationEvent', class {});
      const models: Record<string, unknown> = {};
      const fetchMock = stubApi(undefined, models);
      render(<App />);
      fireEvent.click(await screen.findByRole('button', { name: /Walk and take photos/ }));
      fireEvent.click(screen.getByRole('button', { name: /Heading off/ }));
      fireEvent.click(screen.getByRole('button', { name: 'Calibrate' }));
      const sheet = within(screen.getByRole('region', { name: 'Calibrate the compass' }));
      // The doors and windows of the room the figure stands in are offered as targets.
      expect(sheet.getAllByRole('button', { name: /^(Door|Window):/ }).length).toBeGreaterThan(0);
      expect(sheet.getByLabelText(/Magnetic declination/)).toHaveValue(0);

      // While the page is open, the stored home changes: an agent corrects it through the api.
      const corrected = {
        ...mockHome,
        name: 'Mock home, corrected by an agent',
        rooms: mockHome.rooms.map((r, i) => (i === 0 ? { ...r, name: 'Renamed room' } : r)),
      };
      models['mock-home'] = corrected;

      fireEvent.change(sheet.getByLabelText(/Magnetic declination/), { target: { value: '4' } });
      fireEvent.click(sheet.getByRole('button', { name: 'Save' }));
      expect(await sheet.findByText('Declination saved for this home.')).toBeInTheDocument();
      const puts = () => fetchMock.mock.calls.filter(([, init]) => init?.method === 'PUT');
      expect(puts()[0]![0]).toBe('/api/homes/mock-home');
      const saved = JSON.parse(puts()[0]![1]!.body as string) as typeof mockHome;
      // By default the value counts as read off a chart or model.
      expect(saved.building.magneticDeclination).toEqual({
        value: 4,
        source: 'geodata',
        note: 'From a declination chart or model, entered in the app',
      });
      // The save is made on the home as it is stored now: the agent's correction survives, and
      // nothing but the declination differs from it.
      expect(saved.name).toBe('Mock home, corrected by an agent');
      expect(saved.rooms[0]!.name).toBe('Renamed room');
      expect({ ...saved, building: { ...saved.building, magneticDeclination: undefined } }).toEqual(
        {
          ...corrected,
          building: { ...corrected.building, magneticDeclination: undefined },
        },
      );

      // The provenance can be set to a measurement on site.
      fireEvent.change(sheet.getByLabelText('Where it is from'), { target: { value: 'measured' } });
      fireEvent.click(sheet.getByRole('button', { name: 'Save' }));
      await waitFor(() => expect(puts()).toHaveLength(2));
      const measured = JSON.parse(puts()[1]![1]!.body as string) as typeof mockHome;
      expect(measured.building.magneticDeclination).toMatchObject({ value: 4, source: 'measured' });
      expect(measured.name).toBe('Mock home, corrected by an agent');
    });

    it('comes back walking where the shutter was tapped when the camera app reloaded the page', async () => {
      stubApi();
      const first = render(<App />);
      fireEvent.click(await screen.findByRole('button', { name: /Walk and take photos/ }));
      fireEvent.click(screen.getByRole('button', { name: 'Overview' }));
      const figure = { ...lastScene!.walk!.figure.current };
      // The shutter opens the phone's camera app: the scene stops drawing meanwhile.
      fireEvent.click(screen.getByLabelText('Take photo'));
      expect(lastScene?.paused).toBe(true);
      // The browser throws the tab away and loads the page afresh: no React cleanup runs, and
      // sessionStorage is all that is left.
      const kept = sessionStorage.getItem(WALK_SESSION_KEY);
      expect(JSON.parse(kept!)).toMatchObject({ homeId: 'mock-home', view: 'third' });
      first.unmount();
      sessionStorage.setItem(WALK_SESSION_KEY, kept!);

      render(<App />);
      expect(await screen.findByRole('application', { name: 'Movement pad' })).toBeInTheDocument();
      expect(lastScene?.walk?.view).toBe('third');
      expect(lastScene?.walk?.figure.current).toMatchObject(figure);
      expect(lastScene?.paused).toBe(false);
      const notice = screen.getByRole('alert');
      expect(notice).toHaveTextContent(/reloaded the page while the camera app was open/);
      expect(notice).toHaveTextContent(/please take it again/);
      fireEvent.click(within(notice).getByRole('button', { name: 'OK' }));
      expect(screen.queryByRole('alert')).not.toBeInTheDocument();

      // The restored walk is over once left: walking again is a fresh walk, without the notice.
      fireEvent.click(screen.getByRole('button', { name: /Exit/ }));
      fireEvent.click(screen.getByRole('button', { name: /Walk and take photos/ }));
      expect(screen.getByRole('application', { name: 'Movement pad' })).toBeInTheDocument();
      expect(screen.queryByRole('alert')).not.toBeInTheDocument();
      expect(screen.queryByText(/reloaded the page/)).not.toBeInTheDocument();
    });

    it('prefers the walk of this tab to the ?walk of the address, which a reload keeps', async () => {
      window.history.replaceState(null, '', '/?walk=first');
      const figure = { x: 0.5, z: 1, y: -1.2, levelId: 'souterrain', yaw: 1, pitch: 0 };
      sessionStorage.setItem(
        WALK_SESSION_KEY,
        JSON.stringify({
          homeId: 'mock-home',
          view: 'third',
          figure,
          heading: false,
          tilt: false,
          pending: { figure, sensors: { source: 'manual' }, at: 1 },
          savedAt: Date.now(),
        }),
      );
      stubApi();
      render(<App />);
      expect(await screen.findByRole('application', { name: 'Movement pad' })).toBeInTheDocument();
      expect(lastScene?.walk?.view).toBe('third');
      expect(lastScene?.walk?.figure.current).toMatchObject(figure);
      expect(screen.getByRole('alert')).toHaveTextContent(/please take it again/);
    });

    it('forgets the walk on exit, so a reload then shows the viewer', async () => {
      stubApi();
      render(<App />);
      fireEvent.click(await screen.findByRole('button', { name: /Walk and take photos/ }));
      expect(sessionStorage.getItem(WALK_SESSION_KEY)).not.toBeNull();
      fireEvent.click(screen.getByRole('button', { name: /Exit/ }));
      expect(sessionStorage.getItem(WALK_SESSION_KEY)).toBeNull();
    });

    it('opens walking directly from the address: ?walk=third', async () => {
      window.history.replaceState(null, '', '/?walk=third');
      stubApi();
      render(<App />);
      expect(await screen.findByRole('application', { name: 'Movement pad' })).toBeInTheDocument();
      expect(lastScene?.walk?.view).toBe('third');
    });
  });
});
