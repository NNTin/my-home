import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { App } from '../App';
import { toolbarInView, toolbarPosition } from '../scene/FurnitureLayer';
import { markerScale, markerTapRadius } from '../scene/PhotoMarkers';
import type { SceneProps } from '../scene/Scene';
import { fakeApi } from '../test/fakeApi';
import { testPhoto, testPlacement } from '../test/fixtures';
import { stubScreen } from '../test/screen';
import { FurnitureToolbar } from './FurnitureToolbar';
import { HINTS_SEEN_KEY } from './Hints';
import { stageStatusText } from './StageTools';
import { useKeyboardViewport } from './useKeyboardViewport';

// jsdom has no WebGL: the canvas is replaced by a stub exposing what it was asked to draw.
let lastScene: SceneProps | undefined;
vi.mock('../scene/Scene', () => ({
  Scene: (props: SceneProps) => {
    lastScene = props;
    return <div data-testid="scene" />;
  },
}));

const sheet = () => screen.getByRole('region', { name: 'Panels' });
const tab = (name: RegExp) => screen.getByRole('tab', { name });
const furniture = () => lastScene?.furniture ?? [];

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

const bed = testPlacement({ id: 'bed-1', name: 'Bed' });

/** Opens the app with one bed placed and waits until the scene shows it. */
async function openWithBed(mode: Parameters<typeof stubScreen>[0]) {
  const result = await open(mode, { placements: [bed] });
  await vi.waitFor(() => expect(furniture()).toHaveLength(1));
  return result;
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  localStorage.clear();
  lastScene = undefined;
  window.history.replaceState(null, '', '/');
});

describe('furniture by touch', () => {
  it('floats a toolbar next to the selected item on a phone, and none on a desktop', async () => {
    const { turn } = await openWithBed('portrait');
    expect(lastScene?.touch).toBe(true);
    expect(lastScene?.toolbar).toBeUndefined();

    act(() => lastScene!.handlers.onSelect('bed-1'));
    expect(lastScene?.toolbar?.name).toBe('Bed');
    // No panel had to be opened for it.
    expect(sheet()).toHaveClass('sheet-collapsed');

    turn('desktop');
    expect(lastScene?.touch).toBe(false);
    expect(lastScene?.toolbar).toBeUndefined();
    expect(lastScene?.handlers.onLongPress).toBeUndefined();
  });

  it('rotates, duplicates and deletes from the toolbar', async () => {
    await openWithBed('portrait');
    act(() => lastScene!.handlers.onSelect('bed-1'));
    const before = furniture()[0]!.rotationY;

    act(() => lastScene!.toolbar!.onRotate(1));
    expect(furniture()[0]!.rotationY).not.toBe(before);
    act(() => lastScene!.toolbar!.onRotate(-1));
    expect(furniture()[0]!.rotationY).toBeCloseTo(before);

    act(() => lastScene!.toolbar!.onDuplicate());
    expect(furniture()).toHaveLength(2);
    // The copy is the selected one now, and the toolbar is its toolbar.
    expect(furniture().find((f) => f.selected)?.id).not.toBe('bed-1');

    act(() => lastScene!.toolbar!.onDelete());
    expect(furniture().map((f) => f.id)).toEqual(['bed-1']);
    expect(lastScene?.toolbar).toBeUndefined();
  });

  it('raises and lowers a wall cabinet by 5 cm and drags it along its wall (#63)', async () => {
    const cabinet = testPlacement({
      id: 'cab-1',
      name: 'Kitchen · Wall cabinet',
      typeId: 'kitchen.wall-cabinet',
      roomId: 'souterrain-kitchen',
      position: { x: 3, z: -3.675 },
      mounting: 'wall',
      elevation: 1.33,
    });
    await open('portrait', {
      placements: [
        cabinet,
        testPlacement({
          id: 'light-1',
          typeId: 'fixture.downlight',
          mounting: 'ceiling',
          position: { x: 3, z: -2 },
        }),
      ],
    });
    await vi.waitFor(() => expect(furniture()).toHaveLength(2));
    const y = () => furniture().find((f) => f.id === 'cab-1')!.position[1];
    const start = y();
    act(() => lastScene!.handlers.onSelect('cab-1'));
    act(() => lastScene!.toolbar!.onRaise!(5));
    expect(y()).toBeCloseTo(start + 0.05);
    act(() => lastScene!.toolbar!.onRaise!(-10));
    expect(y()).toBeCloseTo(start - 0.05);
    // A drag into the room keeps it on its wall, moved along it.
    act(() => lastScene!.handlers.onMoveStart('cab-1'));
    act(() => lastScene!.handlers.onMove('cab-1', [4, -3]));
    act(() => lastScene!.handlers.onDragEnd());
    const moved = furniture().find((f) => f.id === 'cab-1')!;
    expect(moved.position[0]).toBeCloseTo(4);
    expect(moved.position[2]).toBeCloseTo(-3.675);
    // A bed on the floor and a light under the ceiling have no ▲ ▼.
    act(() => lastScene!.handlers.onSelect('light-1'));
    expect(lastScene!.toolbar!.onRaise).toBeUndefined();
  });

  it('opens the furniture panel from "more" and from a long press', async () => {
    await openWithBed('portrait');
    act(() => lastScene!.handlers.onSelect('bed-1'));
    act(() => lastScene!.toolbar!.onMore());
    expect(sheet()).toHaveClass('sheet-half');
    expect(tab(/Furniture/)).toHaveAttribute('aria-selected', 'true');
    expect(
      within(screen.getByRole('region', { name: 'Furniture' })).getByLabelText('Selected item'),
    ).toHaveTextContent('Bed');

    fireEvent.click(tab(/View/));
    fireEvent.click(tab(/View/));
    expect(sheet()).toHaveClass('sheet-collapsed');
    act(() => lastScene!.handlers.onSelect(undefined));

    // A long press starts like a drag; it ends as "more" with the item where it was.
    const at = furniture()[0]!.position;
    act(() => lastScene!.handlers.onMoveStart('bed-1'));
    act(() => lastScene!.handlers.onLongPress!('bed-1'));
    expect(sheet()).toHaveClass('sheet-half');
    expect(tab(/Furniture/)).toHaveAttribute('aria-selected', 'true');
    expect(furniture()[0]).toMatchObject({ selected: true, position: at });
    // Nothing was changed, so nothing is saved and nothing claims to be.
    expect(screen.queryByRole('status', { name: 'Status' })).not.toBeInTheDocument();
  });

  it('has no toolbar while walking', async () => {
    await openWithBed('portrait');
    act(() => lastScene!.handlers.onSelect('bed-1'));
    fireEvent.click(screen.getByRole('button', { name: 'Walk and take photos' }));
    expect(lastScene?.toolbar).toBeUndefined();
  });
});

