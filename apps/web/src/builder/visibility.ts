import type { HomeScene } from './buildHome';

/** What the viewer shows. Pure data, so the filtering rules are unit-tested without a canvas. */
export interface Visibility {
  /**
   * Cutaway: levels above this index (0 = lowest) are hidden. The roof shows only at
   * `roofIndex(scene)`, one above the top level, so the top level can be looked into.
   */
  maxLevelIndex: number;
  hiddenLevels: string[];
  hiddenApartments: string[];
  hiddenOutdoorAreas: string[];
  showTerrain: boolean;
}

/** The cutaway index that shows the whole building including its roof. */
export const roofIndex = (scene: Pick<HomeScene, 'levels'>) => scene.levels.length;

export const defaultVisibility = (scene: Pick<HomeScene, 'levels'>): Visibility => ({
  maxLevelIndex: roofIndex(scene),
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

  const showRoof = v.maxLevelIndex >= roofIndex(scene);

  return {
    ...scene,
    walls: scene.walls.filter(shown),
    openings: scene.openings.filter(shown),
    roomFloors: scene.roomFloors.filter(shown),
    // Slabs belong to a level, so the floor of a hidden level is cut away with it.
    slabs: scene.slabs.filter((s) => shownLevels.has(s.levelId) && (s.kind !== 'roof' || showRoof)),
    roofPlanes: showRoof ? scene.roofPlanes.filter((r) => shownLevels.has(r.levelId)) : [],
    roofWindows: showRoof ? scene.roofWindows.filter((r) => shownLevels.has(r.levelId)) : [],
    terrain: v.showTerrain ? scene.terrain : [],
    outdoorAreas: scene.outdoorAreas.filter((a) => !v.hiddenOutdoorAreas.includes(a.id)),
  };
}

/** Adds or removes `id` from a list of hidden ids. */
export const toggleId = (list: string[], id: string) =>
  list.includes(id) ? list.filter((x) => x !== id) : [...list, id];
