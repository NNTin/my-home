import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { App } from './App';
import { enterEditMode } from './test/editMode';
import { frameFor, piecePageHref, scenePieces } from './placements/focus';
import { buildHome } from './builder/buildHome';
import type { SceneProps } from './scene/Scene';
import { fakeApi } from './test/fakeApi';
import { mockHome, testPlacement } from './test/fixtures';
import { shownScene } from './test/screen';

let lastScene: SceneProps | undefined;
const shown = () => lastScene && shownScene(lastScene);
vi.mock('./scene/Scene', () => ({
  Scene: (props: SceneProps) => {
    lastScene = props;
    return <div data-testid="scene" />;
  },
}));

const WINDOW = 'souterrain-kitchen-window';
const panel = () => within(screen.getByRole('region', { name: 'Furniture' }));

async function openAt(search: string, options?: Parameters<typeof fakeApi>[0]) {
  window.history.replaceState(null, '', `/${search}`);
  const api = fakeApi(options);
  render(<App />);
  await screen.findByTestId('scene');
  await vi.waitFor(() => expect(api.calls('GET', /placements/).length).toBeGreaterThan(0));
  await act(() => new Promise((r) => setTimeout(r, 20)));
}

afterEach(() => {
  vi.unstubAllGlobals();
  localStorage.clear();
  lastScene = undefined;
  window.history.replaceState(null, '', '/');
});

describe('?focus=<useId>', () => {
  it('frames an opening, cuts away to its level, highlights and selects it', async () => {
    await openAt(`?focus=${WINDOW}`);
    const piece = scenePieces(buildHome(mockHome)).get(WINDOW)!;
    await vi.waitFor(() => expect(lastScene?.frame).toBeDefined());
    expect(lastScene!.frame).toMatchObject({ center: piece.center, radius: piece.radius });
    // The view looks at the back wall from outside, from behind the house.
    expect(lastScene!.frame!.from[2]).toBeLessThan(0);
    expect(shown()!.openings.every((o) => o.levelId === 'souterrain')).toBe(true);
    expect(lastScene!.pieces?.highlightId).toBe(WINDOW);
    const chip = panel().getByLabelText('Selected piece');
    expect(chip).toHaveTextContent('Kitchen · back window (Casement window)');
    expect(within(chip).getByRole('link', { name: /Open piece page/ })).toHaveAttribute(
      'href',
      `/catalog/openings/window.casement?home=mock-home#use=${WINDOW}`,
    );
  });

  it('frames and selects a placement once the placements are loaded', async () => {
    await openAt('?focus=souterrain-bed-1', { placements: [testPlacement()] });
    await vi.waitFor(() => expect(lastScene?.frame).toBeDefined());
    expect(lastScene!.furniture.find((f) => f.selected)?.id).toBe('souterrain-bed-1');
    expect(lastScene!.frame!.center[0]).toBe(-3);
    expect(lastScene!.frame!.from[1]).toBeGreaterThan(0.8); // from high above, into the cutaway
    expect(panel().getByLabelText('Selected item')).toHaveTextContent('Bedroom · Bed');
  });

  it('says so for an id that is not in this home', async () => {
    await openAt('?focus=nope');
    expect(await screen.findByRole('alert')).toHaveTextContent('Not found in this home');
    expect(lastScene!.frame).toBeUndefined();
  });

  it('walking wins over focus', async () => {
    await openAt(`?walk=first&focus=${WINDOW}`);
    expect(lastScene!.walk).toBeDefined();
    expect(lastScene!.frame).toBeUndefined();
    expect(lastScene!.pieces).toBeUndefined();
    expect(screen.queryByRole('alert')).toBeNull();
  });
});