describe('FurnitureToolbar', () => {
  it('names the item and offers its tools as labelled buttons', () => {
    const on = { onRotate: vi.fn(), onDuplicate: vi.fn(), onDelete: vi.fn(), onMore: vi.fn() };
    render(
      <FurnitureToolbar name="Round table" href="/catalog/furniture/furniture.table" {...on} />,
    );
    const bar = within(screen.getByRole('toolbar', { name: 'Round table: edit' }));
    expect(bar.getByRole('link', { name: 'Open piece page' })).toHaveAttribute(
      'href',
      '/catalog/furniture/furniture.table',
    );
    fireEvent.click(bar.getByRole('button', { name: 'Rotate left' }));
    fireEvent.click(bar.getByRole('button', { name: 'Rotate right' }));
    expect(on.onRotate.mock.calls).toEqual([[1], [-1]]);
    fireEvent.click(bar.getByRole('button', { name: 'Duplicate' }));
    fireEvent.click(bar.getByRole('button', { name: 'Delete' }));
    fireEvent.click(bar.getByRole('button', { name: /More/ }));
    expect(on.onDuplicate).toHaveBeenCalledOnce();
    expect(on.onDelete).toHaveBeenCalledOnce();
    expect(on.onMore).toHaveBeenCalledOnce();
  });
});

describe('toolbarPosition', () => {
  const view = { width: 390, height: 600 };
  it('floats above the item', () => {
    expect(toolbarPosition([195, 300], view)).toEqual([195, 256]);
  });
  it('stays inside the view near its edges', () => {
    expect(toolbarPosition([10, 300], view)[0]).toBe(164);
    expect(toolbarPosition([385, 300], view)[0]).toBe(226);
    expect(toolbarPosition([195, 20], view)[1]).toBe(28);
    expect(toolbarPosition([195, 900], view)[1]).toBe(572);
  });
  it('is centred in a view narrower than itself', () => {
    expect(toolbarPosition([10, 300], { width: 300, height: 600 })[0]).toBe(150);
  });
});

