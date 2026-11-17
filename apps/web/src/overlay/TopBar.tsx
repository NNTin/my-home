import type { HomeSummary } from '@my-home/shared';
import type { KeyboardEvent } from 'react';
import type { HomeScene } from '../builder/buildHome';
import { roofIndex, type Visibility } from '../builder/visibility';

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
 * The phone's top bar: the home, walking, the photos and the cutaway level as a segmented
 * control, so the most used actions need no panel.
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
  const choose = (index: number) => onChange({ ...visibility, maxLevelIndex: index });

  // A radio group moves with the arrow keys and has one tab stop.
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const step = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[e.key];
    if (step === undefined) return;
    e.preventDefault();
    const at = options.findIndex((o) => o.index === chosen);
    const next = options[(at + step + options.length) % options.length];
    if (!next) return;
    choose(next.index);
    e.currentTarget.querySelector<HTMLElement>(`[data-level="${next.id}"]`)?.focus();
  };

  return (
    <div className="topbar" role="toolbar" aria-label="Home, walking, photos and level">
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
        <button type="button" aria-label="Walk and take photos" onClick={onWalk}>
          <span aria-hidden="true">🚶</span> Walk
        </button>
        <button
          type="button"
          aria-pressed={photosOpen}
          aria-label={`Photos (${photoCount})${openRequests > 0 ? `, ${openRequests} requested` : ''}`}
          onClick={onPhotos}
        >
          <span aria-hidden="true">📷</span> Photos ({photoCount})
          {openRequests > 0 && <span className="badge">{openRequests}</span>}
        </button>
      </div>
      <div
        className="segmented"
        role="radiogroup"
        aria-label="Show up to level"
        onKeyDown={onKeyDown}
      >
        {options.map((o) => (
          <button
            key={o.id}
            type="button"
            role="radio"
            data-level={o.id}
            aria-checked={o.index === chosen}
            aria-label={o.name}
            title={o.name}
            tabIndex={o.index === chosen ? 0 : -1}
            onClick={() => choose(o.index)}
          >
            {o.label}
          </button>
        ))}
      </div>
    </div>
  );
}
