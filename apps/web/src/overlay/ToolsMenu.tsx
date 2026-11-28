import type { HomeSummary } from '@my-home/shared';
import { HudIcon } from '../hud/HudIcon';
import { SkBadge } from '../hud/SkBadge';
import { SkButton } from '../hud/SkButton';
import { SkPanel } from '../hud/SkPanel';
import { setPerfShown, usePerfShown } from '../quality/perfSwitch';
import { href, keptQuery } from '../routing';
import { SkToggle } from '../hud/SkToggle';
import { EffectsSwitch } from './QualityControl';
import { stageStatusText, type StageStatus } from './StageTools';
import { KeyboardShortcuts } from './KeyboardShortcuts';
import { ToolsHelp } from './ToolsHelp';

export interface ToolsMenuProps {
  homes: HomeSummary[];
  homeId: string;
  onSelectHome(id: string): void;
  photoCount: number;
  openRequests: number;
  /** The photos are the open surface. */
  photosOpen: boolean;
  onPhotos(): void;
  /** Loading and saving, in words (#203). */
  status: StageStatus;
  /** A touch screen: its gestures in the help. */
  touch: boolean;
  /** How many times `?` asked for the keys: the shortcuts open unfolded (#204, #205). */
  helpAsked?: number;
  className?: string;
}

/**
 * Tools (HUD v2 #200): what leaves the resting view, with its full names. The home, the photos with their count
 * and the catalogue; on the desktop it is the open surface, on a phone a menu over the stage tools.
 */
export function ToolsMenu({
  homes,
  homeId,
  onSelectHome,
  photoCount,
  openRequests,
  photosOpen,
  onPhotos,
  status,
  touch,
  helpAsked = 0,
  className,
}: ToolsMenuProps) {
  const perf = usePerfShown();
  const said = stageStatusText(status);
  return (
    <SkPanel className={`overlay panel tools-menu ${className ?? ''}`} label="Tools" arrive>
      <h1>Tools</h1>
      {homes.length > 1 ? (
        <label className="field">
          Home{' '}
          <select value={homeId} onChange={(e) => onSelectHome(e.target.value)}>
            {homes.map((h) => (
              <option key={h.id} value={h.id}>
                {h.name}
              </option>
            ))}
          </select>
        </label>
      ) : (
        <p className="home-name">{homes.find((h) => h.id === homeId)?.name}</p>
      )}
      <div className="buttons">
        <SkButton
          size="compact"
          variant="secondary"
          pressed={photosOpen}
          aria-label={`Photos (${photoCount})${openRequests > 0 ? `, ${openRequests} requested` : ''}`}
          onClick={onPhotos}
        >
          <HudIcon name="photos" /> Photos ({photoCount})
          <SkBadge className="topbar-count" shown={openRequests > 0} count={openRequests} />
        </SkButton>
        <SkButton size="compact" variant="secondary" href={href({ page: 'catalog' }, keptQuery())}>
          <HudIcon name="catalogue" /> Catalogue
        </SkButton>
      </div>
      {/* Status in words: what the badge says, and "All is well" when it says nothing (#203). */}
      <p className={said?.warn ? 'tools-status warning' : 'tools-status'} role="status">
        {said?.text ?? 'All changes saved'}
      </p>
      <EffectsSwitch />
      <ToolsHelp touch={touch} />
      {/* The keys that apply, and their settings (#205); `?` opens it here. */}
      <KeyboardShortcuts key={helpAsked} open={helpAsked > 0} />
      {/* Measure (#206) comes here, beside the diagnostics. */}
      <fieldset className="tools-diagnostics">
        <legend>Diagnostics</legend>
        <SkToggle
          className="toggle"
          size="compact"
          label="Performance readout"
          checked={perf}
          onChange={setPerfShown}
        >
          Performance readout
        </SkToggle>
        <p className="tools-links">
          <a href="/?hud=measure">Measure the HUD</a> ·{' '}
          <a href="/?render=measure">Measure render mode</a>
        </p>
      </fieldset>
    </SkPanel>
  );
}