describe('toolbarInView', () => {
  it('shows the toolbar for an item in the picture or just beside it', () => {
    expect(toolbarInView({ x: 0, y: 0, z: 0.5 })).toBe(true);
    expect(toolbarInView({ x: -1.1, y: 0.9, z: 0.9 })).toBe(true);
  });
  it('hides it for an item behind the camera or well off-screen', () => {
    // Behind the camera a point projects beyond the far plane, mirrored onto the screen.
    expect(toolbarInView({ x: 0.2, y: -0.3, z: 1.4 })).toBe(false);
    expect(toolbarInView({ x: 1.6, y: 0, z: 0.5 })).toBe(false);
    expect(toolbarInView({ x: 0, y: -2, z: 0.5 })).toBe(false);
  });
});

describe('markerTapRadius', () => {
  it('is the comfortable target up close, larger for a finger', () => {
    expect(markerTapRadius(1, false)).toBe(0.2);
    expect(markerTapRadius(1, true)).toBe(0.4);
  });
  it('stops growing with the marker, but always covers the ball that is drawn', () => {
    expect(markerTapRadius(2, true)).toBe(0.8);
    // Five times life-size: the ring is 1.35 m out, the target stays well inside it.
    expect(markerTapRadius(5, true)).toBe(0.8);
    expect(markerTapRadius(5, false)).toBeCloseTo(0.66);
    expect(markerTapRadius(5, false)).toBeGreaterThan(0.12 * 5);
  });
});

describe('markerScale', () => {
  it('draws a camera marker life-size up close and larger from afar, up to a limit', () => {
    expect(markerScale(2)).toBe(1);
    expect(markerScale(7)).toBe(1);
    expect(markerScale(14)).toBe(2);
    expect(markerScale(500)).toBe(5);
  });
});

