import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { App } from './App';
import { shortLevelName } from './overlay/LevelControl';
import type { SceneProps } from './scene/Scene';
import { fakeApi, homeSummary } from './test/fakeApi';
import { testPhoto, testRequest } from './test/fixtures';
import { openLevelPicker, shownScene, stubScreen } from './test/screen';

// jsdom has no WebGL, so the R3F canvas is replaced with a stub that exposes what it would draw.
let lastScene: SceneProps | undefined;
const shown = () => lastScene && shownScene(lastScene);
vi.mock('./catalog-page/renderThumbnail', () => ({
  renderThumbnail: () => Promise.reject(new Error('no WebGL in jsdom')),
  THUMBNAIL_SIZE: 256,
}));
vi.mock('./scene/Scene', () => ({
  Scene: (props: SceneProps) => {
    lastScene = props;
    return <div data-testid="scene" />;
  },
}));

const levelsOf = () => new Set(shown()?.walls.map((w) => w.levelId));
const viewer = () => screen.getByTestId('scene').closest('.viewer') as HTMLElement;
const sheet = () => screen.getByRole('region', { name: 'Panels' });
const tab = (name: RegExp) => screen.getByRole('tab', { name });
const topBar = () => within(screen.getByRole('toolbar'));
const level = (name: string) => openLevelPicker().getByRole('radio', { name });
const region = (name: string) => screen.queryByRole('region', { name });
/** Tools, in the stage tools (HUD v2 #200). */
const tools = () => fireEvent.click(screen.getByRole('button', { name: 'Tools' }));

async function open(
  mode: Parameters<typeof stubScreen>[0],
  options?: Parameters<typeof fakeApi>[0],
) {
  const turn = stubScreen(mode);
  const api = fakeApi(options);
  render(<App />);
  await screen.findByTestId('scene');
  await turn.listening();
  return { turn, api };
}

describe('shortLevelName', () => {
  it('shortens level names for the level switcher', () => {
    expect(shortLevelName('First floor (attic)')).toBe('Attic');
    expect(shortLevelName('Ground floor')).toBe('Ground');
    expect(shortLevelName('Souterrain')).toBe('Souterrain');
    expect(shortLevelName('floor')).toBe('Floor');
  });
});

