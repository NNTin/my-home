import type { PhotoRequest, PhotoSensors } from '@my-home/shared';
import {
  createElement,
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type PointerEvent,
} from 'react';
import type { PhotosApi } from '../api';
import { activeRequest, openRequests } from '../photos/requests';
import { CameraView, hasInPageCamera } from './CameraView';
import { CaptureSheet } from './CaptureSheet';
import type { Figure } from './figure';
import { Joystick } from './Joystick';
import { Minimap, type MapSpot } from './Minimap';
import type { CameraHints } from './prepareImage';

import type { MinimapLevel } from './minimap';
import type { CalibrationTarget } from './calibration';
import { accuracyLabel } from './orientation';
import { compassStatusText, storedCameraMode, useCompass, type CameraMode } from './useCompass';
import { useFigure, type Walk } from './useWalk';
import { saveWalkSession, type WalkSession } from './walkSession';
import { yawTowards } from './world';

/** A photo just taken with the phone's camera app: its focal length is this phone's. */
const CAMERA_APP: CameraHints = { source: 'camera-app' };

export type WalkView = 'first' | 'third';

/** Where a declination value comes from: read off a chart or model, or measured at the home. */
export type DeclinationSource = 'geodata' | 'measured';

/** One tap of the look up/down buttons: 10°. */
const TILT_STEP = (10 * Math.PI) / 180;
/** Radians of turning per pixel dragged across the view. */
const LOOK_SENSITIVITY = 0.005;

interface Props {
  homeId: string;
  walk: Walk;
  /** Names the figure's place, e.g. "Kitchen · Souterrain"; empty outdoors. */
  describe(figure: Figure): string;
  view: WalkView;
  onView(view: WalkView): void;
  onExit(): void;
  /** `building.northBearing` and `building.magneticDeclination`, for the phone's compass. */
  northBearing?: number;
  declination?: number;
  /** Saves a new declination for the home; rejects when that fails. */
  onDeclination?(degrees: number, source: DeclinationSource): Promise<void>;
  /** Doors and windows around the figure that the compass can be calibrated against. */
  calibrationTargets?(figure: Figure): CalibrationTarget[];
  api: Pick<PhotosApi, 'upload' | 'update'>;
  /** Photo requests; the open ones are offered here and answered by taking a photo. */
  requests?: PhotoRequest[];
  /** The room the figure is in, to match requests that only name a room. */
  roomIdOf?(figure: Figure): string | undefined;
  /** Jumps the figure to a request's spot. */
  onGoTo?(request: PhotoRequest): void;
  /** Tells which request the owner picked to answer next (shown highlighted in 3D). */
  onChoose?(requestId: string | undefined): void;
  /** Called after a photo, or a correction of its pose, was stored. */
  onSaved?(): void;
  /**
   * A camera is open, the page's own or the phone's camera app: the 3D view is not seen
   * meanwhile and can stop drawing, which leaves the phone more memory for the camera.
   */
  onCamera?(open: boolean): void;
  /** The minimap: the plan of every level, and what else it shows. */
  map?: {
    levels: ReadonlyMap<string, MinimapLevel>;
    groundLevelId: string | undefined;
    /** The cameras of the photos, shown on the map when the owner asks for them. */
    photos: MapSpot[];
    /** Sets the figure down where the enlarged map was tapped; false where it cannot stand. */
    onPlace?(point: [number, number], levelId: string): boolean;
  };
  /**
   * Offer the Sensors/Manual switch (a phone or tablet). Without it the view is always set by
   * hand (desktop), and so it is on a device without orientation sensors.
   */
  sensors?: boolean;
  /** What a walk saved before the page was reloaded brings back (see `walkSession`). */
  restored?: Pick<WalkSession, 'mode' | 'draft'> & {
    /** The phone's camera app was open when the page went: its photo never arrived. */
    lostPhoto: boolean;
  };
}

type Draft = NonNullable<WalkSession['draft']>;

/**
 * The controls shown while walking: the movement pad, drag-to-look, the view switch and the
 * camera button. Laid out for one thumb on a phone held upright; it works with a mouse too.
 */
