import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { App } from '../App';
import type { SceneProps } from '../scene/Scene';
import { fakeApi, homeSummary } from '../test/fakeApi';
import { openLevelPicker, shownScene, stubScreen } from '../test/screen';

// jsdom has no WebGL: the canvas is a stub that records what it would be given.
let lastScene: SceneProps | undefined;
vi.mock('../scene/Scene', () => ({
  Scene: (props: SceneProps) => {
    lastScene = props;
    return <div data-testid="scene" />;
  },
}));

const levelsShown = () => new Set(lastScene && shownScene(lastScene).walls.map((w) => w.levelId));
const query = () => Object.fromEntries(new URLSearchParams(window.location.search));

/** Opens the app at `path` and waits for the named views' chunk: its control is in the panel. */
async function open(path: string) {
  fakeApi({ homes: [homeSummary('mock-home', 'Mock home')], models: {} });
  window.history.replaceState(null, '', path);
  render(<App />);
  // The named views are in the desktop's Views surface (HUD v2 #200); on a phone, the sheet's View tab.
  await screen.findByTestId('scene');
  const button = screen.queryByRole('button', { name: 'Views' });
  if (button) fireEvent.click(button);
  return within(await screen.findByRole('group', { name: 'Views' }, { timeout: 10_000 }));
}

/** "Cut at" is a sakuga-slider (its fallback here): set its value and say so, as a drag does. */
function setCut(views: ReturnType<typeof within>, value: string) {
  act(() => {
    const slider = views.getByRole('slider', { name: 'Cut at' }) as HTMLElement & { value: string };
    slider.value = value;
    fireEvent.input(slider);
  });
}

