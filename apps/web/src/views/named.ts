import type { HomeScene, Vec2, Vec3 } from '../builder/buildHome';
import { wholeVisibility, type Visibility } from '../builder/visibility';
import type { Backdrop, Look, RigView } from '../lighting/rig';
import type { FrameRequest } from '../placements/focus';

/**
 * The named views (docs/design/realistic-render.md §7.1): an isometric cutaway of a level, a
 * cross-section of the whole house, and eye level in a room. Each is a camera, a visibility, a
 * light rig, a backdrop and, for a section, a cut; each has a URL. Plain data and plain
 * functions: nothing here needs three.js.
 */
export type NamedView =
  | { kind: 'cutaway'; levelId: string }
  /** `at`: metres from the building's near face to the cut, along `look`. */
  | { kind: 'section'; look: Look; at: number }
  /** `look`: degrees clockwise from plan north (-z). */
  | { kind: 'eye'; roomId: string; look: number };

export type ViewKind = NamedView['kind'];

/** The views that can be opened, by URL and from the Views control, in the control's order. */
export const VIEW_KINDS: readonly ViewKind[] = ['cutaway', 'section', 'eye'];

export const LOOKS: readonly Look[] = ['north', 'east', 'south', 'west'];

/** Unit vectors on the plan, pointing where each look looks; -z is plan north. */
const DIRECTION: Record<Look, Vec2> = {
  north: [0, -1],
  east: [1, 0],
  south: [0, 1],
  west: [-1, 0],
};

const DEG = Math.PI / 180;
/** Narrow fields of view read as isometric and as an elevation (§7.1); the camera stays perspective. */
export const VIEW_FOV: Record<ViewKind, number> = { cutaway: 20, section: 25, eye: 70 };
/** The eye's height above the floor, in metres. */
export const EYE_LEVEL = 1.6;
/** The cutaway looks down from the south-east at this angle above the horizon. */
const CUTAWAY_ELEVATION = 40 * DEG;
/** How much more than the house a cutaway frames: the garden around it. */
const CUTAWAY_GARDEN = 1.4;
/** Garden shown to the left and right of the house in a section, in metres. */
const SECTION_GARDEN = 6;
/**
 * The cut lies this far behind the position asked for. Wall faces stand at whole centimetres: a
 * cut exactly in one would leave it to rounding which pixels of the face are drawn.
 */
export const CUT_OFFSET = 0.003;

type Scene = Pick<
  HomeScene,
  'levels' | 'slabs' | 'roofPlanes' | 'roomFloors' | 'bounds' | 'terrain'
>;

/** The building's footprint on the plan, and its height from under the lowest floor to the roof. */
export function houseBounds(scene: Scene): { min: Vec3; max: Vec3 } {
  const points = scene.slabs.flatMap((s) => s.outline);
  if (points.length === 0) return scene.bounds;
  const xs = points.map((p) => p[0]);
  const zs = points.map((p) => p[1]);
  return {
    min: [Math.min(...xs), Math.min(...scene.slabs.map((s) => s.bottom)), Math.min(...zs)],
    max: [Math.max(...xs), scene.bounds.max[1], Math.max(...zs)],
  };
}

/** Where the building begins along `look`, and how deep it is: the range of a section's cut. */
export function sectionRange(scene: Scene, look: Look): { near: number; depth: number } {
  const [dx, dz] = DIRECTION[look];
  const { min, max } = houseBounds(scene);
  const along = [min[0] * dx + min[2] * dz, max[0] * dx + max[2] * dz];
  const near = Math.min(...along);
  return { near, depth: Math.max(...along) - near };
}

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

/**
 * The cut of a section as a plane `normal · p + constant = 0`: what lies behind it, seen along
 * `look`, is kept.
 */
export function sectionPlane(
  scene: Scene,
  view: { look: Look; at: number },
): { normal: Vec3; constant: number } {
  const [dx, dz] = DIRECTION[view.look];
  const { near, depth } = sectionRange(scene, view.look);
  return { normal: [dx, 0, dz], constant: -(near + clamp(view.at, 0, depth) + CUT_OFFSET) };
}

const lowestLevel = (scene: Scene) =>
  scene.levels.reduce<Scene['levels'][number] | undefined>(
    (lowest, l) => (!lowest || l.index < lowest.index ? l : lowest),
    undefined,
  );

/** The rooms an eye-level view can stand in: those of the level that is modelled inside. */
export const eyeRooms = (scene: Scene) =>
  scene.roomFloors.filter((r) => r.levelId === lowestLevel(scene)?.id);

