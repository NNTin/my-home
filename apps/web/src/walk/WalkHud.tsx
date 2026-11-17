import type { PhotoRequest, PhotoSensors } from '@my-home/shared';
import { useEffect, useRef, useState, type PointerEvent } from 'react';
import type { PhotosApi } from '../api';
import { activeRequest, openRequests } from '../photos/requests';
import { CaptureSheet } from './CaptureSheet';
import type { Figure } from './figure';
import { Joystick } from './Joystick';
import type { CalibrationTarget } from './calibration';
import { accuracyLabel } from './orientation';
import { compassStatusText, useCompass } from './useCompass';
import { useFigure, type Walk } from './useWalk';
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
}

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
  const [calibrating, setCalibrating] = useState(false);
  const [declinationText, setDeclinationText] = useState(String(declination));
  const [declinationSaved, setDeclinationSaved] = useState<'saving' | 'saved' | 'failed'>();
  const [declinationSource, setDeclinationSource] = useState<DeclinationSource>('geodata');
  /** The compass turns the figure / the phone's tilt sets the pitch, right now. */
  const following = compass.heading === 'on';
  const tilting = compass.tilt === 'on';
  /**
   * Turning the view by hand. While the compass turns the figure, a sideways turn is a
   * correction of the compass (the calibration offset) instead of being undone by the next
   * sensor event. While the phone's tilt sets the pitch, looking up or down by hand is off.
   * Whatever the sensors do not drive stays in the owner's hands.
   */
  const onLook = (dYaw: number, dPitch: number) => {
    // A turn to the left (positive yaw) is a smaller bearing.
    if (following) compass.adjustCalibration((-dYaw * 180) / Math.PI);
    walk.lookBy(following ? 0 : dYaw, tilting ? 0 : dPitch);
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
              {following ? accuracy.text : compass.heading === 'paused' ? 'paused' : '…'}
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
          <p>
            <strong>Offset {offset}</strong>{' '}
            <button
              type="button"
              onClick={compass.resetCalibration}
              disabled={compass.calibration === 0}
            >
              Reset
            </button>
          </p>
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
          <div className="capture-actions">
            <button type="button" className="primary" onClick={() => setCalibrating(false)}>
              Done
            </button>
          </div>
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
            onSaved?.();
          }}
          onClose={() => setCapture(undefined)}
        />
      ) : (
        <div className="walk-controls">
          <Joystick onChange={onPad} />
          <div className="walk-tilt" role="group" aria-label="Look up and down">
            <button
              type="button"
              aria-label="Look up"
              disabled={tilting}
              onClick={() => onLook(0, TILT_STEP)}
            >
              ▲
            </button>
            <button
              type="button"
              aria-label="Look down"
              disabled={tilting}
              onClick={() => onLook(0, -TILT_STEP)}
            >
              ▼
            </button>
          </div>
          <label className="shutter" title="Take a photo here">
            <span aria-hidden="true">📷</span>
            <input
              aria-label="Take photo"
              type="file"
              accept="image/*"
              capture="environment"
              onClick={() => {
                // The tap on the shutter is the moment of the photo: the camera app that opens
                // next hides the page, and the phone moves on.
                tap.current = { figure: figureRef.current, sensors: compass.snapshot() };
              }}
              onChange={(e) => {
                const picked = e.target.files?.[0];
                if (picked) {
                  const taken = tap.current;
                  // Back to the pose of the tap, whatever the phone did in between.
                  if (taken) walk.place(taken.figure);
                  setCapture({ file: picked, sensors: taken?.sensors ?? compass.snapshot() });
                }
                tap.current = undefined;
                // The same photo can be picked again after a discard.
                e.target.value = '';
              }}
            />
          </label>
        </div>
      )}
    </div>
  );
}