describe('phone layout', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    localStorage.clear();
    lastScene = undefined;
    window.history.replaceState(null, '', '/');
  });

  it('rests on a desktop screen: the corners, no panel (HUD v2 #200)', async () => {
    await open('desktop');
    expect(viewer()).not.toHaveClass('mobile');
    expect(region('View controls')).not.toBeInTheDocument();
    expect(region('Furniture')).not.toBeInTheDocument();
    expect(screen.getAllByRole('toolbar').map((t) => t.getAttribute('aria-label'))).toEqual([
      'Mode and level',
      'Views, Edit and Tools',
    ]);
    expect(region('Panels')).not.toBeInTheDocument();
    expect(viewer().style.getPropertyValue('--stage-inset')).toBe('');
  });

  it('shows the 3D view with a top bar and a collapsed sheet on a phone', async () => {
    await open('portrait');
    expect(viewer()).toHaveClass('mobile', 'portrait');
    // No panel is open: only the top bar and the tabs of the sheet.
    expect(region('View controls')).not.toBeInTheDocument();
    expect(region('Furniture')).not.toBeInTheDocument();
    expect(sheet()).toHaveClass('sheet-collapsed');
    expect(sheet()).not.toHaveClass('sheet-side');
    expect(screen.getAllByRole('tab').map((t) => t.textContent?.trim())).toEqual([
      '👁View',
      '🛋Furniture',
      '📷Photos',
      '📌Requests',
    ]);
    // The mode, Walk and the level; the home, the photos and the catalogue are in Tools (HUD v2 #200).
    expect(topBar().getByText('Orbit')).toBeInTheDocument();
    expect(topBar().getByRole('button', { name: 'Walk and take photos' })).toBeInTheDocument();
    expect(topBar().queryByRole('button', { name: /Photos/ })).toBeNull();
    tools();
    expect(within(region('Tools')!).getByText('Mock home')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Photos (0)' })).toBeInTheDocument();
    // The 3D view ends where the tab bar begins.
    expect(viewer().style.getPropertyValue('--stage-inset')).toBe('var(--sheet-collapsed)');
    expect(levelsOf()).toEqual(new Set(['souterrain']));
    expect(level('Souterrain')).toBeChecked();
  });

  it('opens one panel at a time and closes it with one tap', async () => {
    await open('portrait');
    fireEvent.click(tab(/Furniture/));
    expect(sheet()).toHaveClass('sheet-half');
    expect(region('Furniture')).toBeInTheDocument();
    expect(region('View controls')).not.toBeInTheDocument();
    expect(viewer().style.getPropertyValue('--stage-inset')).toBe('50%');

    fireEvent.click(tab(/View/));
    expect(region('View controls')).toBeInTheDocument();
    expect(region('Furniture')).not.toBeInTheDocument();

    fireEvent.click(tab(/View/));
    expect(sheet()).toHaveClass('sheet-collapsed');
    expect(region('View controls')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Open the panel' }));
    expect(region('View controls')).toBeInTheDocument();
    // Opened all the way, the sheet lies over the view, which keeps its half-open size.
    fireEvent.click(screen.getByRole('button', { name: 'Make the panel larger' }));
    expect(sheet()).toHaveClass('sheet-full');
    expect(viewer().style.getPropertyValue('--sheet-size')).toBe('100%');
    expect(viewer().style.getPropertyValue('--stage-inset')).toBe('50%');
  });

  it('switches the cutaway level in the top bar', async () => {
    await open('portrait');
    expect(screen.queryByRole('radiogroup', { name: 'Show up to level' })).toBeNull();
    expect(level('Souterrain')).toBeChecked();
    expect(level('Roof')).not.toBeChecked();
    expect(level('First floor (attic)')).toHaveTextContent('Attic');

    fireEvent.click(level('Roof'));
    expect(levelsOf()).toEqual(new Set(['souterrain', 'ground-floor', 'first-floor']));

    fireEvent.click(level('Souterrain'));
    expect(level('Souterrain')).toBeChecked();
    expect(level('Roof')).not.toBeChecked();
    expect(levelsOf()).toEqual(new Set(['souterrain']));

    // The arrow keys move through the levels, as in any radio group.
    fireEvent.keyDown(level('Souterrain'), { key: 'ArrowLeft' });
    expect(level('Ground floor')).toBeChecked();
    expect(level('Ground floor')).toHaveFocus();
    expect(levelsOf()).toEqual(new Set(['souterrain', 'ground-floor']));
    fireEvent.keyDown(level('Ground floor'), { key: 'ArrowRight' });
    fireEvent.keyDown(level('Souterrain'), { key: 'ArrowRight' });
    expect(level('Roof')).toBeChecked();

    // Furniture is added to the level that is looked into (in edit mode).
    fireEvent.click(level('Souterrain'));
    fireEvent.click(screen.getByRole('switch', { name: 'Edit' }));
    fireEvent.click(tab(/Furniture/));
    expect(screen.getByText('Add to Souterrain')).toBeInTheDocument();
  });

  it('shows opening details in a shallow sheet and gives focus back on close', async () => {
    await open('portrait');
    act(() => lastScene!.pieces!.onSelectPiece('souterrain-patio-door'));
    const details = screen.getByRole('button', { name: /: details$/ });
    fireEvent.click(details);
    const inspector = within(region('Furniture')!);
    expect(inspector.getByRole('heading', { level: 1 })).toBeInTheDocument();
    expect(viewer().style.getPropertyValue('--stage-inset')).toBe('28%');
    fireEvent.click(inspector.getByRole('button', { name: 'Close inspector' }));
    expect(details).toHaveFocus();
    expect(sheet()).toHaveClass('sheet-collapsed');
    fireEvent.click(details);
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(details).toHaveFocus();
    expect(sheet()).toHaveClass('sheet-collapsed');
  });

  it('offers the quality setting in the View panel, in a phone\u2019s words, and remembers it', async () => {
    await open('portrait');
    // A phone refines when the view is still.
    expect(lastScene?.quality).toBe('auto');
    fireEvent.click(tab(/View/));
    const quality = within(
      within(region('View controls')!).getByRole('group', { name: 'Quality' }),
    );
    // A segmented row (sakuga-segmented): each choice is named by its words.
    expect(quality.getAllByRole('radio').map((r) => r.getAttribute('aria-label'))).toEqual([
      'Fast',
      'Automatic',
      'Always beautiful',
    ]);
    expect(quality.getByLabelText('Automatic')).toBeChecked();
    fireEvent.click(quality.getByLabelText('Always beautiful'));
    expect(lastScene?.quality).toBe('beautiful');
    expect(localStorage.getItem('my-home.quality')).toBe('beautiful');
  });

  it('folds the rarely used switches away and shows or hides a whole group', async () => {
    await open('portrait');
    fireEvent.click(tab(/View/));
    const panel = within(region('View controls')!);
    expect(panel.getByRole('switch', { name: 'Room names' })).toBeChecked();
    const outdoor = panel.getByRole('group', { name: 'Outdoor' });
    expect(outdoor).not.toHaveAttribute('open');
    expect(outdoor).toHaveTextContent('4 of 4 shown');
    expect(panel.getByRole('group', { name: 'Apartments' })).not.toHaveAttribute('open');
    expect(panel.getByRole('group', { name: 'Levels' })).not.toHaveAttribute('open');

    fireEvent.click(within(outdoor).getByRole('button', { name: 'Hide all' }));
    expect(shown()?.outdoorAreas).toEqual([]);
    expect(shown()?.terrain).toEqual([]);
    expect(outdoor).toHaveTextContent('0 of 4 shown');
    expect(within(outdoor).getByRole('button', { name: 'Hide all' })).toBeDisabled();

    fireEvent.click(within(outdoor).getByRole('checkbox', { name: 'Driveway' }));
    expect(shown()?.outdoorAreas.map((a) => a.id)).toEqual(['driveway']);
    fireEvent.click(within(outdoor).getByRole('button', { name: 'Show all' }));
    expect(shown()?.outdoorAreas).toHaveLength(3);
    expect(shown()?.terrain).not.toEqual([]);

    const apartments = panel.getByRole('group', { name: 'Apartments' });
    fireEvent.click(within(apartments).getByRole('checkbox', { name: 'Ground-floor apartment' }));
    expect(levelsOf().has('ground-floor')).toBe(false);
  });

  it('opens the catalogue from Tools, keeping the home', async () => {
    window.history.replaceState(null, '', '/?home=mock-home&sheet=half');
    await open('portrait');
    tools();
    const catalogue = screen.getByRole('link', { name: 'Catalogue' });
    expect(catalogue).toHaveAttribute('href', '/catalog?home=mock-home');
    fireEvent.click(catalogue);
    expect(await screen.findByRole('heading', { name: 'Catalogue' })).toBeInTheDocument();
    expect(screen.queryByRole('toolbar')).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Catalogue' }).closest('.catalog-page')).toHaveClass(
      'mobile',
      'portrait',
    );
  });

  it('opens the photos from Tools and the requests from their tab', async () => {
    const photo = testPhoto({ id: 'hallway' });
    await open('portrait', { photos: [photo], requests: [testRequest()] });
    const photos = async () => {
      tools();
      return screen.findByRole('button', { name: 'Photos (1), 1 requested' });
    };
    let button = await photos();
    expect(button).toHaveAttribute('aria-pressed', 'false');
    expect(tab(/Requests/)).toHaveAccessibleName('Requests 1 open');
    // No camera markers while the gallery is closed.
    expect(lastScene?.photoMarkers).toEqual([]);

    // A choice closes the menu.
    fireEvent.click(button);
    expect(region('Tools')).not.toBeInTheDocument();
    expect(sheet()).toHaveClass('sheet-half');
    expect(tab(/Photos/)).toHaveAttribute('aria-selected', 'true');
    expect(region('Photos')).toBeInTheDocument();
    expect(lastScene?.photoMarkers?.map((m) => m.id)).toEqual(['hallway']);

    fireEvent.click(tab(/Requests/));
    expect(tab(/Requests/)).toHaveAttribute('aria-selected', 'true');
    expect(within(region('Photos')!).getByText(testRequest().reason)).toBeInTheDocument();

    // The same button closes the sheet again, and leaving the photos removes the markers.
    fireEvent.click(tab(/Photos/));
    button = await photos();
    expect(button).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(button);
    expect(sheet()).toHaveClass('sheet-collapsed');
    fireEvent.click(tab(/Furniture/));
    expect(lastScene?.photoMarkers).toEqual([]);
  });

  it('reaches the trash from the photos, without a second row of tabs', async () => {
    await open('portrait', { photos: [testPhoto({ id: 'hallway' })] });
    tools();
    fireEvent.click(await screen.findByRole('button', { name: 'Photos (1)' }));
    // The sheet's tabs are the only tabs.
    expect(screen.getAllByRole('tab')).toHaveLength(4);
    expect(screen.queryByRole('button', { name: 'Close' })).not.toBeInTheDocument();

    fireEvent.click(await screen.findByRole('button', { name: /Trash \(0\)/ }));
    expect(screen.getByText('The trash is empty.')).toBeInTheDocument();
    expect(tab(/Photos/)).toHaveAttribute('aria-selected', 'true');
    fireEvent.click(screen.getByRole('button', { name: /Back to the photos/ }));
    expect(screen.queryByText('The trash is empty.')).not.toBeInTheDocument();
  });

  it('opens the sheet on the photo of a camera marker that is tapped', async () => {
    await open('portrait', { photos: [testPhoto({ id: 'hallway' })] });
    tools();
    fireEvent.click(await screen.findByRole('button', { name: 'Photos (1)' }));
    fireEvent.click(tab(/Photos/));
    expect(sheet()).toHaveClass('sheet-collapsed');

    lastScene?.onSelectPhoto?.('hallway');
    expect(await screen.findByRole('group', { name: 'Photo details' })).toBeInTheDocument();
    expect(sheet()).toHaveClass('sheet-half');
  });

  it('leaves the whole screen to walking and comes back as it was', async () => {
    await open('portrait');
    fireEvent.click(level('Ground floor'));
    fireEvent.click(tab(/Furniture/));
    fireEvent.click(topBar().getByRole('button', { name: 'Walk and take photos' }));

    expect(viewer()).toHaveClass('mobile', 'walking');
    expect(screen.getByRole('application', { name: 'Movement pad' })).toBeInTheDocument();
    expect(screen.queryByRole('toolbar')).not.toBeInTheDocument();
    expect(region('Panels')).not.toBeInTheDocument();
    expect(viewer().style.getPropertyValue('--stage-inset')).toBe('');

    fireEvent.click(screen.getByRole('button', { name: /Exit/ }));
    expect(level('Ground floor')).toBeChecked();
    expect(sheet()).toHaveClass('sheet-half');
    expect(region('Furniture')).toBeInTheDocument();
  });

  it('follows the screen: desktop, phone upright, phone across', async () => {
    const { turn } = await open('desktop');
    fireEvent.click(openLevelPicker().getByLabelText('Souterrain'));

    turn('portrait');
    expect(viewer()).toHaveClass('mobile', 'portrait');
    expect(region('View controls')).not.toBeInTheDocument();
    // What was chosen stays chosen.
    expect(level('Souterrain')).toBeChecked();
    fireEvent.click(tab(/Furniture/));
    expect(viewer().style.getPropertyValue('--stage-inset')).toBe('50%');

    // Held across, the sheet is at the side and the view keeps most of the width.
    turn('landscape');
    expect(viewer()).toHaveClass('mobile', 'landscape');
    expect(sheet()).toHaveClass('sheet-side', 'sheet-half');
    expect(viewer().style.getPropertyValue('--stage-inset')).toBe('45%');
    expect(region('Furniture')).toBeInTheDocument();

    turn('desktop');
    // The desktop rests: its corners, the surfaces closed (HUD v2 #200).
    expect(screen.getByRole('toolbar', { name: 'Views, Edit and Tools' })).toBeInTheDocument();
    expect(region('Furniture')).not.toBeInTheDocument();
    expect(region('Panels')).not.toBeInTheDocument();
    expect(levelsOf()).toEqual(new Set(['souterrain']));
  });

  it('opens with a panel from the address: ?panel=furniture&sheet=full', async () => {
    window.history.replaceState(null, '', '/?panel=furniture&sheet=full');
    await open('portrait');
    expect(sheet()).toHaveClass('sheet-full');
    expect(tab(/Furniture/)).toHaveAttribute('aria-selected', 'true');
    expect(region('Furniture')).toBeInTheDocument();
  });

  it('opens the requests from the address, on a phone and on a desktop', async () => {
    window.history.replaceState(null, '', '/?panel=requests');
    const { turn } = await open('landscape', { requests: [testRequest()] });
    expect(sheet()).toHaveClass('sheet-half');
    expect(tab(/Requests/)).toHaveAttribute('aria-selected', 'true');
    expect(await screen.findByText(testRequest().reason)).toBeInTheDocument();

    turn('desktop');
    expect(region('Photos')).toBeInTheDocument();
    expect(screen.getByText(testRequest().reason)).toBeInTheDocument();
  });

  it('closes the Tools menu with Escape and gives the focus back to Tools (HUD v2 #200)', async () => {
    await open('portrait');
    tools();
    expect(region('Tools')).toBeInTheDocument();
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(region('Tools')).not.toBeInTheDocument();
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Tools' }));
  });

  it('offers the home selector in Tools when there are several homes', async () => {
    await open('portrait', {
      homes: [homeSummary('mock-home', 'Mock home'), homeSummary('other', 'Other home')],
    });
    tools();
    expect(within(region('Tools')!).getByLabelText('Home')).toHaveValue('mock-home');
  });
});
