import type { Photo } from '@my-home/shared';
import { useEffect, useRef, useState } from 'react';
import type { PhotosApi } from '../api';
import { poseOf, type Figure } from './figure';
import { prepareImage, type PreparedImage } from './prepareImage';

/** Suggested tags; the api stores any short lower-case label. */
export const PHOTO_TAGS = ['wall', 'window', 'door', 'floor', 'ceiling', 'furniture', 'outside'];

/** One tap of a nudge button: 10 cm, or 5° of turning or tilting. */
export const NUDGE_DISTANCE = 0.1;
export const NUDGE_ANGLE = (5 * Math.PI) / 180;

type Phase =
  | { step: 'compose' }
  | { step: 'uploading'; progress: number }
  | { step: 'failed'; message: string }
  | { step: 'saved'; photo: Photo; adjusted?: 'saving' | 'saved' | 'failed' };

interface Props {
  /** The photo the camera just took. */
  file: Blob;
  homeId: string;
  /** Read at the moment of saving, so the figure can still be moved while the sheet is open. */
  getFigure(): Figure;
  /** "Kitchen · Souterrain", for the current figure. */
  where: string;
  api: Pick<PhotosApi, 'upload' | 'update'>;
  onNudge(forward: number, right: number): void;
  onLook(dYaw: number, dPitch: number): void;
  onClose(): void;
}

/**
 * Shown after the camera returns a photo: a preview, a note, tags and fine controls for the
 * figure's pose. Saving uploads the photo with the pose of the figure **at that moment**;
 * afterwards the pose of the saved photo can still be corrected.
 */
export function CaptureSheet({
  file,
  homeId,
  getFigure,
  where,
  api,
  onNudge,
  onLook,
  onClose,
}: Props) {
  const [phase, setPhase] = useState<Phase>({ step: 'compose' });
  const [note, setNote] = useState('');
  const [tags, setTags] = useState<string[]>([]);
  // The preview URL lives exactly as long as the effect, so it is never used after being revoked.
  const preview = useRef<HTMLImageElement>(null);
  useEffect(() => {
    const url = URL.createObjectURL(file);
    if (preview.current) preview.current.src = url;
    return () => URL.revokeObjectURL(url);
  }, [file]);
  // Resizing starts right away, so it is usually done when Save is pressed.
  const prepared = useRef<Promise<PreparedImage> | undefined>(undefined);
  prepared.current ??= prepareImage(file);

  const save = async () => {
    setPhase({ step: 'uploading', progress: 0 });
    try {
      const image = await prepared.current!;
      const figure = getFigure();
      const photo = await api.upload(
        homeId,
        {
          levelId: figure.levelId ?? null,
          pose: poseOf(figure, image.fovH),
          takenAt: new Date().toISOString(),
          note,
          tags,
        },
        image.blob,
        (progress) => setPhase({ step: 'uploading', progress }),
      );
      setPhase({ step: 'saved', photo });
    } catch (err) {
      setPhase({ step: 'failed', message: (err as Error).message });
    }
  };

  const updatePose = async (photo: Photo) => {
    setPhase({ step: 'saved', photo, adjusted: 'saving' });
    try {
      const figure = getFigure();
      const updated = await api.update(photo.id, {
        levelId: figure.levelId ?? null,
        pose: poseOf(figure, photo.pose.fovH),
      });
      setPhase({ step: 'saved', photo: updated, adjusted: 'saved' });
    } catch {
      setPhase({ step: 'saved', photo, adjusted: 'failed' });
    }
  };

  const busy = phase.step === 'uploading';
  const nudges = (
    <div className="nudges" role="group" aria-label="Adjust the pose">
      <button type="button" onClick={() => onLook(NUDGE_ANGLE, 0)} aria-label="Turn left">
        ⟲
      </button>
      <button type="button" onClick={() => onNudge(NUDGE_DISTANCE, 0)} aria-label="Forward">
        ↑
      </button>
      <button type="button" onClick={() => onLook(-NUDGE_ANGLE, 0)} aria-label="Turn right">
        ⟳
      </button>
      <button type="button" onClick={() => onLook(0, NUDGE_ANGLE)} aria-label="Look up">
        ⤒
      </button>
      <button type="button" onClick={() => onNudge(0, -NUDGE_DISTANCE)} aria-label="Left">
        ←
      </button>
      <button type="button" onClick={() => onNudge(-NUDGE_DISTANCE, 0)} aria-label="Back">
        ↓
      </button>
      <button type="button" onClick={() => onNudge(0, NUDGE_DISTANCE)} aria-label="Right">
        →
      </button>
      <button type="button" onClick={() => onLook(0, -NUDGE_ANGLE)} aria-label="Look down">
        ⤓
      </button>
    </div>
  );

  return (
    <section className="capture-sheet" aria-label="New photo">
      <div className="capture-head">
        <img ref={preview} alt="The photo just taken" />
        <div>
          <strong>{phase.step === 'saved' ? 'Photo saved' : 'New photo'}</strong>
          <p className="where">
            {phase.step === 'saved'
              ? (phase.photo.capturedRoomName ?? phase.photo.room?.name ?? 'No room')
              : where}
          </p>
        </div>
      </div>

      {phase.step === 'saved' ? (
        <>
          <p className="hint">
            Not quite where you stood? Move the figure, then update the pose of this photo.
          </p>
          {nudges}
          <p role="status" className="hint">
            {phase.adjusted === 'saving' && 'Updating the pose…'}
            {phase.adjusted === 'saved' && 'Pose updated.'}
            {phase.adjusted === 'failed' && 'Could not update the pose. Try again.'}
          </p>
          <div className="capture-actions">
            <button
              type="button"
              onClick={() => void updatePose(phase.photo)}
              disabled={phase.adjusted === 'saving'}
            >
              Update pose
            </button>
            <button type="button" className="primary" onClick={onClose}>
              Done
            </button>
          </div>
        </>
      ) : (
        <>
          <label className="capture-note">
            Note
            <textarea
              value={note}
              maxLength={2000}
              rows={2}
              placeholder="What does it show?"
              disabled={busy}
              onChange={(e) => setNote(e.target.value)}
            />
          </label>
          <div className="capture-tags" role="group" aria-label="Tags">
            {PHOTO_TAGS.map((tag) => (
              <label key={tag} className={tags.includes(tag) ? 'chip on' : 'chip'}>
                <input
                  type="checkbox"
                  checked={tags.includes(tag)}
                  disabled={busy}
                  onChange={() =>
                    setTags(tags.includes(tag) ? tags.filter((t) => t !== tag) : [...tags, tag])
                  }
                />
                {tag}
              </label>
            ))}
          </div>
          <p className="hint">The photo is saved at the figure's position and view. Adjust:</p>
          {nudges}
          {phase.step === 'uploading' && (
            <div className="capture-progress">
              <progress max={1} value={phase.progress} aria-label="Upload progress" />
              <span>{Math.round(phase.progress * 100)}%</span>
            </div>
          )}
          {phase.step === 'failed' && (
            <p role="alert" className="error">
              Upload failed: {phase.message}
            </p>
          )}
          <div className="capture-actions">
            <button type="button" onClick={onClose} disabled={busy}>
              Discard
            </button>
            <button type="button" className="primary" onClick={() => void save()} disabled={busy}>
              {phase.step === 'failed' ? 'Try again' : busy ? 'Saving…' : 'Save photo'}
            </button>
          </div>
        </>
      )}
    </section>
  );
}
