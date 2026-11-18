import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { App } from './App';
import type { SceneProps } from './scene/Scene';
import { fakeApi } from './test/fakeApi';
import { testPhoto, testRequest } from './test/fixtures';

// jsdom has no WebGL, so the R3F canvas is replaced with a stub that exposes what it would draw.
let lastScene: SceneProps | undefined;
vi.mock('./scene/Scene', () => ({
  Scene: (props: SceneProps) => {
    lastScene = props;
    return <div data-testid="scene" />;
  },
}));

const hallway = testPhoto({ id: 'hallway', note: 'Coat rack', tags: ['wall'] });
const kitchen = testPhoto({
  id: 'kitchen',
  pose: { position: { x: 3, y: 0.4, z: -2 }, yaw: Math.PI / 2, pitch: -0.1 },
  capturedRoomId: 'souterrain-kitchen',
  capturedRoomName: 'Kitchen',
  room: { id: 'souterrain-kitchen', name: 'Kitchen' },
  image: { contentType: 'image/webp', width: 1200, height: 1600, byteSize: 1000 },
  requestId: 'request-done',
  takenAt: '2026-03-02T10:00:00.000Z',
});
const upstairs = testPhoto({
  id: 'upstairs',
  levelId: 'ground-floor',
  pose: { position: { x: 0, y: 2.9, z: 0 }, yaw: 0, pitch: 0 },
  capturedRoomId: 'old-room',
  capturedRoomName: 'Old room',
  capturedRoomStatus: 'missing',
  room: null,
  takenAt: '2026-03-03T10:00:00.000Z',
});
const garden = testPhoto({
  id: 'garden',
  levelId: null,
  capturedRoomId: null,
  capturedRoomName: null,
  capturedRoomStatus: 'none',
  room: null,
  levelInModel: false,
  takenAt: '2026-03-04T10:00:00.000Z',
});
const open = testRequest();
const done = testRequest({
  id: 'request-done',
  reason: 'Where is the radiator?',
  status: 'fulfilled',
  closedAt: '2026-03-02T10:00:00.000Z',
});

async function openGallery(options: Parameters<typeof fakeApi>[0] = {}) {
  const api = fakeApi({
    photos: [garden, upstairs, kitchen, hallway],
    requests: [open, done],
    ...options,
  });
  render(<App />);
  // The first view looks into the souterrain: these tests need the whole building in view.
  fireEvent.click(await screen.findByRole('radio', { name: 'Roof' }));
  fireEvent.click(await screen.findByRole('button', { name: /Photos \(4\)/ }));
  const panel = within(await screen.findByRole('region', { name: 'Photos' }));
  return { api, panel };
}
const markerIds = () => lastScene?.photoMarkers?.map((m) => m.id);
const thumbnails = (panel: Pick<typeof screen, 'getAllByRole'>) =>
  panel.getAllByRole('button', { pressed: false }).filter((b) => b.classList.contains('thumbnail'));

