import {
  BoxGeometry,
  BufferAttribute,
  BufferGeometry,
  CylinderGeometry,
  DoubleSide,
  ExtrudeGeometry,
  FrontSide,
  Matrix4,
  MeshStandardMaterial,
  Path,
  Shape,
  ShapeGeometry,
  Vector2,
} from 'three';
import { slopeY, type PlaneSlope, type Vec2 } from '../builder/buildHome';
import {
  batchKey,
  CYLINDER_SEGMENTS,
  linearRgb,
  materialKey,
  type DrawGroup,
  type DrawItem,
  type DrawMaterial,
  type DrawShape,
} from '../builder/drawList';

/**
 * Batching: merges draw items into few geometries (docs/design/realistic-render.md §4.2). Every
 * item with the same batch key becomes one mesh; its tint is written into the vertex colours, so
 * one material draws differently coloured items in one call. Positions and normals are merged in
 * the frame the items' matrices lead to: the world for the shell, the piece's own for a piece.
 */

/** Plan polygon as a three.js shape; `flipZ` for shapes laid down to face up (a surface). */
const toShape = (outline: Vec2[], holes: Vec2[][] = [], flipZ = false) => {
  const v = ([x, z]: Vec2) => new Vector2(x, flipZ ? -z : z);
  const shape = new Shape(outline.map(v));
  shape.holes = holes.map((hole) => new Path(hole.map(v)));
  return shape;
};

/**
 * Moves the vertices of a flat face onto a sloped plane. `toPlan` maps a vertex's local (x, y) to
 * plan [x, z]; `isFace(z)` picks the face's vertices by local z; `localZ(y)` maps a height back.
 */
function slopeVertices(
  geometry: BufferGeometry,
  slope: PlaneSlope,
  toPlan: (x: number, y: number) => Vec2,
  isFace: (z: number) => boolean,
  localZ: (y: number) => number,
) {
  const position = geometry.getAttribute('position');
  for (let i = 0; i < position.count; i++) {
    if (!isFace(position.getZ(i))) continue;
    position.setZ(i, localZ(slopeY(slope, toPlan(position.getX(i), position.getY(i)))));
  }
  position.needsUpdate = true;
  geometry.computeVertexNormals();
}

/** The geometry of a shape in its local frame, as the viewer has always built it. */
export function shapeGeometry(shape: DrawShape): BufferGeometry {
  switch (shape.kind) {
    case 'box':
      return new BoxGeometry(...shape.size);
    case 'cylinder':
      return new CylinderGeometry(
        shape.diameter / 2,
        shape.diameter / 2,
        shape.height,
        CYLINDER_SEGMENTS,
      );
    case 'profile': {
      const outline = new Shape(shape.outline.map(([x, y]) => new Vector2(x, y)));
      const g = new ExtrudeGeometry(outline, { depth: shape.depth, bevelEnabled: false });
      g.translate(0, 0, -shape.depth / 2);
      return g;
    }
    case 'prism': {
      const g = new ExtrudeGeometry(toShape(shape.outline, shape.holes), {
        depth: shape.top - shape.bottom,
        bevelEnabled: false,
      });
      // Local z = 0 is the top face (world y = top - z), local (x, y) is plan (x, z).
      if (shape.slope) {
        slopeVertices(
          g,
          shape.slope,
          (x, y) => [x, y],
          (z) => Math.abs(z) < 1e-6,
          (y) => shape.top - y,
        );
      }
      return g;
    }
    case 'surface': {
      const g = new ShapeGeometry(toShape(shape.outline, shape.holes, true));
      // Laid down to face up: local (x, y, z) is world (x, y + z, -y), so plan z = -local y.
      if (shape.slope) {
        slopeVertices(
          g,
          shape.slope,
          (x, y) => [x, -y],
          () => true,
          (y) => y - shape.y,
        );
      }
      return g;
    }
  }
}

/** One mesh: the merged items of a batch key. */
export interface Batch {
  key: string;
  group: DrawGroup;
  /** Set for the meshes of a piece. */
  piece?: string;
  finish: string;
  material: DrawMaterial | undefined;
  castShadow: boolean;
  receiveShadow: boolean;
  geometry: BufferGeometry;
  /** How many draw items were merged. */
  items: number;
  triangles: number;
}

