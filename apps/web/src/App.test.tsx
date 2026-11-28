import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { App } from './App';
import { enterEditMode } from './test/editMode';
import type { SceneProps } from './scene/Scene';
import { fakeApi, homeSummary } from './test/fakeApi';
import { mockHome } from './test/fixtures';
import { shownScene, stubScreen } from './test/screen';
import { WALK_SESSION_KEY } from './walk/walkSession';

// jsdom has no WebGL, so the R3F canvas is replaced with a stub that exposes what it would draw.
let lastScene: SceneProps | undefined;
const shown = () => lastScene && shownScene(lastScene);
/** The desktop's surfaces open from the lower right corner (HUD v2 #200). */
const views = async () => fireEvent.click(await screen.findByRole('button', { name: 'Views' }));
const tools = async () => fireEvent.click(await screen.findByRole('button', { name: 'Tools' }));
vi.mock('./scene/Scene', () => ({
  Scene: (props: SceneProps) => {
    lastScene = props;
    return <div data-testid="scene" />;
  },
}));

// The piece page's inspector and the catalogue's thumbnails need WebGL too.
vi.mock('./piece-page/Inspector', () => ({ Inspector: () => <div data-testid="inspector" /> }));
vi.mock('./catalog-page/renderThumbnail', () => ({
  renderThumbnail: () => Promise.reject(new Error('no WebGL in jsdom')),
  THUMBNAIL_SIZE: 256,
}));

const jsonResponse = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

function stubApi(
  homes = [homeSummary('mock-home', 'Mock home')],
  models: Record<string, unknown> = {},
) {
  return fakeApi({ homes, models }).fetch;
}

const levelsOf = () => new Set(shown()?.walls.map((w) => w.levelId));

