import { HudIcon } from '../hud/HudIcon';
import { SkButton } from '../hud/SkButton';

/**
 * The selection's short edge label (HUD v2 #201, docs/design/hud-v2/layers.md § Contextual): its name at the lower
 * left, away from the selection, a clear control on the scene. It opens and closes the inspector.
 */
export function SelectionLabel({
  name,
  open,
  onToggle,
  tone,
}: {
  name: string;
  /** The inspector is open. */
  open: boolean;
  onToggle(): void;
  tone: 'dark' | 'light';
}) {
  return (
    <div className="hud-corner hud-bottom-left">
      <SkButton
        className="selection-label"
        size="compact"
        appearance="clear"
        backing
        tone={tone}
        pressed={open}
        aria-label={`${name}: details`}
        onClick={onToggle}
      >
        {name} <HudIcon name="chevron-right" />
      </SkButton>
    </div>
  );
}