describe('the foot of the 3D view on a phone', () => {
  it('resets the view, except while looking from a photo', async () => {
    const reset = vi.fn();
    await open('portrait', { photos: [testPhoto({ id: 'hallway' })] });
    lastScene!.resetViewRef!.current = reset;
    fireEvent.click(screen.getByRole('button', { name: /Reset view/ }));
    expect(reset).toHaveBeenCalledOnce();

    // "View from here" holds the camera at the photo's pose: nothing to reset.
    act(() => lastScene!.onSelectPhoto!('hallway'));
    fireEvent.click(await screen.findByRole('button', { name: 'View from here' }));
    expect(lastScene?.viewpoint).toBeDefined();
    expect(screen.queryByRole('button', { name: /Reset view/ })).not.toBeInTheDocument();
  });

  it('has no "Reset view" on a desktop and none while walking', async () => {
    const { turn } = await open('desktop');
    expect(screen.queryByRole('button', { name: /Reset view/ })).not.toBeInTheDocument();
    turn('portrait');
    expect(screen.getByRole('button', { name: /Reset view/ })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Walk and take photos' }));
    expect(screen.queryByRole('button', { name: /Reset view/ })).not.toBeInTheDocument();
  });

  it('says that an edit is being saved while the sheet is closed', async () => {
    await openWithBed('portrait');
    expect(screen.queryByRole('status', { name: 'Status' })).not.toBeInTheDocument();
    act(() => lastScene!.handlers.onSelect('bed-1'));
    act(() => lastScene!.toolbar!.onRotate(1));
    expect(screen.getByRole('status', { name: 'Status' })).toHaveTextContent('Saving…');
    await vi.waitFor(
      () => expect(screen.getByRole('status', { name: 'Status' })).toHaveTextContent('Saved'),
      { timeout: 3000 },
    );
  });
});

describe('stageStatusText', () => {
  const quiet = { loading: false, save: 'saved' as const, edited: false, photosError: undefined };
  it('is silent when nothing is going on', () => {
    expect(stageStatusText(quiet)).toBeUndefined();
  });
  it('reports loading, saving and saved', () => {
    expect(stageStatusText({ ...quiet, loading: true })?.text).toBe('Loading furniture…');
    expect(stageStatusText({ ...quiet, save: 'pending' })).toEqual({
      text: 'Saving…',
      warn: false,
    });
    expect(stageStatusText({ ...quiet, save: 'saving' })).toEqual({ text: 'Saving…', warn: false });
    expect(stageStatusText({ ...quiet, edited: true })).toEqual({ text: 'Saved', warn: false });
  });
  it('warns about what needs attention', () => {
    expect(stageStatusText({ ...quiet, save: 'offline' })).toMatchObject({ warn: true });
    expect(stageStatusText({ ...quiet, save: 'conflict' })?.text).toMatch(/Changed elsewhere/);
    expect(stageStatusText({ ...quiet, save: 'rejected' })?.text).toMatch(/Not saved/);
    expect(stageStatusText({ ...quiet, loading: true, photosError: 'boom' })).toMatchObject({
      text: expect.stringMatching(/^Photos/) as string,
      warn: true,
    });
  });
});

describe('first-run hints', () => {
  const hints = () => screen.queryByRole('complementary', { name: 'How to use the viewer' });

  it('shows once on a phone and stays away after "Got it"', async () => {
    await open('portrait');
    expect(hints()).toHaveTextContent(/Drag to turn the view/);
    expect(hints()).toHaveTextContent(/Tap a tab below/);
    expect(hints()).toHaveTextContent(/Walk lets you walk/);
    fireEvent.click(within(hints()!).getByRole('button', { name: 'Got it' }));
    expect(hints()).not.toBeInTheDocument();
    expect(localStorage.getItem(HINTS_SEEN_KEY)).not.toBeNull();
  });

  it('does not show again in the same browser', async () => {
    localStorage.setItem(HINTS_SEEN_KEY, 'earlier');
    await open('portrait');
    expect(hints()).not.toBeInTheDocument();
  });

  it('points to the side when the phone is held across, and is not for desktops', async () => {
    const { turn } = await open('landscape');
    expect(hints()).toHaveTextContent(/Tap a tab at the side/);
    turn('desktop');
    expect(hints()).not.toBeInTheDocument();
  });

  it('is left out with ?hints=off, without counting as seen', async () => {
    window.history.replaceState(null, '', '/?hints=off');
    await open('portrait');
    expect(hints()).not.toBeInTheDocument();
    expect(localStorage.getItem(HINTS_SEEN_KEY)).toBeNull();
  });

  it('is not shown while walking', async () => {
    window.history.replaceState(null, '', '/?walk=first');
    await open('portrait');
    expect(hints()).not.toBeInTheDocument();
  });
});

describe('useKeyboardViewport', () => {
  function stubViewport(width: number, height: number) {
    const viewport = Object.assign(new EventTarget(), { width, height });
    vi.stubGlobal('visualViewport', viewport);
    vi.spyOn(window, 'scrollTo').mockImplementation(() => {});
    return (next: { width?: number; height?: number }) => {
      Object.assign(viewport, next);
      viewport.dispatchEvent(new Event('resize'));
    };
  }
  function Probe({ enabled }: { enabled: boolean }) {
    useKeyboardViewport(enabled);
    return null;
  }
  const root = document.documentElement;

  it('keeps the app in what the keyboard leaves free, and lets go when it closes', () => {
    const resize = stubViewport(390, 844);
    const { unmount } = render(<Probe enabled />);
    expect(root).not.toHaveClass('keyboard-open');

    resize({ height: 508 });
    expect(root).toHaveClass('keyboard-open');
    expect(root.style.getPropertyValue('--app-height')).toBe('508px');

    // The browser's own bars take far less than a keyboard.
    resize({ height: 790 });
    expect(root).not.toHaveClass('keyboard-open');
    expect(root.style.getPropertyValue('--app-height')).toBe('');

    resize({ height: 508 });
    unmount();
    expect(root).not.toHaveClass('keyboard-open');
    expect(root.style.getPropertyValue('--app-height')).toBe('');
  });

  it('starts over when the phone is turned', () => {
    const resize = stubViewport(390, 844);
    render(<Probe enabled />);
    // Held across the screen is lower, but that is not a keyboard.
    resize({ width: 844, height: 390 });
    expect(root).not.toHaveClass('keyboard-open');
    resize({ height: 170 });
    expect(root).toHaveClass('keyboard-open');
  });

  it('does nothing on a desktop screen', () => {
    const resize = stubViewport(1440, 900);
    render(<Probe enabled={false} />);
    resize({ height: 300 });
    expect(root).not.toHaveClass('keyboard-open');
  });
});
