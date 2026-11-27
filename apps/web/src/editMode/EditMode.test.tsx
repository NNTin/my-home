import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { App } from '../App';
import type { SceneProps } from '../scene/Scene';
import { fakeApi } from '../test/fakeApi';
import { testPlacement } from '../test/fixtures';
import { stubScreen } from '../test/screen';
import { isEditMode } from './editMode';

// jsdom has no WebGL: the canvas is replaced by a stub exposing what it was asked to draw.
let lastScene: SceneProps | undefined;
vi.mock('../scene/Scene', () => ({
  Scene: (props: SceneProps) => {
    lastScene = props;
    return <div data-testid="scene" />;
  },
}));

const furniture = () => lastScene?.furniture ?? [];
const panel = () => within(screen.getByRole('region', { name: 'Furniture' }));
/** "Edit": the painted switch (sakuga-toggle, its fallback here): on is edit mode. */
const toggle = () => screen.getByRole('switch', { name: 'Edit' });
const badge = () => screen.queryByRole('status', { name: 'Edit mode' });
const key = (k: string, mods: Partial<KeyboardEventInit> = {}) =>
  fireEvent.keyDown(window, { key: k, ...mods });

const bed = testPlacement({ id: 'bed-1', name: 'Bed' });

async function open(mode?: Parameters<typeof stubScreen>[0]) {
  if (mode) stubScreen(mode);
  const api = fakeApi({ placements: [bed] });
  render(<App />);
  await screen.findByTestId('scene');
  await vi.waitFor(() => expect(furniture()).toHaveLength(1));
  return api;
}

const writes = (api: ReturnType<typeof fakeApi>) =>
  api.fetch.mock.calls.filter(([, init]) => (init?.method ?? 'GET') !== 'GET');

/** One pointer drag of the bed, as the scene reports it. */
const drag = (to: [number, number]) => {
  const h = () => lastScene!.handlers;
  act(() => h().onMoveStart('bed-1'));
  act(() => h().onMove('bed-1', to));
  act(() => h().onDragEnd());
};

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  localStorage.clear();
  lastScene = undefined;
  window.history.replaceState(null, '', '/');
});

