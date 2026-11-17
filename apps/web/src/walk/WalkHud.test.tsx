import type { Photo, PhotoRequest } from '@my-home/shared';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildHome } from '../builder/buildHome';
import { mockHome, testRequest } from '../test/fixtures';
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
  sensors: null,
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
const onDeclination = vi.fn<(degrees: number, source: string) => Promise<void>>(() =>
  Promise.resolve(),
);
function Harness({
  api = fakeApi(),
  requests = [],
  onSaved,
  northBearing = 0,
  declination = 0,
}: {
  api?: Api;
  requests?: PhotoRequest[];
  onSaved?: () => void;
  northBearing?: number;
  declination?: number;
}) {
  const walk = useWalk(world, start, true);
  const [view, setView] = useState<WalkView>('first');
  return (
    <WalkHud
      homeId="mock-home"
      walk={walk}
      describe={(figure) => (figure.levelId ? `Hallway · ${figure.levelId}` : '')}
      view={view}
      onView={setView}
      onExit={onExit}
      northBearing={northBearing}
      declination={declination}
      onDeclination={onDeclination}
      calibrationTargets={() => [
        // A door due north of the figure and a window due east of it.
        { id: 'door-a', label: 'Door: hallway kitchen', x: 0.5, z: -3, distance: 3 },
        { id: 'window-b', label: 'Window: hallway east', x: 4.5, z: 0, distance: 4 },
      ]}
      api={api}
      requests={requests}
      roomIdOf={() => 'souterrain-hallway'}
      {...(onSaved && { onSaved })}
    />
  );
}

const hud = () => screen.getByTestId('walk-hud');
const at = () => ({
  x: Number(hud().dataset.x),
  z: Number(hud().dataset.z),
  yaw: Number(hud().dataset.yaw),
});
const pitch = () => Number(hud().dataset.pitch);
const rad = (degrees: number) => (degrees * Math.PI) / 180;
/** A mocked orientation event; `bearing` makes it an absolute (compass) one. */
const tiltPhone = (beta: number, bearing?: number) =>
  act(
    () =>
      void window.dispatchEvent(
        Object.assign(
          new Event(bearing === undefined ? 'deviceorientation' : 'deviceorientationabsolute'),
          {
            alpha: bearing === undefined ? 17 : (360 - bearing) % 360,
            beta,
            gamma: 0,
            absolute: bearing !== undefined,
          },
        ),
      ),
  );
/** jsdom has no PointerEvent: a MouseEvent with a pointer id is what the handlers need. */
function firePointer(target: Element, type: string, x: number, y: number, pointerId = 1) {
  const event = new MouseEvent(type, { bubbles: true, clientX: x, clientY: y });
  Object.defineProperty(event, 'pointerId', { value: pointerId });
  fireEvent(target, event);
}

