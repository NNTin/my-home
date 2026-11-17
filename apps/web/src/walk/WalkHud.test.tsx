import type { Photo, PhotoRequest } from '@my-home/shared';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildHome } from '../builder/buildHome';
import { createContext } from '../editor/operations';
import { furniture } from '../catalog/furniture';
import { mockHome, testRequest } from '../test/fixtures';
import type { Figure } from './figure';
import { useWalk } from './useWalk';
import { WalkHud, type WalkView } from './WalkHud';
import { minimapLevels } from './minimap';
import { WALK_SESSION_KEY } from './walkSession';
import { buildWalkWorld, EYE_HEIGHT } from './world';

// Mock home, souterrain (floor at -1.2): the hallway is x -0.5…1.5, z -4…4.
const world = buildWalkWorld(mockHome, buildHome(mockHome));
const mapLevels = minimapLevels(
  buildHome(mockHome),
  createContext(mockHome, furniture).plans,
  'souterrain',
);
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
  onCamera,
  restored,
  sensors = true,
}: {
  api?: Api;
  requests?: PhotoRequest[];
  onSaved?: () => void;
  northBearing?: number;
  declination?: number;
  onCamera?: (open: boolean) => void;
  restored?: Parameters<typeof WalkHud>[0]['restored'];
  sensors?: boolean;
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
      {...(onCamera && { onCamera })}
      {...(restored && { restored })}
      sensors={sensors}
      map={{ levels: mapLevels, groundLevelId: 'souterrain', photos: [] }}
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
    sessionStorage.clear();
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

  it('shows the minimap, which follows the figure and makes room for the sheets', async () => {
    render(<Harness />);
    const map = () => document.querySelector('.walk-map-svg .map-figure') as SVGGElement | null;
    expect(screen.getByRole('button', { name: /^Map of / })).toBeVisible();
    fireEvent.keyDown(window, { key: 'ArrowUp' });
    await waitFor(() => expect(Number(map()!.dataset.z)).toBeLessThan(-0.2));
    fireEvent.keyUp(window, { key: 'ArrowUp' });
    takePhoto();
    expect(map()).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Discard' }));
    expect(map()).not.toBeNull();
  });

  it('offers the camera modes only on phones with orientation sensors', () => {
    const { unmount } = render(<Harness sensors={false} />);
    // Desktop: always Manual, no switch.
    expect(screen.queryByRole('radiogroup', { name: 'Camera mode' })).not.toBeInTheDocument();
    unmount();
    vi.stubGlobal('DeviceOrientationEvent', undefined);
    render(<Harness />);
    expect(screen.queryByRole('radiogroup', { name: 'Camera mode' })).not.toBeInTheDocument();
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
    const modeButton = (name: RegExp) => screen.getByRole('radio', { name });
    const chooseSensors = () => fireEvent.click(modeButton(/Sensors/));
    const wait = (ms: number) => act(() => new Promise((resolve) => setTimeout(resolve, ms)));

    it('starts in Manual mode: no orientation listeners, the view is turned by hand', async () => {
      const add = vi.spyOn(window, 'addEventListener');
      render(<Harness />);
      expect(modeButton(/Manual/)).toHaveAttribute('aria-checked', 'true');
      expect(modeButton(/Sensors/)).toHaveAttribute('aria-checked', 'false');
      expect(hud().dataset.mode).toBe('manual');
      expect(add.mock.calls.some(([type]) => String(type).startsWith('deviceorientation'))).toBe(
        false,
      );
      // Moving the phone does nothing.
      tiltPhone(60, 90);
      await wait(200);
      expect(at().yaw).toBe(0);
      expect(pitch()).toBe(0);
      // Drag, ▲ and the pad's left and right do.
      fireEvent.click(screen.getByRole('button', { name: 'Look up' }));
      await waitFor(() => expect(pitch()).toBeCloseTo(rad(10), 2));
      const view = screen.getByLabelText('Drag to look around');
      firePointer(view, 'pointerdown', 200, 300);
      firePointer(view, 'pointermove', 300, 300);
      firePointer(view, 'pointerup', 300, 300);
      await waitFor(() => expect(at().yaw).toBeCloseTo(-0.5));
      expect(screen.queryByRole('button', { name: 'Calibrate' })).not.toBeInTheDocument();
    });

    it('turns and tilts the view with the phone in Sensor mode, blending in', async () => {
      render(<Harness northBearing={20} declination={3} />);
      chooseSensors();
      expect(modeButton(/Sensors/)).toHaveAttribute('aria-checked', 'true');
      expect(hud().dataset.mode).toBe('sensors');
      tiltPhone(60, 67);
      // 67 magnetic + 3 = 70 true; + 20 = 90 clockwise of -z: yaw -90°. Beta 60 looks down 30°.
      await waitFor(() => expect(at().yaw).toBeLessThan(rad(-87)));
      expect(at().yaw).toBeGreaterThanOrEqual(rad(-90));
      await waitFor(() => expect(pitch()).toBeLessThan(rad(-27)));
      expect(pitch()).toBeGreaterThanOrEqual(rad(-30));
      expect(screen.getByRole('status', { name: 'Compass' })).toHaveTextContent('accuracy unknown');

      // Back to Manual: the view stays where it is and the hand takes over.
      fireEvent.click(modeButton(/Manual/));
      tiltPhone(120, 200);
      await wait(200);
      expect(at().yaw).toBeLessThan(rad(-87));
      expect(pitch()).toBeLessThan(rad(-27));
      expect(screen.getByRole('button', { name: 'Look up' })).toBeEnabled();
    });

    it('only walks in Sensor mode: drag and ▲▼ change nothing and are hidden, the pad sidesteps', async () => {
      render(<Harness />);
      chooseSensors();
      expect(screen.queryByRole('group', { name: 'Look up and down' })).not.toBeInTheDocument();
      expect(screen.queryByText(/drag to look/)).not.toBeInTheDocument();
      // Before the first reading the pad already sidesteps instead of turning.
      const pad = screen.getByRole('application', { name: 'Movement pad' });
      firePointer(pad, 'pointerdown', 44, 0);
      // Facing -z, right is +x.
      await waitFor(() => expect(at().x).toBeGreaterThan(0.6));
      firePointer(pad, 'pointerup', 44, 0);
      expect(at().yaw).toBe(0);

      tiltPhone(90, 90);
      await waitFor(() => expect(at().yaw).toBeLessThan(rad(-87)));
      await wait(300);
      const before = { yaw: at().yaw, pitch: pitch() };
      const view = screen.getByLabelText('Turn the phone to look around');
      firePointer(view, 'pointerdown', 200, 300);
      firePointer(view, 'pointermove', 300, 100);
      firePointer(view, 'pointermove', 100, 500);
      firePointer(view, 'pointerup', 100, 500);
      // The keys do not turn either.
      fireEvent.keyDown(window, { key: 'q' });
      await wait(200);
      fireEvent.keyUp(window, { key: 'q' });
      expect(at().yaw).toBeCloseTo(before.yaw, 3);
      expect(pitch()).toBeCloseTo(before.pitch, 3);
      // A drag is no calibration any more.
      expect(screen.getByRole('status', { name: 'Compass' })).not.toHaveTextContent('offset');
      // Pushed up, the pad walks where the phone points: east.
      firePointer(pad, 'pointerdown', 0, -44);
      await waitFor(() => expect(at().x).toBeGreaterThan(1.0));
      firePointer(pad, 'pointerup', 0, -44);
      expect(Math.abs(at().yaw - before.yaw)).toBeLessThan(0.01);
    });

    it('moves between the modes with the arrow keys', () => {
      render(<Harness />);
      const group = screen.getByRole('radiogroup', { name: 'Camera mode' });
      fireEvent.keyDown(group, { key: 'ArrowLeft' });
      expect(modeButton(/Sensors/)).toHaveAttribute('aria-checked', 'true');
      expect(modeButton(/Sensors/)).toHaveFocus();
      fireEvent.keyDown(group, { key: 'ArrowRight' });
      expect(modeButton(/Manual/)).toHaveAttribute('aria-checked', 'true');
    });

    it('remembers the mode on this device, and starts in it where no permission is asked', () => {
      const { unmount } = render(<Harness />);
      chooseSensors();
      unmount();
      render(<Harness />);
      expect(modeButton(/Sensors/)).toHaveAttribute('aria-checked', 'true');
      expect(screen.queryByRole('group', { name: 'Look up and down' })).not.toBeInTheDocument();
    });

    it('says that the view is held for the photo, not that the sensors are paused', async () => {
      render(<Harness />);
      chooseSensors();
      tiltPhone(90, 30);
      const chip = () => screen.getByRole('status', { name: 'Compass' });
      await waitFor(() => expect(chip()).toHaveTextContent('accuracy unknown'));

      // The capture sheet is open: the view stays where it was at the tap.
      takePhoto();
      expect(chip()).toHaveTextContent('held for the photo');
      expect(chip()).not.toHaveTextContent('paused');
      // And nothing claims that the page is in the background.
      expect(screen.queryByRole('alert')).not.toBeInTheDocument();

      fireEvent.click(screen.getByRole('button', { name: 'Discard' }));
      tiltPhone(90, 30);
      await waitFor(() => expect(chip()).toHaveTextContent('accuracy unknown'));

      // A page in the background is the other thing, and keeps its own word.
      Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true });
      fireEvent(document, new Event('visibilitychange'));
      expect(chip()).toHaveTextContent('paused');
      expect(chip()).not.toHaveTextContent('held');
      Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true });
      fireEvent(document, new Event('visibilitychange'));
    });

    it('keeps the offset, Reset and Done at the head of the calibration sheet', async () => {
      render(<Harness />);
      chooseSensors();
      tiltPhone(90, 8);
      await waitFor(() =>
        expect(screen.getByRole('status', { name: 'Compass' })).toBeInTheDocument(),
      );
      fireEvent.click(screen.getByRole('button', { name: 'Calibrate' }));
      const sheet = screen.getByRole('region', { name: 'Calibrate the compass' });
      const head = sheet.firstElementChild as HTMLElement;
      expect(head).toHaveClass('walk-calibrate-head');
      expect(head).toHaveTextContent('Offset 0°');
      expect(within(head).getByRole('button', { name: 'Reset' })).toBeDisabled();
      // Calibration is by a door or a window, never by dragging.
      expect(sheet).not.toHaveTextContent(/drag/i);
      fireEvent.click(within(head).getByRole('button', { name: 'Done' }));
      expect(
        screen.queryByRole('region', { name: 'Calibrate the compass' }),
      ).not.toBeInTheDocument();
    });

    it('calibrates against a door, shows and resets the offset, and saves the declination', async () => {
      render(<Harness />);
      chooseSensors();
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

    it('falls back to Manual with a message when permission is refused or no data arrives', async () => {
      const requestPermission = vi.fn().mockResolvedValue('denied');
      vi.stubGlobal('DeviceOrientationEvent', Object.assign(class {}, { requestPermission }));
      render(<Harness />);
      chooseSensors();
      expect(await screen.findByRole('alert')).toHaveTextContent(/did not allow.*Manual/);
      expect(modeButton(/Manual/)).toHaveAttribute('aria-checked', 'true');
      expect(screen.getByRole('button', { name: 'Look up' })).toBeEnabled();

      requestPermission.mockResolvedValue('granted');
      chooseSensors();
      await waitFor(() => expect(modeButton(/Sensors/)).toHaveAttribute('aria-checked', 'true'));
      expect(screen.getByRole('alert')).toHaveTextContent('Waiting for the sensors…');
      expect(requestPermission).toHaveBeenCalledTimes(2);
      // Nothing arrives: back to Manual, with the look controls.
      await waitFor(
        () => expect(screen.getByRole('alert')).toHaveTextContent(/No motion sensor data/),
        { timeout: 4000 },
      );
      expect(modeButton(/Manual/)).toHaveAttribute('aria-checked', 'true');
      expect(screen.getByRole('button', { name: 'Look up' })).toBeEnabled();
    }, 10_000);

    it('stores the sensor snapshot with a photo taken in Sensor mode', async () => {
      const api = fakeApi();
      render(<Harness api={api} northBearing={20} declination={3} />);
      chooseSensors();
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

    it('stores source manual without tilt for a photo taken in Manual mode', async () => {
      const api = fakeApi();
      render(<Harness api={api} />);
      tiltPhone(110, 40);
      takePhoto();
      fireEvent.click(screen.getByRole('button', { name: 'Save photo' }));
      await screen.findByText('Photo saved');
      const { sensors } = api.upload.mock.calls[0]![1];
      expect(sensors).toMatchObject({ source: 'manual', yaw: 0, pitch: 0 });
      expect(sensors).not.toHaveProperty('beta');
      expect(sensors?.tilt ?? false).toBe(false);
    });

    it('stores the view of the moment the shutter was tapped, whatever the phone does afterwards', async () => {
      const api = fakeApi();
      render(<Harness api={api} />);
      chooseSensors();
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
      await wait(250);
      fireEvent.change(shutter, { target: { files: [new File(['x'], 'photo.jpg')] } });
      // Back on the page, reading the sheet with the phone tipped towards them.
      tiltPhone(30, 310);
      tiltPhone(25, 300);
      await wait(300);
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

  const kept = () => JSON.parse(sessionStorage.getItem(WALK_SESSION_KEY) ?? 'null');

  describe('when the camera app takes the page away', () => {
    it('keeps the walk and the pose of the tap for this tab, and forgets them on exit', () => {
      const view = render(<Harness />);
      expect(kept()).toMatchObject({ homeId: 'mock-home', view: 'first', figure: start });
      expect(kept().pending).toBeUndefined();

      fireEvent.click(screen.getByLabelText('Take photo'));
      expect(kept().pending).toMatchObject({ figure: start, sensors: { source: 'manual' } });
      // The photo arrived: nothing is on its way any more.
      fireEvent.change(screen.getByLabelText('Take photo'), {
        target: { files: [new File(['x'], 'photo.jpg', { type: 'image/jpeg' })] },
      });
      expect(kept().pending).toBeUndefined();

      view.unmount();
      expect(sessionStorage.getItem(WALK_SESSION_KEY)).toBeNull();
    });

    it('starts the scene again on a cancelled picker, or on the next touch where none says so', () => {
      const onCamera = vi.fn();
      render(<Harness onCamera={onCamera} />);
      const input = screen.getByLabelText('Take photo');
      fireEvent.click(input);
      expect(onCamera).toHaveBeenLastCalledWith(true);
      act(() => void input.dispatchEvent(new Event('cancel')));
      expect(onCamera).toHaveBeenLastCalledWith(false);
      expect(kept().pending).toBeUndefined();

      // A picker that says nothing at all: the next touch on the page.
      fireEvent.click(input);
      expect(onCamera).toHaveBeenLastCalledWith(true);
      fireEvent.pointerDown(hud());
      expect(onCamera).toHaveBeenLastCalledWith(false);
      expect(kept().pending).toBeUndefined();
    });

    it('stops the scene while the camera app is open, and starts it when the page is back', () => {
      const onCamera = vi.fn();
      render(<Harness onCamera={onCamera} />);
      expect(onCamera).toHaveBeenLastCalledWith(false);
      fireEvent.click(screen.getByLabelText('Take photo'));
      expect(onCamera).toHaveBeenLastCalledWith(true);
      // A focus without having left first is not a return.
      act(() => void window.dispatchEvent(new Event('focus')));
      expect(onCamera).toHaveBeenLastCalledWith(true);
      // Back without a photo (cancelled): the page lived, so nothing was lost either.
      vi.spyOn(document, 'hasFocus').mockReturnValueOnce(false);
      act(() => void window.dispatchEvent(new Event('blur')));
      act(() => void window.dispatchEvent(new Event('focus')));
      expect(onCamera).toHaveBeenLastCalledWith(false);
      expect(kept().pending).toBeUndefined();
    });

    it('says that the photo was lost when the page was reloaded meanwhile', () => {
      render(<Harness restored={{ mode: 'manual', lostPhoto: true }} />);
      expect(screen.getByRole('alert')).toHaveTextContent(
        /reloaded the page while the camera app was open.*please take it again/,
      );
      takePhoto();
      expect(screen.queryByText(/reloaded the page/)).not.toBeInTheDocument();
    });

    it('keeps the note and tags being typed, and offers them again after a reload', async () => {
      const first = render(<Harness />);
      takePhoto();
      fireEvent.change(screen.getByLabelText('Note'), { target: { value: 'Kitchen window' } });
      fireEvent.click(screen.getByLabelText('window'));
      expect(kept().draft).toEqual({ note: 'Kitchen window', tags: ['window'] });
      const draft = kept().draft;
      first.unmount();

      const api = fakeApi();
      render(<Harness api={api} restored={{ mode: 'manual', lostPhoto: true, draft }} />);
      takePhoto();
      expect(screen.getByLabelText('Note')).toHaveValue('Kitchen window');
      fireEvent.click(screen.getByRole('button', { name: 'Save photo' }));
      await screen.findByText('Photo saved');
      expect(api.upload.mock.calls[0]![1]).toMatchObject({
        note: 'Kitchen window',
        tags: ['window'],
      });
      // Saved: the next photo starts blank.
      expect(kept().draft).toBeUndefined();
    });

    it('stays in Manual when Manual is tapped before the quiet permission answer arrives', async () => {
      let answer: (result: string) => void = () => {};
      vi.stubGlobal(
        'DeviceOrientationEvent',
        Object.assign(class extends Event {}, {
          requestPermission: () => new Promise<string>((resolve) => (answer = resolve)),
        }),
      );
      render(<Harness restored={{ mode: 'sensors', lostPhoto: false }} />);
      // The quiet request is on its way.
      await act(async () => {});
      const manual = screen.getByRole('radio', { name: /Manual/ });
      // Still Manual while the browser has not answered; the owner taps it anyway.
      expect(manual).toHaveAttribute('aria-checked', 'true');
      fireEvent.click(manual);
      await act(async () => answer('granted'));
      expect(screen.getByRole('radio', { name: /Manual/ })).toHaveAttribute('aria-checked', 'true');
      expect(hud().dataset.mode).toBe('manual');
      vi.unstubAllGlobals();
    });

    it('comes back in Sensor mode where no tap is needed (Android), else in Manual', async () => {
      vi.stubGlobal('DeviceOrientationEvent', class extends Event {});
      const { unmount } = render(<Harness restored={{ mode: 'sensors', lostPhoto: false }} />);
      expect(screen.getByRole('radio', { name: /Sensors/ })).toHaveAttribute(
        'aria-checked',
        'true',
      );
      expect(JSON.parse(sessionStorage.getItem(WALK_SESSION_KEY)!)).toMatchObject({
        mode: 'sensors',
      });
      unmount();
      // Chrome on Android has a permission function too, and grants it without a tap.
      vi.stubGlobal(
        'DeviceOrientationEvent',
        Object.assign(class extends Event {}, {
          requestPermission: vi.fn().mockResolvedValue('granted'),
        }),
      );
      const chrome = render(<Harness restored={{ mode: 'sensors', lostPhoto: false }} />);
      await waitFor(() =>
        expect(screen.getByRole('radio', { name: /Sensors/ })).toHaveAttribute(
          'aria-checked',
          'true',
        ),
      );
      chrome.unmount();
      // iOS refuses a request no tap started: Manual until the owner taps, and no complaint.
      vi.stubGlobal(
        'DeviceOrientationEvent',
        Object.assign(class extends Event {}, {
          requestPermission: vi.fn().mockRejectedValue(new Error('NotAllowedError')),
        }),
      );
      render(<Harness restored={{ mode: 'sensors', lostPhoto: false }} />);
      await act(() => new Promise((resolve) => setTimeout(resolve, 50)));
      expect(screen.getByRole('radio', { name: /Manual/ })).toHaveAttribute('aria-checked', 'true');
      expect(screen.queryByRole('alert')).not.toBeInTheDocument();
      vi.unstubAllGlobals();
    });

    it('offers a copy of the photo when the upload fails', async () => {
      const api = fakeApi();
      api.upload.mockRejectedValueOnce(new Error('no connection to the server'));
      render(<Harness api={api} />);
      takePhoto();
      expect(screen.getByText('Save a copy on the phone')).not.toBeVisible();
      fireEvent.click(screen.getByRole('button', { name: 'Save photo' }));
      expect(await screen.findByRole('alert')).toHaveTextContent(/The photo stays here/);
      const copy = screen.getByText('Save a copy on the phone');
      expect(copy).toBeVisible();
      expect(copy).toHaveAttribute('href', 'blob:preview');
      expect(copy.getAttribute('download')).toMatch(/^photo-.*\.jpg$/);
    });
  });

  describe('with the camera inside the page', () => {
    const track = { stop: vi.fn(), kind: 'video' };
    const stream = { getTracks: () => [track], getVideoTracks: () => [track] };
    const getUserMedia = vi.fn<(c: MediaStreamConstraints) => Promise<unknown>>();
    beforeEach(() => {
      getUserMedia.mockResolvedValue(stream);
      Object.defineProperty(navigator, 'mediaDevices', {
        configurable: true,
        value: { getUserMedia },
      });
      vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined);
      vi.spyOn(HTMLVideoElement.prototype, 'videoWidth', 'get').mockReturnValue(1080);
      vi.spyOn(HTMLVideoElement.prototype, 'videoHeight', 'get').mockReturnValue(1920);
      vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
        drawImage: vi.fn(),
      } as unknown as CanvasRenderingContext2D);
      vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation(function (
        this: HTMLCanvasElement,
        done,
      ) {
        done(new Blob([`frame ${this.width}x${this.height}`], { type: 'image/jpeg' }));
      });
    });
    afterEach(() => {
      Reflect.deleteProperty(navigator, 'mediaDevices');
      vi.restoreAllMocks();
    });

    it('takes the photo in the page, without the camera app, and uploads the frame', async () => {
      const api = fakeApi();
      const onCamera = vi.fn();
      render(<Harness api={api} onCamera={onCamera} />);
      const shutter = screen.getByRole('button', { name: 'Take photo' });
      fireEvent.click(shutter);
      const camera = within(screen.getByRole('region', { name: 'Camera' }));
      expect(onCamera).toHaveBeenLastCalledWith(true);
      expect(getUserMedia).toHaveBeenCalledWith(
        expect.objectContaining({
          video: expect.objectContaining({ facingMode: { ideal: 'environment' } }),
        }),
      );
      const take = camera.getByRole('button', { name: 'Take the photo' });
      await waitFor(() => expect(take).toBeEnabled());
      // Nothing about a camera app on its way: the page never leaves.
      expect(kept().pending).toBeUndefined();
      fireEvent.click(take);

      const sheet = within(await screen.findByRole('region', { name: 'New photo' }));
      expect(screen.queryByRole('region', { name: 'Camera' })).not.toBeInTheDocument();
      expect(track.stop).toHaveBeenCalled();
      expect(onCamera).toHaveBeenLastCalledWith(false);
      fireEvent.click(sheet.getByRole('button', { name: 'Save photo' }));
      await sheet.findByText('Photo saved');
      const [, meta, image] = api.upload.mock.calls[0]!;
      expect(await image.text()).toBe('frame 1080x1920');
      expect(meta.pose.position.x).toBeCloseTo(start.x);
      expect(meta.sensors).toMatchObject({ source: 'manual' });
    });

    it('falls back to the camera app and the gallery when the camera is not allowed', async () => {
      getUserMedia.mockRejectedValue(
        Object.assign(new Error('denied'), { name: 'NotAllowedError' }),
      );
      render(<Harness />);
      fireEvent.click(screen.getByRole('button', { name: 'Take photo' }));
      const camera = within(screen.getByRole('region', { name: 'Camera' }));
      expect(await camera.findByRole('alert')).toHaveTextContent(/not allowed for this site/);
      expect(camera.getByRole('button', { name: 'Take the photo' })).toBeDisabled();
      expect(camera.getByLabelText('Camera app')).toHaveAttribute('capture', 'environment');
      const gallery = camera.getByLabelText('Gallery');
      expect(gallery).toHaveAttribute('type', 'file');
      expect(gallery).not.toHaveAttribute('capture');

      fireEvent.click(gallery);
      fireEvent.change(gallery, {
        target: { files: [new File(['picked'], 'old.jpg', { type: 'image/jpeg' })] },
      });
      expect(await screen.findByRole('region', { name: 'New photo' })).toBeInTheDocument();
      expect(screen.queryByRole('region', { name: 'Camera' })).not.toBeInTheDocument();
    });

    it('lets go of the camera while the camera app is open from the viewfinder', async () => {
      render(<Harness />);
      fireEvent.click(screen.getByRole('button', { name: 'Take photo' }));
      const camera = within(screen.getByRole('region', { name: 'Camera' }));
      await waitFor(() =>
        expect(camera.getByRole('button', { name: 'Take the photo' })).toBeEnabled(),
      );
      fireEvent.click(camera.getByLabelText('Camera app'));
      expect(track.stop).toHaveBeenCalled();
      expect(kept().pending).toBeDefined();
      // Back with the page alive: the viewfinder takes the camera again.
      vi.spyOn(document, 'hasFocus').mockReturnValueOnce(false);
      act(() => void window.dispatchEvent(new Event('blur')));
      act(() => void window.dispatchEvent(new Event('focus')));
      await waitFor(() => expect(getUserMedia).toHaveBeenCalledTimes(2));
    });

    it('resumes the scene and the viewfinder when the picker is closed without a photo', async () => {
      const onCamera = vi.fn();
      render(<Harness onCamera={onCamera} />);
      fireEvent.click(screen.getByRole('button', { name: 'Take photo' }));
      const camera = within(screen.getByRole('region', { name: 'Camera' }));
      await waitFor(() =>
        expect(camera.getByRole('button', { name: 'Take the photo' })).toBeEnabled(),
      );
      const gallery = camera.getByLabelText('Gallery');
      fireEvent.click(gallery);
      expect(camera.getByRole('button', { name: 'Take the photo' })).toBeDisabled();
      // Closed without taking the focus away (an action sheet on the page): only `cancel` says so.
      act(() => void gallery.dispatchEvent(new Event('cancel')));
      await waitFor(() => expect(getUserMedia).toHaveBeenCalledTimes(2));
      await waitFor(() =>
        expect(camera.getByRole('button', { name: 'Take the photo' })).toBeEnabled(),
      );
      expect(kept().pending).toBeUndefined();
      expect(screen.getByRole('region', { name: 'Camera' })).toBeInTheDocument();
    });
  });
});