/** Where an eye-level view of a room looks by default: to its farthest corner, in whole degrees. */
function defaultEyeLook(room: Scene['roomFloors'][number]): number {
  const [cx, , cz] = room.labelAt;
  let far: Vec2 = [0, -1];
  let best = -1;
  for (const [x, z] of room.outline) {
    const d = Math.hypot(x - cx, z - cz);
    if (d > best) [best, far] = [d, [x - cx, z - cz]];
  }
  return (Math.round(Math.atan2(far[0], -far[1]) / DEG) + 360) % 360;
}

/**
 * The view of a kind as it opens without parameters: the cutaway of the level `id` (the lowest
 * one when omitted or unknown), the section looking north through the middle, eye level in the
 * room `id` (the first one when omitted or unknown).
 */
export function defaultView(scene: Scene, kind: ViewKind, id?: string): NamedView | undefined {
  if (kind === 'cutaway') {
    const level = scene.levels.find((l) => l.id === id) ?? lowestLevel(scene);
    return level && { kind, levelId: level.id };
  }
  if (kind === 'section')
    return { kind, look: 'north', at: sectionRange(scene, 'north').depth / 2 };
  const rooms = eyeRooms(scene);
  const room = rooms.find((r) => r.roomId === id) ?? rooms[0];
  return room && { kind, roomId: room.roomId, look: defaultEyeLook(room) };
}

const VIEW_PARAMS = ['view', 'level', 'look', 'at', 'room'] as const;

const numberOf = (value: string | null): number | undefined => {
  const n = value === null || value.trim() === '' ? NaN : Number(value);
  return Number.isFinite(n) ? n : undefined;
};

/**
 * The named view a URL asks for: `?view=cutaway&level=<levelId>`,
 * `?view=section&look=north|east|south|west&at=<m>`, `?view=eye&room=<roomId>&look=<degrees>`.
 * A parameter that is missing or names nothing of this home takes its default.
 */
export function parseView(search: string, scene: Scene): NamedView | undefined {
  const params = new URLSearchParams(search);
  const kind = VIEW_KINDS.find((k) => k === params.get('view'));
  if (!kind) return undefined;
  if (kind === 'cutaway') return defaultView(scene, kind, params.get('level') ?? undefined);
  if (kind === 'section') {
    const look = LOOKS.find((l) => l === params.get('look')) ?? 'north';
    const { depth } = sectionRange(scene, look);
    return { kind, look, at: clamp(numberOf(params.get('at')) ?? depth / 2, 0, depth) };
  }
  const view = defaultView(scene, kind, params.get('room') ?? undefined);
  const look = numberOf(params.get('look'));
  return view?.kind === 'eye' && look !== undefined
    ? { ...view, look: ((look % 360) + 360) % 360 }
    : view;
}

/** The parameters of a view's URL. */
export function viewQuery(view: NamedView): Record<string, string> {
  switch (view.kind) {
    case 'cutaway':
      return { view: view.kind, level: view.levelId };
    case 'section':
      return { view: view.kind, look: view.look, at: String(Math.round(view.at * 100) / 100) };
    case 'eye':
      return { view: view.kind, room: view.roomId, look: String(Math.round(view.look)) };
  }
}

/** `search` with the named view's parameters replaced by those of `view` (none: dropped). */
export function withView(search: string, view: NamedView | undefined): string {
  const params = new URLSearchParams(search);
  for (const key of VIEW_PARAMS) params.delete(key);
  for (const [key, value] of Object.entries(view ? viewQuery(view) : {})) params.set(key, value);
  const text = params.toString();
  return text ? `?${text}` : '';
}

/** Puts the named view into the address, or takes it out, without a history entry. */
export function writeViewUrl(view: NamedView | undefined) {
  const { pathname, search, hash } = window.location;
  const next = withView(search, view);
  if (next !== search)
    window.history.replaceState(window.history.state, '', pathname + next + hash);
}

/** What a named view shows of the home. */
export function viewVisibility(scene: Scene, view: NamedView): Visibility {
  const whole = wholeVisibility(scene);
  if (view.kind !== 'cutaway') return whole;
  const level = scene.levels.find((l) => l.id === view.levelId);
  if (!level) return whole;
  return {
    ...whole,
    maxLevelIndex: level.index,
    hiddenLevels: scene.levels.filter((l) => l.index > level.index).map((l) => l.id),
  };
}

