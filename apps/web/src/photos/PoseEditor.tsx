import type { Photo, PhotoPose, PhotoPoseChange } from '@my-home/shared';
import { useEffect, useState } from 'react';
import { photosApi, type PhotosApi } from '../api';
import { fovHOf, headingDegrees } from './frustum';
import type { Photos } from './usePhotos';

/** Recorded with a correction made here, in the photo's pose history. */
export const GALLERY_REASON = 'corrected in the gallery against the model';

const toRadians = (degrees: number) => (degrees * Math.PI) / 180;
const toDegrees = (radians: number) => (radians * 180) / Math.PI;
const tenth = (value: number) => Math.round(value * 10) / 10;
/** Yaw for a heading in degrees clockwise from plan north (docs/photos.md § Pose conventions). */
const yawOf = (heading: number) => {
  const yaw = toRadians(-heading);
  return Math.atan2(Math.sin(yaw), Math.cos(yaw));
};
const headingOf = (yaw: number) => {
  const h = toDegrees(-yaw) % 360;
  return tenth(h < 0 ? h + 360 : h) % 360;
};

interface Values {
  heading: number;
  pitch: number;
  fov: number;
}

const valuesOf = (photo: Photo): Values => ({
  heading: headingOf(photo.pose.yaw),
  pitch: tenth(toDegrees(photo.pose.pitch)),
  fov: tenth(toDegrees(fovHOf(photo))),
});

const poseOf = (photo: Photo, v: Values): PhotoPose => ({
  position: photo.pose.position,
  yaw: yawOf(v.heading),
  pitch: toRadians(v.pitch),
  fovH: toRadians(v.fov),
});

const LIMITS = {
  heading: { min: 0, max: 359.9, step: 0.5, nudge: 1 },
  pitch: { min: -89, max: 89, step: 0.5, nudge: 1 },
  fov: { min: 20, max: 120, step: 0.5, nudge: 1 },
} as const;
const LABELS = { heading: 'Heading', pitch: 'Pitch', fov: 'Field of view' } as const;

const clamp = (key: keyof Values, value: number) => {
  if (key === 'heading') return tenth(((value % 360) + 360) % 360);
  return tenth(Math.min(LIMITS[key].max, Math.max(LIMITS[key].min, value)));
};

const describe = (pose: PhotoPose) =>
  `${headingDegrees(pose.yaw)}° · pitch ${Math.round(toDegrees(pose.pitch))}° · view ${
    pose.fovH === undefined ? '?' : Math.round(toDegrees(pose.fovH))
  }°`;
const when = (iso: string) =>
  new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
const who = (change: PhotoPoseChange) =>
  change.actor === 'agent' ? 'an agent' : change.actor === 'owner' ? 'you' : change.actor;

interface Props {
  photo: Photo;
  photos: Pick<Photos, 'update' | 'undoPose'>;
  /** The pose being tried, for the 3D view and the overlay; undefined when it is the stored one. */
  onDraft(pose: PhotoPose | undefined): void;
  api?: Pick<PhotosApi, 'poseHistory'>;
}

/**
 * Corrects a photo's heading, pitch and field of view while viewing from its pose with the photo
 * laid over the model: every change moves the 3D camera at once, Save stores it. Each saved
 * change goes into the photo's pose history with who made it and can be undone; the sensor
 * snapshot keeps what the phone measured.
 */
export function PoseEditor({ photo, photos, onDraft, api = photosApi }: Props) {
  const stored = valuesOf(photo);
  const storedKey = JSON.stringify(stored);
  const [values, setValues] = useState<Values>(stored);
  const [history, setHistory] = useState<PhotoPoseChange[]>();
  const [busy, setBusy] = useState(false);
  const changed = JSON.stringify(values) !== storedKey;

  // A reload of the photo (after Save or Undo) starts from what is stored now.
  const [shownKey, setShownKey] = useState(storedKey);
  if (shownKey !== storedKey) {
    setShownKey(storedKey);
    setValues(stored);
  }
  useEffect(() => {
    onDraft(changed ? poseOf(photo, values) : undefined);
    // `photo` only matters through `values` and its position, which a correction keeps.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [changed, values, onDraft]);
  useEffect(() => () => onDraft(undefined), [onDraft]);
  useEffect(() => {
    const controller = new AbortController();
    api.poseHistory(photo.id, controller.signal).then(
      (response) => setHistory(response.items),
      () => {
        if (!controller.signal.aborted) setHistory([]);
      },
    );
    return () => controller.abort();
  }, [api, photo.id, storedKey]);

  const set = (key: keyof Values, value: number) =>
    Number.isFinite(value) && setValues((v) => ({ ...v, [key]: clamp(key, value) }));
  const run = async (action: () => Promise<void>) => {
    setBusy(true);
    try {
      await action();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="pose-editor" role="group" aria-label="Correct the pose">
      <p className="note">
        Turn, tilt and widen the view until the model lines up with the photo, then save.
      </p>
      {(Object.keys(LIMITS) as (keyof Values)[]).map((key) => {
        const { min, max, step, nudge } = LIMITS[key];
        return (
          <div key={key} className="pose-field">
            <label className="field">
              {LABELS[key]}{' '}
              <input
                type="range"
                min={min}
                max={max}
                step={step}
                value={values[key]}
                onChange={(e) => set(key, Number(e.target.value))}
              />
            </label>
            <button
              type="button"
              aria-label={`${LABELS[key]} −${nudge}°`}
              onClick={() => set(key, values[key] - nudge)}
            >
              −
            </button>
            <input
              type="number"
              className="pose-value"
              aria-label={`${LABELS[key]} in degrees`}
              step={0.1}
              value={values[key]}
              onChange={(e) => set(key, Number(e.target.value))}
            />
            <button
              type="button"
              aria-label={`${LABELS[key]} +${nudge}°`}
              onClick={() => set(key, values[key] + nudge)}
            >
              +
            </button>
          </div>
        );
      })}
      <div className="buttons">
        <button
          type="button"
          disabled={!changed || busy}
          onClick={() =>
            void run(() =>
              photos.update(photo.id, { pose: poseOf(photo, values), poseReason: GALLERY_REASON }),
            )
          }
        >
          Save pose
        </button>
        <button type="button" disabled={!changed || busy} onClick={() => setValues(stored)}>
          Reset
        </button>
      </div>
      {history && history.length > 0 && (
        <ul className="pose-history" aria-label="Pose history">
          {history.map((change) => (
            <li key={change.id}>
              <span className="note">
                {when(change.at)} · {who(change)}
                {change.undoesId ? ' undid a change' : ''}: {describe(change.before)} →{' '}
                {describe(change.after)}
                {change.reason && ` (${change.reason})`}
              </span>{' '}
              {change.canUndo && (
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void run(() => photos.undoPose(photo.id, change.id))}
                >
                  Undo
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
