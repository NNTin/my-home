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
  showRoomNames: boolean;
}

/** The cutaway index that shows the whole building including its roof. */
export const roofIndex = (scene: Pick<HomeScene, 'levels'>) => scene.levels.length;

/** The whole building, roof included, every level checked: what the cutaway can show at most. */
export const wholeVisibility = (scene: Pick<HomeScene, 'levels'>): Visibility => ({
  maxLevelIndex: roofIndex(scene),
  hiddenLevels: [],
  hiddenApartments: [],
  hiddenOutdoorAreas: [],
  showTerrain: true,
  showRoomNames: true,
});

/**
 * The first view, and what a reset returns to: looking into the lowest level (the souterrain, where
 * the owner lives), the levels above unchecked. `showUpTo` checks them again.
 */
export function defaultVisibility(scene: Pick<HomeScene, 'levels'>): Visibility {
  const lowest = Math.min(...scene.levels.map((l) => l.index));
  if (scene.levels.length === 0) return wholeVisibility(scene);
  return {
    ...wholeVisibility(scene),
    maxLevelIndex: lowest,
    hiddenLevels: scene.levels.filter((l) => l.index !== lowest).map((l) => l.id),
  };
}

/** Cuts away above `index` and checks every level up to it, so the chosen level is never empty. */
export const showUpTo = (
  scene: Pick<HomeScene, 'levels'>,
  v: Visibility,
  index: number,
): Visibility => ({
  ...v,
  maxLevelIndex: index,
  hiddenLevels: v.hiddenLevels.filter(
    (id) => (scene.levels.find((l) => l.id === id)?.index ?? Infinity) > index,
  ),
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
    stairs: scene.stairs.filter(shown),
    // Slabs belong to a level, so the floor of a hidden level is cut away with it.
    slabs: scene.slabs.filter((s) => shownLevels.has(s.levelId) && (s.kind !== 'roof' || showRoof)),
    roofPlanes: showRoof ? scene.roofPlanes.filter((r) => shownLevels.has(r.levelId)) : [],
    roofWindows: showRoof ? scene.roofWindows.filter((r) => shownLevels.has(r.levelId)) : [],
    terrain: v.showTerrain ? scene.terrain : [],
    outdoorAreas: scene.outdoorAreas.filter((a) => !v.hiddenOutdoorAreas.includes(a.id)),
  };
}

/** A room name to draw at a point in the scene. */
export interface RoomLabel {
  id: string;
  name: string;
  at: [number, number, number];
}

/**
 * Room names for the level being looked into: the highest level shown, and only once the roof
 * is cut away, so names never float over a closed building.
 */
export function roomLabels(scene: HomeScene, v: Visibility): RoomLabel[] {
  if (!v.showRoomNames || v.maxLevelIndex >= roofIndex(scene)) return [];
  const shown = visibleScene(scene, v);
  const top = scene.levels.findLast((l) => shown.roomFloors.some((r) => r.levelId === l.id));
  return shown.roomFloors
    .filter((r) => r.levelId === top?.id)
    .map((r) => ({ id: r.roomId, name: r.name, at: r.labelAt }));
}

/** Adds or removes `id` from a list of hidden ids. */
export const toggleId = (list: string[], id: string) =>
  list.includes(id) ? list.filter((x) => x !== id) : [...list, id];
