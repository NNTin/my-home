import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from './App';
import type { SceneProps } from './scene/Scene';
import { fakeApi } from './test/fakeApi';
import { layoutItem } from './test/fixtures';

// jsdom has no WebGL: the canvas is replaced by a stub exposing the furniture and its handlers.
let lastScene: SceneProps | undefined;
vi.mock('./scene/Scene', () => ({
  Scene: (props: SceneProps) => {
    lastScene = props;
    return <div data-testid="scene" />;
  },
}));

const furniture = () => lastScene?.furniture ?? [];
const panel = () => within(screen.getByRole('region', { name: 'Furniture' }));
const status = () => panel().getByRole('status').textContent;
const waitSaved = () =>
  vi.waitFor(() => expect(status()).toBe('All changes saved'), { timeout: 3000 });
const key = (k: string, mods: Partial<KeyboardEventInit> = {}) =>
  fireEvent.keyDown(window, { key: k, ...mods });

async function renderApp() {
  render(<App />);
  await screen.findByTestId('scene');
  await vi.waitFor(() => expect(panel().getByLabelText('Name')).not.toHaveValue(''));
}

/** Cuts away the upper levels, so furniture is added to the souterrain. */
const showSouterrain = () =>
  fireEvent.click(
    within(screen.getByRole('group', { name: 'Show up to level' })).getByLabelText('Souterrain'),
  );
const layoutGroup = () => within(panel().getByRole('group', { name: 'Layout' }));

/** Runs scene handlers one render at a time, as real pointer events would. */
const scene = (...steps: ((h: SceneProps['handlers']) => void)[]) => {
  for (const step of steps) act(() => step(lastScene!.handlers));
};

const place = (name: RegExp) => fireEvent.click(panel().getByRole('button', { name }));