export function WalkHud({
  homeId,
  walk,
  describe,
  view,
  onView,
  onExit,
  northBearing = 0,
  declination = 0,
  onDeclination,
  calibrationTargets,
  api,
  requests = [],
  roomIdOf,
  onGoTo,
  onChoose,
  onSaved,
  onCamera,
  sensors = false,
  map,
  restored,
}: Props) {
  const figure = useFigure(walk);
  const open = openRequests(requests);
  const [chosenId, setChosenId] = useState<string>();
  const [listed, setListed] = useState(false);
  const request = activeRequest(open, { ...figure, roomId: roomIdOf?.(figure) }, chosenId);
  const choose = (id: string | undefined) => {
    setChosenId(id);
    onChoose?.(id);
  };
  const { setPad: onPad, nudge: onNudge, figureRef } = walk;
  /**
   * The photo being reviewed, with what the sensors said **when the shutter was tapped**. Between
   * the tap and the save the owner reads the sheet and types, usually with the phone tipped
   * towards them: none of that may end up in the photo's pose.
   */
  const [capture, setCapture] = useState<{
    file: Blob;
    sensors: PhotoSensors;
    camera?: CameraHints;
  }>();
  const tap = useRef<{ figure: Figure; sensors: PhotoSensors } | undefined>(undefined);
  const file = capture?.file;
  const compass = useCompass({
    northBearing,
    declination,
    setFollow: walk.setFollow,
    getFigure: () => figureRef.current,
    // The view stays where it was at the tap; the sheet's arrows adjust it from there.
    held: capture !== undefined,
    // The mode of the walk before a reload, else the one chosen last on this device.
    initialMode: sensors ? (restored?.mode ?? storedCameraMode()) : 'manual',
  });
  const sensorMode = compass.mode === 'sensors';
  const { setSensorMode } = walk;
  useEffect(() => setSensorMode(sensorMode), [sensorMode, setSensorMode]);
  const inPage = useState(hasInPageCamera)[0];
  /** The page's own camera is showing. */
  const [viewfinder, setViewfinder] = useState(false);
  /** The phone's camera app (or the gallery) is open and has not handed back a photo yet. */
  const [away, setAway] = useState(false);
  const [notice, setNotice] = useState(restored?.lostPhoto ?? false);

  // Walk mode is kept for this tab, so a reload (mostly one while the camera app was open) comes
  // back walking where it was. `pending` and `draft` ride along with every save.
  const kept = useRef<Pick<WalkSession, 'pending' | 'draft'>>({
    ...(restored?.draft && { draft: restored.draft }),
  });
  const keep = useRef(() => {});
  useEffect(() => {
    keep.current = () =>
      saveWalkSession({
        homeId,
        view,
        figure: figureRef.current,
        mode: compass.mode,
        ...kept.current,
      });
    keep.current();
  }, [homeId, view, compass.mode, figureRef]);
  useEffect(() => {
    const onHide = () => {
      if (document.visibilityState === 'hidden') keep.current();
    };
    const onPageHide = () => keep.current();
    document.addEventListener('visibilitychange', onHide);
    window.addEventListener('pagehide', onPageHide);
    return () => {
      document.removeEventListener('visibilitychange', onHide);
      window.removeEventListener('pagehide', onPageHide);
      // Unmounted: walk mode was left (a reload does not get here).
      saveWalkSession(undefined);
    };
  }, []);
  const cameraOpen = viewfinder || away;
  useEffect(() => {
    onCamera?.(cameraOpen);
  }, [cameraOpen, onCamera]);
  useEffect(() => () => onCamera?.(false), [onCamera]);
  // Back from the camera app with the page still alive: whatever it hands back (or not) arrives
  // in this page, so nothing is lost any more.
  // Only a return counts: the page must have been left (hidden, or the focus lost) first. A
  // picker closed without a photo usually says so (`cancel`, see `FileInput`); where it says
  // nothing and never took the focus either (an action sheet on the page), the next touch on the
  // page shows that the owner is back.
  useEffect(() => {
    if (!away) return;
    let left = false;
    const leave = () => {
      if (document.visibilityState === 'hidden' || !document.hasFocus()) left = true;
    };
    const resume = () => {
      delete kept.current.pending;
      keep.current();
      setAway(false);
    };
    const back = () => {
      if (left && document.visibilityState !== 'hidden') resume();
    };
    const change = () => (document.visibilityState === 'hidden' ? leave() : back());
    document.addEventListener('visibilitychange', change);
    window.addEventListener('blur', leave);
    window.addEventListener('focus', back);
    window.addEventListener('pointerdown', resume, true);
    return () => {
      document.removeEventListener('visibilitychange', change);
      window.removeEventListener('blur', leave);
      window.removeEventListener('focus', back);
      window.removeEventListener('pointerdown', resume, true);
    };
  }, [away]);

  /** The moment of the photo: the figure and what the sensors say now. */
  const shutter = () => {
    tap.current = { figure: figureRef.current, sensors: compass.snapshot() };
  };
  const took = (photo: Blob, camera?: CameraHints) => {
    const taken = tap.current;
    // Back to the pose of the tap, whatever the phone did in between.
    if (taken) walk.place(taken.figure);
    setCapture({
      file: photo,
      sensors: taken?.sensors ?? compass.snapshot(),
      ...(camera && { camera }),
    });
    tap.current = undefined;
    setViewfinder(false);
    setNotice(false);
    delete kept.current.pending;
    keep.current();
  };
  /** Note and tags from before a reload, for the next photo only. */
  const [draft, setInitialDraft] = useState(restored?.draft);
  const setDraft = (draft: Draft | undefined) => {
    setInitialDraft(undefined);
    if (draft && (draft.note !== '' || draft.tags.length > 0)) kept.current.draft = draft;
    else delete kept.current.draft;
    keep.current();
  };

  /** The phone's camera app is opening: the tab may not survive it, so keep where it was. */
  const leaving = () => {
    shutter();
    kept.current.pending = { ...tap.current!, at: Date.now() };
    keep.current();
    setAway(true);
  };
  /** The picker closed, with a photo or without one (cancelled): the page is still here. */
  const picked = (photo: Blob | undefined, camera?: CameraHints) => {
    if (photo) took(photo, camera);
    tap.current = undefined;
    delete kept.current.pending;
    keep.current();
    setAway(false);
  };
  const [calibrating, setCalibrating] = useState(false);
  const [declinationText, setDeclinationText] = useState(String(declination));
  const [declinationSaved, setDeclinationSaved] = useState<'saving' | 'saved' | 'failed'>();
  const [declinationSource, setDeclinationSource] = useState<DeclinationSource>('geodata');
  /** The compass turns the figure right now. */
  const following = compass.heading === 'on';
  /**
   * Turning and tilting the view by hand: Manual mode only. In Sensor mode the phone owns the
   * view, and a drag or a tap never changes it (calibration is in the Calibrate sheet).
   */
  const onLook = (dYaw: number, dPitch: number) => {
    if (!sensorMode) walk.lookBy(dYaw, dPitch);
  };
  const chooseMode = (mode: CameraMode) => {
    // Always passed on, also for the mode already shown: a tap is the owner's choice, which must
    // win over a quiet permission answer for a restored Sensor mode that is still on its way.
    compass.setMode(mode);
    if (mode === 'manual') setCalibrating(false);
  };
  // A radio group moves with the arrow keys and has one tab stop.
  const modeKey = (e: KeyboardEvent<HTMLDivElement>) => {
    const step = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[e.key];
    if (step === undefined) return;
    e.preventDefault();
    e.stopPropagation();
    const mode: CameraMode = sensorMode ? 'manual' : 'sensors';
    chooseMode(mode);
    e.currentTarget.querySelector<HTMLButtonElement>(`[data-mode="${mode}"]`)?.focus();
  };
  const accuracy = accuracyLabel(compass.accuracy);
  const offset = `${compass.calibration > 0 ? '+' : ''}${compass.calibration}°`;
  const statusText = compassStatusText(compass);
  const pitchDegrees = Math.round((figure.pitch * 180) / Math.PI);
  const saveDeclination = async () => {
    const value = Number(declinationText);
    if (
      !onDeclination ||
      declinationText.trim() === '' ||
      !Number.isFinite(value) ||
      Math.abs(value) > 180
    ) {
      return setDeclinationSaved('failed');
    }
    setDeclinationSaved('saving');
    try {
      await onDeclination(value, declinationSource);
      setDeclinationSaved('saved');
    } catch {
      setDeclinationSaved('failed');
    }
  };
  const drag = useRef<{ id: number; x: number; y: number } | undefined>(undefined);
  const where = describe(figure) || 'Outside';

  // Some mobile browsers start scrolling the page under a vertical drag in spite of
  // `touch-action: none`; a touch that moves on the look layer is ours alone.
  const lookLayer = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const layer = lookLayer.current;
    if (!layer) return;
    const hold = (e: TouchEvent) => e.preventDefault();
    layer.addEventListener('touchmove', hold, { passive: false });
    return () => layer.removeEventListener('touchmove', hold);
  }, [view]);

  const lookMove = (e: PointerEvent<HTMLDivElement>) => {
    const from = drag.current;
    if (from?.id !== e.pointerId) return;
    // Dragging right looks right (yaw is counter-clockwise), dragging up looks up.
    onLook(-(e.clientX - from.x) * LOOK_SENSITIVITY, -(e.clientY - from.y) * LOOK_SENSITIVITY);
    drag.current = { id: e.pointerId, x: e.clientX, y: e.clientY };
  };
  const lookEnd = (e: PointerEvent<HTMLDivElement>) => {
    if (drag.current?.id === e.pointerId) drag.current = undefined;
  };

  return (
    <div
      className="walk-hud"
      data-testid="walk-hud"
      data-x={figure.x.toFixed(2)}
      data-z={figure.z.toFixed(2)}
      data-y={figure.y.toFixed(2)}
      data-yaw={figure.yaw.toFixed(3)}
      data-pitch={figure.pitch.toFixed(3)}
      data-level={figure.levelId ?? ''}
      data-mode={compass.mode}
    >
      {view === 'first' && (
        <div
          ref={lookLayer}
          className="walk-look"
          aria-label={sensorMode ? 'Turn the phone to look around' : 'Drag to look around'}
          onPointerDown={(e) => {
            // Sensor mode: the layer only keeps touches away from the page and the scene.
            if (drag.current || sensorMode) return;
            drag.current = { id: e.pointerId, x: e.clientX, y: e.clientY };
            e.currentTarget.setPointerCapture?.(e.pointerId);
          }}
          onPointerMove={lookMove}
          onPointerUp={lookEnd}
          onPointerCancel={lookEnd}
        />
      )}

      <div className="walk-bar">
        <button type="button" onClick={onExit}>
          ✕ Exit
        </button>
        <span className="walk-where" role="status" aria-label="Figure location">
          {where}
        </span>
        <button
          type="button"
          aria-pressed={view === 'first'}
          onClick={() => onView(view === 'first' ? 'third' : 'first')}
        >
          {view === 'first' ? 'Overview' : 'First person'}
        </button>
        {sensors && compass.supported && (
          <div
            className="segmented walk-mode"
            role="radiogroup"
            aria-label="Camera mode"
            onKeyDown={modeKey}
          >
            {(
              [
                ['sensors', '📱 Sensors', 'The phone turns and tilts the view; touch only walks'],
                ['manual', '✋ Manual', 'Turn and tilt by hand; the motion sensors are off'],
              ] as const
            ).map(([mode, label, title]) => (
              <button
                key={mode}
                type="button"
                role="radio"
                data-mode={mode}
                aria-checked={compass.mode === mode}
                tabIndex={compass.mode === mode ? 0 : -1}
                title={title}
                onClick={() => chooseMode(mode)}
              >
                {label}
              </button>
            ))}
          </div>
        )}
        <span className="walk-compass" role="status" aria-label="View tilt">
          {pitchDegrees > 0 ? '▲' : pitchDegrees < 0 ? '▼' : '◆'} {Math.abs(pitchDegrees)}°
        </span>
        {sensorMode && (
          <>
            <span
              className={accuracy.poor ? 'walk-compass poor' : 'walk-compass'}
              role="status"
              aria-label="Compass"
            >
              {following
                ? accuracy.text
                : compass.held
                  ? // Not the same as a page in the background: the view waits for the photo.
                    'held for the photo'
                  : compass.heading === 'paused'
                    ? 'paused'
                    : '…'}
              {compass.calibration !== 0 && ` · offset ${offset}`}
            </span>
            <button
              type="button"
              aria-expanded={calibrating}
              onClick={() => setCalibrating(!calibrating)}
            >
              Calibrate
            </button>
          </>
        )}
        {open.length > 0 && (
          <button type="button" aria-expanded={listed} onClick={() => setListed(!listed)}>
            Requests ({open.length})
          </button>
        )}
        {statusText && (
          <p className="walk-notice" role="alert">
            {statusText}
          </p>
        )}
        {!sensorMode && (
          <span className="walk-keys">W A S D / arrows walk · Q E turn · drag to look</span>
        )}
      </div>
      {sensorMode && calibrating && !file && (
        <section className="walk-calibrate" aria-label="Calibrate the compass">
          {/* Always in reach, whatever the rest of the sheet scrolls to. */}
          <div className="walk-calibrate-head">
            <strong>Offset {offset}</strong>
            <button
              type="button"
              onClick={compass.resetCalibration}
              disabled={compass.calibration === 0}
            >
              Reset
            </button>
            <button type="button" className="primary" onClick={() => setCalibrating(false)}>
              Done
            </button>
          </div>
          <p className="hint">
            Point the phone at one of these and tap it: the view turns to match what you see.
          </p>
          <div className="capture-actions">
            {(calibrationTargets?.(figure) ?? []).slice(0, 6).map((target) => (
              <button
                key={target.id}
                type="button"
                disabled={!following}
                onClick={() =>
                  compass.calibrateTo(yawTowards([target.x - figure.x, target.z - figure.z]))
                }
              >
                {target.label}
              </button>
            ))}
          </div>
          <label className="walk-declination">
            Magnetic declination (° east){' '}
            <input
              type="number"
              step="0.1"
              min={-180}
              max={180}
              value={declinationText}
              onChange={(e) => {
                setDeclinationText(e.target.value);
                setDeclinationSaved(undefined);
              }}
            />
          </label>{' '}
          <label className="walk-declination">
            Where it is from{' '}
            <select
              value={declinationSource}
              onChange={(e) => {
                setDeclinationSource(e.target.value as DeclinationSource);
                setDeclinationSaved(undefined);
              }}
            >
              <option value="geodata">a declination chart or model</option>
              <option value="measured">measured on site</option>
            </select>
          </label>{' '}
          <button
            type="button"
            onClick={() => void saveDeclination()}
            disabled={declinationSaved === 'saving' || declinationSaved === 'saved'}
          >
            Save
          </button>
          <p className="hint" role="status">
            {declinationSaved === 'saved' && 'Declination saved for this home.'}
            {declinationSaved === 'failed' && 'Could not save the declination (-180 to 180).'}
            {declinationSaved === undefined &&
              'From a declination chart for your area; 0 if unknown. The offset above is per device.'}
          </p>
        </section>
      )}
      {listed && !file && (
        <ul className="walk-requests" aria-label="Open photo requests">
          {open.map((r) => (
            <li key={r.id}>
              <p>
                <strong>{r.reason}</strong>
              </p>
              <p className="hint">{r.roomName ?? r.roomId ?? 'Anywhere'}</p>
              <div className="capture-actions">
                {r.position && onGoTo && (
                  <button
                    type="button"
                    onClick={() => {
                      onGoTo(r);
                      choose(r.id);
                      setListed(false);
                    }}
                  >
                    Go there
                  </button>
                )}
                <button
                  type="button"
                  aria-pressed={chosenId === r.id}
                  onClick={() => choose(chosenId === r.id ? undefined : r.id)}
                >
                  {chosenId === r.id ? 'Answering this' : 'Answer this'}
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
      {map && !file && !listed && !calibrating && !viewfinder && (
        <div className="walk-map-slot">
          <Minimap
            figure={figure}
            levels={map.levels}
            groundLevelId={map.groundLevelId}
            northBearing={northBearing}
            roomId={roomIdOf?.(figure)}
            requests={open.flatMap((r): MapSpot[] =>
              r.position
                ? [
                    {
                      id: r.id,
                      x: r.position.x,
                      z: r.position.z,
                      levelId: r.levelId ?? undefined,
                      active: r.id === request?.id,
                    },
                  ]
                : [],
            )}
            photos={map.photos}
            onPlace={map.onPlace}
          />
        </div>
      )}
      {request && !file && !listed && (
        <p className="walk-request" role="status" aria-label="Photo request here">
          📌 {request.reason}
        </p>
      )}

      {notice && !file && (
        <div className="walk-notice" role="alert">
          <p>
            The browser reloaded the page while the camera app was open, so that photo did not
            arrive. You are back where you took it: please take it again.
            {inPage && ' The 📷 button now uses the camera inside this page, which avoids this.'}
          </p>
          <button type="button" onClick={() => setNotice(false)}>
            OK
          </button>
        </div>
      )}
      {viewfinder && !file && (
        <CameraView
          onShutter={shutter}
          onPhoto={took}
          onClose={() => setViewfinder(false)}
          suspended={away}
        >
          <FileInput
            camera
            label="Camera app"
            icon="📱"
            onOpen={leaving}
            onPick={(photo) => picked(photo, CAMERA_APP)}
          />
          <FileInput label="Gallery" icon="🖼" onOpen={leaving} onPick={picked} />
        </CameraView>
      )}
      {file ? (
        <CaptureSheet
          file={file}
          camera={capture?.camera}
          homeId={homeId}
          getFigure={() => figureRef.current}
          where={where}
          api={api}
          onNudge={onNudge}
          onLook={walk.lookBy}
          getSensors={() => capture!.sensors}
          request={request}
          onSaved={() => {
            // An answered request is no longer the one to answer next.
            choose(undefined);
            setDraft(undefined);
            onSaved?.();
          }}
          draft={draft}
          onDraft={setDraft}
          onClose={() => {
            setCapture(undefined);
            setDraft(undefined);
          }}
        />
      ) : (
        <div className="walk-controls">
          <Joystick onChange={onPad} />
          {/* Sensor mode: the phone tilts the view, so there is nothing to tilt by hand. */}
          {!sensorMode && (
            <div className="walk-tilt" role="group" aria-label="Look up and down">
              <button type="button" aria-label="Look up" onClick={() => onLook(0, TILT_STEP)}>
                ▲
              </button>
              <button type="button" aria-label="Look down" onClick={() => onLook(0, -TILT_STEP)}>
                ▼
              </button>
            </div>
          )}
          {inPage ? (
            <button
              type="button"
              className="shutter"
              title="Take a photo here"
              aria-label="Take photo"
              onClick={() => setViewfinder(true)}
            >
              <Shutter />
            </button>
          ) : (
            <FileInput
              shutter
              camera
              label="Take photo"
              icon="📷"
              onOpen={leaving}
              onPick={(photo) => picked(photo, CAMERA_APP)}
            />
          )}
        </div>
      )}
    </div>
  );
}

interface FileInputProps {
  /** Opens the phone's camera app; otherwise its gallery or files. */
  camera?: boolean;
  /** The round shutter of the walk controls, with only the icon showing. */
  shutter?: boolean;
  label: string;
  icon: string;
  /** Tapped: the moment of the photo, and the page goes to the background. */
  onOpen(): void;
  /** What came back, if anything. */
  onPick(photo: File | undefined): void;
}

/** A file input styled as a button: the shutter (camera, icon only) or a labelled one. */
function FileInput({
  camera = false,
  shutter = false,
  label,
  icon,
  onOpen,
  onPick,
}: FileInputProps) {
  // Closing the picker without a photo fires `cancel` (no React prop for it on an input).
  const input = useRef<HTMLInputElement>(null);
  const cancelled = useRef(onPick);
  useEffect(() => {
    cancelled.current = onPick;
  });
  useEffect(() => {
    const element = input.current;
    if (!element) return;
    const cancel = () => cancelled.current(undefined);
    element.addEventListener('cancel', cancel);
    return () => element.removeEventListener('cancel', cancel);
  }, []);
  return (
    <label className={shutter ? 'shutter' : 'camera-alt'} title={label}>
      {shutter ? (
        <Shutter />
      ) : (
        <>
          <span aria-hidden="true">{icon}</span>
          <span>{label}</span>
        </>
      )}
      <input
        ref={input}
        aria-label={label}
        type="file"
        accept="image/*"
        {...(camera && { capture: 'environment' })}
        onClick={onOpen}
        onChange={(e) => {
          onPick(e.target.files?.[0]);
          // The same photo can be picked again after a discard.
          e.target.value = '';
        }}
      />
    </label>
  );
}

/** `<sakuga-shutter>`: the shutter's look and beats, inside the page's own label or button (HUD v2 #202). */
function Shutter() {
  return createElement('sakuga-shutter', { 'aria-hidden': 'true' });
}