describe('edit mode on a desktop', () => {
  it('starts in view mode: nothing moves, nothing is offered to change', async () => {
    const api = await open();
    expect(isEditMode()).toBe(false);
    expect(toggle()).not.toBeChecked();
    expect(badge()).not.toBeInTheDocument();
    expect(lastScene?.editable).toBe(false);

    const before = furniture()[0]!.position;
    drag([1, 1]);
    act(() => lastScene!.handlers.onRotateStart('bed-1'));
    act(() => lastScene!.handlers.onRotate('bed-1', [0, 0], [1, 0]));
    act(() => lastScene!.handlers.onDragEnd());
    expect(furniture()[0]!.position).toEqual(before);
    expect(furniture()[0]!.rotationY).toBe(bed.rotationY);

    // No editing shortcut works either.
    act(() => lastScene!.handlers.onSelect('bed-1'));
    key('r');
    key('d', { ctrlKey: true });
    key('Delete');
    key('z', { ctrlKey: true });
    expect(furniture()).toHaveLength(1);
    expect(furniture()[0]!.rotationY).toBe(bed.rotationY);

    // The panel offers no way to place or change: only to inspect.
    expect(panel().queryByRole('group', { name: 'Bed room' })).not.toBeInTheDocument();
    for (const name of [/^Undo$/, /^Redo$/, /Rotate/, /^Duplicate$/, /^Delete$/])
      expect(panel().queryByRole('button', { name })).not.toBeInTheDocument();
    expect(panel().queryByLabelText('Height above the floor in cm')).not.toBeInTheDocument();
    expect(writes(api)).toEqual([]);
  });

  it('still selects an item to inspect it: name, type, piece page link', async () => {
    await open();
    act(() => lastScene!.handlers.onSelect('bed-1'));
    expect(furniture()[0]!.selected).toBe(true);
    const selection = within(panel().getByLabelText('Selected item'));
    expect(selection.getByText('Bed')).toBeInTheDocument();
    expect(selection.getByRole('link', { name: /Open piece page: Bed/ })).toBeInTheDocument();
    act(() => lastScene!.handlers.onSelect(undefined));
    expect(furniture()[0]!.selected).toBe(false);
  });

  it('works after "Edit", says so, and stops again after "Done"', async () => {
    const api = await open();
    fireEvent.click(toggle());
    expect(isEditMode()).toBe(true);
    expect(toggle()).toBeChecked();
    expect(badge()).toHaveTextContent('Edit mode');
    expect(lastScene?.editable).toBe(true);
    expect(panel().getByRole('group', { name: 'Bed room' })).toBeInTheDocument();

    drag([-1, -2]);
    expect(furniture()[0]!.position[0]).toBeCloseTo(-1, 0);
    await vi.waitFor(() => expect(writes(api).length).toBeGreaterThan(0), { timeout: 3000 });
    act(() => lastScene!.handlers.onSelect('bed-1'));
    key('r');
    expect(furniture()[0]!.rotationY).not.toBe(bed.rotationY);

    fireEvent.click(toggle());
    expect(isEditMode()).toBe(false);
    expect(badge()).not.toBeInTheDocument();
    expect(lastScene?.editable).toBe(false);
    const after = furniture()[0]!;
    drag([3, 3]);
    key('Delete');
    expect(furniture()).toHaveLength(1);
    expect(furniture()[0]!.position).toEqual(after.position);
    expect(furniture()[0]!.rotationY).toBe(after.rotationY);
    expect(panel().queryByRole('group', { name: 'Bed room' })).not.toBeInTheDocument();
  });

  it('puts an item back when edit mode ends in the middle of a drag', async () => {
    await open();
    fireEvent.click(toggle());
    const before = furniture()[0]!.position;
    act(() => lastScene!.handlers.onMoveStart('bed-1'));
    act(() => lastScene!.handlers.onMove('bed-1', [-2, -2]));
    expect(furniture()[0]!.position).not.toEqual(before);
    fireEvent.click(toggle());
    expect(furniture()[0]!.position).toEqual(before);
  });
});

describe('edit mode on a phone', () => {
  it('has "Edit" in the stage tools, not the top bar; a tap shows the piece, not the tools', async () => {
    await open('portrait');
    expect(lastScene?.touch).toBe(true);
    expect(lastScene?.editable).toBe(false);
    // Its splash rises over the view from the foot of the stage (§5.13).
    expect(toggle().closest('.stage-tools')).not.toBeNull();
    expect(
      within(screen.getByRole('toolbar', { name: 'Mode and level' })).queryByRole('switch'),
    ).toBeNull();
    expect(lastScene?.toolbar).toBeUndefined();

    act(() => lastScene!.handlers.onSelect('bed-1'));
    const view = screen.getByRole('toolbar', { name: 'Bed: piece' });
    expect(within(view).getByRole('link', { name: /Open piece page: Bed/ })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Rotate left' })).not.toBeInTheDocument();
    expect(lastScene?.handlers).not.toHaveProperty('onLongPress');
    const before = furniture()[0]!.position;
    drag([2, 2]);
    expect(furniture()[0]!.position).toEqual(before);
  });

  it('floats the tools after "Edit" and takes them away after "Done"', async () => {
    await open('portrait');
    fireEvent.click(toggle());
    expect(badge()).toBeInTheDocument();
    expect(lastScene?.editable).toBe(true);
    act(() => lastScene!.handlers.onSelect('bed-1'));
    expect(lastScene?.toolbar).toBeDefined();
    act(() => lastScene!.toolbar!.onRotate(1));
    expect(furniture()[0]!.rotationY).not.toBe(bed.rotationY);

    fireEvent.click(toggle());
    expect(lastScene?.toolbar).toBeUndefined();
    expect(lastScene?.editable).toBe(false);
  });
});
