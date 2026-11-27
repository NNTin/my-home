import type { HomeSummary } from '@my-home/shared';
import { SkCheckbox } from '../hud/SkCheckbox';
import { SkSegmented } from '../hud/SkSegmented';
import { SkToggle } from '../hud/SkToggle';
import { shortLevelName } from './TopBar';
import type { ReactNode } from 'react';
import type { HomeScene } from '../builder/buildHome';
import { roofIndex, showUpTo, toggleId, type Visibility } from '../builder/visibility';
import { EditToggle } from '../editMode/EditToggle';
import type { Quality } from '../quality/setting';
import { href, keptQuery, Link } from '../routing';
import { QualityControl } from './QualityControl';

interface Props {
  homes: HomeSummary[];
  homeId: string;
  onSelectHome(id: string): void;
  scene: HomeScene;
  visibility: Visibility;
  onChange(visibility: Visibility): void;
  /** Starts walking the figure through the home (and taking photos). */
  onWalk(): void;
  /** Opens or closes the photo gallery. */
  photoCount: number;
  openRequests: number;
  photosOpen: boolean;
  onPhotos(): void;
  quality: Quality;
  onQuality(quality: Quality): void;
  /** "Plan colours": room floors in the colours that tell rooms apart, not their finishes. */
  planColours: boolean;
  onPlanColours(on: boolean): void;
  /** The "Views" control (`views/ViewsControl.tsx`), once its lazy chunk is here. */
  views?: ReactNode;
}

/** One of a list of show/hide settings: a compact Sakuga checkbox (docs/design/hud.md §4.2, B27). */
function Toggle({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange(): void;
}) {
  return (
    <SkCheckbox className="toggle" size="compact" checked={checked} onChange={onChange}>
      {label}
    </SkCheckbox>
  );
}

export function ControlPanel({
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
  quality,
  onQuality,
  planColours,
  onPlanColours,
  views,
}: Props) {
  const set = (patch: Partial<Visibility>) => onChange({ ...visibility, ...patch });
  const levelsTopDown = [...scene.levels].reverse();
  const outdoor = scene.outdoorAreas;

  return (
    <section className="overlay panel" aria-label="View controls">
      <h1>my-home</h1>
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
      {/* Edit on the header's own line, below the window's top: its splash has room (§5.13). */}
      <div className="panel-edit">
        <EditToggle />
      </div>
      <div className="buttons">
        <button type="button" onClick={onWalk}>
          🚶 Walk and take photos
        </button>
        <button type="button" aria-pressed={photosOpen} onClick={onPhotos}>
          📷 Photos ({photoCount}){openRequests > 0 && ` · ${openRequests} requested`}
        </button>
        <Link className="button" to={href({ page: 'catalog' }, keptQuery())}>
          📚 Catalogue
        </Link>
      </div>

      {views}

      <fieldset>
        <legend>Show up to level</legend>
        {/* One choice: a segmented row, the short names shown, the full ones read out (§4.4). */}
        <SkSegmented
          label="Show up to level"
          size="compact"
          value={
            visibility.maxLevelIndex >= roofIndex(scene)
              ? 'roof'
              : (levelsTopDown.find((l) => l.index === visibility.maxLevelIndex)?.id ?? 'roof')
          }
          options={[
            { value: 'roof', label: 'Roof' },
            ...levelsTopDown.map((l) => ({
              value: l.id,
              label: shortLevelName(l.name),
              name: l.name,
            })),
          ]}
          onChange={(id) => {
            const level = levelsTopDown.find((l) => l.id === id);
            onChange(showUpTo(scene, visibility, level ? level.index : roofIndex(scene)));
          }}
        />
        {/* The settings that stand alone: painted switches (§4.8). */}
        <SkToggle
          className="toggle"
          size="compact"
          label="Room names"
          checked={visibility.showRoomNames}
          onChange={() => set({ showRoomNames: !visibility.showRoomNames })}
        >
          Room names
        </SkToggle>
        <SkToggle
          className="toggle"
          size="compact"
          label="Plan colours"
          checked={planColours}
          onChange={() => onPlanColours(!planColours)}
        >
          Plan colours
        </SkToggle>
      </fieldset>

      <fieldset>
        <legend>Levels</legend>
        {levelsTopDown.map((l) => (
          <Toggle
            key={l.id}
            label={l.name}
            checked={!visibility.hiddenLevels.includes(l.id)}
            onChange={() => set({ hiddenLevels: toggleId(visibility.hiddenLevels, l.id) })}
          />
        ))}
      </fieldset>

      <fieldset>
        <legend>Apartments</legend>
        {scene.apartments.map((a) => (
          <Toggle
            key={a.id}
            label={a.name}
            checked={!visibility.hiddenApartments.includes(a.id)}
            onChange={() => set({ hiddenApartments: toggleId(visibility.hiddenApartments, a.id) })}
          />
        ))}
      </fieldset>

      <fieldset>
        <legend>Outdoor</legend>
        {outdoor.map((a) => (
          <Toggle
            key={a.id}
            label={a.name}
            checked={!visibility.hiddenOutdoorAreas.includes(a.id)}
            onChange={() =>
              set({ hiddenOutdoorAreas: toggleId(visibility.hiddenOutdoorAreas, a.id) })
            }
          />
        ))}
        <Toggle
          label="Terrain"
          checked={visibility.showTerrain}
          onChange={() => set({ showTerrain: !visibility.showTerrain })}
        />
      </fieldset>

      <QualityControl quality={quality} onChange={onQuality} phone={false} />
    </section>
  );
}
