import { catalog } from '@my-home/shared';
import type { Box, HomeScene, Vec3 } from '../builder/buildHome';
import { roofIndex, type Visibility } from '../builder/visibility';
import { href } from '../routing';

/** A git use the viewer draws: a window or door (house or outbuilding), a roof window, a gate. */
export interface ScenePiece {
  id: string;
  typeId: string;
  name: string;
  kind: 'opening' | 'roof-window' | 'gate';
  /** The level it belongs to; none for outbuildings and gates. */
  levelId?: string;
  apartmentId?: string;
  /** In an exterior wall, an outbuilding or outdoors: looked at from outside. */
  exterior: boolean;
  center: Vec3;
  /** Of the sphere around it, in metres. */
  radius: number;
}

const boxRadius = (b: Box) => Math.hypot(...b.size) / 2;

/** The bounding sphere of boxes (gates: their posts and panels). */
function sphereOf(boxes: Box[]): { center: Vec3; radius: number } {
  const min: Vec3 = [Infinity, Infinity, Infinity];
  const max: Vec3 = [-Infinity, -Infinity, -Infinity];
  for (const b of boxes) {
    const r = boxRadius(b);
    for (let i = 0; i < 3; i++) {
      min[i] = Math.min(min[i]!, b.center[i]! - r);
      max[i] = Math.max(max[i]!, b.center[i]! + r);
    }
  }
  const center: Vec3 = [(min[0] + max[0]) / 2, (min[1] + max[1]) / 2, (min[2] + max[2]) / 2];
  return { center, radius: Math.hypot(max[0] - min[0], max[1] - min[1], max[2] - min[2]) / 2 };
}

/** Every piece of the home model in the scene, by use id. */
export function scenePieces(scene: HomeScene): Map<string, ScenePiece> {
  const pieces = new Map<string, ScenePiece>();
  const wallKind = new Map(scene.walls.map((w) => [w.wallId, w.kind]));
  for (const o of scene.openings) {
    pieces.set(o.id, {
      id: o.id,
      typeId: o.typeId,
      name: o.name,
      kind: 'opening',
      levelId: o.levelId,
      ...(o.apartmentId !== undefined && { apartmentId: o.apartmentId }),
      exterior: wallKind.get(o.wallId) !== 'interior',
      center: o.center,
      radius: boxRadius(o),
    });
  }
  for (const b of scene.outbuildings) {
    for (const o of b.openings) {
      pieces.set(o.id, {
        id: o.id,
        typeId: o.typeId,
        name: o.name,
        kind: 'opening',
        exterior: true,
        center: o.center,
        radius: boxRadius(o),
      });
    }
  }
  for (const w of scene.roofWindows) {
    pieces.set(w.id, {
      id: w.id,
      typeId: w.typeId,
      name: w.name,
      kind: 'roof-window',
      levelId: w.levelId,
      exterior: true,
      center: w.center,
      radius: Math.hypot(...w.size) / 2,
    });
  }
  for (const f of scene.fences) {
    if (!f.typeId) continue;
    const boxes = [...f.posts, ...f.panels];
    if (boxes.length === 0) continue;
    pieces.set(f.id, {
      id: f.id,
      typeId: f.typeId,
      name: f.name,
      kind: 'gate',
      exterior: true,
      ...sphereOf(boxes),
    });
  }
  return pieces;
}

/** What `frame` in the scene needs: look at `center` from direction `from` (a unit vector). */
export interface FrameRequest {
  center: Vec3;
  radius: number;
  from: Vec3;
}

const DEG = Math.PI / 180;

/**
 * Where to look at a use from. Pieces outside are seen from outside, along the direction from the
 * building's middle to them, slightly from above; interior doors and furniture from high above,
 * into the cutaway; roof windows from above the roof.
 */
export function frameFor(
  scene: Pick<HomeScene, 'bounds'>,
  target: { center: Vec3; radius: number; exterior: boolean; kind?: ScenePiece['kind'] },
): FrameRequest {
  const { min, max } = scene.bounds;
  const [cx, cz] = [(min[0] + max[0]) / 2, (min[2] + max[2]) / 2];
  let [dx, dz] = [target.center[0] - cx, target.center[2] - cz];
  const length = Math.hypot(dx, dz);
  if (!target.exterior || length < 0.5) [dx, dz] = [0.55, 0.75];
  const norm = Math.hypot(dx, dz);
  const elevation =
    (target.kind === 'roof-window' ? 55 : target.exterior && target.kind ? 25 : 60) * DEG;
  return {
    center: target.center,
    radius: target.radius,
    from: [
      (dx / norm) * Math.cos(elevation),
      Math.sin(elevation),
      (dz / norm) * Math.cos(elevation),
    ],
  };
}

/** The cutaway that shows a use on `levelId` (roof windows: with the roof), in view. */
export function focusVisibility(
  scene: Pick<HomeScene, 'levels'>,
  v: Visibility,
  target: { levelId?: string; apartmentId?: string; kind?: ScenePiece['kind'] },
): Visibility {
  const level = scene.levels.find((l) => l.id === target.levelId);
  if (!level) return v;
  return {
    ...v,
    maxLevelIndex: target.kind === 'roof-window' ? roofIndex(scene) : level.index,
    hiddenLevels: v.hiddenLevels.filter((id) => id !== level.id),
    hiddenApartments: v.hiddenApartments.filter((id) => id !== target.apartmentId),
  };
}

/** `/catalog/<kind>/<typeId>?home=<id>#use=<useId>`: the piece page, on this use. */
export function piecePageHref(typeId: string, homeId: string, useId: string): string {
  const kind = catalog.get(typeId)?.kind ?? 'furniture';
  return `${href({ page: 'piece', kind, typeId }, { home: homeId })}#use=${encodeURIComponent(useId)}`;
}