describe('named views in the viewer', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    localStorage.clear();
    sessionStorage.clear();
    lastScene = undefined;
    window.history.replaceState(null, '', '/');
  });

  it('the free view is as it was: the sky, the free rig, letters and room names', async () => {
    const views = await open('/');
    expect(views.getByRole('radio', { name: 'Free' })).toHaveAttribute('aria-checked', 'true');
    expect(lastScene).toMatchObject({ rigView: undefined, backdrop: undefined, busy: false });
    expect(lastScene?.markers).toHaveLength(4);
    expect(lastScene?.lettersHidden).toBe(false);
    expect(lastScene?.labels.length).toBeGreaterThan(0);
    expect(views.getByLabelText('Backdrop')).toHaveValue('sky');
    expect(window.location.search).toBe('');
  });

  it('?view=cutaway opens the cutaway of a level: its camera, studio backdrop, no letters or names', async () => {
    await open('/?view=cutaway&level=ground-floor&quality=fast');
    expect(levelsShown()).toEqual(new Set(['souterrain', 'ground-floor']));
    expect(lastScene).toMatchObject({
      rigView: { kind: 'cutaway' },
      backdrop: 'studio-light',
      lettersHidden: true,
      labels: [],
      busy: false,
      quality: 'fast',
    });
    expect(lastScene?.frame).toMatchObject({ fov: 20 });
    // The address still names the view, with everything else it had.
    expect(query()).toEqual({ view: 'cutaway', level: 'ground-floor', quality: 'fast' });
  });

  it('the view is not settled before its chunk has opened it', async () => {
    fakeApi({ homes: [homeSummary('mock-home', 'Mock home')], models: {} });
    window.history.replaceState(null, '', '/?view=eye');
    render(<App />);
    await screen.findByTestId('scene');
    // Whatever is drawn first, a capture must wait while the view is still to come.
    if (lastScene?.rigView === undefined) expect(lastScene?.busy).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Views' }));
    await screen.findByRole('group', { name: 'Views' }, { timeout: 10_000 });
    expect(lastScene).toMatchObject({ rigView: { kind: 'eye' }, busy: false });
  });

  it('orbiting away leaves the view: the address drops it, its look stays until "Free"', async () => {
    const views = await open('/?view=cutaway&hints=off');
    const before = lastScene?.frame?.key;
    act(() => lastScene?.onOrbit?.());
    expect(query()).toEqual({ hints: 'off' });
    expect(lastScene?.lettersHidden).toBe(false);
    expect(lastScene?.labels.length).toBeGreaterThan(0);
    // The backdrop and the light of the view are kept, and the camera is not moved.
    expect(lastScene).toMatchObject({ rigView: { kind: 'cutaway' }, backdrop: 'studio-light' });
    expect(lastScene?.frame?.key).toBe(before);
    expect(views.getByRole('radio', { name: 'Cutaway' })).toHaveAttribute('aria-checked', 'true');

    fireEvent.click(views.getByRole('radio', { name: 'Free' }));
    expect(lastScene).toMatchObject({ rigView: undefined, backdrop: undefined });
    expect(levelsShown()).toEqual(new Set(['souterrain']));
  });

  it('the control opens a view and writes its address; another view replaces it', async () => {
    const views = await open('/?hints=off');
    fireEvent.click(views.getByRole('radio', { name: 'Eye level' }));
    expect(query()).toMatchObject({ hints: 'off', view: 'eye', room: 'souterrain-hallway' });
    expect(lastScene).toMatchObject({ rigView: { kind: 'eye' }, backdrop: 'studio-light' });
    expect(lastScene?.frame).toMatchObject({ fov: 70 });
    // From inside: the whole house, ceilings on.
    expect(levelsShown()).toEqual(new Set(['souterrain', 'ground-floor', 'first-floor']));

    fireEvent.change(views.getByLabelText('Room'), { target: { value: 'souterrain-kitchen' } });
    expect(query()).toMatchObject({ view: 'eye', room: 'souterrain-kitchen' });

    fireEvent.click(views.getByRole('radio', { name: 'Cutaway' }));
    expect(query()).toEqual({ hints: 'off', view: 'cutaway', level: 'souterrain' });
    expect(levelsShown()).toEqual(new Set(['souterrain']));

    // "Free" shows again what was shown before the first named view.
    fireEvent.click(views.getByRole('radio', { name: 'Free' }));
    expect(query()).toEqual({ hints: 'off' });
    expect(levelsShown()).toEqual(new Set(['souterrain']));
  });

  it('changing what is shown by hand leaves the view too', async () => {
    await open('/?view=cutaway');
    const cutaway = openLevelPicker();
    fireEvent.click(cutaway.getByLabelText('Ground floor'));
    expect(window.location.search).toBe('');
    expect(lastScene?.rigView).toEqual({ kind: 'cutaway' });
    expect(levelsShown()).toEqual(new Set(['souterrain', 'ground-floor']));
  });

  it('the backdrop is chosen in the control, or by ?backdrop= for a visit', async () => {
    const views = await open('/?backdrop=studio-dark');
    expect(lastScene?.backdrop).toBe('studio-dark');
    expect(screen.getByRole('button', { name: 'Views' })).toHaveAttribute('tone', 'light');
    expect(views.getByLabelText('Backdrop')).toHaveValue('studio-dark');
    fireEvent.change(views.getByLabelText('Backdrop'), { target: { value: 'studio-light' } });
    expect(lastScene?.backdrop).toBe('studio-light');
    expect(screen.getByRole('button', { name: 'Views' })).toHaveAttribute('tone', 'dark');
    // A chosen backdrop is the named views' too.
    fireEvent.change(views.getByLabelText('Backdrop'), { target: { value: 'sky' } });
    fireEvent.click(views.getByRole('radio', { name: 'Cutaway' }));
    expect(lastScene?.backdrop).toBe('sky');
  });

  it('with ?focus= the view gives its look and field of view, and the camera frames the use', async () => {
    await open('/?view=cutaway&focus=souterrain-kitchen-window');
    expect(lastScene).toMatchObject({ rigView: { kind: 'cutaway' }, backdrop: 'studio-light' });
    expect(lastScene?.frame?.fov).toBe(20);
    // The window's own frame: a sphere of well under a metre around it.
    expect(lastScene?.frame?.radius).toBeLessThan(2);
  });

  it('with ?walk= the walk comes first; the view opens when it is left', async () => {
    fakeApi({ homes: [homeSummary('mock-home', 'Mock home')], models: {} });
    window.history.replaceState(null, '', '/?view=cutaway&walk=third');
    render(<App />);
    await screen.findByRole('button', { name: /Exit|Leave|Done/ });
    await act(() => import('./render-views'));
    expect(lastScene?.walk).toBeDefined();
    expect(lastScene?.rigView).toBeUndefined();
    // Nothing is still to come while walking: a capture of the walk can settle.
    expect(lastScene?.busy).toBe(false);
    expect(query()).toMatchObject({ view: 'cutaway' });
    fireEvent.click(screen.getByRole('button', { name: /Exit|Leave|Done/ }));
    fireEvent.click(await screen.findByRole('button', { name: 'Views' }));
    await screen.findByRole('group', { name: 'Views' });
    expect(lastScene).toMatchObject({ rigView: { kind: 'cutaway' }, walk: undefined });
    expect(lastScene?.frame).toMatchObject({ fov: 20 });
  });

  it('?view=section cuts the whole house; the slider moves the cut and the address follows', async () => {
    const views = await open('/?view=section&look=east&at=2&quality=fast');
    expect(lastScene).toMatchObject({
      rigView: { kind: 'section', look: 'east' },
      backdrop: 'studio-light',
      lettersHidden: true,
      labels: [],
    });
    expect(lastScene?.frame).toMatchObject({ fov: 25, from: [-1, 0, expect.closeTo(0)] });
    expect(levelsShown()).toEqual(new Set(['souterrain', 'ground-floor', 'first-floor']));
    const before = lastScene?.frame?.key;
    setCut(views, '3.5');
    expect(query()).toEqual({ view: 'section', look: 'east', at: '3.5', quality: 'fast' });
    // Moving the cut does not move the camera.
    expect(lastScene?.frame?.key).toBe(before);
    // Looking from another side does.
    fireEvent.change(views.getByLabelText('Looking'), { target: { value: 'south' } });
    expect(query()).toMatchObject({ view: 'section', look: 'south' });
    expect(lastScene?.frame?.key).not.toBe(before);
    expect(lastScene?.rigView).toEqual({ kind: 'section', look: 'south' });
  });

  it('a cut that was left by orbiting can still be moved, without taking the camera back', async () => {
    const views = await open('/?view=section');
    act(() => lastScene?.onOrbit?.());
    expect(window.location.search).toBe('');
    const before = lastScene?.frame?.key;
    setCut(views, '1');
    expect(lastScene?.frame?.key).toBe(before);
    expect(window.location.search).toBe('');
    expect(lastScene?.rigView).toEqual({ kind: 'section', look: 'north' });
  });

  it('on a phone the control is in the View tab and "Reset view" goes back to the free view', async () => {
    stubScreen('portrait');
    const views = await open('/?panel=view&hints=off');
    fireEvent.click(views.getByRole('radio', { name: 'Cutaway' }));
    expect(lastScene?.rigView).toEqual({ kind: 'cutaway' });
    expect(query()).toMatchObject({ view: 'cutaway' });
    fireEvent.click(screen.getByRole('button', { name: /Reset view/ }));
    expect(lastScene?.rigView).toBeUndefined();
    expect(query()).not.toHaveProperty('view');
  });
});