describe('picking a window, door or gate', () => {
  it('selects it with a chip and a link to its piece page; furniture selection is cleared', async () => {
    await openAt('', { placements: [testPlacement()] });
    act(() => lastScene!.handlers.onSelect('souterrain-bed-1'));
    act(() => lastScene!.pieces!.onSelectPiece('souterrain-living-door'));
    expect(lastScene!.furniture.some((f) => f.selected)).toBe(false);
    // Its label at the edge opens the inspector (HUD v2 #201).
    fireEvent.click(screen.getByRole('button', { name: 'Living room door: details' }));
    expect(panel().getByLabelText('Selected piece')).toHaveTextContent(
      'Living room door (Interior door)',
    );
    expect(lastScene!.pieces?.highlightId).toBe('souterrain-living-door');
    // Clicking a wall in front of it, or empty space, puts it away.
    act(() => lastScene!.pieces!.onSelectPiece(undefined));
    // With nothing selected and Edit off, the desktop rests: the furniture surface closes (HUD v2 #200).
    expect(screen.queryByLabelText('Selected piece')).toBeNull();
    expect(screen.queryByRole('region', { name: 'Furniture' })).toBeNull();
  });
});

describe('picking a room (HUD v2 #201)', () => {
  it('selects the room under a click on its floor: outline, label, inspector, Focus room', async () => {
    await openAt('?hints=off');
    const room = buildHome(mockHome).roomFloors.find((r) => r.name === 'Living room')!;
    act(() => lastScene!.pieces!.onSelectRoom!([room.labelAt[0], room.y, room.labelAt[2]]));
    expect(lastScene!.roomOutline?.outline).toEqual(room.outline);
    // A door behind the click is not frontmost and says "none": the room stays selected.
    act(() => lastScene!.pieces!.onSelectPiece(undefined));
    expect(lastScene!.roomOutline?.outline).toEqual(room.outline);
    // Its label at the edge opens the inspector.
    fireEvent.click(screen.getByRole('button', { name: 'Living room: details' }));
    const selected = within(panel().getByLabelText('Selected room'));
    expect(selected.getByText('Living room')).toBeInTheDocument();
    const before = lastScene!.frame?.key ?? 0;
    fireEvent.click(selected.getByRole('button', { name: 'Focus room' }));
    expect(lastScene!.frame?.key).toBeGreaterThan(before);
    // A click on empty space clears the outline and the label together.
    act(() => lastScene!.handlers.onSelect(undefined));
    expect(lastScene!.roomOutline).toBeUndefined();
    expect(screen.queryByRole('button', { name: 'Living room: details' })).toBeNull();
    // A click on a wall picks no room.
    act(() => lastScene!.pieces!.onSelectRoom!([500, room.y, 500]));
    expect(lastScene!.roomOutline).toBeUndefined();
  });

  it('picks no room in Edit, where a click on the floor deselects as before', async () => {
    enterEditMode();
    await openAt('?hints=off');
    expect(lastScene!.pieces?.onSelectRoom).toBeUndefined();
  });

  it('says which spaces a door links', async () => {
    await openAt('?hints=off');
    act(() => lastScene!.pieces!.onSelectPiece('souterrain-living-door'));
    fireEvent.click(screen.getByRole('button', { name: /: details$/ }));
    expect(
      within(panel().getByLabelText('Selected piece')).getByText(/^Between /),
    ).toHaveTextContent('Living room');
  });
});

describe('focus helpers', () => {
  const scene = buildHome(mockHome);
  it('looks at exterior pieces from outside and interior ones from above', () => {
    const pieces = scenePieces(scene);
    expect(pieces.get(WINDOW)).toMatchObject({
      kind: 'opening',
      exterior: true,
      levelId: 'souterrain',
    });
    expect(pieces.get('souterrain-living-door')?.exterior).toBe(false);
    const inside = frameFor(scene, pieces.get('souterrain-living-door')!);
    expect(inside.from[1]).toBeCloseTo(Math.sin((60 * Math.PI) / 180));
    expect(Math.hypot(...inside.from)).toBeCloseTo(1);
  });
  it('links a use to its piece page', () => {
    expect(piecePageHref('door.interior', 'home', 'x y')).toBe(
      '/catalog/openings/door.interior?home=home#use=x%20y',
    );
  });
});
