import type { HomeScene } from '../builder/buildHome';
import type { Visibility } from '../builder/visibility';
import { HudIcon } from '../hud/HudIcon';
import { SkButton } from '../hud/SkButton';
import { LevelControl } from './LevelControl';

interface Props {
  scene: HomeScene;
  visibility: Visibility;
  onChange(visibility: Visibility): void;
  onWalk(): void;
  levelOpen: boolean;
  onLevelToggle(): void;
  onLevelDismiss(): void;
  tone: 'dark' | 'light';
}

/**
 * The phone's top bar (HUD v2 #200): the mode, Walk and the cutaway level, near the top as on the desktop. The
 * home, the photos and the catalogue are in Tools, over the stage tools; the panels are the sheet's.
 */
export function TopBar({
  scene,
  visibility,
  onChange,
  onWalk,
  levelOpen,
  onLevelToggle,
  onLevelDismiss,
  tone,
}: Props) {
  return (
    <div className="topbar" role="toolbar" aria-label="Mode and level">
      <div className="topbar-row">
        <span className="hud-mode">Orbit</span>
        {/* Walk is the primary (ドン) compact button (docs/design/hud.md §4.1). */}
        <SkButton
          className="hud-walk"
          size="compact"
          appearance="clear"
          tone={tone}
          aria-label="Walk and take photos"
          onClick={onWalk}
        >
          <HudIcon name="walk" /> Walk
        </SkButton>
      </div>
      <LevelControl
        scene={scene}
        visibility={visibility}
        onChange={onChange}
        open={levelOpen}
        onToggle={onLevelToggle}
        onDismiss={onLevelDismiss}
        tone={tone}
      />
    </div>
  );
}
