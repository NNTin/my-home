import type { HomeScene } from '../builder/buildHome';
import type { Visibility } from '../builder/visibility';
import { EditToggle } from '../editMode/EditToggle';
import { HudIcon } from '../hud/HudIcon';
import { SkButton } from '../hud/SkButton';
import { SkIconButton } from '../hud/SkIconButton';
import { LevelControl } from './LevelControl';

/** What the desktop's one shared surface shows (Photos is its own: the photos panel). */
export type Surface = 'views' | 'tools' | 'furniture';

/**
 * The desktop's resting HUD (HUD v2 #200, docs/design/hud-v2/layers.md § Primary): the mode, Walk and the level
 * at the upper left; Views, Edit and Tools at the lower right, clear controls on the scene. Only the controls take
 * input: the corners themselves pass drags, clicks and the wheel to the 3D view.
 */
export function HudCorners({
  scene,
  visibility,
  onChange,
  onWalk,
  surface,
  onSurface,
}: {
  scene: HomeScene;
  visibility: Visibility;
  onChange(visibility: Visibility): void;
  onWalk(): void;
  /** The open surface, if it is one of these. */
  surface: Surface | 'photos' | undefined;
  onSurface(surface: 'views' | 'tools'): void;
}) {
  return (
    <>
      <div className="hud-corner hud-top-left" role="toolbar" aria-label="Mode and level">
        {/* The mode, read: Orbit here; Walk has its own HUD with its Exit (§ Primary). */}
        <span className="hud-mode">Orbit</span>
        <SkButton
          size="compact"
          appearance="clear"
          aria-label="Walk and take photos"
          onClick={onWalk}
        >
          <HudIcon name="walk" /> Walk
        </SkButton>
        <LevelControl scene={scene} visibility={visibility} onChange={onChange} />
      </div>
      <div
        className="hud-corner hud-bottom-right"
        role="toolbar"
        aria-label="Views, Edit and Tools"
      >
        <SkIconButton
          className="hud-views"
          size="compact"
          appearance="clear"
          backing
          icon="view"
          label="Views"
          pressed={surface === 'views'}
          onClick={() => onSurface('views')}
        />
        <EditToggle className="stage-edit" />
        <SkIconButton
          className="hud-tools"
          size="compact"
          appearance="clear"
          backing
          icon="more"
          label="Tools"
          pressed={surface === 'tools' || surface === 'photos'}
          onClick={() => onSurface('tools')}
        />
      </div>
    </>
  );
}
