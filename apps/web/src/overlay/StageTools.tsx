import type { SaveStatus } from '../layouts/saver';

/** What is going on, in a few words, for when no panel is open to say it. */
export interface StageStatus {
  /** The layouts are still loading. */
  loading: boolean;
  save: SaveStatus;
  /** Whether the layout was edited since it was opened: only then is "Saved" worth saying. */
  edited: boolean;
  /** An error of the photo gallery, if any. */
  photosError: string | undefined;
}

const saveText: Record<Exclude<SaveStatus, 'saved'>, string> = {
  pending: 'Saving…',
  saving: 'Saving…',
  offline: 'Offline: changes kept on this phone',
  rejected: 'Not saved: see Furniture',
  conflict: 'Changed elsewhere: see Furniture',
};

/** The text of the status chip, and whether it reports a problem; undefined when all is quiet. */
export function stageStatusText(status: StageStatus): { text: string; warn: boolean } | undefined {
  if (status.photosError) return { text: 'Photos: a problem, see the Photos tab', warn: true };
  if (status.loading) return { text: 'Loading furniture…', warn: false };
  if (status.save === 'saved') return status.edited ? { text: 'Saved', warn: false } : undefined;
  return {
    text: saveText[status.save],
    warn: status.save !== 'pending' && status.save !== 'saving',
  };
}

/**
 * What floats at the foot of the phone's 3D view: "Reset view", and a small status chip for
 * loading and saving, which the panels report only while they are open.
 */
export function StageTools({
  status,
  onResetView,
}: {
  status: StageStatus;
  /** Undefined while the camera is not the orbit camera ("view from here"). */
  onResetView: (() => void) | undefined;
}) {
  const chip = stageStatusText(status);
  return (
    <div className="stage-tools">
      {onResetView && (
        <button type="button" className="reset-view" onClick={onResetView}>
          <span aria-hidden="true">⟲</span> Reset view
        </button>
      )}
      <span
        // "Saved" fades out by itself; a new save shows it again.
        key={chip?.text}
        className={['status-chip', chip?.warn && 'warn', chip?.text === 'Saved' && 'fading']
          .filter(Boolean)
          .join(' ')}
        role="status"
        aria-label="Status"
        hidden={!chip}
      >
        {chip?.text}
      </span>
    </div>
  );
}
