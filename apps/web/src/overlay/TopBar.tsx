import type { HomeSummary } from '@my-home/shared';
import type { HomeScene } from '../builder/buildHome';
import { roofIndex, showUpTo, type Visibility } from '../builder/visibility';
import { HudIcon } from '../hud/HudIcon';
import { SkBadge } from '../hud/SkBadge';
import { SkButton } from '../hud/SkButton';
import { SkIconButton } from '../hud/SkIconButton';
import { SkSegmented } from '../hud/SkSegmented';
import { href, keptQuery } from '../routing';

interface Props {
  homes: HomeSummary[];
  homeId: string;
  onSelectHome(id: string): void;
  scene: HomeScene;
  visibility: Visibility;
  onChange(visibility: Visibility): void;
  onWalk(): void;
  photoCount: number;
  openRequests: number;
  /** The photos are what the sheet shows right now. */
  photosOpen: boolean;
  onPhotos(): void;
}

/**
 * A level's name for a narrow button: "First floor (attic)" becomes "Attic" and "Ground floor"
 * becomes "Ground". The full name stays the button's accessible name.
 */
export function shortLevelName(name: string): string {
  const bracketed = /\(([^)]+)\)\s*$/.exec(name)?.[1];
  const short = (bracketed ?? name.replace(/\s+floor$/i, '')).trim();
  return short === '' ? name : short.charAt(0).toUpperCase() + short.slice(1);
}

/**
 * The phone's top bar: the home, walking, the photos, the catalogue and the cutaway level as a
 * segmented control, so the most used actions need no panel.
 */
export function TopBar({
  homes,
  homeId,
  onSelectHome,
  scene,
  visibility,
  onChange,
  onWalk,
  photoCount,
  openRequests,
  photosOpen,
  onPhotos,
}: Props) {
  const roof = roofIndex(scene);
  // Top down like the building: the roof first, the lowest level last.
  const options = [
    { id: 'roof', name: 'Roof', label: 'Roof', index: roof },
    ...[...scene.levels]
      .reverse()
      .map((l) => ({ id: l.id, name: l.name, label: shortLevelName(l.name), index: l.index })),
  ];
  const chosen = Math.min(visibility.maxLevelIndex, roof);
  const choose = (index: number) => onChange(showUpTo(scene, visibility, index));

  return (
    <div className="topbar" role="toolbar" aria-label="Home, walking, photos, catalogue and level">
      <div className="topbar-row">
        {homes.length > 1 ? (
          <select
            className="topbar-home"
            aria-label="Home"
            value={homeId}
            onChange={(e) => onSelectHome(e.target.value)}
          >
            {homes.map((h) => (
              <option key={h.id} value={h.id}>
                {h.name}
              </option>
            ))}
          </select>
        ) : (
          <span className="topbar-home">{homes.find((h) => h.id === homeId)?.name}</span>
        )}
        {/* Compact Sakuga buttons (docs/design/hud.md §4.1): Walk is the primary (ドン), Photos a toggle. */}
        <SkButton size="compact" aria-label="Walk and take photos" onClick={onWalk}>
          <HudIcon name="walk" /> Walk
        </SkButton>
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
        {/* The icon only; its name is "Catalogue". */}
        <SkIconButton
          className="topbar-link"
          size="compact"
          icon="catalogue"
          label="Catalogue"
          href={href({ page: 'catalog' }, keptQuery())}
        />
      </div>
      {/* The cutaway level: a compact segmented row (docs/design/hud.md §4.1), one tab stop, arrow keys. */}
      <SkSegmented
        className="segmented"
        size="compact"
        label="Show up to level"
        value={options.find((o) => o.index === chosen)?.id ?? 'roof'}
        options={options.map((o) => ({ value: o.id, label: o.label, name: o.name }))}
        onChange={(id) => {
          const o = options.find((x) => x.id === id);
          if (o) choose(o.index);
        }}
      />
    </div>
  );
}