describe('furniture editor', () => {
  beforeEach(() => vi.spyOn(window, 'confirm').mockReturnValue(true));
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    localStorage.clear();
    lastScene = undefined;
  });

  it('creates a default layout and builds the catalog from the registry', async () => {
    const api = fakeApi();
    await renderApp();
    expect(panel().getByLabelText('Name')).toHaveValue('Default layout');
    expect([...api.layouts.values()].map((l) => l.name)).toEqual(['Default layout']);
    for (const group of ['Bedroom', 'Dining', 'Living room', 'Office'])
      expect(panel().getByRole('group', { name: group })).toBeInTheDocument();
    expect(
      panel().getAllByRole('button', { name: /Bed|Sofa|Round table|Chair|Wardrobe|Desk/ }),
    ).toHaveLength(6);
  });

  it('places furniture in the chosen room and auto-saves it', async () => {
    const api = fakeApi();
    await renderApp();
    showSouterrain();
    fireEvent.change(panel().getByLabelText('Room'), { target: { value: 'souterrain-bedroom' } });
    place(/Bed/);

    expect(furniture()).toHaveLength(1);
    expect(furniture()[0]).toMatchObject({ selected: true, colliding: false });
    expect(panel().getByLabelText('Selected item')).toHaveTextContent('Bed in Bedroom');
    expect(status()).toBe('Unsaved changes…');
    await waitSaved();
    const [saved] = [...api.layouts.values()];
    expect(saved?.items).toEqual([
      expect.objectContaining({
        typeId: 'bed',
        levelId: 'souterrain',
        roomId: 'souterrain-bedroom',
      }),
    ]);
    expect(saved?.version).toBe(2);
  });

  it('moves, rotates, duplicates and deletes with undo/redo and shortcuts', async () => {
    fakeApi();
    await renderApp();
    showSouterrain();
    fireEvent.change(panel().getByLabelText('Room'), {
      target: { value: 'souterrain-living-room' },
    });
    place(/Chair/);
    const id = furniture()[0]!.id;
    const start = furniture()[0]!.position;

    scene(
      (h) => h.onMoveStart(id),
      (h) => h.onMove(id, [-3.03, -2.02]),
      (h) => h.onMove(id, [-3.51, -2.49]),
      (h) => h.onDragEnd(),
    );
    expect(furniture()[0]!.position).toEqual([-3.5, -1.2, -2.5]);

    key('r');
    expect(furniture()[0]!.rotationY).toBeCloseTo(Math.PI / 2);
    key('d', { ctrlKey: true });
    expect(furniture()).toHaveLength(2);
    expect(furniture().some((f) => f.colliding)).toBe(false);
    key('Delete');
    expect(furniture()).toHaveLength(1);

    key('z', { ctrlKey: true }); // delete
    key('z', { ctrlKey: true }); // duplicate
    key('z', { ctrlKey: true }); // rotate
    expect(furniture()).toHaveLength(1);
    expect(furniture()[0]!.rotationY).toBe(0);
    key('z', { ctrlKey: true }); // move
    expect(furniture()[0]!.position).toEqual(start);
    key('z', { ctrlKey: true }); // place
    expect(furniture()).toHaveLength(0);
    expect(panel().getByRole('button', { name: 'Undo' })).toBeDisabled();

    key('Z', { ctrlKey: true, shiftKey: true });
    key('y', { ctrlKey: true });
    expect(furniture()[0]!.position).toEqual([-3.5, -1.2, -2.5]);
  });

  it('rotates with the handle in steps or freely, and highlights collisions', async () => {
    fakeApi();
    await renderApp();
    showSouterrain();
    place(/Sofa/);
    const id = furniture()[0]!.id;
    const [x, , z] = furniture()[0]!.position;
    const drag = (to: [number, number]) =>
      scene(
        (h) => h.onRotateStart(id),
        (h) => h.onRotate(id, [x + 1, z], to),
        (h) => h.onDragEnd(),
      );

    drag([x + 1, z - 0.8]); // ~39° counter-clockwise: rounds to 0 with 90° steps
    expect(furniture()[0]!.rotationY).toBe(0);
    fireEvent.change(panel().getByLabelText('Rotation step'), { target: { value: '0' } });
    drag([x + 1, z - 0.8]);
    expect(furniture()[0]!.rotationY).toBeCloseTo(Math.atan2(0.8, 1));

    place(/Sofa/);
    const second = furniture()[1]!.id;
    scene(
      (h) => h.onMoveStart(second),
      (h) => h.onMove(second, [x, z]),
      (h) => h.onDragEnd(),
    );
    expect(furniture().every((f) => f.colliding)).toBe(true);
    expect(panel().getByLabelText('Selected item')).toHaveTextContent('Overlaps sofa');
  });

  it('manages named layouts: create, rename, duplicate, switch and delete', async () => {
    const api = fakeApi();
    await renderApp();
    const names = () => [...api.layouts.values()].map((l) => l.name);

    fireEvent.click(panel().getByRole('button', { name: 'New' }));
    await vi.waitFor(() => expect(panel().getByLabelText('Name')).toHaveValue('Layout'));
    fireEvent.change(panel().getByLabelText('Name'), { target: { value: 'Living plan' } });
    await waitSaved();
    expect(names()).toEqual(['Default layout', 'Living plan']);

    place(/Desk/);
    fireEvent.click(layoutGroup().getByRole('button', { name: 'Duplicate' }));
    await vi.waitFor(() =>
      expect(panel().getByLabelText('Name')).toHaveValue('Living plan (copy)'),
    );
    expect(furniture()).toHaveLength(1);
    expect(names()).toEqual(['Default layout', 'Living plan', 'Living plan (copy)']);

    const select = panel().getByLabelText('Layout');
    fireEvent.change(select, { target: { value: 'layout-1' } });
    await vi.waitFor(() => expect(panel().getByLabelText('Name')).toHaveValue('Default layout'));
    expect(furniture()).toHaveLength(0);
    expect(localStorage.getItem('my-home:last-layout:mock-home')).toBe('layout-1');

    fireEvent.click(layoutGroup().getByRole('button', { name: 'Delete' }));
    await vi.waitFor(() => expect(names()).toEqual(['Living plan', 'Living plan (copy)']));
    await vi.waitFor(() => expect(panel().getByLabelText('Name')).toHaveValue('Living plan'));
    expect(panel().getByRole('link', { name: 'Export' })).toHaveAttribute(
      'href',
      '/api/layouts/layout-2/export',
    );
  });

  it('reopens the last active layout', async () => {
    fakeApi({ layouts: [{ name: 'A' }, { name: 'B', items: [layoutItem()] }] });
    localStorage.setItem('my-home:last-layout:mock-home', 'layout-2');
    await renderApp();
    expect(panel().getByLabelText('Name')).toHaveValue('B');
    expect(furniture()).toHaveLength(1);
  });

  it('restores an unsynced local draft after a reload and saves it', async () => {
    const api = fakeApi({ layouts: [{ name: 'Default' }] });
    localStorage.setItem(
      'my-home:layout-draft:layout-1',
      JSON.stringify({
        layoutId: 'layout-1',
        baseVersion: 1,
        name: 'Default',
        items: [layoutItem()],
        savedAt: '2026-06-01T00:00:00.000Z',
      }),
    );
    await renderApp();
    expect(furniture()).toHaveLength(1);
    expect(panel().getByText('Restored unsaved changes from this browser.')).toBeInTheDocument();
    await waitSaved();
    expect(api.layouts.get('layout-1')?.items).toEqual([layoutItem()]);
    expect(localStorage.getItem('my-home:layout-draft:layout-1')).toBeNull();
  });

  it('keeps the draft on a 409 and lets the user overwrite or reload', async () => {
    const api = fakeApi({ layouts: [{ name: 'Default' }] });
    await renderApp();
    api.touch('layout-1', { name: 'Changed elsewhere' });
    place(/Wardrobe/);
    const alert = await panel().findByRole('alert', {}, { timeout: 3000 });
    expect(alert).toHaveTextContent('changed elsewhere');
    expect(localStorage.getItem('my-home:layout-draft:layout-1')).toContain('wardrobe');

    fireEvent.click(within(alert).getByRole('button', { name: 'Overwrite with mine' }));
    await waitSaved();
    expect(api.layouts.get('layout-1')).toMatchObject({ name: 'Default', version: 3 });

    api.touch('layout-1', { name: 'Changed again', items: [] });
    key('Delete');
    const again = await panel().findByRole('alert', {}, { timeout: 3000 });
    fireEvent.click(within(again).getByRole('button', { name: 'Reload server copy' }));
    await vi.waitFor(() => expect(panel().getByLabelText('Name')).toHaveValue('Changed again'));
    expect(furniture()).toHaveLength(0);
    expect(status()).toBe('All changes saved');
    expect(localStorage.getItem('my-home:layout-draft:layout-1')).toBeNull();
  });

  it('keeps and flags items whose level or room no longer exists', async () => {
    const api = fakeApi({
      layouts: [
        {
          name: 'Old building',
          items: [
            layoutItem({ id: 'gone-level', levelId: 'attic', roomId: 'attic-room' }),
            layoutItem({ id: 'gone-room', roomId: 'old-bedroom' }),
            layoutItem({ id: 'gone-type', typeId: 'piano', position: { x: 3, z: -2 } }),
          ],
        },
      ],
    });
    await renderApp();
    const flagged = within(panel().getByRole('group', { name: 'Needs attention' }));
    expect(flagged.getAllByRole('listitem').map((li) => li.textContent)).toEqual([
      expect.stringContaining('level "attic" no longer exists'),
      expect.stringContaining('room "old-bedroom" no longer exists'),
      expect.stringContaining('unknown furniture type'),
    ]);
    // The item on a missing level is not drawn; the others are.
    expect(furniture().map((f) => f.id)).toEqual(['gone-room', 'gone-type']);

    showSouterrain();
    fireEvent.click(flagged.getByRole('button', { name: 'Move to Souterrain' }));
    expect(furniture().map((f) => f.id)).toContain('gone-level');
    await waitSaved();
    expect(api.layouts.get('layout-1')?.items).toHaveLength(3);
  });

  it('imports a layout file as a new layout and reports invalid files', async () => {
    const api = fakeApi();
    await renderApp();
    const input = panel().getByLabelText('Import layout file');
    const file = (content: string) =>
      new File([content], 'layout.json', { type: 'application/json' });

    fireEvent.change(input, {
      target: {
        files: [
          file(JSON.stringify({ schemaVersion: 1, name: 'Imported', items: [layoutItem()] })),
        ],
      },
    });
    await vi.waitFor(() => expect(panel().getByLabelText('Name')).toHaveValue('Imported'));
    expect(api.layouts.size).toBe(2);

    fireEvent.change(input, { target: { files: [file('{"name": 1}')] } });
    expect(await panel().findByText(/Import failed: not a layout file/)).toBeInTheDocument();
    fireEvent.change(input, { target: { files: [file('nope')] } });
    expect(await panel().findByText(/not valid JSON/)).toBeInTheDocument();
  });
});
