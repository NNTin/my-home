import type { HomeSummary } from '@my-home/shared';
import { HudIcon } from '../hud/HudIcon';
import { SkBadge } from '../hud/SkBadge';
import { SkButton } from '../hud/SkButton';
import { SkPanel } from '../hud/SkPanel';
import { href, keptQuery } from '../routing';

export interface ToolsMenuProps {
  homes: HomeSummary[];
  homeId: string;
  onSelectHome(id: string): void;
  photoCount: number;
  openRequests: number;
  /** The photos are the open surface. */
  photosOpen: boolean;
  onPhotos(): void;
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
  className,
}: ToolsMenuProps) {
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
    </SkPanel>
  );
}
