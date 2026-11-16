import type { HomeSummary } from '@my-home/shared';
import type { HomeScene } from '../builder/buildHome';
import { roofIndex, toggleId, type Visibility } from '../builder/visibility';

interface Props {
  homes: HomeSummary[];
  homeId: string;
  onSelectHome(id: string): void;
  scene: HomeScene;
  visibility: Visibility;
  onChange(visibility: Visibility): void;
  /** Starts walking the figure through the home (and taking photos). */
  onWalk(): void;
}

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
    <label className="toggle">
      <input type="checkbox" checked={checked} onChange={onChange} /> {label}
    </label>
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
      <div className="buttons">
        <button type="button" onClick={onWalk}>
          🚶 Walk and take photos
        </button>
      </div>

      <fieldset>
        <legend>Show up to level</legend>
        <label className="toggle">
          <input
            type="radio"
            name="cutaway"
            checked={visibility.maxLevelIndex >= roofIndex(scene)}
            onChange={() => set({ maxLevelIndex: roofIndex(scene) })}
          />{' '}
          Roof
        </label>
        {levelsTopDown.map((l) => (
          <label key={l.id} className="toggle">
            <input
              type="radio"
              name="cutaway"
              checked={visibility.maxLevelIndex === l.index}
              onChange={() => set({ maxLevelIndex: l.index })}
            />{' '}
            {l.name}
          </label>
        ))}
        <Toggle
          label="Room names"
          checked={visibility.showRoomNames}
          onChange={() => set({ showRoomNames: !visibility.showRoomNames })}
        />
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
    </section>
  );
}
