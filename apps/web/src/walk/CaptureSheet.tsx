import type { Photo, PhotoRequest, PhotoSensors } from '@my-home/shared';
import { useEffect, useRef, useState } from 'react';
import type { PhotosApi } from '../api';
import { SakugaProgress } from '../loading/SakugaProgress';
import { poseOf, type Figure } from './figure';
import { prepareImage, takenAtOf, type CameraHints, type PreparedImage } from './prepareImage';
import { SkButton } from '../hud/SkButton';
import { SkCheckbox } from '../hud/SkCheckbox';
import { SkField } from '../hud/SkField';
import { PHOTO_TAGS } from '../photos/tags';

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
  /** What the camera inside the page knew about it (size, zoom), for its field of view. */
  camera?: CameraHints | undefined;
  homeId: string;
  /** Read at the moment of saving, so the figure can still be moved while the sheet is open. */
  getFigure(): Figure;
  /** "Kitchen · Souterrain", for the current figure. */
  where: string;
  api: Pick<PhotosApi, 'upload' | 'update'>;
  onNudge(forward: number, right: number): void;
  onLook(dYaw: number, dPitch: number): void;
  /** What the phone's sensors say at the moment of saving (or that the view was set by hand). */
  getSensors?(): PhotoSensors;
  /** The open photo request this photo would answer, if the figure is at one. */
  request?: PhotoRequest | undefined;
  /** Called after the photo, or a correction of its pose, was stored. */
  onSaved?(): void;
  /** Note and tags to start from, kept from before a reload. */
  draft?: { note: string; tags: string[] } | undefined;
  /** Called as the note or the tags change, so they can be kept. */
  onDraft?(draft: { note: string; tags: string[] }): void;
  onClose(): void;
}

/**
 * Shown after the camera returns a photo: a preview, a note, tags and fine controls for the
 * figure's pose. Saving uploads the photo with the pose of the figure **at that moment**;
 * afterwards the pose of the saved photo can still be corrected.
 */
