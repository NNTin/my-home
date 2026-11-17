import type { PhotoRequest, PhotoSensors } from '@my-home/shared';
import { useEffect, useRef, useState, type PointerEvent } from 'react';
import type { PhotosApi } from '../api';
import { activeRequest, openRequests } from '../photos/requests';
import { CameraView, hasInPageCamera } from './CameraView';
import { CaptureSheet } from './CaptureSheet';
import type { Figure } from './figure';
import { Joystick } from './Joystick';
import type { CalibrationTarget } from './calibration';
import { accuracyLabel } from './orientation';
import { compassStatusText, useCompass } from './useCompass';
import { useFigure, type Walk } from './useWalk';
import { saveWalkSession, type WalkSession } from './walkSession';
import { yawTowards } from './world';

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
  /** What a walk saved before the page was reloaded brings back (see `walkSession`). */
  restored?: Pick<WalkSession, 'heading' | 'tilt' | 'draft'> & {
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
  const [capture, setCapture] = useState<{ file: Blob; sensors: PhotoSensors }>();
  const tap = useRef<{ figure: Figure; sensors: PhotoSensors } | undefined>(undefined);
  const file = capture?.file;
  const compass = useCompass({
    northBearing,
    declination,
    setFollow: walk.setFollow,
    getFigure: () => figureRef.current,
    // The view stays where it was at the tap; the sheet's arrows adjust it from there.
    held: capture !== undefined,
  });
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
  const heading = compass.heading !== 'off';
  const tilting = compass.tilt !== 'off';
  const keep = useRef(() => {});
  useEffect(() => {
    keep.current = () =>
      saveWalkSession({
        homeId,
        view,
        figure: figureRef.current,
        heading,
        tilt: tilting,
        ...kept.current,
      });
    keep.current();
  }, [homeId, view, heading, tilting, figureRef]);
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
  // The sensor modes come back where the browser needs no tap to allow them (Android); iOS asks
  // again from the buttons.
  const resumed = useRef(false);
  useEffect(() => {
    if (resumed.current || !restored || !compass.supported) return;
    resumed.current = true;
    const ask = (DeviceOrientationEvent as unknown as { requestPermission?: unknown })
      .requestPermission;
    if (typeof ask === 'function') return;
    if (restored.heading) compass.toggleHeading();
    if (restored.tilt) compass.toggleTilt();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const cameraOpen = viewfinder || away;
  useEffect(() => {
    onCamera?.(cameraOpen);
  }, [cameraOpen, onCamera]);
  useEffect(() => () => onCamera?.(false), [onCamera]);
  // Back from the camera app with the page still alive: whatever it hands back (or not) arrives
  // in this page, so nothing is lost any more.
  // Only a return counts: the page must have been left (hidden, or the focus lost) first.
  useEffect(() => {
    if (!away) return;
    let left = false;
    const leave = () => {
      if (document.visibilityState === 'hidden' || !document.hasFocus()) left = true;
    };
    const back = () => {
      if (!left || document.visibilityState === 'hidden') return;
      delete kept.current.pending;
      keep.current();
      setAway(false);
    };
    const change = () => (document.visibilityState === 'hidden' ? leave() : back());
    document.addEventListener('visibilitychange', change);
    window.addEventListener('blur', leave);
    window.addEventListener('focus', back);
    return () => {
      document.removeEventListener('visibilitychange', change);
      window.removeEventListener('blur', leave);
      window.removeEventListener('focus', back);
    };
  }, [away]);

  /** The moment of the photo: the figure and what the sensors say now. */
  const shutter = () => {
    tap.current = { figure: figureRef.current, sensors: compass.snapshot() };
  };
  const took = (photo: Blob) => {
    const taken = tap.current;
    // Back to the pose of the tap, whatever the phone did in between.
    if (taken) walk.place(taken.figure);
    setCapture({ file: photo, sensors: taken?.sensors ?? compass.snapshot() });
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
  const picked = (photo: Blob | undefined) => {
    if (photo) took(photo);
    tap.current = undefined;
    setAway(false);
  };
  const [calibrating, setCalibrating] = useState(false);
  const [declinationText, setDeclinationText] = useState(String(declination));
  const [declinationSaved, setDeclinationSaved] = useState<'saving' | 'saved' | 'failed'>();
  const [declinationSource, setDeclinationSource] = useState<DeclinationSource>('geodata');
  /** The compass turns the figure / the phone's tilt sets the pitch, right now. */
  const following = compass.heading === 'on';
  const tiltFollowing = compass.tilt === 'on';
  /**
   * Turning the view by hand. While the compass turns the figure, a sideways turn is a
   * correction of the compass (the calibration offset) instead of being undone by the next
   * sensor event. While the phone's tilt sets the pitch, looking up or down by hand is off.
   * Whatever the sensors do not drive stays in the owner's hands.
   */
  const onLook = (dYaw: number, dPitch: number) => {
    // A turn to the left (positive yaw) is a smaller bearing.
    if (following) compass.adjustCalibration((-dYaw * 180) / Math.PI);
    walk.lookBy(following ? 0 : dYaw, tiltFollowing ? 0 : dPitch);
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
    >
      {view === 'first' && (
        <div
          ref={lookLayer}
          className="walk-look"
          aria-label={following ? 'Drag sideways to correct the compass' : 'Drag to look around'}
          onPointerDown={(e) => {
            if (drag.current) return;
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
        {compass.supported && (
          <>
            <button
              type="button"
              aria-pressed={compass.heading !== 'off'}
              title="Turn with the phone: its compass sets the heading"
              onClick={compass.toggleHeading}
            >
              🧭 Heading {compass.heading !== 'off' ? 'on' : 'off'}
            </button>
            <button
              type="button"
              aria-pressed={compass.tilt !== 'off'}
              title="Tilt with the phone: tilting it up and down tilts the view"
              onClick={compass.toggleTilt}
            >
              ↕ Tilt {compass.tilt !== 'off' ? 'on' : 'off'}
            </button>
          </>
        )}
        <span className="walk-compass" role="status" aria-label="View tilt">
          {pitchDegrees > 0 ? '▲' : pitchDegrees < 0 ? '▼' : '◆'} {Math.abs(pitchDegrees)}°
        </span>
        {compass.heading !== 'off' && (
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
        <span className="walk-keys">W A S D / arrows walk · Q E turn · drag to look</span>
      </div>
      {compass.heading !== 'off' && calibrating && !file && (
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
            Point the phone at one of these and tap it, or drag the view sideways until it matches
            what you see.
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
          <FileInput camera label="Camera app" icon="📱" onOpen={leaving} onPick={picked} />
          <FileInput label="Gallery" icon="🖼" onOpen={leaving} onPick={picked} />
        </CameraView>
      )}
      {file ? (
        <CaptureSheet
          file={file}
          homeId={homeId}
          getFigure={() => figureRef.current}
          where={where}
          api={api}
          onNudge={onNudge}
          onLook={onLook}
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
          <div className="walk-tilt" role="group" aria-label="Look up and down">
            <button
              type="button"
              aria-label="Look up"
              disabled={tiltFollowing}
              onClick={() => onLook(0, TILT_STEP)}
            >
              ▲
            </button>
            <button
              type="button"
              aria-label="Look down"
              disabled={tiltFollowing}
              onClick={() => onLook(0, -TILT_STEP)}
            >
              ▼
            </button>
          </div>
          {inPage ? (
            <button
              type="button"
              className="shutter"
              title="Take a photo here"
              aria-label="Take photo"
              onClick={() => setViewfinder(true)}
            >
              <span aria-hidden="true">📷</span>
            </button>
          ) : (
            <FileInput
              shutter
              camera
              label="Take photo"
              icon="📷"
              onOpen={leaving}
              onPick={picked}
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
  return (
    <label className={shutter ? 'shutter' : 'camera-alt'} title={label}>
      <span aria-hidden="true">{icon}</span>
      {!shutter && <span>{label}</span>}
      <input
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
