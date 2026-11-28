import { CUT_FINISH, TERRAIN_FINISH } from '@my-home/shared';
import { Box3, BufferAttribute, BufferGeometry, Matrix4, Vector3 } from 'three';
import type { HomeScene } from '../builder/buildHome';
import type { Vec3 } from '../geom/types';
import {
  groupKey,
  partItems,
  scenePieceDraws,
  shellItems,
  transform,
  wallSolidItems,
  type DrawGroup,
  type DrawItem,
  type PlacementDraw,
} from '../builder/drawList';
import { shapeGeometry } from '../scene/batches';

/**
 * The solids a section caps (docs/design/realistic-render.md §7.2). A cut solid is closed with a
 * stencil cap: its back and front faces count, in the stencil buffer, how many solids the cut
 * plane is inside of at each pixel, and a quad on the plane is drawn where that is not zero. The
 * count does not depend on how solids overlap or touch, as walls do at every corner and opening.
 *
 * There are two caps: `soil.plain` for the terrain and `cut.dark` for everything else. Each is
 * counted and drawn on its own, the terrain first, so where a wall stands in soil the wall's cap
 * wins. The counting meshes are the closed solids again, positions only, merged by what is shown
 * and hidden together: a few meshes, two draw calls each. Each solid is counted a hair larger than
 * it is drawn (`CAP_OVERLAP`), so that solids which touch leave no seam in the cap.
 */

/** Which cap closes a solid. */
export type CapKind = 'soil' | 'dark';
export const CAP_FINISH: Record<CapKind, string> = {
  soil: TERRAIN_FINISH.finish,
  dark: CUT_FINISH.finish,
};

/** The closed solids of one cap that are shown and hidden together, as one geometry. */
export interface CapSolids {
  key: string;
  cap: CapKind;
  /** What shows and hides them (`groupShown`); undefined: always shown. */
  group?: DrawGroup;
  geometry: BufferGeometry;
  /** How many draw items were merged. */
  items: number;
}

/**
 * Whether a section caps the item: a closed solid that is drawn opaque. Glass and wire mesh are
 * cut and stay open: a dark slab in a window pane would be no pane.
 */
export const capped = (item: DrawItem): boolean => item.closed && !item.material?.transparent;

const matrix = new Matrix4();
const box = new Box3();
const middle = new Vector3();
const size = new Vector3();

/**
 * Every counted solid is this much larger on each side, in metres. Solids that only touch (a wall
 * on the wall below, two stretches of one wall) are triangles that do not share their edges:
 * where they meet, rounding can leave a pixel to neither, and the count there falls to nothing.
 * Solids that overlap have no such pixel, and a count of two is capped like a count of one.
 */
export const CAP_OVERLAP = 0.0015;

/** Grows a solid about the middle of its bounds, in its own frame, by `CAP_OVERLAP` on each side. */
function grow(g: BufferGeometry): BufferGeometry {
  g.computeBoundingBox();
  box.copy(g.boundingBox!).getCenter(middle);
  box.getSize(size);
  const factor = (extent: number) => (extent > 0 ? 1 + (2 * CAP_OVERLAP) / extent : 1);
  return g
    .translate(-middle.x, -middle.y, -middle.z)
    .scale(factor(size.x), factor(size.y), factor(size.z))
    .translate(middle.x, middle.y, middle.z);
}

function mergePositions(items: readonly DrawItem[]): BufferGeometry {
  const parts = items.map((item) => {
    const g = shapeGeometry(item.shape);
    const flat = g.index ? g.toNonIndexed() : g;
    if (flat !== g) g.dispose();
    return grow(flat).applyMatrix4(matrix.fromArray(item.matrix));
  });
  const count = parts.reduce((n, g) => n + g.getAttribute('position').count, 0);
  const position = new Float32Array(count * 3);
  let at = 0;
  for (const g of parts) {
    position.set(g.getAttribute('position').array, at);
    at += g.getAttribute('position').count * 3;
    g.dispose();
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new BufferAttribute(position, 3));
  return geometry;
}