const matrix = new Matrix4();

function merge(
  items: DrawItem[],
  transparent: boolean,
): { geometry: BufferGeometry; triangles: number } {
  const parts = items.map((item) => {
    const g = shapeGeometry(item.shape);
    g.applyMatrix4(matrix.fromArray(item.matrix));
    return g;
  });
  const vertices = parts.reduce((n, g) => n + g.getAttribute('position').count, 0);
  const indices = parts.reduce(
    (n, g) => n + (g.index ? g.index.count : g.getAttribute('position').count),
    0,
  );
  const colorSize = transparent ? 4 : 3;
  const position = new Float32Array(vertices * 3);
  const normal = new Float32Array(vertices * 3);
  const color = new Float32Array(vertices * colorSize);
  const index = vertices > 65535 ? new Uint32Array(indices) : new Uint16Array(indices);
  let v = 0;
  let i = 0;
  parts.forEach((g, n) => {
    const item = items[n]!;
    const count = g.getAttribute('position').count;
    position.set(g.getAttribute('position').array, v * 3);
    normal.set(g.getAttribute('normal').array, v * 3);
    const [r, green, b] = linearRgb(item.tint);
    for (let k = 0; k < count; k++) {
      const at = (v + k) * colorSize;
      color[at] = r;
      color[at + 1] = green;
      color[at + 2] = b;
      if (transparent) color[at + 3] = item.material?.opacity ?? 1;
    }
    if (g.index) for (let k = 0; k < g.index.count; k++) index[i++] = g.index.getX(k) + v;
    else for (let k = 0; k < count; k++) index[i++] = v + k;
    v += count;
    g.dispose();
  });
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new BufferAttribute(position, 3));
  geometry.setAttribute('normal', new BufferAttribute(normal, 3));
  geometry.setAttribute('color', new BufferAttribute(color, colorSize));
  geometry.setIndex(new BufferAttribute(index, 1));
  return { geometry, triangles: indices / 3 };
}

/** The batches of a list of draw items, in the order of each batch's first item. */
export function batches(items: readonly DrawItem[]): Batch[] {
  const byKey = new Map<string, DrawItem[]>();
  for (const item of items) {
    const key = batchKey(item);
    const list = byKey.get(key);
    if (list) list.push(item);
    else byKey.set(key, [item]);
  }
  return [...byKey].map(([key, list]): Batch => {
    const first = list[0]!;
    return {
      key,
      group: first.group,
      ...(first.piece !== undefined && { piece: first.piece }),
      finish: first.finish,
      material: first.material,
      castShadow: first.castShadow,
      receiveShadow: first.receiveShadow,
      items: list.length,
      ...merge(list, first.material?.transparent === true),
    };
  });
}

/** How a mesh glows: selected in the editor or after `?focus=`, or overlapping something. */
export interface Glow {
  color: string;
  intensity: number;
}

const materials = new Map<string, MeshStandardMaterial>();

/**
 * The material of a batch. One instance per kind of surface, shared by every batch of that kind
 * (the colours are in the vertices), so the whole scene draws with a handful of shader programs.
 * A mesh that glows gets a copy of its own with the glow as its emissive colour: a uniform, so
 * the copy compiles nothing.
 */
export function batchMaterial(m: DrawMaterial | undefined, glow?: Glow): MeshStandardMaterial {
  const key = `${materialKey(m)}|${glow ? `${glow.color}/${glow.intensity}` : ''}`;
  let material = materials.get(key);
  if (!material) {
    material = new MeshStandardMaterial({
      vertexColors: true,
      transparent: m?.transparent ?? false,
      depthWrite: m?.depthWrite ?? true,
      side: m?.doubleSided ? DoubleSide : FrontSide,
      ...(m?.metalness !== undefined && { metalness: m.metalness }),
      ...(m?.roughness !== undefined && { roughness: m.roughness }),
      ...(glow && { emissive: glow.color, emissiveIntensity: glow.intensity }),
    });
    materials.set(key, material);
  }
  return material;
}
