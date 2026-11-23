import type { HomeScene } from '../builder/buildHome';
import { toggleId, type Visibility } from '../builder/visibility';
import type { Quality } from '../quality/setting';
import { QualityControl } from './QualityControl';

interface Props {
  scene: HomeScene;
  visibility: Visibility;
  onChange(visibility: Visibility): void;
  quality: Quality;
  onQuality(quality: Quality): void;
  /** "Plan colours": room floors in the colours that tell rooms apart, not their finishes. */
  planColours: boolean;
  onPlanColours(on: boolean): void;
}

interface Item {
  id: string;
  name: string;
  shown: boolean;
  toggle(): void;
}

interface Group {
  name: string;
  items: Item[];
  /** Shows or hides every item of the group. */
  setAll(shown: boolean): void;
}

/**
 * The phone's View tab. The cutaway level is in the top bar; here are the room names and the
 * rarely used switches for single levels, apartments and outdoor areas, folded away by default.
 */
export function ViewPanel({
  scene,
  visibility,
  onChange,
  quality,
  onQuality,
  planColours,
  onPlanColours,
}: Props) {
  const set = (patch: Partial<Visibility>) => onChange({ ...visibility, ...patch });
  /** The hidden ids of a group that is shown or hidden as a whole. */
  const hidden = (all: { id: string }[], shown: boolean) => (shown ? [] : all.map((x) => x.id));

  const groups: Group[] = [
    {
      name: 'Levels',
      items: [...scene.levels].reverse().map((l) => ({
        id: l.id,
        name: l.name,
        shown: !visibility.hiddenLevels.includes(l.id),
        toggle: () => set({ hiddenLevels: toggleId(visibility.hiddenLevels, l.id) }),
      })),
      setAll: (shown) => set({ hiddenLevels: hidden(scene.levels, shown) }),
    },
    {
      name: 'Apartments',
      items: scene.apartments.map((a) => ({
        id: a.id,
        name: a.name,
        shown: !visibility.hiddenApartments.includes(a.id),
        toggle: () => set({ hiddenApartments: toggleId(visibility.hiddenApartments, a.id) }),
      })),
      setAll: (shown) => set({ hiddenApartments: hidden(scene.apartments, shown) }),
    },
    {
      name: 'Outdoor',
      items: [
        ...scene.outdoorAreas.map((a) => ({
          id: a.id,
          name: a.name,
          shown: !visibility.hiddenOutdoorAreas.includes(a.id),
          toggle: () => set({ hiddenOutdoorAreas: toggleId(visibility.hiddenOutdoorAreas, a.id) }),
        })),
        {
          id: 'terrain',
          name: 'Terrain',
          shown: visibility.showTerrain,
          toggle: () => set({ showTerrain: !visibility.showTerrain }),
        },
      ],
      setAll: (shown) =>
        set({ hiddenOutdoorAreas: hidden(scene.outdoorAreas, shown), showTerrain: shown }),
    },
  ];

  return (
    <section className="overlay panel view-panel" aria-label="View controls">
      <h1>View</h1>
      <label className="toggle">
        <input
          type="checkbox"
          checked={visibility.showRoomNames}
          onChange={() => set({ showRoomNames: !visibility.showRoomNames })}
        />{' '}
        Room names
      </label>
      <label className="toggle">
        <input type="checkbox" checked={planColours} onChange={() => onPlanColours(!planColours)} />{' '}
        Plan colours
      </label>
      <QualityControl quality={quality} onChange={onQuality} phone />
      <h2>Show / hide…</h2>
      {groups
        .filter((g) => g.items.length > 0)
        .map((g) => {
          const count = g.items.filter((i) => i.shown).length;
          return (
            <details key={g.name} className="toggle-group" aria-label={g.name}>
              <summary>
                {g.name}{' '}
                <span className="note">
                  {count} of {g.items.length} shown
                </span>
              </summary>
              <div className="buttons" role="group" aria-label={`All ${g.name.toLowerCase()}`}>
                <button
                  type="button"
                  onClick={() => g.setAll(true)}
                  disabled={count === g.items.length}
                >
                  Show all
                </button>
                <button type="button" onClick={() => g.setAll(false)} disabled={count === 0}>
                  Hide all
                </button>
              </div>
              {g.items.map((i) => (
                <label key={i.id} className="toggle">
                  <input type="checkbox" checked={i.shown} onChange={i.toggle} /> {i.name}
                </label>
              ))}
            </details>
          );
        })}
    </section>
  );
}