export function CaptureSheet({
  file,
  camera,
  homeId,
  getFigure,
  where,
  api,
  onNudge,
  onLook,
  getSensors,
  request,
  onSaved,
  draft,
  onDraft,
  onClose,
}: Props) {
  const [phase, setPhase] = useState<Phase>({ step: 'compose' });
  const [answers, setAnswers] = useState(true);
  const [note, setNoteState] = useState(draft?.note ?? '');
  const [tags, setTagsState] = useState<string[]>(draft?.tags ?? []);
  const setNote = (value: string) => {
    setNoteState(value);
    onDraft?.({ note: value, tags });
  };
  const setTags = (value: string[]) => {
    setTagsState(value);
    onDraft?.({ note, tags: value });
  };
  // The preview URL lives exactly as long as the effect, so it is never used after being revoked.
  // The same URL lets the owner keep a copy on the phone when the upload fails.
  const preview = useRef<HTMLImageElement>(null);
  const copy = useRef<HTMLAnchorElement>(null);
  useEffect(() => {
    const url = URL.createObjectURL(file);
    if (preview.current) preview.current.src = url;
    if (copy.current) copy.current.href = url;
    return () => URL.revokeObjectURL(url);
  }, [file]);
  // Resizing starts right away, so it is usually done when Save is pressed.
  const prepared = useRef<Promise<PreparedImage> | undefined>(undefined);
  prepared.current ??= prepareImage(file, camera);

  // The upload's bar stays once the photo is saved, until it has played its end.
  const [barShown, setBarShown] = useState(false);
  const save = async () => {
    setBarShown(true);
    setPhase({ step: 'uploading', progress: 0 });
    try {
      const image = await prepared.current!;
      const figure = getFigure();
      const photo = await api.upload(
        homeId,
        {
          levelId: figure.levelId ?? null,
          pose: poseOf(figure, image.fovH),
          takenAt: takenAtOf(file),
          note,
          tags,
          ...(getSensors && { sensors: getSensors() }),
          ...(request && answers && { requestId: request.id }),
        },
        image.blob,
        (progress) => setPhase({ step: 'uploading', progress }),
      );
      setPhase({ step: 'saved', photo });
      onSaved?.();
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
      onSaved?.();
    } catch {
      setPhase({ step: 'saved', photo, adjusted: 'failed' });
    }
  };

  const busy = phase.step === 'uploading';
  const nudges = (
    <div className="nudges" role="group" aria-label="Adjust the pose">
      <SkButton
        size="compact"
        variant="secondary"
        onClick={() => onLook(NUDGE_ANGLE, 0)}
        aria-label="Turn left"
      >
        ⟲
      </SkButton>
      <SkButton
        size="compact"
        variant="secondary"
        onClick={() => onNudge(NUDGE_DISTANCE, 0)}
        aria-label="Forward"
      >
        ↑
      </SkButton>
      <SkButton
        size="compact"
        variant="secondary"
        onClick={() => onLook(-NUDGE_ANGLE, 0)}
        aria-label="Turn right"
      >
        ⟳
      </SkButton>
      <SkButton
        size="compact"
        variant="secondary"
        onClick={() => onLook(0, NUDGE_ANGLE)}
        aria-label="Look up"
      >
        ⤒
      </SkButton>
      <SkButton
        size="compact"
        variant="secondary"
        onClick={() => onNudge(0, -NUDGE_DISTANCE)}
        aria-label="Left"
      >
        ←
      </SkButton>
      <SkButton
        size="compact"
        variant="secondary"
        onClick={() => onNudge(-NUDGE_DISTANCE, 0)}
        aria-label="Back"
      >
        ↓
      </SkButton>
      <SkButton
        size="compact"
        variant="secondary"
        onClick={() => onNudge(0, NUDGE_DISTANCE)}
        aria-label="Right"
      >
        →
      </SkButton>
      <SkButton
        size="compact"
        variant="secondary"
        onClick={() => onLook(0, -NUDGE_ANGLE)}
        aria-label="Look down"
      >
        ⤓
      </SkButton>
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

      {(phase.step === 'uploading' || (phase.step === 'saved' && barShown)) && (
        <div className="capture-progress">
          <SakugaProgress
            // Every byte sent is not saved yet: the bar is full when the api has answered.
            value={phase.step === 'uploading' ? Math.min(phase.progress, 0.99) : 1}
            label="Upload progress"
            onEnd={() => setBarShown(false)}
          />
        </div>
      )}

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
            <SkButton
              size="compact"
              variant="secondary"
              onClick={() => void updatePose(phase.photo)}
              disabled={phase.adjusted === 'saving'}
            >
              Update pose
            </SkButton>
            <SkButton size="compact" onClick={onClose}>
              Done
            </SkButton>
          </div>
        </>
      ) : (
        <>
          <label className="capture-note">
            Note
            <SkField size="compact">
              <textarea
                value={note}
                maxLength={2000}
                rows={2}
                placeholder="What does it show?"
                disabled={busy}
                onChange={(e) => setNote(e.target.value)}
              />
            </SkField>
          </label>
          <div className="capture-tags" role="group" aria-label="Tags">
            {PHOTO_TAGS.map((tag) => (
              <SkCheckbox
                key={tag}
                className="chip"
                size="compact"
                checked={tags.includes(tag)}
                disabled={busy}
                onChange={() =>
                  setTags(tags.includes(tag) ? tags.filter((t) => t !== tag) : [...tags, tag])
                }
              >
                {tag}
              </SkCheckbox>
            ))}
          </div>
          {request && (
            <SkCheckbox
              className="capture-request"
              size="compact"
              checked={answers}
              disabled={busy}
              onChange={() => setAnswers(!answers)}
            >
              Answers the request: <em>{request.reason}</em>
            </SkCheckbox>
          )}
          <p className="hint">The photo is saved at the figure's position and view. Adjust:</p>
          {nudges}
          {phase.step === 'failed' && (
            <p role="alert" className="error">
              Upload failed: {phase.message}. The photo stays here: try again, or save a copy on the
              phone first.
            </p>
          )}
          {/* Always rendered, so the effect above can give it the photo's URL. */}
          <a
            ref={copy}
            className="capture-copy"
            download={`photo-${takenAtOf(file).replace(/[:.]/g, '-')}.jpg`}
            hidden={phase.step !== 'failed'}
          >
            Save a copy on the phone
          </a>
          <div className="capture-actions">
            <SkButton size="compact" variant="secondary" onClick={onClose} disabled={busy}>
              Discard
            </SkButton>
            <SkButton size="compact" onClick={() => void save()} disabled={busy}>
              {phase.step === 'failed' ? 'Try again' : busy ? 'Saving…' : 'Save photo'}
            </SkButton>
          </div>
        </>
      )}
    </section>
  );
}