describe('App', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    localStorage.clear();
    sessionStorage.clear();
    lastScene = undefined;
    window.history.replaceState(null, '', '/');
  });

  it('a desktop draws beautiful by default; ?quality= and the Quality control change it', async () => {
    stubApi();
    const first = render(<App />);
    await screen.findByTestId('scene');
    expect(lastScene?.quality).toBe('beautiful');
    first.unmount();

    window.history.replaceState(null, '', '/?quality=fast');
    render(<App />);
    await screen.findByTestId('scene');
    expect(lastScene?.quality).toBe('fast');
    // The URL is for this visit only.
    expect(localStorage.getItem('my-home.quality')).toBeNull();
    await views();
    const quality = within(screen.getByRole('group', { name: 'Quality' }));
    expect(quality.getByLabelText('Fast')).toBeChecked();
    fireEvent.click(quality.getByLabelText('Auto'));
    expect(lastScene?.quality).toBe('auto');
    expect(localStorage.getItem('my-home.quality')).toBe('auto');
  });

  it('loads the first home from the API and starts in the souterrain, upper levels unchecked', async () => {
    const fetchMock = stubApi();
    render(<App />);

    expect(await screen.findByTestId('scene')).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith('/api/homes', expect.anything());
    expect(fetchMock).toHaveBeenCalledWith('/api/homes/mock-home', expect.anything());
    await tools();
    expect(screen.getByText('Mock home')).toBeInTheDocument();
    expect(levelsOf()).toEqual(new Set(['souterrain']));
    expect(shown()?.roofPlanes).toEqual([]);
    const cutaway = within(screen.getByRole('radiogroup', { name: 'Show up to level' }));
    expect(cutaway.getByLabelText('Souterrain')).toBeChecked();
    await views();
    const levels = within(screen.getByRole('group', { name: 'Levels' }));
    expect(levels.getByRole('checkbox', { name: 'Souterrain' })).toBeChecked();
    expect(levels.getByRole('checkbox', { name: 'Ground floor' })).not.toBeChecked();
    expect(levels.getByRole('checkbox', { name: 'First floor (attic)' })).not.toBeChecked();
    expect(lastScene?.northBearing).toBe(0);
    expect(lastScene?.markers.map((m) => m.label)).toEqual(['N', 'E', 'S', 'W']);
    expect(shown()?.outdoorAreas.map((a) => a.name)).toEqual([
      'Souterrain garden',
      'Ground-floor garden',
      'Driveway',
    ]);
  });

  it('cuts away the upper levels to look into the souterrain', async () => {
    stubApi();
    render(<App />);
    const cutaway = within(await screen.findByRole('radiogroup', { name: 'Show up to level' }));

    fireEvent.click(cutaway.getByLabelText('Souterrain'));
    expect(levelsOf()).toEqual(new Set(['souterrain']));
    expect(shown()?.slabs.map((s) => s.id)).toEqual(['souterrain:floor']);
    // The orbit target moves down into the souterrain (floor at -1.2 m, 2.5 m high).
    expect(lastScene?.target[1]).toBeCloseTo(0.05);
  });

  it('cuts away the roof to look into the attic', async () => {
    stubApi();
    enterEditMode();
    render(<App />);
    const cutaway = within(await screen.findByRole('radiogroup', { name: 'Show up to level' }));
    fireEvent.click(cutaway.getByLabelText('Roof'));
    expect(shown()?.roofPlanes).toHaveLength(2);
    expect(levelsOf()).toEqual(new Set(['souterrain', 'ground-floor', 'first-floor']));

    fireEvent.click(cutaway.getByLabelText('First floor (attic)'));
    expect(shown()?.roofPlanes).toEqual([]);
    expect(levelsOf()).toEqual(new Set(['souterrain', 'ground-floor', 'first-floor']));
    expect(screen.getByText(/Add to First floor \(attic\)/)).toBeInTheDocument();

    fireEvent.click(cutaway.getByLabelText('Roof'));
    expect(shown()?.roofPlanes).toHaveLength(2);
  });

  it('toggles apartments, levels and outdoor areas', async () => {
    stubApi();
    render(<App />);
    await views();
    const apartments = within(await screen.findByRole('group', { name: 'Apartments' }));
    fireEvent.click(apartments.getByRole('checkbox', { name: 'Ground-floor apartment' }));
    expect(levelsOf().has('ground-floor')).toBe(false);

    const levels = within(screen.getByRole('group', { name: 'Levels' }));
    fireEvent.click(levels.getByRole('checkbox', { name: 'First floor (attic)' }));
    expect(levelsOf()).toEqual(new Set(['souterrain']));
    expect(shown()?.roofPlanes).toEqual([]);

    const outdoor = within(screen.getByRole('group', { name: 'Outdoor' }));
    fireEvent.click(outdoor.getByRole('checkbox', { name: 'Driveway' }));
    expect(shown()?.outdoorAreas.map((a) => a.id)).not.toContain('driveway');
    fireEvent.click(outdoor.getByRole('checkbox', { name: 'Terrain' }));
    expect(shown()?.terrain).toEqual([]);
  });

  it('renders whichever home is selected, with no renderer changes', async () => {
    const tiny = { ...mockHome, id: 'tiny', name: 'Tiny home', outdoorAreas: [] };
    stubApi([homeSummary('mock-home', 'Mock home'), homeSummary('tiny', 'Tiny home')], { tiny });
    render(<App />);
    await tools();
    fireEvent.change(await screen.findByLabelText('Home'), { target: { value: 'tiny' } });
    await vi.waitFor(() => expect(shown()?.outdoorAreas).toEqual([]));
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
      expect(shown()?.roofPlanes).toHaveLength(2);
      expect(lastScene?.labels).toEqual([]);
    });

    it('cuts the building away at the level of the figure in the overview', async () => {
      stubApi();
      render(<App />);
      fireEvent.click(await screen.findByRole('button', { name: /Walk and take photos/ }));
      fireEvent.click(screen.getByRole('button', { name: 'Overview' }));

      expect(lastScene?.walk?.view).toBe('third');
      expect(levelsOf()).toEqual(new Set(['souterrain']));
      expect(shown()?.roofPlanes).toHaveLength(0);
      expect(lastScene?.labels.map((l) => l.name)).toContain('Hallway');
    });

    it('returns to the viewer as it was on exit', async () => {
      stubApi();
      render(<App />);
      const cutaway = within(await screen.findByRole('radiogroup', { name: 'Show up to level' }));
      fireEvent.click(cutaway.getByLabelText('Ground floor'));
      fireEvent.click(screen.getByRole('button', { name: /Walk and take photos/ }));
      fireEvent.click(screen.getByRole('button', { name: /Exit/ }));

      expect(lastScene?.walk).toBeUndefined();
      expect(screen.getByRole('toolbar', { name: 'Views, Edit and Tools' })).toBeInTheDocument();
      expect(levelsOf()).toEqual(new Set(['souterrain', 'ground-floor']));
    });

    it('saves the magnetic declination of the home from the calibration sheet', async () => {
      vi.stubGlobal('DeviceOrientationEvent', class {});
      // The camera modes are offered on phones.
      stubScreen('portrait');
      const fetchMock = stubApi();
      render(<App />);
      fireEvent.click(await screen.findByRole('button', { name: /Walk and take photos/ }));
      fireEvent.click(screen.getByRole('radio', { name: /Sensors/ }));
      fireEvent.click(screen.getByRole('button', { name: 'Calibrate' }));
      const sheet = within(screen.getByRole('region', { name: 'Calibrate the compass' }));
      // The doors and windows of the room the figure stands in are offered as targets.
      expect(sheet.getAllByRole('button', { name: /^(Door|Window):/ }).length).toBeGreaterThan(0);
      expect(sheet.getByLabelText(/Magnetic declination/)).toHaveValue(0);

      fireEvent.change(sheet.getByLabelText(/Magnetic declination/), { target: { value: '4' } });
      fireEvent.click(sheet.getByRole('button', { name: 'Save' }));
      expect(await sheet.findByText('Declination saved for this home.')).toBeInTheDocument();
      const puts = () => fetchMock.mock.calls.filter(([, init]) => init?.method === 'PUT');
      // A home setting on top of the model from git (which every deploy replaces), never a
      // replace of the whole home.
      expect(puts().map(([url]) => url)).toEqual(['/api/homes/mock-home/settings']);
      // By default the value counts as read off a chart or model.
      expect(JSON.parse(puts()[0]![1]!.body as string)).toEqual({
        version: 0,
        magneticDeclination: {
          value: 4,
          source: 'geodata',
          note: 'From a declination chart or model, entered in the app',
        },
      });

      // The provenance can be set to a measurement on site; the save uses the current version.
      fireEvent.change(sheet.getByLabelText('Where it is from'), { target: { value: 'measured' } });
      fireEvent.click(sheet.getByRole('button', { name: 'Save' }));
      await waitFor(() => expect(puts()).toHaveLength(2));
      expect(JSON.parse(puts()[1]![1]!.body as string)).toMatchObject({
        version: 1,
        magneticDeclination: { value: 4, source: 'measured' },
      });
      expect(puts().every(([url]) => url === '/api/homes/mock-home/settings')).toBe(true);
      // The home as the api returns it now has the setting.
      const home = (await (await fetchMock('/api/homes/mock-home')).json()) as typeof mockHome;
      expect(home.building.magneticDeclination).toMatchObject({ value: 4, source: 'measured' });
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

  it('opens one surface at a time from the corner; Escape closes it and gives the focus back (HUD v2 #200)', async () => {
    stubApi();
    render(<App />);
    await views();
    expect(screen.getByRole('region', { name: 'View controls' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Views' })).toHaveAttribute('aria-pressed', 'true');
    // Tools replaces Views: one surface at a time.
    await tools();
    expect(screen.queryByRole('region', { name: 'View controls' })).toBeNull();
    expect(screen.getByRole('region', { name: 'Tools' })).toBeInTheDocument();
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.queryByRole('region', { name: 'Tools' })).toBeNull();
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Tools' }));
    // Pressed again, a trigger closes its surface.
    await views();
    await views();
    expect(screen.queryByRole('region', { name: 'View controls' })).toBeNull();
  });

  it('opens the floor overview from the orientation corner, one surface at a time (HUD v2 #202)', async () => {
    stubApi();
    render(<App />);
    await views();
    fireEvent.click(screen.getByRole('button', { name: 'Floor overview' }));
    expect(screen.getByRole('region', { name: 'Floor overview' })).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'View controls' })).toBeNull();
    expect(lastScene?.walk).toBeUndefined();
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.queryByRole('region', { name: 'Floor overview' })).toBeNull();
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Floor overview' }));
  });

  describe('pages', () => {
    it('shows the viewer on / with the title of the app', async () => {
      stubApi();
      render(<App />);
      expect(await screen.findByTestId('scene')).toBeInTheDocument();
      expect(document.title).toBe('my-home');
      // At rest the desktop is the corners alone (HUD v2 #200).
      expect(screen.getByRole('toolbar', { name: 'Mode and level' })).toBeInTheDocument();
      expect(screen.getByRole('toolbar', { name: 'Views, Edit and Tools' })).toBeInTheDocument();
      expect(screen.queryByRole('region', { name: 'View controls' })).toBeNull();
    });

    it('shows the catalogue on /catalog, without loading the home or reading ?walk', async () => {
      window.history.replaceState(null, '', '/catalog?walk=first&home=mock-home');
      const fetchMock = stubApi();
      render(<App />);
      expect(await screen.findByRole('heading', { name: 'Catalogue' })).toBeInTheDocument();
      expect(screen.queryByTestId('scene')).not.toBeInTheDocument();
      expect(screen.queryByRole('application', { name: 'Movement pad' })).not.toBeInTheDocument();
      expect(sessionStorage.getItem(WALK_SESSION_KEY)).toBeNull();
      expect(fetchMock.mock.calls.map(([url]) => url)).toEqual(['/api/catalog/usage']);
      // The title is set in an effect, which may run a moment after the lazy page is shown.
      await waitFor(() => expect(document.title).toBe('Catalogue · my-home'));
    });

    it('shows a piece page with the name of its type', async () => {
      window.history.replaceState(null, '', '/catalog/furniture/furniture.bed');
      stubApi();
      render(<App />);
      expect(await screen.findByRole('heading', { level: 1, name: 'Bed' })).toBeInTheDocument();
      expect(screen.getByRole('link', { name: '← Catalogue' })).toHaveAttribute('href', '/catalog');
      expect(screen.getByTestId('inspector')).toBeInTheDocument();
      // The title is set in an effect, which may run a moment after the lazy page is shown.
      await waitFor(() => expect(document.title).toBe('Bed · my-home'));
    });

    it.each(['/nope', '/catalog/furniture/furniture.throne', '/catalog/openings/furniture.bed'])(
      'shows not-found on %s, with a link home',
      async (path) => {
        window.history.replaceState(null, '', `${path}?home=tiny`);
        stubApi();
        render(<App />);
        expect(await screen.findByRole('heading', { name: 'Page not found' })).toBeInTheDocument();
        expect(screen.getByRole('link', { name: '← Home' })).toHaveAttribute('href', '/?home=tiny');
      },
    );

    it('leaving the viewer mid-load for a page already loaded takes the loading screen away at once', async () => {
      // The catalogue's chunk is loaded first, so going there later asks for nothing.
      window.history.replaceState(null, '', '/catalog');
      stubApi();
      const first = render(<App />);
      expect(await screen.findByRole('heading', { name: 'Catalogue' })).toBeInTheDocument();
      first.unmount();

      window.history.replaceState(null, '', '/');
      render(<App />);
      await screen.findByTestId('scene');
      // The stub scene never draws a frame: the viewer is still loading.
      expect(document.getElementById('boot')).not.toBeNull();
      await tools();
      fireEvent.click(screen.getByRole('link', { name: 'Catalogue' }));
      expect(await screen.findByRole('heading', { name: 'Catalogue' })).toBeInTheDocument();
      expect(document.getElementById('boot')).toBeNull();
    });

    it('goes from the viewer to the catalogue and back, keeping ?home= only', async () => {
      window.history.replaceState(null, '', '/?home=mock-home&panel=photos');
      stubApi();
      render(<App />);
      expect(await screen.findByRole('region', { name: 'Photos' })).toBeInTheDocument();
      // Tools over the photos goes back to its menu.
      await tools();
      const entry = screen.getByRole('link', { name: 'Catalogue' });
      expect(entry).toHaveAttribute('href', '/catalog?home=mock-home');
      fireEvent.click(entry);
      expect(await screen.findByRole('heading', { name: 'Catalogue' })).toBeInTheDocument();
      expect(screen.queryByTestId('scene')).not.toBeInTheDocument();
      expect(window.location.pathname + window.location.search).toBe('/catalog?home=mock-home');

      fireEvent.click(await screen.findByRole('link', { name: /^Bed/ }));
      expect(await screen.findByRole('heading', { level: 1, name: 'Bed' })).toBeInTheDocument();

      // The back button returns to the catalogue.
      act(() => {
        window.history.replaceState(null, '', '/catalog?home=mock-home');
        window.dispatchEvent(new PopStateEvent('popstate'));
      });
      fireEvent.click(await screen.findByRole('link', { name: '← Home' }));
      // A fresh viewer: the photos panel of the first visit is not reopened.
      expect(await screen.findByTestId('scene')).toBeInTheDocument();
      expect(window.location.search).toBe('?home=mock-home');
      expect(screen.queryByRole('region', { name: 'Photos' })).not.toBeInTheDocument();
      expect(document.title).toBe('my-home');
    });

    it('keeps ?home= when the home is changed', async () => {
      const tiny = { ...mockHome, id: 'tiny', name: 'Tiny home', outdoorAreas: [] };
      stubApi([homeSummary('mock-home', 'Mock home'), homeSummary('tiny', 'Tiny home')], { tiny });
      render(<App />);
      await tools();
      fireEvent.change(await screen.findByLabelText('Home'), { target: { value: 'tiny' } });
      // The other home's viewer starts at rest: Tools again.
      await vi.waitFor(() => expect(shown()?.outdoorAreas).toEqual([]));
      await tools();
      await vi.waitFor(() =>
        expect(screen.getByRole('link', { name: 'Catalogue' })).toHaveAttribute(
          'href',
          '/catalog?home=tiny',
        ),
      );
    });
  });
});