describe('photo gallery', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    localStorage.clear();
    lastScene = undefined;
    window.history.replaceState(null, '', '/');
  });

  it('announces photos and open requests on the gallery button', async () => {
    fakeApi({ photos: [hallway], requests: [open, done] });
    render(<App />);
    expect(
      await screen.findByRole('button', { name: /Photos \(1\) · 1 requested/ }),
    ).toBeInTheDocument();
    // Closed, the gallery draws nothing into the 3D view.
    expect(markerIds()).toEqual([]);
  });

  it('loads every page of a large collection, so old photos stay reachable', async () => {
    // 1,201 photos: three pages of the api. The oldest one answers a request.
    const many = Array.from({ length: 1200 }, (_, i) =>
      testPhoto({
        id: `photo-${i}`,
        takenAt: new Date(Date.UTC(2026, 5, 1) - i * 60_000).toISOString(),
      }),
    );
    const oldest = testPhoto({
      id: 'oldest',
      note: 'The very first photo',
      requestId: 'request-done',
      takenAt: '2025-01-01T10:00:00.000Z',
    });
    const api = fakeApi({ photos: [...many, oldest], requests: [done] });
    render(<App />);
    fireEvent.click(
      await screen.findByRole('button', { name: /Photos \(1201\)/ }, { timeout: 5000 }),
    );
    const panel = within(await screen.findByRole('region', { name: 'Photos' }));
    expect(
      api
        .calls('GET', /\/photos\?/)
        .map(([url]) => new URL(url, 'http://x').searchParams.get('offset')),
    ).toEqual(expect.arrayContaining(['0', '500', '1000']));
    expect(lastScene?.photoMarkers).toHaveLength(1201);

    // A date filter for the old range finds it, and so does the jump from its request.
    fireEvent.change(panel.getByLabelText('To'), { target: { value: '2025-12-31' } });
    expect(markerIds()).toEqual(['oldest']);
    fireEvent.click(panel.getByRole('button', { name: 'Clear filters' }));
    fireEvent.click(panel.getByRole('tab', { name: /Requests/ }));
    fireEvent.click(panel.getByRole('button', { name: 'Show photos' }));
    expect(
      within(panel.getByRole('group', { name: 'Photo details' })).getByLabelText('Note'),
    ).toHaveValue('The very first photo');
  }, 20_000);

  it('does not count a deleted request as open', async () => {
    const deleted = { ...open, id: 'request-deleted', deletedAt: '2026-03-05T00:00:00.000Z' };
    const api = fakeApi({ photos: [hallway], requests: [open] });
    // An api that hands out a deleted request with the others must not inflate the count.
    api.requests.set(deleted.id, deleted);
    const original = api.fetch.getMockImplementation()!;
    api.fetch.mockImplementation(async (url, init) => {
      if (!/photo-requests\?/.test(url)) return original(url, init);
      return new Response(JSON.stringify({ items: [open, deleted] }), {
        headers: { 'content-type': 'application/json' },
      });
    });
    render(<App />);
    expect(
      await screen.findByRole('button', { name: /Photos \(1\) · 1 requested/ }),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Photos \(1\)/ }));
    expect(await screen.findByRole('tab', { name: 'Requests (1)' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Walk and take photos/ }));
    await waitFor(() => expect(lastScene!.requestGhosts!.map((g) => g.id)).toEqual(['request-1']));
    expect(screen.getByRole('button', { name: 'Requests (1)' })).toBeInTheDocument();
  });

  it('lists thumbnails and shows a camera marker with a view cone per photo', async () => {
    const { panel } = await openGallery();
    expect(thumbnails(panel)).toHaveLength(4);
    expect(panel.getByRole('img', { name: /^Kitchen,/ })).toHaveAttribute(
      'src',
      '/api/photos/kitchen/thumbnail',
    );
    expect(screen.queryByRole('region', { name: 'Furniture' })).not.toBeInTheDocument();

    expect(markerIds()).toEqual(['garden', 'upstairs', 'kitchen', 'hallway']);
    const marker = lastScene!.photoMarkers!.find((m) => m.id === 'hallway')!;
    expect(marker.position).toEqual([0.5, 0.4, 0]);
    // Looking along -z with a 4:3 frame: the cone opens 1.2 m in front of the camera.
    expect(marker.corners).toHaveLength(4);
    for (const corner of marker.corners) expect(corner[2]).toBeCloseTo(-1.2);
    expect(marker.corners[1]![0] - marker.corners[0]![0]).toBeCloseTo(2 * 1.2 * Math.tan(0.6));
  });

  it('shows only markers of the levels in view, and outdoor ones always', async () => {
    await openGallery();
    const cutaway = within(screen.getByRole('group', { name: 'Show up to level' }));
    fireEvent.click(cutaway.getByLabelText('Souterrain'));
    expect(markerIds()).toEqual(['garden', 'kitchen', 'hallway']);
  });

  it('filters thumbnails and markers together', async () => {
    const { panel } = await openGallery();
    fireEvent.change(panel.getByLabelText('Room'), { target: { value: 'souterrain-kitchen' } });
    expect(thumbnails(panel)).toHaveLength(1);
    expect(markerIds()).toEqual(['kitchen']);

    fireEvent.click(panel.getByRole('button', { name: 'Clear filters' }));
    fireEvent.change(panel.getByLabelText('Level'), { target: { value: 'outdoors' } });
    expect(markerIds()).toEqual(['garden']);
    fireEvent.change(panel.getByLabelText('Level'), { target: { value: '' } });
    fireEvent.change(panel.getByLabelText('Tag'), { target: { value: 'wall' } });
    expect(markerIds()).toEqual(['hallway']);
    fireEvent.change(panel.getByLabelText('Tag'), { target: { value: '' } });
    fireEvent.change(panel.getByLabelText('Request'), { target: { value: 'any' } });
    expect(markerIds()).toEqual(['kitchen']);
    fireEvent.change(panel.getByLabelText('Request'), { target: { value: '' } });
    fireEvent.change(panel.getByLabelText('From'), { target: { value: '2026-03-04' } });
    expect(markerIds()).toEqual(['garden']);
    fireEvent.change(panel.getByLabelText('To'), { target: { value: '2026-03-01' } });
    expect(panel.getByText('No photo matches the filters.')).toBeInTheDocument();
  });

  it('opens a photo with its pose, note, tags and request', async () => {
    const { panel } = await openGallery();
    fireEvent.click(panel.getByRole('img', { name: /^Kitchen,/ }));
    const detail = within(panel.getByRole('group', { name: 'Photo details' }));
    expect(detail.getByRole('img', { name: 'Photo taken in Kitchen' })).toHaveAttribute(
      'src',
      '/api/photos/kitchen/image',
    );
    expect(detail.getByText(/Souterrain/)).toBeInTheDocument();
    // Yaw π/2 looks along -x: heading 270°. No field of view stored: a portrait phone photo.
    expect(detail.getByText(/x 3.00, z -2.00, eye height 0.40 m/)).toHaveTextContent(
      'heading 270° · pitch -6° · view 50° (assumed)',
    );
    expect(detail.getByText('Where is the radiator?')).toBeInTheDocument();
    expect(lastScene!.photoMarkers!.find((m) => m.selected)?.id).toBe('kitchen');
  });

  it('opens a photo when its marker is clicked in 3D', async () => {
    const { panel } = await openGallery();
    fireEvent.click(panel.getByRole('tab', { name: /Trash/ }));
    act(() => lastScene!.onSelectPhoto!('hallway'));
    expect(panel.getByRole('tab', { name: /Photos/ })).toHaveAttribute('aria-selected', 'true');
    expect(
      within(panel.getByRole('group', { name: 'Photo details' })).getByLabelText('Note'),
    ).toHaveValue('Coat rack');
  });

  it('says where each heading came from and marks measured ones in 3D', async () => {
    const measured = testPhoto({
      id: 'measured',
      sensors: {
        source: 'sensor',
        alpha: 271.5,
        beta: 84,
        gamma: -2,
        absolute: true,
        compassAccuracy: 12,
        screenAngle: 90,
        declination: 3,
        calibrationOffset: -7,
        trueBearing: 84.4,
        yaw: 0,
        pitch: 0,
      },
    });
    const byHand = testPhoto({
      id: 'by-hand',
      sensors: { source: 'manual', yaw: 0, pitch: 0 },
      takenAt: '2026-03-02T10:00:00.000Z',
      capturedRoomName: 'Kitchen',
      room: { id: 'souterrain-kitchen', name: 'Kitchen' },
    });
    const { panel } = await openGallery({
      photos: [upstairs, garden, byHand, measured],
      requests: [],
    });
    const source = () =>
      within(panel.getByRole('group', { name: 'Photo details' })).getByLabelText('Heading source');

    fireEvent.click(panel.getByRole('img', { name: /^Hallway,/ }));
    expect(source()).toHaveTextContent(
      '🧭 Heading measured by the phone: true bearing 84° · ±12° · declination +3° · calibration -7° · screen turned 90°.',
    );
    fireEvent.click(panel.getByRole('img', { name: /^Kitchen,/ }));
    expect(source()).toHaveTextContent('Heading set by hand (compass off).');
    // An older photo without a snapshot still displays.
    fireEvent.click(panel.getByRole('img', { name: /^Old room,/ }));
    expect(source()).toHaveTextContent('no sensor data');

    expect(Object.fromEntries(lastScene!.photoMarkers!.map((m) => [m.id, m.measured]))).toEqual({
      measured: true,
      'by-hand': false,
      upstairs: false,
      garden: false,
    });
    expect(panel.getByText(/a ring around a camera marks a measured heading/)).toBeInTheDocument();
  });

  it('keeps showing a photo whose room is not in this model', async () => {
    const { panel } = await openGallery();
    fireEvent.click(panel.getByRole('img', { name: /^Old room,/ }));
    const detail = within(panel.getByRole('group', { name: 'Photo details' }));
    expect(detail.getByText('Old room')).toBeInTheDocument();
    expect(detail.getByText('(room not in this model)')).toBeInTheDocument();
    expect(markerIds()).toContain('upstairs');
    expect(
      within(panel.getByLabelText('Room')).getByText('Old room (not in this model)'),
    ).toBeInTheDocument();
  });

  it('edits the note and the tags', async () => {
    const { api, panel } = await openGallery();
    fireEvent.click(panel.getByRole('img', { name: /^Hallway,/ }));
    const detail = within(panel.getByRole('group', { name: 'Photo details' }));

    fireEvent.change(detail.getByLabelText('Note'), { target: { value: 'Coat rack, 1.2 m wide' } });
    fireEvent.click(detail.getByRole('button', { name: 'Save note' }));
    await waitFor(() => expect(api.photos.get('hallway')!.note).toBe('Coat rack, 1.2 m wide'));

    fireEvent.click(detail.getByLabelText('window'));
    await waitFor(() => expect(api.photos.get('hallway')!.tags).toEqual(['wall', 'window']));
    fireEvent.click(await detail.findByLabelText('wall'));
    await waitFor(() => expect(api.photos.get('hallway')!.tags).toEqual(['window']));
    fireEvent.change(detail.getByLabelText('New tag'), { target: { value: ' Radiator ' } });
    fireEvent.submit(detail.getByLabelText('New tag'));
    await waitFor(() => expect(api.photos.get('hallway')!.tags).toEqual(['window', 'radiator']));
    expect(await detail.findByLabelText('radiator')).toBeChecked();
  });

  describe('view from here', () => {
    it('moves the 3D camera to the pose of the photo and back', async () => {
      const { panel } = await openGallery();
      fireEvent.click(panel.getByRole('img', { name: /^Hallway,/ }));
      fireEvent.click(panel.getByRole('button', { name: 'View from here' }));

      expect(lastScene!.viewpoint).toEqual({ pose: hallway.pose, fovH: 1.2, aspect: 4 / 3 });
      // Seen from inside: the whole building, no room names, no markers in the way.
      expect(new Set(lastScene!.scene.walls.map((w) => w.levelId)).size).toBe(3);
      expect(lastScene!.labels).toEqual([]);
      expect(markerIds()).toEqual([]);

      fireEvent.click(panel.getByRole('button', { name: 'Leave this view' }));
      expect(lastScene!.viewpoint).toBeUndefined();
      expect(markerIds()).toHaveLength(4);
    });

    it('keeps the same view when the lists are reloaded', async () => {
      const { api, panel } = await openGallery();
      fireEvent.click(panel.getByRole('img', { name: /^Hallway,/ }));
      fireEvent.click(panel.getByRole('button', { name: 'View from here' }));
      const before = lastScene!.viewpoint;

      // Editing the note reloads every list: the photo is a new object with the same pose.
      const detail = within(panel.getByRole('group', { name: 'Photo details' }));
      fireEvent.change(detail.getByLabelText('Note'), { target: { value: 'Still here' } });
      fireEvent.click(detail.getByRole('button', { name: 'Save note' }));
      await waitFor(() => expect(api.photos.get('hallway')!.note).toBe('Still here'));
      await waitFor(() => expect(detail.queryByRole('button', { name: 'Save note' })).toBeNull());
      // The very same object: the camera rig is not torn down and set up again.
      expect(lastScene!.viewpoint).toBe(before);
    });

    it('lays the photo over the view at a chosen opacity', async () => {
      const { panel } = await openGallery();
      fireEvent.click(panel.getByRole('img', { name: /^Hallway,/ }));
      expect(panel.queryByLabelText(/Lay the photo over/)).not.toBeInTheDocument();
      fireEvent.click(panel.getByRole('button', { name: 'View from here' }));
      expect(document.querySelector('.photo-overlay')).toBeNull();

      fireEvent.click(panel.getByLabelText(/Lay the photo over/));
      const overlay = document.querySelector<HTMLImageElement>('.photo-overlay')!;
      expect(overlay).toHaveAttribute('src', '/api/photos/hallway/image');
      expect(overlay.style.opacity).toBe('0.5');
      fireEvent.change(panel.getByLabelText('Opacity'), { target: { value: '0.8' } });
      expect(overlay.style.opacity).toBe('0.8');

      // Another photo, or closing the gallery, leaves the view.
      fireEvent.click(panel.getByRole('img', { name: /^Kitchen,/ }));
      expect(lastScene!.viewpoint).toBeUndefined();
      expect(document.querySelector('.photo-overlay')).toBeNull();
    });
  });

  describe('trash', () => {
    it('deletes into the trash and restores', async () => {
      const { api, panel } = await openGallery();
      fireEvent.click(panel.getByRole('img', { name: /^Hallway,/ }));
      fireEvent.click(panel.getByRole('button', { name: 'Delete' }));

      expect(await panel.findByRole('tab', { name: 'Photos (3)' })).toBeInTheDocument();
      expect(api.photos.get('hallway')!.deletedAt).not.toBeNull();
      expect(markerIds()).toEqual(['garden', 'upstairs', 'kitchen']);

      fireEvent.click(panel.getByRole('tab', { name: 'Trash (1)' }));
      expect(panel.getByText(/stay here for 30 days/)).toBeInTheDocument();
      expect(panel.getByText(/Deleted for good on/)).toBeInTheDocument();
      fireEvent.click(panel.getByRole('button', { name: 'Restore' }));
      expect(await panel.findByRole('tab', { name: 'Photos (4)' })).toBeInTheDocument();
      expect(panel.getByText('The trash is empty.')).toBeInTheDocument();
    });

    const inTrash = { deletedAt: '2026-03-05T00:00:00.000Z', purgeAt: '2026-04-04T00:00:00.000Z' };

    it('deletes for good only after asking', async () => {
      const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
      const { api, panel } = await openGallery({
        photos: [
          hallway,
          kitchen,
          garden,
          upstairs,
          { ...testPhoto({ id: 'blurry' }), ...inTrash },
        ],
      });
      fireEvent.click(panel.getByRole('tab', { name: 'Trash (1)' }));
      fireEvent.click(panel.getByRole('button', { name: 'Delete for good' }));
      expect(confirm).toHaveBeenCalledWith(
        expect.stringMatching(/for good\? This cannot be undone/),
      );
      expect(api.photos.has('blurry')).toBe(true);

      confirm.mockReturnValue(true);
      fireEvent.click(panel.getByRole('button', { name: 'Delete for good' }));
      expect(await panel.findByRole('tab', { name: 'Trash (0)' })).toBeInTheDocument();
      expect(api.photos.has('blurry')).toBe(false);
      expect(api.photos.size).toBe(4);
    });

    it('empties the trash of photos and requests', async () => {
      vi.spyOn(window, 'confirm').mockReturnValue(true);
      const { api, panel } = await openGallery({
        photos: [
          hallway,
          kitchen,
          garden,
          upstairs,
          { ...testPhoto({ id: 'blurry' }), ...inTrash },
        ],
        requests: [open, { ...done, ...inTrash }],
      });
      fireEvent.click(panel.getByRole('tab', { name: 'Trash (2)' }));
      expect(panel.getByText('Request: Where is the radiator?')).toBeInTheDocument();
      fireEvent.click(panel.getByRole('button', { name: 'Empty trash' }));
      expect(await panel.findByText('The trash is empty.')).toBeInTheDocument();
      expect([...api.photos.keys()]).toEqual(['hallway', 'kitchen', 'garden', 'upstairs']);
      expect([...api.requests.keys()]).toEqual(['request-1']);
    });

    it('never purges a photo that is not in the trash', async () => {
      const { api } = await openGallery();
      const res = await fetch('/api/photos/hallway/purge', { method: 'POST' });
      expect(res.status).toBe(409);
      expect(api.photos.has('hallway')).toBe(true);
    });
  });

  describe('requests', () => {
    it('lists requests and jumps to the photos that answer one', async () => {
      const { panel } = await openGallery();
      fireEvent.click(panel.getByRole('tab', { name: 'Requests (1)' }));
      const items = panel.getAllByRole('listitem');
      expect(items).toHaveLength(2);
      expect(items[0]).toHaveTextContent('How wide is the window above the sink?');
      expect(items[0]).toHaveTextContent('Kitchen · Souterrain · asked by an agent · open');
      expect(items[1]).toHaveTextContent('fulfilled · 1 photo(s)');

      fireEvent.click(within(items[1]!).getByRole('button', { name: 'Show photos' }));
      expect(panel.getByRole('tab', { name: /Photos/ })).toHaveAttribute('aria-selected', 'true');
      expect(panel.getByLabelText('Request')).toHaveValue('request-done');
      expect(markerIds()).toEqual(['kitchen']);
      expect(panel.getByRole('group', { name: 'Photo details' })).toBeInTheDocument();
    });

    it('cancels, reopens and deletes a request', async () => {
      const { api, panel } = await openGallery();
      fireEvent.click(panel.getByRole('tab', { name: 'Requests (1)' }));
      fireEvent.click(panel.getByRole('button', { name: 'Cancel' }));
      expect(await panel.findByRole('tab', { name: 'Requests (0)' })).toBeInTheDocument();
      expect(api.requests.get('request-1')!.status).toBe('cancelled');

      fireEvent.click(panel.getAllByRole('button', { name: 'Reopen' })[0]!);
      expect(await panel.findByRole('tab', { name: 'Requests (1)' })).toBeInTheDocument();

      fireEvent.click(panel.getAllByRole('button', { name: 'Delete' })[0]!);
      expect(await panel.findByRole('tab', { name: 'Trash (1)' })).toBeInTheDocument();
      expect(api.requests.get('request-1')!.deletedAt).not.toBeNull();
    });
  });

  describe('while walking', () => {
    it('shows open requests as ghost figures and answers the one the figure is sent to', async () => {
      fakeApi({ photos: [hallway], requests: [open, done] });
      render(<App />);
      fireEvent.click(await screen.findByRole('button', { name: /Walk and take photos/ }));

      // Only the open request, standing on the souterrain floor, looking where it asks.
      await waitFor(() => expect(lastScene!.requestGhosts).toHaveLength(1));
      expect(lastScene!.requestGhosts![0]).toEqual({
        id: 'request-1',
        position: [3, -1.2, -2],
        yaw: 1.5,
        active: false,
      });

      fireEvent.click(screen.getByRole('button', { name: 'Requests (1)' }));
      const list = within(screen.getByRole('list', { name: 'Open photo requests' }));
      expect(list.getByText('How wide is the window above the sink?')).toBeInTheDocument();
      fireEvent.click(list.getByRole('button', { name: 'Go there' }));

      expect(lastScene!.walk!.figure.current).toMatchObject({ x: 3, z: -2, y: -1.2, yaw: 1.5 });
      expect(lastScene!.requestGhosts![0]!.active).toBe(true);
      expect(await screen.findByRole('status', { name: 'Photo request here' })).toHaveTextContent(
        'How wide is the window above the sink?',
      );
    });

    it('shows the photo markers in the overview and opens the gallery from one', async () => {
      fakeApi({ photos: [hallway, upstairs] });
      render(<App />);
      fireEvent.click(await screen.findByRole('button', { name: /Walk and take photos/ }));
      await waitFor(() => expect(lastScene!.walk).toBeDefined());
      expect(markerIds()).toEqual([]);
      fireEvent.click(screen.getByRole('button', { name: 'Overview' }));
      // The cutaway is at the figure's level, so only that level's photos show.
      await waitFor(() => expect(markerIds()).toEqual(['hallway']));

      act(() => lastScene!.onSelectPhoto!('hallway'));
      expect(lastScene!.walk).toBeUndefined();
      expect(
        within(screen.getByRole('region', { name: 'Photos' })).getByRole('group', {
          name: 'Photo details',
        }),
      ).toBeInTheDocument();
    });
  });
});
