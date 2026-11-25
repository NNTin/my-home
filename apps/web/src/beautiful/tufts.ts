import {
  Box3,
  BufferAttribute,
  BufferGeometry,
  Color,
  InstancedMesh,
  Matrix4,
  MeshStandardMaterial,
  Quaternion,
  Vector3,
  type Camera,
  type Mesh,
  type Object3D,
  type Plane,
  type Scene,
  type WebGLRenderTarget,
} from 'three';

/**
 * Grass tufts on the lawns (docs/design/realistic-render.md §8.3): small bunches of blades along
 * every lawn's edges and within 6 m of the camera, in beautiful frames only.
 *
 * They are one instanced mesh that is in the scene from the moment this chunk arrives, so the
 * warm-up compiles its program with everything else (§4.5). A fast frame draws it with no
 * instances, which is no draw call: switching tier shows and hides the tufts without compiling
 * anything. Which tier a frame is, the mesh reads from the target the frame is drawn into: only
 * the beautiful tier's has a depth texture (`scene/output.ts`).
 *
 * Under something low that lies on a lawn (a stepping stone) there are none.
 *
 * Nothing here is random: a tuft's place, turn and size come from a hash of where it stands, so
 * the same view draws the same pixels (§6.7).
 */

/** The finish whose surfaces grow tufts; a mesh's material is named after its finish. */
const LAWN = 'grass.lawn';
/** Tufts stand this close to the camera, and are full-grown inside `NEAR_FULL` of it. */
export const NEAR_RADIUS = 6;
const NEAR_FULL = 4.5;
/** Near the camera a tuft stands in every cell of this size; along an edge every `EDGE_STEP`. */
const NEAR_CELL = 0.2;
const EDGE_STEP = 0.08;
/**
 * Where the mower does not reach, grass stands higher: an edge tuft is this much larger than one
 * on the open lawn, 9 to 22 cm high. It is what shows of the tufts from far away.
 */
const EDGE_GROWTH = 1.8;
/**
 * An edge tuft stands on the edge or up to this far to either side of it: grass grows over a
 * border, which is what makes a lawn's outline ragged against paving and gravel.
 */
const EDGE_INSET = 0.04;
/** The mesh holds at most this many tufts: 8 triangles each. */
export const MAX_TUFTS = 8192;
/** The mean colour of the lawn's texture (`grass-lawn/color-512.webp`). */
const LAWN_COLOR = '#606d30';
const BLADES = 4;

/** A triangle of a lawn in the world: three corners, x y z each. */
export type Triangle = readonly [Vector3, Vector3, Vector3];

/** One bunch of blades: where it stands, its turn about the vertical, its size and its shade. */
export interface Tuft {
  x: number;
  y: number;
  z: number;
  turn: number;
  width: number;
  height: number;
  /** A factor on the lawn's colour, about 1. */
  shade: number;
}