/** How far it is from `from` along the unit direction `d` to the outline; Infinity if it is not met. */
function reach(from: Vec2, d: Vec2, outline: readonly Vec2[]): number {
  let nearest = Infinity;
  outline.forEach(([ax, az], i) => {
    const [bx, bz] = outline[(i + 1) % outline.length]!;
    const [ex, ez] = [bx - ax, bz - az];
    const cross = d[0] * ez - d[1] * ex;
    if (Math.abs(cross) < 1e-9) return;
    const t = ((ax - from[0]) * ez - (az - from[1]) * ex) / cross;
    const u = ((ax - from[0]) * d[1] - (az - from[1]) * d[0]) / cross;
    if (t > 0 && u >= 0 && u <= 1) nearest = Math.min(nearest, t);
  });
  return nearest;
}

/** Of the way from the middle of the room to the wall behind the eye, and what is kept clear of it. */
const EYE_BACK = 0.6;
const EYE_CLEAR = 0.5;

/**
 * Where the eye stands in a room: back from the room's middle, towards the wall behind it, so
 * the view takes in the room and not the nearest piece of furniture.
 */
export function eyePosition(room: Scene['roomFloors'][number], look: number): Vec3 {
  const [x, y, z] = room.labelAt;
  const [dx, dz] = [Math.sin(look * DEG), -Math.cos(look * DEG)];
  const behind = reach([x, z], [-dx, -dz], room.outline);
  const back = Number.isFinite(behind)
    ? Math.max(0, Math.min(behind * EYE_BACK, behind - EYE_CLEAR))
    : 0;
  return [x - dx * back, y + EYE_LEVEL, z - dz * back];
}

/** Where a named view's camera stands and what it looks at. */
export function viewFrame(scene: Scene, view: NamedView): FrameRequest {
  const fov = VIEW_FOV[view.kind];
  const { min, max } = houseBounds(scene);
  const middle: Vec2 = [(min[0] + max[0]) / 2, (min[2] + max[2]) / 2];
  switch (view.kind) {
    case 'cutaway': {
      const level = scene.levels.find((l) => l.id === view.levelId);
      const y = level ? level.elevation + level.height / 2 : (min[1] + max[1]) / 2;
      const across = Math.SQRT1_2 * Math.cos(CUTAWAY_ELEVATION);
      return {
        center: [middle[0], y, middle[1]],
        // The house with the garden around it.
        radius: (Math.hypot(max[0] - min[0], max[2] - min[2]) / 2) * CUTAWAY_GARDEN,
        // South-east and high: +x is east, +z is south.
        from: [across, Math.sin(CUTAWAY_ELEVATION), across],
        fov,
      };
    }
    case 'section': {
      const [dx, dz] = DIRECTION[view.look];
      // Across the look: the house's width as the camera sees it, with some garden either side.
      const width = Math.abs(dz) * (max[0] - min[0]) + Math.abs(dx) * (max[2] - min[2]);
      return {
        center: [middle[0], (min[1] + max[1]) / 2, middle[1]],
        radius: 0,
        from: [-dx, 0, -dz],
        fov,
        extent: [width / 2 + SECTION_GARDEN, (max[1] - min[1]) / 2 + 1],
      };
    }
    case 'eye': {
      const room = scene.roomFloors.find((r) => r.roomId === view.roomId);
      const [x, y, z] = room
        ? eyePosition(room, view.look)
        : [middle[0], min[1] + EYE_LEVEL, middle[1]];
      const [dx, dz] = [Math.sin(view.look * DEG), -Math.cos(view.look * DEG)];
      // The orbit controls turn about a point just ahead of the eye: a drag looks around.
      const ahead = 0.1;
      return {
        center: [x + dx * ahead, y, z + dz * ahead],
        radius: 0,
        from: [-dx, 0, -dz],
        fov,
        distance: ahead,
      };
    }
  }
}

/** How a named view is lit (`lighting/rig.ts`). */
export const viewRig = (view: NamedView): RigView =>
  view.kind === 'section' ? { kind: 'section', look: view.look } : { kind: view.kind };

/** Named views stand in a white studio unless a backdrop is chosen (§6.3). */
export const VIEW_BACKDROP: Backdrop = 'studio-light';

/** `my-home-<view>-<yyyymmdd-hhmm>.png`: the file an exported image is saved as (§7.4). */
export function imageName(view: string, at: Date): string {
  const two = (n: number) => String(n).padStart(2, '0');
  const day = `${at.getFullYear()}${two(at.getMonth() + 1)}${two(at.getDate())}`;
  return `my-home-${view}-${day}-${two(at.getHours())}${two(at.getMinutes())}.png`;
}

/** The pixels of an exported image: twice the canvas, at most 3840 wide (§7.4). */
export function exportSize(
  width: number,
  height: number,
): { width: number; height: number; ratio: number } {
  const ratio = Math.min(2, 3840 / Math.max(1, width));
  return { width: Math.floor(width * ratio), height: Math.floor(height * ratio), ratio };
}
