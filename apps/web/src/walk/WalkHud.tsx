import type { PhotoRequest } from '@my-home/shared';
import { useRef, useState, type PointerEvent } from 'react';
import type { PhotosApi } from '../api';
import { activeRequest, openRequests } from '../photos/requests';
import { CaptureSheet } from './CaptureSheet';
import type { Figure } from './figure';
import { Joystick } from './Joystick';
import type { CompassState } from './useCompass';
import { useFigure, type Walk } from './useWalk';

export type WalkView = 'first' | 'third';

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
  compass: CompassState;
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
  compass,
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
  const { setPad: onPad, lookBy: onLook, nudge: onNudge, figureRef } = walk;
  const [file, setFile] = useState<Blob>();
  const drag = useRef<{ id: number; x: number; y: number } | undefined>(undefined);
  const where = describe(figure) || 'Outside';

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
      data-level={figure.levelId ?? ''}
    >
      {view === 'first' && (
        <div
          className="walk-look"
          aria-label="Drag to look around"
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
          <button
            type="button"
            aria-pressed={compass.active}
            title="Turn the figure with the phone's compass"
            onClick={compass.toggle}
          >
            🧭 {compass.active ? 'On' : 'Off'}
          </button>
        )}
        {open.length > 0 && (
          <button type="button" aria-expanded={listed} onClick={() => setListed(!listed)}>
            Requests ({open.length})
          </button>
        )}
        <span className="walk-keys">W A S D / arrows walk · Q E turn · drag to look</span>
      </div>
      {compass.error && (
        <p className="walk-notice" role="alert">
          {compass.error}
        </p>
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
          request={request}
          onSaved={() => {
            // An answered request is no longer the one to answer next.
            choose(undefined);
            onSaved?.();
          }}
          onClose={() => setFile(undefined)}
        />
      ) : (
        <div className="walk-controls">
          <Joystick onChange={onPad} />
          <label className="shutter" title="Take a photo here">
            <span aria-hidden="true">📷</span>
            <input
              aria-label="Take photo"
              type="file"
              accept="image/*"
              capture="environment"
              onChange={(e) => {
                const picked = e.target.files?.[0];
                if (picked) setFile(picked);
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