const takePhoto = () => {
  const file = new File(['fake image bytes'], 'photo.jpg', { type: 'image/jpeg' });
  // The tap on the shutter, then the camera app handing back the photo.
  fireEvent.click(screen.getByLabelText('Take photo'));
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

  it('looks up and down with the buttons, shown as the view tilt', async () => {
    render(<Harness />);
    expect(screen.getByRole('status', { name: 'View tilt' })).toHaveTextContent('◆ 0°');
    fireEvent.click(screen.getByRole('button', { name: 'Look up' }));
    fireEvent.click(screen.getByRole('button', { name: 'Look up' }));
    await waitFor(() => expect(pitch()).toBeCloseTo(rad(20), 2));
    expect(screen.getByRole('status', { name: 'View tilt' })).toHaveTextContent('▲ 20°');
    for (let i = 0; i < 4; i++) fireEvent.click(screen.getByRole('button', { name: 'Look down' }));
    await waitFor(() => expect(pitch()).toBeCloseTo(rad(-20), 2));
    expect(screen.getByRole('status', { name: 'View tilt' })).toHaveTextContent('▼ 20°');
  });

  it('looks up by dragging the view up, down by dragging it down', async () => {
    render(<Harness />);
    const view = screen.getByLabelText('Drag to look around');
    firePointer(view, 'pointerdown', 200, 400);
    firePointer(view, 'pointermove', 200, 300);
    firePointer(view, 'pointerup', 200, 300);
    await waitFor(() => expect(pitch()).toBeCloseTo(0.5));
    expect(at().yaw).toBe(0);
    firePointer(view, 'pointerdown', 200, 300);
    firePointer(view, 'pointermove', 200, 500);
    firePointer(view, 'pointerup', 200, 500);
    await waitFor(() => expect(pitch()).toBeCloseTo(-0.5));
  });

  it('offers the sensor modes only on devices that have orientation sensors', () => {
    vi.stubGlobal('DeviceOrientationEvent', undefined);
    render(<Harness />);
    expect(screen.queryByRole('button', { name: /Heading/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Tilt o/ })).not.toBeInTheDocument();
    // Looking by hand is always there.
    expect(screen.getByRole('button', { name: 'Look up' })).toBeEnabled();
    vi.unstubAllGlobals();
  });

  describe("with the phone's sensors", () => {
    beforeEach(() => {
      vi.stubGlobal('DeviceOrientationEvent', class {});
      vi.spyOn(document, 'hasFocus').mockReturnValue(true);
    });
    afterEach(() => {
      vi.unstubAllGlobals();
      vi.restoreAllMocks();
      localStorage.clear();
    });

    it('tilts the view with the phone, on its own, without a compass', async () => {
      render(<Harness />);
      const toggle = screen.getByRole('button', { name: /Tilt off/ });
      fireEvent.click(toggle);
      expect(screen.getByRole('button', { name: /Tilt on/ })).toHaveAttribute(
        'aria-pressed',
        'true',
      );
      expect(screen.getByRole('button', { name: /Heading off/ })).toHaveAttribute(
        'aria-pressed',
        'false',
      );

      // A relative event is enough for the tilt. Upright (beta 90) is level; 60 looks down 30°.
      tiltPhone(60);
      await waitFor(() => expect(pitch()).toBeLessThan(rad(-27)));
      expect(pitch()).toBeGreaterThanOrEqual(rad(-30));
      tiltPhone(120);
      await waitFor(() => expect(pitch()).toBeGreaterThan(rad(27)));
      // The heading stays where it was, and stays in the owner's hands.
      expect(at().yaw).toBe(0);
      const view = screen.getByLabelText('Drag to look around');
      firePointer(view, 'pointerdown', 200, 300);
      firePointer(view, 'pointermove', 300, 100);
      firePointer(view, 'pointerup', 300, 100);
      await waitFor(() => expect(at().yaw).toBeCloseTo(-0.5));
      // ...but the vertical part of the drag is ignored while the phone sets the tilt.
      await act(() => new Promise((resolve) => setTimeout(resolve, 200)));
      expect(pitch()).toBeGreaterThan(rad(27));
      expect(pitch()).toBeLessThanOrEqual(rad(30));
      expect(screen.getByRole('button', { name: 'Look up' })).toBeDisabled();

      // Switched off, the view stays where it is and the hand takes over again.
      fireEvent.click(screen.getByRole('button', { name: /Tilt on/ }));
      tiltPhone(20);
      await act(() => new Promise((resolve) => setTimeout(resolve, 200)));
      expect(pitch()).toBeGreaterThan(rad(27));
      expect(screen.getByRole('button', { name: 'Look up' })).toBeEnabled();
    });

    it('turns the view with the compass and blends in instead of snapping', async () => {
      render(<Harness northBearing={20} declination={3} />);
      fireEvent.click(screen.getByRole('button', { name: /Heading off/ }));
      tiltPhone(90, 67);
      // 67 magnetic + 3 = 70 true; + 20 = 90 clockwise of -z: yaw -90°.
      await waitFor(() => expect(at().yaw).toBeLessThan(rad(-87)));
      expect(at().yaw).toBeGreaterThanOrEqual(rad(-90));
      expect(screen.getByRole('status', { name: 'Compass' })).toHaveTextContent('accuracy unknown');
      // The tilt was not switched on: the phone's tilt is ignored, the hand still tilts.
      tiltPhone(50, 67);
      await act(() => new Promise((resolve) => setTimeout(resolve, 200)));
      expect(pitch()).toBe(0);
      fireEvent.click(screen.getByRole('button', { name: 'Look up' }));
      await waitFor(() => expect(pitch()).toBeCloseTo(rad(10), 2));
    });

    it('sidesteps with the pad while the compass turns the figure', async () => {
      render(<Harness />);
      fireEvent.click(screen.getByRole('button', { name: /Heading off/ }));
      tiltPhone(90, 0);
      await waitFor(() =>
        expect(screen.getByRole('status', { name: 'Compass' })).toBeInTheDocument(),
      );
      const pad = screen.getByRole('application', { name: 'Movement pad' });
      firePointer(pad, 'pointerdown', 44, 0);
      // Facing -z, right is +x.
      await waitFor(() => expect(at().x).toBeGreaterThan(0.6));
      firePointer(pad, 'pointerup', 44, 0);
      expect(Math.abs(at().yaw)).toBeLessThan(0.03);
    });

    it('a sideways drag corrects the compass and shows the offset', async () => {
      render(<Harness />);
      fireEvent.click(screen.getByRole('button', { name: /Heading off/ }));
      tiltPhone(90, 90);
      await waitFor(() => expect(at().yaw).toBeLessThan(rad(-87)));
      const view = screen.getByLabelText('Drag sideways to correct the compass');
      firePointer(view, 'pointerdown', 200, 300);
      // 35 px to the right at 0.005 rad/px: about 10° clockwise.
      firePointer(view, 'pointermove', 235, 300);
      firePointer(view, 'pointerup', 235, 300);
      expect(await screen.findByText(/offset \+10°/)).toBeInTheDocument();
      await waitFor(() => expect(at().yaw).toBeLessThan(rad(-97)));
      // The next sensor event does not undo it.
      tiltPhone(90, 90);
      await act(() => new Promise((resolve) => setTimeout(resolve, 200)));
      expect(at().yaw).toBeLessThan(rad(-97));
    });

    it('calibrates against a door, shows and resets the offset, and saves the declination', async () => {
      render(<Harness />);
      fireEvent.click(screen.getByRole('button', { name: /Heading off/ }));
      // The phone points at the door (due north of the figure) but its compass says 8°.
      tiltPhone(90, 8);
      await waitFor(() =>
        expect(screen.getByRole('status', { name: 'Compass' })).toBeInTheDocument(),
      );
      fireEvent.click(screen.getByRole('button', { name: 'Calibrate' }));
      const sheet = within(screen.getByRole('region', { name: 'Calibrate the compass' }));
      fireEvent.click(sheet.getByRole('button', { name: 'Door: hallway kitchen' }));
      expect(await sheet.findByText('Offset -8°')).toBeInTheDocument();
      await waitFor(() => expect(Math.abs(at().yaw)).toBeLessThan(rad(2)));

      fireEvent.click(sheet.getByRole('button', { name: 'Reset' }));
      expect(sheet.getByText('Offset 0°')).toBeInTheDocument();

      const input = sheet.getByLabelText(/Magnetic declination/);
      fireEvent.change(input, { target: { value: '4.5' } });
      fireEvent.click(sheet.getByRole('button', { name: 'Save' }));
      expect(await sheet.findByText('Declination saved for this home.')).toBeInTheDocument();
      // By default the value counts as read off a chart or model.
      expect(onDeclination).toHaveBeenCalledWith(4.5, 'geodata');
      fireEvent.change(sheet.getByLabelText('Where it is from'), { target: { value: 'measured' } });
      fireEvent.click(sheet.getByRole('button', { name: 'Save' }));
      await waitFor(() => expect(onDeclination).toHaveBeenLastCalledWith(4.5, 'measured'));
      fireEvent.change(input, { target: { value: '400' } });
      fireEvent.click(sheet.getByRole('button', { name: 'Save' }));
      expect(sheet.getByText(/Could not save/)).toBeInTheDocument();
    });

    it('says when a mode gets no data, and when permission is refused', async () => {
      const requestPermission = vi.fn().mockResolvedValue('denied');
      vi.stubGlobal('DeviceOrientationEvent', Object.assign(class {}, { requestPermission }));
      render(<Harness />);
      fireEvent.click(screen.getByRole('button', { name: /Tilt off/ }));
      expect(await screen.findByRole('alert')).toHaveTextContent(/needs permission/);
      expect(screen.getByRole('button', { name: /Tilt off/ })).toBeInTheDocument();

      // One granted permission covers both modes.
      requestPermission.mockResolvedValue('granted');
      fireEvent.click(screen.getByRole('button', { name: /Tilt off/ }));
      expect(await screen.findByRole('button', { name: /Tilt on/ })).toBeInTheDocument();
      expect(screen.getByRole('alert')).toHaveTextContent('Waiting for the sensors…');
      fireEvent.click(screen.getByRole('button', { name: /Heading off/ }));
      expect(await screen.findByRole('button', { name: /Heading on/ })).toBeInTheDocument();
      expect(requestPermission).toHaveBeenCalledTimes(2);
      await waitFor(
        () => expect(screen.getByRole('alert')).toHaveTextContent(/No compass or tilt data/),
        { timeout: 4000 },
      );
    }, 10_000);

    it('stores the sensor snapshot with a photo taken while the compass is on', async () => {
      const api = fakeApi();
      render(<Harness api={api} northBearing={20} declination={3} />);
      fireEvent.click(screen.getByRole('button', { name: /Heading off/ }));
      fireEvent.click(screen.getByRole('button', { name: /Tilt off/ }));
      tiltPhone(75, 67);
      await waitFor(() => expect(at().yaw).toBeLessThan(rad(-87)));
      await waitFor(() => expect(pitch()).toBeLessThan(rad(-12)));
      takePhoto();
      fireEvent.click(screen.getByRole('button', { name: 'Save photo' }));
      await screen.findByText('Photo saved');
      const meta = api.upload.mock.calls[0]![1];
      expect(meta.sensors).toMatchObject({
        source: 'sensor',
        alpha: 293,
        beta: 75,
        gamma: 0,
        absolute: true,
        tilt: true,
        declination: 3,
        calibrationOffset: 0,
        screenAngle: 0,
      });
      expect(meta.sensors!.magneticBearing).toBeCloseTo(67);
      // The pose is what the sensors gave, smoothed: the same numbers as in the snapshot.
      expect(meta.pose.yaw).toBe(meta.sensors!.yaw);
      expect(meta.pose.pitch).toBe(meta.sensors!.pitch);
      expect(meta.pose.pitch).toBeLessThan(rad(-12));
    });

    it('stores the view of the moment the shutter was tapped, whatever the phone does afterwards', async () => {
      const api = fakeApi();
      render(<Harness api={api} />);
      fireEvent.click(screen.getByRole('button', { name: /Heading off/ }));
      fireEvent.click(screen.getByRole('button', { name: /Tilt off/ }));
      // Aimed: facing east, tipped down 15°.
      tiltPhone(75, 90);
      await waitFor(() => expect(at().yaw).toBeLessThan(rad(-89)));
      await waitFor(() => expect(pitch()).toBeLessThan(rad(-14)));
      const aimed = { yaw: at().yaw, pitch: pitch() };

      const shutter = screen.getByLabelText('Take photo');
      const before = Date.now();
      fireEvent.click(shutter);
      // The camera app is open; the owner lowers the phone and turns round.
      tiltPhone(20, 250);
      await act(() => new Promise((resolve) => setTimeout(resolve, 250)));
      fireEvent.change(shutter, { target: { files: [new File(['x'], 'photo.jpg')] } });
      // Back on the page, reading the sheet with the phone tipped towards them.
      tiltPhone(30, 310);
      tiltPhone(25, 300);
      await act(() => new Promise((resolve) => setTimeout(resolve, 300)));
      // The view has gone back to where it was aimed and stays there.
      expect(at().yaw).toBeCloseTo(aimed.yaw, 2);
      expect(pitch()).toBeCloseTo(aimed.pitch, 2);
      // No complaint about the sensors while the sheet holds them.
      expect(screen.queryByRole('alert')).not.toBeInTheDocument();

      // The arrows still adjust, from the frozen pose.
      fireEvent.click(screen.getByRole('button', { name: 'Turn left' }));
      fireEvent.click(screen.getByRole('button', { name: 'Save photo' }));
      await screen.findByText('Photo saved');
      const { pose, sensors } = api.upload.mock.calls[0]![1];
      expect(pose.yaw).toBeCloseTo(aimed.yaw + rad(5), 2);
      expect(pose.pitch).toBeCloseTo(aimed.pitch, 2);
      // The snapshot is the one from the tap: its raw angles, its view, its time.
      expect(sensors).toMatchObject({ source: 'sensor', alpha: 270, beta: 75, tilt: true });
      expect(sensors!.yaw).toBeCloseTo(aimed.yaw, 2);
      expect(sensors!.pitch).toBeCloseTo(aimed.pitch, 2);
      expect(Date.parse(sensors!.capturedAt!)).toBeGreaterThanOrEqual(before);
      expect(Date.parse(sensors!.capturedAt!)).toBeLessThan(before + 200);

      // Closing the sheet lets the phone drive the view again.
      fireEvent.click(screen.getByRole('button', { name: 'Done' }));
      tiltPhone(90, 0);
      await waitFor(() => expect(Math.abs(at().yaw)).toBeLessThan(rad(1)));
      await waitFor(() => expect(Math.abs(pitch())).toBeLessThan(rad(1)));
    });

    it('marks a photo as tilted by the phone but headed by hand when only the tilt is on', async () => {
      const api = fakeApi();
      render(<Harness api={api} />);
      fireEvent.click(screen.getByRole('button', { name: /Tilt off/ }));
      tiltPhone(110);
      await waitFor(() => expect(pitch()).toBeGreaterThan(rad(17)));
      takePhoto();
      fireEvent.click(screen.getByRole('button', { name: 'Save photo' }));
      await screen.findByText('Photo saved');
      const { sensors, pose } = api.upload.mock.calls[0]![1];
      expect(sensors).toMatchObject({ source: 'manual', tilt: true, beta: 110, absolute: false });
      expect(sensors).not.toHaveProperty('magneticBearing');
      expect(pose.pitch).toBeGreaterThan(rad(17));
    });
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
      // No sensors in use: the snapshot says the view was set by hand. It is the view at the tap
      // on the shutter; the pose has the adjustments made in the sheet on top.
      expect(meta.sensors).toMatchObject({ source: 'manual', yaw: 0, pitch: 0 });
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
    describe('for a photo request', () => {
      // The figure stands at (0.5, 0) in the hallway.
      const here = testRequest({
        id: 'here',
        position: { x: 0.8, z: 0.4 },
        reason: 'The coat rack',
      });
      const elsewhere = testRequest({ id: 'elsewhere', position: { x: 3, z: -2 } });

      it('offers the request at the figure and uploads the photo as its answer', async () => {
        const api = fakeApi();
        const onSaved = vi.fn();
        render(<Harness api={api} requests={[elsewhere, here]} onSaved={onSaved} />);
        expect(screen.getByRole('status', { name: 'Photo request here' })).toHaveTextContent(
          'The coat rack',
        );
        takePhoto();
        expect(screen.getByLabelText(/Answers the request/)).toBeChecked();
        fireEvent.click(screen.getByRole('button', { name: 'Save photo' }));
        await screen.findByText('Photo saved');
        expect(api.upload.mock.calls[0]![1].requestId).toBe('here');
        expect(onSaved).toHaveBeenCalled();
      });

      it('leaves the request open when the owner says the photo is not for it', async () => {
        const api = fakeApi();
        render(<Harness api={api} requests={[here]} />);
        takePhoto();
        fireEvent.click(screen.getByLabelText(/Answers the request/));
        fireEvent.click(screen.getByRole('button', { name: 'Save photo' }));
        await screen.findByText('Photo saved');
        expect(api.upload.mock.calls[0]![1]).not.toHaveProperty('requestId');
      });

      it('answers a request picked from the list, wherever the figure is', async () => {
        const api = fakeApi();
        render(<Harness api={api} requests={[elsewhere]} />);
        expect(
          screen.queryByRole('status', { name: 'Photo request here' }),
        ).not.toBeInTheDocument();
        fireEvent.click(screen.getByRole('button', { name: 'Requests (1)' }));
        fireEvent.click(screen.getByRole('button', { name: 'Answer this' }));
        expect(screen.getByRole('button', { name: 'Answering this' })).toHaveAttribute(
          'aria-pressed',
          'true',
        );
        takePhoto();
        fireEvent.click(screen.getByRole('button', { name: 'Save photo' }));
        await screen.findByText('Photo saved');
        expect(api.upload.mock.calls[0]![1].requestId).toBe('elsewhere');
      });

      it('offers nothing without open requests', () => {
        render(<Harness requests={[{ ...here, status: 'fulfilled' }]} />);
        expect(screen.queryByRole('button', { name: /Requests/ })).not.toBeInTheDocument();
        takePhoto();
        expect(screen.queryByLabelText(/Answers the request/)).not.toBeInTheDocument();
      });
    });
  });
});
