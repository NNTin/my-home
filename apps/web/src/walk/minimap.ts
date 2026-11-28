import type { HomeScene } from '../builder/buildHome';
import type { Box, Vec2 } from '../geom/types';
import type { FloorPlan } from '../editor/floorPlan';
import { add, rotate } from '../geom/geometry';

/**
 * What the minimap draws of one level, in plan coordinates (metres, +x east-ish, +z towards the
 * plan's bottom). Built once per home from the builder's plan data: the map is 2D and needs no
 * second 3D render.
 */
export interface MinimapLevel {
  levelId: string;
  name: string;
  rooms: { id: string; name: string; outline: Vec2[]; label: Vec2 }[];
  /** The solid parts of the walls (doorways left open, as the figure walks through them). */
  walls: Vec2[][];
  doors: Vec2[][];
  windows: Vec2[][];
  /** The stairs that start or end on this level, their treads and landings from the bottom up. */
  stairs: { id: string; fromLevelId: string; toLevelId: string; steps: Vec2[][] }[];
  /** Fences, and their gates, on the level the figure walks out of the building from. */
  fences: Vec2[][];
  gates: Vec2[][];
  footprint: Vec2[];
  bounds: { min: Vec2; max: Vec2 };
}

/** A box seen from above. */
export const boxOutline = (box: Box): Vec2[] => {
  const [sx, , sz] = box.size;
  const center: Vec2 = [box.center[0], box.center[2]];
  return (
    [
      [-sx / 2, -sz / 2],
      [sx / 2, -sz / 2],
      [sx / 2, sz / 2],
      [-sx / 2, sz / 2],
    ] as Vec2[]
  ).map((p) => add(rotate(p, box.rotationY), center));
};

const boundsOf = (polygons: Vec2[][]) => {
  const points = polygons.flat();
  if (points.length === 0) return { min: [0, 0] as Vec2, max: [0, 0] as Vec2 };
  const xs = points.map((p) => p[0]);
  const zs = points.map((p) => p[1]);
  return {
    min: [Math.min(...xs), Math.min(...zs)] as Vec2,
    max: [Math.max(...xs), Math.max(...zs)] as Vec2,
  };
};

/** The level the figure walks out of the building from: the one nearest to the ground. */
export function groundLevelId(scene: HomeScene, groundElevation: number): string | undefined {
  return [...scene.levels].sort(
    (a, b) => Math.abs(a.elevation - groundElevation) - Math.abs(b.elevation - groundElevation),
  )[0]?.id;
}

/** The minimap of every level, keyed by level id. */
export function minimapLevels(
  scene: HomeScene,
  plans: ReadonlyMap<string, FloorPlan>,
  ground: string | undefined,
): Map<string, MinimapLevel> {
  const levels = new Map<string, MinimapLevel>();
  for (const level of scene.levels) {
    const plan = plans.get(level.id);
    const labels = new Map(
      scene.roomFloors.map((f): [string, Vec2] => [f.roomId, [f.labelAt[0], f.labelAt[2]]]),
    );
    const rooms = (plan?.rooms ?? []).map((r) => ({
      id: r.id,
      name: r.name,
      outline: r.outline,
      label: labels.get(r.id) ?? r.outline[0] ?? [0, 0],
    }));
    const openings = scene.openings.filter((o) => o.levelId === level.id);
    const outdoors = level.id === ground;
    const fences = outdoors ? scene.fences : [];
    const map: MinimapLevel = {
      levelId: level.id,
      name: level.name,
      rooms,
      walls: (plan?.walls ?? []).flatMap((w) => w.solids),
      doors: openings.filter((o) => o.type === 'door' || o.type === 'french-door').map(boxOutline),
      windows: openings
        .filter((o) => o.type === 'window' || o.type === 'garage-door')
        .map(boxOutline),
      stairs: scene.stairs
        .filter((s) => s.levelId === level.id || s.toLevelId === level.id)
        .map((s) => ({
          id: s.id,
          fromLevelId: s.levelId,
          toLevelId: s.toLevelId,
          steps: s.steps.map(boxOutline),
        })),
      fences: fences.filter((f) => f.kind !== 'gate').flatMap((f) => f.panels.map(boxOutline)),
      gates: fences.filter((f) => f.kind === 'gate').flatMap((f) => f.panels.map(boxOutline)),
      footprint: plan?.footprint ?? [],
      bounds: { min: [0, 0], max: [0, 0] },
    };
    map.bounds = boundsOf([
      map.footprint,
      ...rooms.map((r) => r.outline),
      ...map.walls,
      ...map.stairs.flatMap((s) => s.steps),
      ...map.fences,
      ...map.gates,
    ]);
    levels.set(level.id, map);
  }
  return levels;
}

/**
 * How the map is turned, in degrees clockwise on screen. `heading`: the figure always looks up.
 * `north`: true north is up (`northBearing` is where true north is on the plan, degrees
 * clockwise from -z).
 */
export type MinimapOrientation = 'heading' | 'north';

export const mapRotation = (orientation: MinimapOrientation, yaw: number, northBearing: number) =>
  orientation === 'heading' ? (yaw * 180) / Math.PI : -northBearing;

/** The view of the map: which plan point is in the middle, the scale and the turn. */
export interface MapView {
  center: Vec2;
  /** Map units (the SVG's viewBox is `MAP_SIZE` across) per metre. */
  scale: number;
  /** Degrees clockwise on screen. */
  rotation: number;
}

/** The SVG's viewBox is this many units across, centred on 0. */
export const MAP_SIZE = 100;

/** Plan point to map units. */
export function toMap(view: MapView, [x, z]: Vec2): Vec2 {
  const r = (view.rotation * Math.PI) / 180;
  const dx = (x - view.center[0]) * view.scale;
  const dz = (z - view.center[1]) * view.scale;
  return [dx * Math.cos(r) - dz * Math.sin(r), dx * Math.sin(r) + dz * Math.cos(r)];
}

/** Map units back to the plan point (a tap on the map). */
export function fromMap(view: MapView, [u, v]: Vec2): Vec2 {
  const r = (-view.rotation * Math.PI) / 180;
  const dx = u * Math.cos(r) - v * Math.sin(r);
  const dz = u * Math.sin(r) + v * Math.cos(r);
  return [view.center[0] + dx / view.scale, view.center[1] + dz / view.scale];
}

/**
 * A point on the screen to map units, for an SVG of `MAP_SIZE` units drawn into `box` with the
 * default `preserveAspectRatio` (centred, fitted).
 */
export function screenToMap(
  box: { left: number; top: number; width: number; height: number },
  clientX: number,
  clientY: number,
): Vec2 | undefined {
  const side = Math.min(box.width, box.height);
  if (side <= 0) return undefined;
  const k = MAP_SIZE / side;
  return [(clientX - (box.left + box.width / 2)) * k, (clientY - (box.top + box.height / 2)) * k];
}
