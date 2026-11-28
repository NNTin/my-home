import { useState, type ReactNode } from 'react';
import { EditToggle } from '../editMode/EditToggle';
import { HudIcon } from '../hud/HudIcon';
import { SkBadge } from '../hud/SkBadge';
import { SkButton } from '../hud/SkButton';
import { SkIconButton } from '../hud/SkIconButton';
import type { SyncStatus as SaveStatus } from '../placements/sync';

/** What is going on, in a few words, for when no panel is open to say it. */
export interface StageStatus {
  /** The furniture is still loading. */
  loading: boolean;
  save: SaveStatus;
  /** Whether the furniture was edited since it was loaded: only then is "Saved" worth saying. */
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
 * What floats at the foot of the phone's 3D view, within thumb reach: Edit, Tools (its menu above them),
 * "Reset view", and a small status badge for loading and saving, which the panels report only while they are open.
 */
export function StageTools({
  status,
  onResetView,
  toolsOpen,
  onTools,
  tools,
  tone,
}: {
  status: StageStatus;
  /** Undefined while the camera is not the orbit camera ("view from here"). */
  onResetView: (() => void) | undefined;
  /** Tools (HUD v2 #200): the home, the photos and the catalogue, in a menu over the stage tools. */
  toolsOpen: boolean;
  onTools(): void;
  tools: ReactNode;
  tone: 'dark' | 'light';
}) {
  return (
    <div className="stage-tools">
      {/* Edit, here and not in the top bar: its splash rises over the view (§5.13). */}
      <EditToggle className="stage-edit" />
      <SkIconButton
        className="hud-tools"
        size="compact"
        icon="tools"
        appearance="clear"
        tone={tone}
        label="Tools"
        pressed={toolsOpen}
        onClick={onTools}
      />
      {onResetView && (
        <SkButton
          size="compact"
          variant="secondary"
          appearance="clear"
          tone={tone}
          className="reset-view"
          onClick={onResetView}
        >
          <HudIcon name="reset" /> Reset view
        </SkButton>
      )}
      <StatusBadge status={status} />
      {toolsOpen && tools}
    </div>
  );
}

/**
 * The status chip: loading, saving and their problems, in words as well as in its look (§4.3). "Saved" draws its check
 * and leaves by shrinking after a while; a new status brings it back. On the phone's stage tools and at the desktop's
 * lower right (HUD v2 #203).
 */
export function StatusBadge({ status }: { status: StageStatus }) {
  const chip = stageStatusText(status);
  // The last words stay on the badge while it shrinks away (state adjusted while rendering, when they change).
  const [last, setLast] = useState(chip);
  if (chip && (chip.text !== last?.text || chip.warn !== last?.warn)) setLast(chip);
  const shown = chip ?? last;
  return (
    <SkBadge
      className="status-chip"
      role="status"
      aria-label="Status"
      shown={!!chip}
      kind={shown?.warn ? 'warn' : undefined}
      done={chip?.text === 'Saved'}
      duration={chip?.text === 'Saved' ? 2.5 : undefined}
    >
      {shown?.text}
    </SkBadge>
  );
}