/**
 * The counting geometry of draw items: one per cap and per group that is shown and hidden as a
 * whole. Fences, outbuildings and furniture are always shown, each kind as one.
 */
export function capSolids(items: readonly DrawItem[]): CapSolids[] {
  const byKey = new Map<string, { cap: CapKind; group?: DrawGroup; items: DrawItem[] }>();
  for (const item of items.filter(capped)) {
    const cap: CapKind = item.finish === CAP_FINISH.soil ? 'soil' : 'dark';
    const always = item.group.kind === 'structure' || item.group.kind === 'placement';
    const key = `${cap}|${always ? item.group.kind : groupKey(item.group)}`;
    const found = byKey.get(key);
    if (found) found.items.push(item);
    else byKey.set(key, { cap, ...(!always && { group: item.group }), items: [item] });
  }
  return [...byKey].map(([key, { cap, group, items: list }]) => ({
    key,
    cap,
    ...(group && { group }),
    geometry: mergePositions(list),
    items: list.length,
  }));
}

/** The draw items of the home's shell, outdoors and built-in pieces, in the world. */
export function homeItems(scene: HomeScene): DrawItem[] {
  return [
    ...shellItems(scene),
    // A wall is drawn as faces, which have no inside: it is counted as its solid stretches.
    ...wallSolidItems(scene),
    ...scenePieceDraws(scene).flatMap((p) =>
      partItems(p.parts, p.id, p.group, transform(p.position, p.rotationY, p.rotationX)),
    ),
  ];
}

/** The draw items of the furniture that is drawn, in the world. */
export const furnitureItems = (placements: readonly PlacementDraw[]): DrawItem[] =>
  placements.flatMap((p) =>
    partItems(p.parts, p.id, { kind: 'placement', id: p.id }, transform(p.position, p.rotationY)),
  );

/**
 * The quad of a cap: a rectangle on the cut plane that covers the scene, facing the camera's
 * side, with texture coordinates in metres. `across` is the horizontal direction in the plane.
 */
export function capQuad(
  plane: { normal: Vec3; constant: number },
  bounds: { min: Vec3; max: Vec3 },
  color: Vec3,
): BufferGeometry {
  const [nx, , nz] = plane.normal;
  const across: Vec3 = [-nz, 0, nx];
  const middle: Vec3 = [
    (bounds.min[0] + bounds.max[0]) / 2,
    0,
    (bounds.min[2] + bounds.max[2]) / 2,
  ];
  // The point of the plane nearest the scene's middle, and a rectangle around it that reaches
  // past the scene in every direction.
  const off = nx * middle[0] + nz * middle[2] + plane.constant;
  const [cx, cz] = [middle[0] - nx * off, middle[2] - nz * off];
  const half = Math.hypot(bounds.max[0] - bounds.min[0], bounds.max[2] - bounds.min[2]) / 2 + 2;
  const [low, high] = [bounds.min[1] - 2, bounds.max[1] + 2];
  const corners = [
    [-half, low],
    [half, low],
    [half, high],
    [-half, high],
  ] as const;
  const position = new Float32Array(12);
  const normal = new Float32Array(12);
  const colors = new Float32Array(12);
  const uv = new Float32Array(8);
  corners.forEach(([a, y], i) => {
    position.set([cx + across[0] * a, y, cz + across[2] * a], i * 3);
    // Towards the camera of the section: against the look.
    normal.set([-nx, 0, -nz], i * 3);
    colors.set(color, i * 3);
    uv.set([a, y], i * 2);
  });
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new BufferAttribute(position, 3));
  geometry.setAttribute('normal', new BufferAttribute(normal, 3));
  geometry.setAttribute('color', new BufferAttribute(colors, 3));
  geometry.setAttribute('uv', new BufferAttribute(uv, 2));
  geometry.setIndex([0, 1, 2, 0, 2, 3]);
  return geometry;
}
