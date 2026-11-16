import type { Photo } from '@my-home/shared';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildHome } from '../builder/buildHome';
import { mockHome } from '../test/fixtures';
import type { Figure } from './figure';
import { useWalk } from './useWalk';
import { WalkHud, type WalkView } from './WalkHud';
import { buildWalkWorld, EYE_HEIGHT } from './world';

// Mock home, souterrain (floor at -1.2): the hallway is x -0.5…1.5, z -4…4.
const world = buildWalkWorld(mockHome, buildHome(mockHome));
const start: Figure = { x: 0.5, z: 0, y: -1.2, levelId: 'souterrain', yaw: 0, pitch: 0 };

const photo = (overrides: Partial<Photo> = {}): Photo => ({
  id: 'photo-1',
  homeId: 'mock-home',
  levelId: 'souterrain',
  pose: { position: { x: 0.5, y: 0.4, z: 0 }, yaw: 0, pitch: 0, fovH: 0.87 },
  capturedRoomId: 'souterrain-hallway',
  capturedRoomName: 'Hallway',
  capturedRoomStatus: 'current',
  room: { id: 'souterrain-hallway', name: 'Hallway' },
  levelInModel: true,
  takenAt: '2026-01-01T00:00:00.000Z',
  note: '',
  tags: [],
  requestId: null,
  image: { contentType: 'image/webp', width: 4, height: 3, byteSize: 10 },
  thumbnail: { contentType: 'image/webp', width: 4, height: 3, byteSize: 10 },
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  deletedAt: null,
  purgeAt: null,
  ...overrides,
});

type Api = Parameters<typeof WalkHud>[0]['api'];
const fakeApi = (): { [K in keyof Api]: ReturnType<typeof vi.fn<Api[K]>> } => ({
  upload: vi.fn<Api['upload']>((_home, meta, _image, onProgress) => {
    onProgress?.(0.5);
    return Promise.resolve(photo({ pose: meta.pose, note: meta.note ?? '' }));
  }),
  update: vi.fn<Api['update']>((id, body) => Promise.resolve(photo({ id, pose: body.pose! }))),
});

const onExit = vi.fn();
function Harness({ api = fakeApi(), compass = false }: { api?: Api; compass?: boolean }) {
  const walk = useWalk(world, start, true);
  const [view, setView] = useState<WalkView>('first');
  const [compassOn, setCompassOn] = useState(false);
  return (
    <WalkHud
      homeId="mock-home"
      walk={walk}
      describe={(figure) => (figure.levelId ? `Hallway · ${figure.levelId}` : '')}
      view={view}
      onView={setView}
      onExit={onExit}
      compass={{ supported: compass, active: compassOn, toggle: () => setCompassOn(!compassOn) }}
      api={api}
    />
  );
}

const hud = () => screen.getByTestId('walk-hud');
const at = () => ({
  x: Number(hud().dataset.x),
  z: Number(hud().dataset.z),
  yaw: Number(hud().dataset.yaw),
});
/** jsdom has no PointerEvent: a MouseEvent with a pointer id is what the handlers need. */
function firePointer(target: Element, type: string, x: number, y: number, pointerId = 1) {
  const event = new MouseEvent(type, { bubbles: true, clientX: x, clientY: y });
  Object.defineProperty(event, 'pointerId', { value: pointerId });
  fireEvent(target, event);
}

const takePhoto = () => {
  const file = new File(['fake image bytes'], 'photo.jpg', { type: 'image/jpeg' });
  fireEvent.change(screen.getByLabelText('Take photo'), { target: { files: [file] } });
  return file;
};