/** A number in 0..1 from two coordinates and a salt: the same for the same place, always. */
export function hash(a: number, b: number, salt = 0): number {
  let h =
    Math.imul(Math.round(a * 1000) | 0, 374761393) ^ Math.imul(Math.round(b * 1000) | 0, 668265263);
  h = Math.imul(h ^ (h >>> 13) ^ Math.imul(salt + 1, 1274126177), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/** The triangles of a mesh in the world. */
export function meshTriangles(mesh: Mesh): Triangle[] {
  mesh.updateWorldMatrix(true, false);
  const position = mesh.geometry.getAttribute('position');
  const index = mesh.geometry.getIndex();
  const count = index ? index.count : position.count;
  const corner = (i: number) =>
    new Vector3()
      .fromBufferAttribute(position, index ? index.getX(i) : i)
      .applyMatrix4(mesh.matrixWorld);
  const triangles: Triangle[] = [];
  for (let i = 0; i + 2 < count; i += 3) triangles.push([corner(i), corner(i + 1), corner(i + 2)]);
  return triangles;
}

const key = (p: Vector3) => `${Math.round(p.x * 1000)},${Math.round(p.z * 1000)}`;

/**
 * The edges of a lawn: the sides of its triangles that no other triangle shares, each with the
 * third corner of its triangle, which says where the inside is.
 */
export function boundaryEdges(triangles: readonly Triangle[]): [Vector3, Vector3, Vector3][] {
  const sides = new Map<string, [Vector3, Vector3, Vector3] | null>();
  for (const t of triangles) {
    for (let i = 0; i < 3; i++) {
      const [a, b, c] = [t[i]!, t[(i + 1) % 3]!, t[(i + 2) % 3]!];
      const [ka, kb] = [key(a), key(b)];
      const id = ka < kb ? `${ka}|${kb}` : `${kb}|${ka}`;
      sides.set(id, sides.has(id) ? null : [a, b, c]);
    }
  }
  return [...sides.values()].filter((s) => s !== null);
}

const tuftAt = (x: number, y: number, z: number, grown = 1): Tuft => ({
  x,
  y,
  z,
  turn: hash(x, z, 1) * Math.PI * 2,
  width: (0.05 + 0.05 * hash(x, z, 2)) * grown,
  height: (0.05 + 0.07 * hash(x, z, 3)) * grown,
  shade: 0.8 + 0.4 * hash(x, z, 4),
});

/** Tufts along the edges of a lawn, on its surface's plane. */
export function edgeTufts(triangles: readonly Triangle[]): Tuft[] {
  const tufts: Tuft[] = [];
  const along = new Vector3();
  const inward = new Vector3();
  for (const [a, b, c] of boundaryEdges(triangles)) {
    along.subVectors(b, a);
    const length = along.length();
    if (length < 1e-6) continue;
    along.divideScalar(length);
    // Towards the third corner, at right angles to the edge.
    inward.subVectors(c, a).addScaledVector(along, -inward.subVectors(c, a).dot(along));
    if (inward.lengthSq() < 1e-12) continue;
    inward.normalize();
    const count = Math.max(1, Math.round(length / EDGE_STEP));
    for (let i = 0; i < count; i++) {
      const t = ((i + 0.5) / count) * length;
      // A side that lies along shorter sides of other triangles is shared, though no one side
      // is its twin: where the lawn goes on beyond it, it is no edge.
      const [ox, oz] = [a.x + along.x * t - inward.x * 0.02, a.z + along.z * t - inward.z * 0.02];
      if (triangles.some((other) => heightIn(other, ox, oz) !== undefined)) continue;
      const inset = EDGE_INSET * (2 * hash(a.x + along.x * t, a.z + along.z * t, 5) - 1);
      tufts.push(
        tuftAt(
          a.x + along.x * t + inward.x * inset,
          a.y + along.y * t + inward.y * inset,
          a.z + along.z * t + inward.z * inset,
          EDGE_GROWTH,
        ),
      );
    }
  }
  return tufts;
}

/** The height of a triangle's plane over the plan point, or undefined outside the triangle. */
function heightIn([a, b, c]: Triangle, x: number, z: number): number | undefined {
  const d = (b.z - c.z) * (a.x - c.x) + (c.x - b.x) * (a.z - c.z);
  if (Math.abs(d) < 1e-12) return undefined;
  const u = ((b.z - c.z) * (x - c.x) + (c.x - b.x) * (z - c.z)) / d;
  const v = ((c.z - a.z) * (x - c.x) + (a.x - c.x) * (z - c.z)) / d;
  const w = 1 - u - v;
  return u < 0 || v < 0 || w < 0 ? undefined : u * a.y + v * b.y + w * c.y;
}

/**
 * Tufts on a lawn within `NEAR_RADIUS` of the eye: one in every cell of a grid that is fixed in
 * the world, so they stay where they are while the camera moves. They grow in from nothing at
 * the radius, so none appears at once.
 */
export function nearTufts(triangles: readonly Triangle[], eye: Vector3): Tuft[] {
  const tufts: Tuft[] = [];
  // Far from the whole lawn (the overview, a named view) there is no cell to look at.
  const reach = (axis: 'x' | 'y' | 'z') => {
    const at = triangles.flatMap((t) => t.map((p) => p[axis]));
    return Math.max(Math.min(...at) - eye[axis], eye[axis] - Math.max(...at));
  };
  if (Math.max(reach('x'), reach('y'), reach('z')) >= NEAR_RADIUS) return tufts;
  const cells = Math.ceil(NEAR_RADIUS / NEAR_CELL);
  const [cx, cz] = [Math.round(eye.x / NEAR_CELL), Math.round(eye.z / NEAR_CELL)];
  for (let i = -cells; i <= cells; i++) {
    for (let j = -cells; j <= cells; j++) {
      const [gx, gz] = [(cx + i) * NEAR_CELL, (cz + j) * NEAR_CELL];
      const x = gx + (hash(gx, gz, 6) - 0.5) * NEAR_CELL;
      const z = gz + (hash(gx, gz, 7) - 0.5) * NEAR_CELL;
      // Cheap first: the plan distance is never more than the distance.
      if (Math.hypot(x - eye.x, z - eye.z) >= NEAR_RADIUS) continue;
      for (const triangle of triangles) {
        const y = heightIn(triangle, x, z);
        if (y === undefined) continue;
        const distance = Math.hypot(x - eye.x, y - eye.y, z - eye.z);
        const grown = Math.min(1, (NEAR_RADIUS - distance) / (NEAR_RADIUS - NEAR_FULL));
        if (grown > 0) tufts.push(tuftAt(x, y, z, grown));
        break;
      }
    }
  }
  return tufts;
}

/**
 * One tuft, a unit wide and high about its foot: four blades that lean out of a small ring. Every
 * normal points up, so a tuft takes the light and the sun's shadow as the lawn under it does;
 * a blade is darker at its foot.
 */
export function tuftGeometry(): BufferGeometry {
  const position: number[] = [];
  const color: number[] = [];
  for (let b = 0; b < BLADES; b++) {
    const angle = ((b + hash(b, 1, 8)) / BLADES) * Math.PI * 2;
    const [dx, dz] = [Math.sin(angle), Math.cos(angle)];
    const foot = 0.12;
    const lean = 0.25 + 0.25 * hash(b, 2, 8);
    const half = 0.1;
    const left = [dx * foot - dz * half, 0, dz * foot + dx * half];
    const right = [dx * foot + dz * half, 0, dz * foot - dx * half];
    const tip = [dx * lean, 0.7 + 0.3 * hash(b, 3, 8), dz * lean];
    // Both ways round: a blade is seen from both sides, and its normal must point up from both.
    // A double-sided material would turn the normal of the far side down, and draw it unlit.
    position.push(...left, ...right, ...tip, ...right, ...left, ...tip);
    for (let side = 0; side < 2; side++)
      color.push(0.75, 0.75, 0.75, 0.75, 0.75, 0.75, 1.25, 1.25, 1.25);
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new BufferAttribute(new Float32Array(position), 3));
  geometry.setAttribute(
    'normal',
    new BufferAttribute(
      new Float32Array(position.length).map((_, i) => (i % 3 === 1 ? 1 : 0)),
      3,
    ),
  );
  geometry.setAttribute('color', new BufferAttribute(new Float32Array(color), 3));
  return geometry;
}

function shown(object: Object3D): boolean {
  for (let o: Object3D | null = object; o; o = o.parent) if (!o.visible) return false;
  return true;
}

/** Whether the lawn is drawn with its texture: a lawn in its tint alone is not green yet. */
const textured = (mesh: Mesh) =>
  ((mesh.material as MeshStandardMaterial).map?.image as { width?: number } | undefined)?.width !==
  1;

/** What the renderer calls before it draws a frame of a scene. */
export type SceneHook = (
  renderer: unknown,
  scene: Scene,
  camera: Camera,
  target: WebGLRenderTarget | null,
) => void;

/** Something lower than this lies on the ground: a stepping stone, a slab, a cover. */
const COVER_HEIGHT = 0.3;
/** Larger than this in plan it is ground itself (paving, a terrain block), not something on it. */
const COVER_AREA = 12;

/**
 * The box of a mesh that may lie on a lawn and cover its grass: a solid (not a flat surface) no
 * larger than a slab. Whether it does lie on the lawn is decided per tuft (`covered`). Tufts
 * stand around the foot of what is higher (a chair, a shrub, a fence), as grass does.
 */
const scratch = new Box3();
export function coverOf(object: Mesh): Box3 | undefined {
  const { geometry } = object;
  if (!geometry.boundingBox) geometry.computeBoundingBox();
  const box = scratch.copy(geometry.boundingBox!).applyMatrix4(object.matrixWorld);
  const [w, h, d] = [box.max.x - box.min.x, box.max.y - box.min.y, box.max.z - box.min.z];
  // Nearly every mesh is none: only a cover gets a box of its own.
  return h > 0.005 && h <= COVER_HEIGHT && w * d <= COVER_AREA ? box.clone() : undefined;
}

/** Whether the tuft stands under a cover that lies on the ground there. */
export const covered = (cover: Box3, tuft: Pick<Tuft, 'x' | 'y' | 'z'>): boolean =>
  tuft.x > cover.min.x &&
  tuft.x < cover.max.x &&
  tuft.z > cover.min.z &&
  tuft.z < cover.max.z &&
  cover.min.y < tuft.y + 0.1 &&
  cover.max.y > tuft.y &&
  cover.max.y <= tuft.y + COVER_HEIGHT;

interface Lawn {
  mesh: Mesh;
  /** The geometry the tufts were made from: a new one is a new lawn. */
  geometry: BufferGeometry;
  triangles: Triangle[];
  edge: Tuft[];
}

/** The tufts of a scene: `mesh` is in it from the start, and `dispose` takes it out again. */
export interface Tufts {
  mesh: InstancedMesh;
  /** Fills the mesh for a frame from `camera` into `target`; a fast frame gets no tufts. */
  update(scene: Scene, camera: Camera, target: WebGLRenderTarget | null): void;
  dispose(): void;
}

/**
 * Puts the tufts into `scene`. They are filled before every frame the renderer draws of it
 * (`Scene.onBeforeRender`), from the lawns that are shown in that frame.
 */
export function createTufts(scene: Scene): Tufts {
  const geometry = tuftGeometry();
  // A section cuts the tufts with the lawn (§7.2): they hold the array of cutting planes that the
  // home's materials share, so they are compiled with the same planes from the start.
  let planes: Plane[] = [];
  scene.traverse((object) => {
    const cut = ((object as Mesh).material as MeshStandardMaterial | undefined)?.clippingPlanes;
    if (cut) planes = cut;
  });
  const material = new MeshStandardMaterial({
    name: 'tufts',
    vertexColors: true,
    roughness: 1,
    metalness: 0,
    clippingPlanes: planes,
  });
  const mesh = new InstancedMesh(geometry, material, MAX_TUFTS);
  mesh.name = 'tufts';
  mesh.count = 0;
  mesh.frustumCulled = false;
  mesh.castShadow = false;
  mesh.receiveShadow = true;
  // Nothing is picked through a tuft, and a tuft is never picked.
  mesh.raycast = () => undefined;
  const base = new Color(LAWN_COLOR);
  const color = new Color();
  // Every instance has a colour from the start: the attribute is part of the program.
  for (let i = 0; i < MAX_TUFTS; i++) mesh.setColorAt(i, base);
  scene.add(mesh);

  const lawns = new Map<Mesh, Lawn>();
  const matrix = new Matrix4();
  const turn = new Quaternion();
  const up = new Vector3(0, 1, 0);
  const at = new Vector3();
  const size = new Vector3();
  const eye = new Vector3();
  /** What the mesh holds: nothing is written while it stays the same. */
  let held = '';

  const update: Tufts['update'] = (frameScene, camera, target) => {
    if (!target?.depthTexture) {
      mesh.count = 0;
      return;
    }
    const found: Lawn[] = [];
    const covers: Box3[] = [];
    frameScene.traverse((object) => {
      const lawn = object as Mesh;
      if (!lawn.isMesh || lawn === mesh || !shown(lawn)) return;
      if ((lawn.material as { name?: string }).name !== LAWN) {
        const cover = coverOf(lawn);
        if (cover) covers.push(cover);
        return;
      }
      if (!textured(lawn)) return;
      let known = lawns.get(lawn);
      if (known?.geometry !== lawn.geometry) {
        const triangles = meshTriangles(lawn);
        known = { mesh: lawn, geometry: lawn.geometry, triangles, edge: edgeTufts(triangles) };
        lawns.set(lawn, known);
      }
      found.push(known);
    });
    for (const lawn of lawns.keys()) if (!lawn.parent) lawns.delete(lawn);
    camera.getWorldPosition(eye);
    const near = found.flatMap((lawn) => nearTufts(lawn.triangles, eye));
    const lying = covers.map((c) => [...c.min.toArray(), ...c.max.toArray()].join()).join(';');
    // Far from every lawn the tufts are the edges', wherever the camera is: nothing to rewrite.
    const from = near.length ? `${eye.x},${eye.y},${eye.z}` : '';
    const now = `${found.map((l) => l.geometry.uuid).join()}@${from}#${lying}`;
    if (now === held) {
      mesh.count = Math.min(MAX_TUFTS, mesh.userData.tufts as number);
      return;
    }
    held = now;
    let count = 0;
    const put = (tuft: Tuft) => {
      if (count >= MAX_TUFTS || covers.some((c) => covered(c, tuft))) return;
      turn.setFromAxisAngle(up, tuft.turn);
      matrix.compose(
        at.set(tuft.x, tuft.y, tuft.z),
        turn,
        size.set(tuft.width, tuft.height, tuft.width),
      );
      mesh.setMatrixAt(count, matrix);
      mesh.setColorAt(count, color.copy(base).multiplyScalar(tuft.shade));
      count++;
    };
    for (const lawn of found) lawn.edge.forEach(put);
    near.forEach(put);
    mesh.count = count;
    mesh.userData.tufts = count;
    // Only the instances in use are sent to the GPU, not the whole of both buffers.
    for (const [attribute, itemSize] of [
      [mesh.instanceMatrix, 16],
      [mesh.instanceColor!, 3],
    ] as const) {
      attribute.clearUpdateRanges();
      attribute.addUpdateRange(0, count * itemSize);
      attribute.needsUpdate = true;
    }
  };

  // three.js calls a scene's hook with the target the frame is drawn into as its fourth
  // argument (`WebGLRenderer.render`); its types describe the hook of an object in a scene.
  const hooked = scene as unknown as { onBeforeRender: SceneHook };
  const before = hooked.onBeforeRender;
  let gone = false;
  const hook: SceneHook = (renderer, frameScene, camera, target) => {
    before.call(scene, renderer, frameScene, camera, target);
    if (!gone) update(frameScene, camera, target);
  };
  hooked.onBeforeRender = hook;

  return {
    mesh,
    update,
    dispose() {
      // Whoever hooked the scene after these tufts keeps its hook, which calls this one: it
      // passes the call on and does nothing more.
      gone = true;
      if (hooked.onBeforeRender === hook) hooked.onBeforeRender = before;
      scene.remove(mesh);
      mesh.dispose();
      geometry.dispose();
      material.dispose();
    },
  };
}
