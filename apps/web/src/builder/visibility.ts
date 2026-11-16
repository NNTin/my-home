import type { HomeScene } from './buildHome';

/** What the viewer shows. Pure data, so the filtering rules are unit-tested without a canvas. */
export interface Visibility {
  /** Cutaway: levels above this index (0 = lowest) are hidden. */
  maxLevelIndex: number;
  hiddenLevels: string[];
  hiddenApartments: string[];
  hiddenOutdoorAreas: string[];
  showTerrain: boolean;
}

export const defaultVisibility = (scene: Pick<HomeScene, 'levels'>): Visibility => ({
  maxLevelIndex: scene.levels.length - 1,
  hiddenLevels: [],
  hiddenApartments: [],
  hiddenOutdoorAreas: [],
  showTerrain: true,
});

/** The descriptors to render for a visibility state. */
export function visibleScene(scene: HomeScene, v: Visibility): HomeScene {
  const shownLevels = new Set(
    scene.levels
      .filter((l) => l.index <= v.maxLevelIndex && !v.hiddenLevels.includes(l.id))
      .map((l) => l.id),
  );
  const hiddenApartments = new Set(v.hiddenApartments);
  const shown = (item: { levelId: string; apartmentId?: string }) =>
    shownLevels.has(item.levelId) &&
    (item.apartmentId === undefined || !hiddenApartments.has(item.apartmentId));

  return {
    ...scene,
    walls: scene.walls.filter(shown),
    openings: scene.openings.filter(shown),
    roomFloors: scene.roomFloors.filter(shown),
    // Slabs belong to a level, so the floor of a hidden level is cut away with it.
    slabs: scene.slabs.filter((s) => shownLevels.has(s.levelId)),
    terrain: v.showTerrain ? scene.terrain : [],
    outdoorAreas: scene.outdoorAreas.filter((a) => !v.hiddenOutdoorAreas.includes(a.id)),
  };
}

/** Adds or removes `id` from a list of hidden ids. */
export const toggleId = (list: string[], id: string) =>
  list.includes(id) ? list.filter((x) => x !== id) : [...list, id];
