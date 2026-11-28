import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { App } from './App';
import type { SceneProps } from './scene/Scene';
import { fakeApi } from './test/fakeApi';
import { enterEditMode } from './test/editMode';
import { testPlacement } from './test/fixtures';

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
  enterEditMode();
  render(<App />);
  await screen.findByTestId('scene');
  await vi.waitFor(() => expect(status()).not.toBe('Loading furniture…'));
}

/** Cuts away the upper levels, so furniture is added to the souterrain. */
const showSouterrain = () =>
  fireEvent.click(
    within(screen.getByRole('radiogroup', { name: 'Show up to level' })).getByLabelText(
      'Souterrain',
    ),
  );

/** Runs scene handlers one render at a time, as real pointer events would. */
const scene = (...steps: ((h: SceneProps['handlers']) => void)[]) => {
  for (const step of steps) act(() => step(lastScene!.handlers));
};

const place = (name: RegExp) => fireEvent.click(panel().getByRole('button', { name }));

describe('furniture editor', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    localStorage.clear();
    lastScene = undefined;
  });

  it('has one set of furniture per home: no layout manager, the catalogue from the registry', async () => {
    fakeApi();
    await renderApp();
    expect(panel().queryByRole('group', { name: 'Layout' })).toBeNull();
    expect(panel().queryByLabelText('Layout')).toBeNull();
    expect(panel().queryByLabelText('Name')).toBeNull();
    for (const name of ['New', 'Import…', 'Export'])
      expect(panel().queryByRole('button', { name })).toBeNull();
    expect(panel().queryByLabelText('Import layout file')).toBeNull();
    for (const group of ['Bed room', 'Dining', 'Living room', 'Work room'])
      expect(panel().getByRole('group', { name: group })).toBeInTheDocument();
    expect(
      panel().getAllByRole('button', { name: /Bed|Sofa|Round table|Chair|Wardrobe|Desk/ }),
    ).toHaveLength(6);
    expect(status()).toBe('All changes saved');
  });

  it('deletes the selected item with Delete or Backspace, but Backspace in a field is the field’s (#218 review)', async () => {
    fakeApi();
    await renderApp();
    showSouterrain();
    place(/Chair/);
    expect(furniture()).toHaveLength(1);
    // Typed in a field, Backspace edits the field: the item stays.
    const field = document.body.appendChild(document.createElement('input'));
    expect(fireEvent.keyDown(field, { key: 'Backspace' })).toBe(true);
    expect(furniture()).toHaveLength(1);
    field.remove();
    // On the view, Backspace deletes it (a Mac laptop has no forward Delete), and is taken.
    expect(fireEvent.keyDown(window, { key: 'Backspace' })).toBe(false);
    expect(furniture()).toHaveLength(0);
    // Undo, and Delete deletes it too.
    key('z', { ctrlKey: true });
    expect(furniture()).toHaveLength(1);
    const id = furniture()[0]!.id;
    scene((h) => h.onSelect(id));
    key('Delete');
    expect(furniture()).toHaveLength(0);
  });

  it('places furniture in the chosen room, saves it as a placement and links its piece page', async () => {
    const api = fakeApi();
    await renderApp();
    showSouterrain();
    fireEvent.change(panel().getByLabelText('Room'), { target: { value: 'souterrain-bedroom' } });
    place(/Bed/);

    expect(furniture()).toHaveLength(1);
    expect(furniture()[0]).toMatchObject({ selected: true, colliding: false });
    await waitSaved();
    expect([...api.placements.values()]).toEqual([
      expect.objectContaining({
        id: 'souterrain-bed-1',
        typeId: 'furniture.bed',
        levelId: 'souterrain',
        roomId: 'souterrain-bedroom',
        version: 1,
      }),
    ]);
    // The server's id and name replace the temporary ones.
    expect(furniture()[0]!.id).toBe('souterrain-bed-1');
    const selected = panel().getByLabelText('Selected item');
    expect(selected).toHaveTextContent('Bedroom · Bed (Bed) in Bedroom');
    expect(within(selected).getByRole('link', { name: /Open piece page/ })).toHaveAttribute(
      'href',
      '/catalog/furniture/furniture.bed?home=mock-home#use=souterrain-bed-1',
    );
  });

  it('hangs a wall cabinet on a wall and a downlight at the ceiling; sets the height, undoes it (#63)', async () => {
    const api = fakeApi();
    await renderApp();
    showSouterrain();
    fireEvent.change(panel().getByLabelText('Room'), { target: { value: 'souterrain-kitchen' } });
    place(/Wall cabinet/);
    await waitSaved();
    const [cabinet] = [...api.placements.values()];
    expect(cabinet).toMatchObject({
      typeId: 'kitchen.wall-cabinet',
      mounting: 'wall',
      elevation: 1.33,
    });
    const height = panel().getByLabelText('Height above the floor in cm');
    expect(height).toHaveValue(133);
    expect(panel().getByLabelText('Mounting')).toHaveValue('wall');

    fireEvent.change(height, { target: { value: '150' } });
    fireEvent.keyDown(height, { key: 'Enter' });
    await waitSaved();
    expect(api.placements.get(cabinet!.id)).toMatchObject({ elevation: 1.5 });
    key('z', { ctrlKey: true });
    await waitSaved();
    expect(api.placements.get(cabinet!.id)).toMatchObject({ elevation: 1.33 });

    fireEvent.click(panel().getByRole('button', { name: /Downlight/ }));
    await waitSaved();
    const light = [...api.placements.values()].find((p) => p.typeId === 'fixture.downlight')!;
    expect(light).toMatchObject({ mounting: 'ceiling', elevation: 0 });
    expect(panel().queryByLabelText('Height above the floor in cm')).toBeNull();
    expect(panel().getByText('Hangs at the ceiling, 250 cm above the floor.')).toBeInTheDocument();
    // Drawn at their heights: the cabinet's bottom 1.33 m and the light 2.50 m above the floor.
    const [c, l] = furniture();
    expect(l!.position[1] - c!.position[1]).toBeCloseTo(2.5 - 1.33);
  });

  it('saves each change per item: move, rotate, duplicate, delete, and their undo', async () => {
    const api = fakeApi();
    await renderApp();
    showSouterrain();
    fireEvent.change(panel().getByLabelText('Room'), {
      target: { value: 'souterrain-living-room' },
    });
    place(/Chair/);
    await waitSaved();
    const id = furniture()[0]!.id;
    const start = furniture()[0]!.position;

    scene(
      (h) => h.onMoveStart(id),
      (h) => h.onMove(id, [-3.03, -2.02]),
      (h) => h.onMove(id, [-3.51, -2.49]),
      (h) => h.onDragEnd(),
    );
    expect(furniture()[0]!.position).toEqual([-3.5, -1.2, -2.5]);
    await waitSaved();
    key('r');
    expect(furniture()[0]!.rotationY).toBeCloseTo(Math.PI / 2);
    await waitSaved();
    // Ctrl+D is the browser's (a bookmark): it duplicates nothing and is not taken. Shift+D duplicates (#204).
    expect(fireEvent.keyDown(window, { key: 'd', ctrlKey: true })).toBe(true);
    expect(furniture()).toHaveLength(1);
    key('D', { shiftKey: true });
    expect(furniture()).toHaveLength(2);
    expect(furniture().some((f) => f.colliding)).toBe(false);
    await waitSaved();
    key('Delete');
    expect(furniture()).toHaveLength(1);
    await waitSaved();

    const writes = () =>
      api.fetch.mock.calls
        .filter(([, init]) => (init?.method ?? 'GET') !== 'GET')
        .map(([url, init]) => `${init!.method} ${url.replace(/^.*\/placements/, '')}`);
    expect(writes()).toEqual([
      'POST ',
      `PATCH /${id}`, // one PATCH for the whole drag
      `PATCH /${id}`,
      'POST ',
      'DELETE /souterrain-chair-2?version=1',
    ]);
    expect(api.placements.get(id)).toMatchObject({ position: { x: -3.5, z: -2.5 }, version: 3 });

    key('z', { ctrlKey: true }); // delete: restored
    key('z', { ctrlKey: true }); // duplicate: back in the trash
    key('z', { ctrlKey: true }); // rotate
    expect(furniture()).toHaveLength(1);
    expect(furniture()[0]!.rotationY).toBe(0);
    key('z', { ctrlKey: true }); // move
    expect(furniture()[0]!.position).toEqual(start);
    await waitSaved();
    // Both undos happened before the next call started: one PATCH with the latest state.
    expect(api.placements.get(id)).toMatchObject({
      rotationY: 0,
      position: { x: start[0], z: start[2] },
      version: 4,
    });
    expect(api.calls('POST', /restore$/)).toHaveLength(1);
    key('z', { ctrlKey: true }); // place
    expect(furniture()).toHaveLength(0);
    expect(panel().getByRole('button', { name: 'Undo' })).toBeDisabled();
    await waitSaved();
    expect([...api.placements.values()].every((p) => p.removedAt !== null)).toBe(true);

    key('Z', { ctrlKey: true, shiftKey: true });
    key('y', { ctrlKey: true });
    expect(furniture()[0]!.position).toEqual([-3.5, -1.2, -2.5]);
    await waitSaved();
    // Redo restores the same placement: no new one.
    expect(api.calls('POST', /\/placements$/)).toHaveLength(2);
    expect(api.placements.get(id)?.removedAt).toBeNull();
  });

  it('rotates with the handle in steps or freely, and highlights collisions', async () => {
    fakeApi();
    await renderApp();
    showSouterrain();
    place(/Sofa/);
    await waitSaved();
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
    await waitSaved();
    const second = furniture()[1]!.id;
    scene(
      (h) => h.onMoveStart(second),
      (h) => h.onMove(second, [x, z]),
      (h) => h.onDragEnd(),
    );
    expect(furniture().every((f) => f.colliding)).toBe(true);
    expect(panel().getByLabelText('Selected item')).toHaveTextContent(/Overlaps .*sofa/);
  });

  it('replays changes this browser had not saved after a reload', async () => {
    const api = fakeApi({ placements: [testPlacement()] });
    localStorage.setItem(
      'my-home:placement-ops:mock-home',
      JSON.stringify([
        {
          op: 'update',
          id: 'souterrain-bed-1',
          baseVersion: 1,
          item: {
            id: 'souterrain-bed-1',
            typeId: 'furniture.bed',
            name: 'Bedroom · Bed',
            levelId: 'souterrain',
            position: { x: -3.2, z: 2.5 },
            rotationY: 0,
            params: {},
          },
        },
      ]),
    );
    await renderApp();
    expect(furniture()[0]!.position).toEqual([-3.2, -1.2, 2.5]);
    await waitSaved();
    expect(api.placements.get('souterrain-bed-1')).toMatchObject({
      position: { x: -3.2, z: 2.5 },
      version: 2,
    });
    expect(panel().queryByText('Restored unsaved changes from this browser.')).toBeNull();
    expect(localStorage.getItem('my-home:placement-ops:mock-home')).toBeNull();
  });

  it('keeps edits in this browser while offline and saves them when back', async () => {
    const api = fakeApi({ placements: [testPlacement()] });
    await renderApp();
    const real = api.fetch.getMockImplementation()!;
    api.fetch.mockImplementation((url, init) =>
      (init?.method ?? 'GET') === 'GET'
        ? real(url, init)
        : Promise.reject(new TypeError('offline')),
    );
    showSouterrain();
    scene((h) => h.onSelect('souterrain-bed-1'));
    key('r');
    await vi.waitFor(() => expect(status()).toMatch(/^Offline/));
    expect(localStorage.getItem('my-home:placement-ops:mock-home')).toContain('souterrain-bed-1');
    api.fetch.mockImplementation(real);
    await vi.waitFor(() => expect(status()).toBe('All changes saved'), { timeout: 8000 });
    expect(api.placements.get('souterrain-bed-1')?.rotationY).toBeCloseTo(Math.PI / 2);
  }, 15000);

  it('reloads an item changed elsewhere (409) and says so', async () => {
    const api = fakeApi({ placements: [testPlacement()] });
    await renderApp();
    api.touch('souterrain-bed-1', { rotationY: Math.PI }); // an agent turned it
    scene((h) => h.onSelect('souterrain-bed-1'));
    key('r');
    const alert = await panel().findByRole('alert', {}, { timeout: 3000 });
    expect(alert).toHaveTextContent(
      'Changed elsewhere (by an agent or another tab), reloaded: Bedroom · Bed',
    );
    expect(status()).toBe('Changed elsewhere');
    expect(furniture()[0]!.rotationY).toBeCloseTo(Math.PI);
    expect(api.placements.get('souterrain-bed-1')?.version).toBe(2);
  });

  it('shows why the server refused a change, puts the item back and does not retry it', async () => {
    const api = fakeApi({ placements: [testPlacement()] });
    await renderApp();
    const real = api.fetch.getMockImplementation()!;
    api.fetch.mockImplementation(async (url, init) =>
      init?.method === 'PATCH'
        ? new Response(
            JSON.stringify({ statusCode: 422, error: 'Unprocessable', message: 'too wide' }),
            { status: 422 },
          )
        : real(url, init),
    );
    scene((h) => h.onSelect('souterrain-bed-1'));
    key('r');
    await vi.waitFor(() => expect(status()).toMatch(/^Not saved/), { timeout: 3000 });
    expect(panel().getByText(/too wide/)).toBeInTheDocument();
    // The bed is back as the server has it; nothing waits in this browser.
    expect(furniture()[0]!.rotationY).toBe(0);
    expect(localStorage.getItem('my-home:placement-ops:mock-home')).toBeNull();
    await new Promise((r) => setTimeout(r, 300));
    expect(api.calls('PATCH', /placements/)).toHaveLength(1);
  });

  it('keeps and flags items whose type, level or room is gone, or whose params are ignored', async () => {
    const api = fakeApi({
      placements: [
        testPlacement({ id: 'gone-level', levelId: 'second-floor', position: { x: 0, z: 0 } }),
        testPlacement({ id: 'gone-room', roomId: 'old-bedroom' }),
        testPlacement({ id: 'gone-type', typeId: 'furniture.piano', position: { x: 3, z: -2 } }),
        testPlacement({ id: 'odd-params', params: { width: 9 }, position: { x: -1.5, z: 1.5 } }),
      ],
    });
    await renderApp();
    const flagged = within(panel().getByRole('group', { name: 'Needs attention' }));
    expect(flagged.getAllByRole('listitem').map((li) => li.textContent)).toEqual([
      expect.stringContaining('level "second-floor" is not in the home model'),
      expect.stringContaining('room "old-bedroom" is not in the home model'),
      expect.stringContaining('type "furniture.piano" is not in the catalogue'),
      expect.stringContaining('ignored: width'),
    ]);
    // The item on a missing level is not drawn; the others are.
    expect(furniture().map((f) => f.id)).toEqual(['gone-room', 'gone-type', 'odd-params']);

    showSouterrain();
    fireEvent.click(flagged.getByRole('button', { name: 'Move to Souterrain' }));
    expect(furniture().map((f) => f.id)).toContain('gone-level');
    await waitSaved();
    expect(api.placements.get('gone-level')).toMatchObject({ levelId: 'souterrain', version: 2 });
  });
});
