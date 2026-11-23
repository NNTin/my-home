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
import { finishes } from '@my-home/shared';
import { slopeY, type PlaneSlope, type UvFrame, type Vec2 } from '../builder/buildHome';
import {
  batchKey,
  CYLINDER_SEGMENTS,
  linearRgb,
  materialKey,
  type DrawGroup,
  type DrawItem,
  type DrawMaterial,
  type DrawShape,
  type FacePart,
} from '../builder/drawList';

/**
 * Batching: merges draw items into few geometries (docs/design/realistic-render.md §4.2). Every
 * item with the same batch key becomes one mesh; its tint is written into the vertex colours, so
 * one material draws differently coloured items in one call. Positions and normals are merged in
 * the frame the items' matrices lead to: the world for the shell, the piece's own for a piece.
 * The batches of a textured finish also get texture coordinates, in metres (§5.4).
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

/**
 * The triangles of a box or a profile that belong to one part of it: the face at local +z, the
 * one at local -z, or everything else. Both shapes have flat faces, so a triangle's normal says
 * which face it is on.
 */
function facePart(geometry: BufferGeometry, part: FacePart): BufferGeometry {
  const flat = geometry.index ? geometry.toNonIndexed() : geometry;
  const position = flat.getAttribute('position');
  const normal = flat.getAttribute('normal');
  const positions: number[] = [];
  const normals: number[] = [];
  for (let i = 0; i < position.count; i += 3) {
    const nz = normal.getZ(i);
    const on: FacePart = nz > 0.5 ? 'front' : nz < -0.5 ? 'back' : 'core';
    if (on !== part) continue;
    for (let k = i; k < i + 3; k++) {
      positions.push(position.getX(k), position.getY(k), position.getZ(k));
      normals.push(normal.getX(k), normal.getY(k), normal.getZ(k));
    }
  }
  if (flat !== geometry) flat.dispose();
  geometry.dispose();
  const out = new BufferGeometry();
  out.setAttribute('position', new BufferAttribute(new Float32Array(positions), 3));
  out.setAttribute('normal', new BufferAttribute(new Float32Array(normals), 3));
  return out;
}

/** The geometry of a shape in its local frame, as the viewer has always built it. */
export function shapeGeometry(shape: DrawShape): BufferGeometry {
  switch (shape.kind) {
    case 'box': {
      const g = new BoxGeometry(...shape.size);
      return shape.only ? facePart(g, shape.only) : g;
    }
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
      return shape.only ? facePart(g, shape.only) : g;
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

/** Texture coordinates in metres of a vertex at `p` with normal `n`, by the frame or by projection. */
type Project = (px: number, py: number, pz: number, nx: number, ny: number, nz: number) => Vec2;

/**
 * A box projection: the two coordinates across the axis the surface faces most. A face that looks
 * up or down takes (x, z), the plan; a face that looks sideways takes the horizontal coordinate
 * along it and the height.
 */
const boxProjection: Project = (px, py, pz, nx, ny, nz) => {
  const [ax, ay, az] = [Math.abs(nx), Math.abs(ny), Math.abs(nz)];
  if (ay >= ax && ay >= az) return [px, pz];
  return ax >= az ? [pz, py] : [px, py];
};

const planar =
  ({ origin: [ox, oy, oz], u, v }: UvFrame): Project =>
  (px, py, pz) => {
    const [x, y, z] = [px - ox, py - oy, pz - oz];
    return [x * u[0] + y * u[1] + z * u[2], x * v[0] + y * v[1] + z * v[2]];
  };

/** The texture coordinates of a geometry's vertices, in metres. */
function projectUvs(g: BufferGeometry, project: Project): Float32Array {
  const position = g.getAttribute('position');
  const normal = g.getAttribute('normal');
  const uv = new Float32Array(position.count * 2);
  for (let i = 0; i < position.count; i++) {
    const [u, v] = project(
      position.getX(i),
      position.getY(i),
      position.getZ(i),
      normal.getX(i),
      normal.getY(i),
      normal.getZ(i),
    );
    uv[i * 2] = u;
    uv[i * 2 + 1] = v;
  }
  return uv;
}

/** What lies on the plan is projected in the world, so neighbours line up; the rest in its own frame. */
const projectsInWorld = (shape: DrawShape) => shape.kind === 'prism' || shape.kind === 'surface';

/** Whether the batches of a finish carry texture coordinates: only a textured finish needs them. */
export const finishHasTexture = (finish: string) => finishes.get(finish)?.texture !== undefined;

function merge(
  items: DrawItem[],
  transparent: boolean,
  textured: boolean,
): { geometry: BufferGeometry; triangles: number } {
  const uvs: Float32Array[] = [];
  const parts = items.map((item) => {
    const g = shapeGeometry(item.shape);
    const local = textured && !item.uv && !projectsInWorld(item.shape);
    if (local) uvs.push(projectUvs(g, boxProjection));
    g.applyMatrix4(matrix.fromArray(item.matrix));
    if (textured && !local) uvs.push(projectUvs(g, item.uv ? planar(item.uv) : boxProjection));
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
  const uv = textured ? new Float32Array(vertices * 2) : undefined;
  const index = vertices > 65535 ? new Uint32Array(indices) : new Uint16Array(indices);
  let v = 0;
  let i = 0;
  parts.forEach((g, n) => {
    const item = items[n]!;
    const count = g.getAttribute('position').count;
    position.set(g.getAttribute('position').array, v * 3);
    normal.set(g.getAttribute('normal').array, v * 3);
    uv?.set(uvs[n]!, v * 2);
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
  if (uv) geometry.setAttribute('uv', new BufferAttribute(uv, 2));
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
      ...merge(list, first.material?.transparent === true, finishHasTexture(first.finish)),
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
 * The material of a catalogue piece's batch (the shell's batches draw with the material of their
 * finish, `finishes/materials.ts`). One instance per kind of surface, shared by every batch of that kind
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