describe('WalkHud', () => {
  beforeEach(() => {
    URL.createObjectURL = vi.fn(() => 'blob:preview');
    URL.revokeObjectURL = vi.fn();
  });
  afterEach(() => {
    vi.clearAllMocks();
  });

  it('shows where the figure is', () => {
    render(<Harness />);
    expect(screen.getByRole('status', { name: 'Figure location' })).toHaveTextContent(
      'Hallway · souterrain',
    );
    expect(at()).toEqual({ x: 0.5, z: 0, yaw: 0 });
    expect(hud().dataset.level).toBe('souterrain');
  });

  it('walks forward while the movement pad is pushed up and stops on release', async () => {
    render(<Harness />);
    const pad = screen.getByRole('application', { name: 'Movement pad' });
    firePointer(pad, 'pointerdown', 0, 0);
    firePointer(pad, 'pointermove', 0, -44);
    // Facing -z: forward is towards smaller z.
    await waitFor(() => expect(at().z).toBeLessThan(-0.2));
    expect(at().x).toBeCloseTo(0.5);

    firePointer(pad, 'pointerup', 0, -44);
    await act(() => new Promise((resolve) => setTimeout(resolve, 150)));
    const stopped = at();
    await act(() => new Promise((resolve) => setTimeout(resolve, 150)));
    expect(at()).toEqual(stopped);
  });

  it('turns with the pad pushed sideways and ignores a second finger', async () => {
    render(<Harness />);
    const pad = screen.getByRole('application', { name: 'Movement pad' });
    firePointer(pad, 'pointerdown', -44, 0, 1);
    // Left on the pad turns left: yaw grows (counter-clockwise).
    await waitFor(() => expect(at().yaw).toBeGreaterThan(0.1));
    firePointer(pad, 'pointerup', 0, 0, 2);
    const before = at().yaw;
    await waitFor(() => expect(at().yaw).toBeGreaterThan(before));
    firePointer(pad, 'pointercancel', 0, 0, 1);
  });

  it('looks around by dragging the view in first person', async () => {
    render(<Harness />);
    const view = screen.getByLabelText('Drag to look around');
    firePointer(view, 'pointerdown', 200, 300);
    firePointer(view, 'pointermove', 300, 300);
    firePointer(view, 'pointerup', 300, 300);
    // Dragging right looks right: yaw decreases.
    await waitFor(() => expect(at().yaw).toBeCloseTo(-0.5));
    firePointer(view, 'pointermove', 500, 300);
    await act(() => new Promise((resolve) => setTimeout(resolve, 150)));
    expect(at().yaw).toBeCloseTo(-0.5);
  });

  it('walks with the keyboard, but not while typing', async () => {
    render(<Harness />);
    fireEvent.keyDown(window, { key: 'ArrowUp' });
    await waitFor(() => expect(at().z).toBeLessThan(-0.1));
    fireEvent.keyUp(window, { key: 'ArrowUp' });

    takePhoto();
    const note = screen.getByLabelText('Note');
    const before = at();
    fireEvent.keyDown(note, { key: 'w' });
    await act(() => new Promise((resolve) => setTimeout(resolve, 200)));
    expect(at()).toEqual(before);
  });

  it('switches between first person and the overview, and exits', () => {
    render(<Harness />);
    fireEvent.click(screen.getByRole('button', { name: 'Overview' }));
    // The overview is orbited with the usual controls, so nothing lies over the canvas.
    expect(screen.queryByLabelText('Drag to look around')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'First person' }));
    expect(screen.getByLabelText('Drag to look around')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Exit/ }));
    expect(onExit).toHaveBeenCalled();
  });

  it('offers the compass only on devices that have one', () => {
    const { unmount } = render(<Harness />);
    expect(screen.queryByTitle(/compass/)).not.toBeInTheDocument();
    unmount();
    render(<Harness compass />);
    const toggle = screen.getByTitle(/compass/);
    expect(toggle).toHaveAttribute('aria-pressed', 'false');
    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute('aria-pressed', 'true');
  });

  describe('taking a photo', () => {
    it('asks the phone camera for a photo', () => {
      render(<Harness />);
      const input = screen.getByLabelText('Take photo');
      expect(input).toHaveAttribute('type', 'file');
      expect(input).toHaveAttribute('accept', 'image/*');
      expect(input).toHaveAttribute('capture', 'environment');
    });

    it('uploads the photo with the pose of the figure, a note and tags', async () => {
      const api = fakeApi();
      render(<Harness api={api} />);
      const file = takePhoto();
      const sheet = within(screen.getByRole('region', { name: 'New photo' }));
      expect(sheet.getByText('Hallway · souterrain')).toBeInTheDocument();

      fireEvent.change(sheet.getByLabelText('Note'), { target: { value: 'North wall' } });
      fireEvent.click(sheet.getByLabelText('wall'));
      fireEvent.click(sheet.getByLabelText('window'));
      fireEvent.click(sheet.getByLabelText('window'));
      // The pose is adjusted after the photo was taken: forward 10 cm twice, turned left once.
      fireEvent.click(sheet.getByRole('button', { name: 'Forward' }));
      fireEvent.click(sheet.getByRole('button', { name: 'Forward' }));
      fireEvent.click(sheet.getByRole('button', { name: 'Turn left' }));
      fireEvent.click(sheet.getByRole('button', { name: 'Look up' }));
      fireEvent.click(sheet.getByRole('button', { name: 'Save photo' }));

      expect(await sheet.findByText('Photo saved')).toBeInTheDocument();
      expect(api.upload).toHaveBeenCalledTimes(1);
      const [homeId, meta, image] = api.upload.mock.calls[0]!;
      expect(homeId).toBe('mock-home');
      // jsdom cannot resize images, so the file itself is sent.
      expect(image).toBe(file);
      expect(meta).toMatchObject({ levelId: 'souterrain', note: 'North wall', tags: ['wall'] });
      expect(meta.pose.position.x).toBeCloseTo(0.5);
      expect(meta.pose.position.z).toBeCloseTo(-0.2);
      expect(meta.pose.position.y).toBeCloseTo(-1.2 + EYE_HEIGHT);
      expect(meta.pose.yaw).toBeCloseTo((5 * Math.PI) / 180);
      expect(meta.pose.pitch).toBeCloseTo((5 * Math.PI) / 180);
      expect(meta.pose.fovH).toBeGreaterThan(0.5);
      expect(Date.parse(meta.takenAt!)).not.toBeNaN();
    });

    it('shows the upload progress', async () => {
      const api = fakeApi();
      let finish!: (photo: Photo) => void;
      let report!: (fraction: number) => void;
      api.upload.mockImplementation((_home, _meta, _image, onProgress) => {
        report = onProgress!;
        return new Promise((resolve) => (finish = resolve));
      });
      render(<Harness api={api} />);
      takePhoto();
      fireEvent.click(screen.getByRole('button', { name: 'Save photo' }));
      await waitFor(() => expect(api.upload).toHaveBeenCalled());

      act(() => report(0.42));
      expect(screen.getByRole('progressbar', { name: 'Upload progress' })).toHaveValue(0.42);
      expect(screen.getByText('42%')).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Saving…' })).toBeDisabled();
      expect(screen.getByRole('button', { name: 'Discard' })).toBeDisabled();

      await act(async () => finish(photo()));
      expect(screen.getByText('Photo saved')).toBeInTheDocument();
    });

    it('keeps the photo when the upload fails, to try again', async () => {
      const api = fakeApi();
      api.upload.mockRejectedValueOnce(new Error('POST /api/homes/mock-home/photos failed: 413'));
      render(<Harness api={api} />);
      takePhoto();
      fireEvent.change(screen.getByLabelText('Note'), { target: { value: 'Keep me' } });
      fireEvent.click(screen.getByRole('button', { name: 'Save photo' }));

      expect(await screen.findByRole('alert')).toHaveTextContent(/Upload failed: .*413/);
      expect(screen.getByLabelText('Note')).toHaveValue('Keep me');
      fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
      expect(await screen.findByText('Photo saved')).toBeInTheDocument();
      expect(api.upload).toHaveBeenCalledTimes(2);
      expect(api.upload.mock.calls[1]![1].note).toBe('Keep me');
    });

    it('lets the pose of the saved photo be corrected', async () => {
      const api = fakeApi();
      render(<Harness api={api} />);
      takePhoto();
      fireEvent.click(screen.getByRole('button', { name: 'Save photo' }));
      await screen.findByText('Photo saved');

      fireEvent.click(screen.getByRole('button', { name: 'Right' }));
      fireEvent.click(screen.getByRole('button', { name: 'Turn right' }));
      fireEvent.click(screen.getByRole('button', { name: 'Update pose' }));
      expect(await screen.findByText('Pose updated.')).toBeInTheDocument();
      const [id, body] = api.update.mock.calls[0]!;
      expect(id).toBe('photo-1');
      expect(body.levelId).toBe('souterrain');
      expect(body.pose!.position.x).toBeCloseTo(0.6);
      expect(body.pose!.yaw).toBeCloseTo((-5 * Math.PI) / 180);
      // The field of view of the photo is kept.
      expect(body.pose!.fovH).toBeCloseTo(api.upload.mock.calls[0]![1].pose.fovH!);

      fireEvent.click(screen.getByRole('button', { name: 'Done' }));
      expect(screen.queryByRole('region', { name: 'New photo' })).not.toBeInTheDocument();
      expect(screen.getByRole('application', { name: 'Movement pad' })).toBeInTheDocument();
    });

    it('discards a photo without uploading it', () => {
      const api = fakeApi();
      render(<Harness api={api} />);
      takePhoto();
      fireEvent.click(screen.getByRole('button', { name: 'Discard' }));
      expect(screen.queryByRole('region', { name: 'New photo' })).not.toBeInTheDocument();
      expect(api.upload).not.toHaveBeenCalled();
      expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:preview');
    });
  });
});
