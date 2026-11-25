import {
  BoxGeometry,
  BufferAttribute,
  BufferGeometry,
  DataTexture,
  DepthTexture,
  Group,
  Matrix4,
  Mesh,
  MeshStandardMaterial,
  PerspectiveCamera,
  Plane,
  Scene,
  Vector3,
  WebGLRenderTarget,
} from 'three';
import { describe, expect, it } from 'vitest';
import {
  boundaryEdges,
  covered,
  coverOf,
  createTufts,
  edgeTufts,
  hash,
  MAX_TUFTS,
  meshTriangles,
  NEAR_RADIUS,
  nearTufts,
  tuftGeometry,
  type SceneHook,
  type Triangle,
} from './tufts';

/** A lawn of `w` by `d` metres from the origin, at height `y`, as two triangles. */
function lawnGeometry(w: number, d: number, y = 0): BufferGeometry {
  const geometry = new BufferGeometry();
  geometry.setAttribute(
    'position',
    new BufferAttribute(new Float32Array([0, y, 0, w, y, 0, w, y, d, 0, y, d]), 3),
  );
  geometry.setIndex([0, 2, 1, 0, 3, 2]);
  return geometry;
}

const texture = (size: number) => new DataTexture(new Uint8Array(size * size * 4), size, size);

function lawnMesh(w = 10, d = 8, map = texture(2), planes: Plane[] = []): Mesh {
  const material = new MeshStandardMaterial({ map, clippingPlanes: planes });
  material.name = 'grass.lawn';
  return new Mesh(lawnGeometry(w, d), material);
}

const beautiful = () => {
  const target = new WebGLRenderTarget(4, 4);
  target.depthTexture = new DepthTexture(4, 4);
  return target;
};
const fast = () => new WebGLRenderTarget(4, 4);
const cameraAt = (x: number, y: number, z: number) => {
  const camera = new PerspectiveCamera();
  camera.position.set(x, y, z);
  camera.updateMatrixWorld();
  return camera;
};
/** What the renderer does before it draws a frame of the scene into `target`. */
const frame = (scene: Scene, camera: PerspectiveCamera, target: WebGLRenderTarget | null) =>
  (scene as unknown as { onBeforeRender: SceneHook }).onBeforeRender(
    undefined,
    scene,
    camera,
    target,
  );

describe('the hash', () => {
  it('is the same for the same place and spreads over 0..1', () => {
    expect(hash(1.25, -3.5, 2)).toBe(hash(1.25, -3.5, 2));
    expect(hash(1.25, -3.5, 2)).not.toBe(hash(1.25, -3.5, 3));
    const values = Array.from({ length: 2000 }, (_, i) => hash(i * 0.2, (i % 37) * 0.2));
    expect(Math.min(...values)).toBeGreaterThanOrEqual(0);
    expect(Math.max(...values)).toBeLessThan(1);
    const mean = values.reduce((sum, v) => sum + v, 0) / values.length;
    expect(mean).toBeGreaterThan(0.45);
    expect(mean).toBeLessThan(0.55);
  });
});

describe('the edges of a lawn', () => {
  const triangles = meshTriangles(new Mesh(lawnGeometry(10, 8)));

  it('are the sides no second triangle shares: not the diagonal', () => {
    expect(triangles).toHaveLength(2);
    const edges = boundaryEdges(triangles);
    expect(edges).toHaveLength(4);
    for (const [a, b] of edges) expect(a.x === b.x || a.z === b.z).toBe(true);
  });

  it('are read in the world, where the mesh stands', () => {
    const mesh = new Mesh(lawnGeometry(1, 1));
    const group = new Group();
    group.position.set(5, -1.65, 2);
    group.add(mesh);
    const [first] = meshTriangles(mesh);
    expect(first![0].toArray()).toEqual([5, -1.65, 2]);
  });

  it('get a tuft every 8 cm, within 4 cm of the edge to either side, on its surface', () => {
    const tufts = edgeTufts(triangles);
    // 36 m of edge.
    expect(tufts).toHaveLength(Math.round(10 / 0.08) * 2 + Math.round(8 / 0.08) * 2);
    for (const t of tufts) {
      expect(t.y).toBeCloseTo(0);
      const inside = Math.min(t.x, 10 - t.x, t.z, 8 - t.z);
      expect(Math.abs(inside)).toBeLessThanOrEqual(0.04 + 1e-9);
      // Higher than on the open lawn: the mower does not reach an edge.
      expect(t.height).toBeGreaterThanOrEqual(0.09);
      expect(t.height).toBeLessThanOrEqual(0.22);
    }
    expect(tufts.some((t) => Math.min(t.x, 10 - t.x, t.z, 8 - t.z) < 0)).toBe(true);
    expect(edgeTufts(triangles)).toEqual(tufts);
  });

  it('lie on a slope where the lawn slopes', () => {
    const sloped: Triangle[] = [
      [new Vector3(0, 0, 0), new Vector3(4, 0, 4), new Vector3(4, 0, 0)],
      [new Vector3(0, 0, 0), new Vector3(0, 0, 4), new Vector3(4, 0, 4)],
    ].map(
      (t) => t.map((p) => new Vector3(p.x, p.x * 0.25, p.z)) as unknown as Triangle,
    ) as Triangle[];
    for (const t of edgeTufts(sloped)) expect(t.y).toBeCloseTo(t.x * 0.25);
    for (const t of nearTufts(sloped, new Vector3(2, 1.6, 2))) expect(t.y).toBeCloseTo(t.x * 0.25);
  });
});

describe('the tufts near the camera', () => {
  const triangles = meshTriangles(new Mesh(lawnGeometry(40, 40)));

  it('stand on the lawn within 6 m of the eye, one a cell, small at the rim', () => {
    const eye = new Vector3(20, 1.6, 20);
    const tufts = nearTufts(triangles, eye);
    // About the cells of a disc whose radius on the ground is sqrt(6² - 1.6²).
    const cells = (Math.PI * (NEAR_RADIUS ** 2 - 1.6 ** 2)) / 0.2 ** 2;
    expect(tufts.length).toBeGreaterThan(cells * 0.9);
    expect(tufts.length).toBeLessThan(cells * 1.1);
    for (const t of tufts) {
      const distance = Math.hypot(t.x - eye.x, t.y - eye.y, t.z - eye.z);
      expect(distance).toBeLessThan(NEAR_RADIUS);
      if (distance > 5.9) expect(t.height).toBeLessThan(0.01);
      if (distance < 4.5) expect(t.height).toBeGreaterThanOrEqual(0.05);
    }
  });

  it('stay where they are when the camera moves', () => {
    const place = (t: { x: number; z: number }) => `${t.x.toFixed(4)},${t.z.toFixed(4)}`;
    const before = new Set(nearTufts(triangles, new Vector3(20, 1.6, 20)).map(place));
    const after = nearTufts(triangles, new Vector3(20.37, 1.6, 20.11)).map(place);
    // Nearly all of them are the same tufts: only the rim changes.
    expect(after.filter((p) => before.has(p)).length).toBeGreaterThan(after.length * 0.9);
  });

  it('are none off the lawn, and none from far away', () => {
    expect(nearTufts(triangles, new Vector3(-20, 1.6, 20))).toEqual([]);
    expect(nearTufts(triangles, new Vector3(20, 60, 20))).toEqual([]);
  });
});

describe('a tuft', () => {
  it('is four blades, each drawn from both sides, with normals that point up and a darker foot', () => {
    const geometry = tuftGeometry();
    const position = geometry.getAttribute('position');
    const normal = geometry.getAttribute('normal');
    const color = geometry.getAttribute('color');
    expect(position.count).toBe(4 * 2 * 3);
    for (let i = 0; i < position.count; i++) {
      expect([normal.getX(i), normal.getY(i), normal.getZ(i)]).toEqual([0, 1, 0]);
      const tip = i % 3 === 2;
      expect(position.getY(i) > 0).toBe(tip);
      expect(color.getX(i) > 1).toBe(tip);
      expect(Math.hypot(position.getX(i), position.getZ(i))).toBeLessThanOrEqual(0.5);
      expect(position.getY(i)).toBeLessThanOrEqual(1);
    }
  });
});

describe('the tufts of a scene', () => {
  it('are in the scene at once, and drawn only in a beautiful frame', () => {
    const scene = new Scene();
    scene.add(lawnMesh());
    const tufts = createTufts(scene);
    // In the scene before any frame: the warm-up compiles them (§4.5).
    expect(scene.children).toContain(tufts.mesh);
    expect(tufts.mesh.visible).toBe(true);
    expect(tufts.mesh.count).toBe(0);
    expect(tufts.mesh.instanceColor).not.toBeNull();

    const far = cameraAt(5, 80, 4);
    frame(scene, far, beautiful());
    const edge = tufts.mesh.count;
    expect(edge).toBe(edgeTufts(meshTriangles(scene.children[0] as Mesh)).length);
    // A fast frame, and a frame onto the canvas, draw none: an instanced mesh without instances
    // is no draw call.
    frame(scene, far, fast());
    expect(tufts.mesh.count).toBe(0);
    frame(scene, far, null);
    expect(tufts.mesh.count).toBe(0);
    // Beautiful again: the same tufts, and nothing is written again.
    const version = tufts.mesh.instanceMatrix.version;
    frame(scene, far, beautiful());
    expect(tufts.mesh.count).toBe(edge);
    expect(tufts.mesh.instanceMatrix.version).toBe(version);
    // Near the lawn there are more.
    frame(scene, cameraAt(5, 1.6, 4), beautiful());
    expect(tufts.mesh.count).toBeGreaterThan(edge + 500);
    expect(tufts.mesh.instanceMatrix.version).toBeGreaterThan(version);
    // Each stands upright where its tuft is.
    const matrix = new Matrix4();
    tufts.mesh.getMatrixAt(0, matrix);
    const at = new Vector3().setFromMatrixPosition(matrix);
    expect(at.y).toBeCloseTo(0);
    expect(new Vector3(0, 1, 0).transformDirection(matrix).y).toBeCloseTo(1);
  });

  it('casts no shadow, is not picked, and never holds more than its instances', () => {
    const scene = new Scene();
    scene.add(lawnMesh(400, 400));
    const tufts = createTufts(scene);
    expect(tufts.mesh.castShadow).toBe(false);
    expect(tufts.mesh.receiveShadow).toBe(true);
    expect(tufts.mesh.frustumCulled).toBe(false);
    const hits: never[] = [];
    tufts.mesh.raycast(undefined as never, hits);
    expect(hits).toEqual([]);
    frame(scene, cameraAt(200, 1.6, 200), beautiful());
    expect(tufts.mesh.count).toBe(MAX_TUFTS);
  });

  it('follow what is shown: a hidden lawn, a lawn without its texture, a new home', () => {
    const scene = new Scene();
    const group = new Group();
    const lawn = lawnMesh();
    const other = new Mesh(lawnGeometry(3, 3), new MeshStandardMaterial({ name: 'gravel.fine' }));
    group.add(lawn, other);
    scene.add(group);
    const tufts = createTufts(scene);
    const camera = cameraAt(5, 80, 4);
    frame(scene, camera, beautiful());
    const all = tufts.mesh.count;
    expect(all).toBeGreaterThan(0);
    // Hidden with its group (the cutaway hides an outdoor area).
    group.visible = false;
    frame(scene, camera, beautiful());
    expect(tufts.mesh.count).toBe(0);
    group.visible = true;
    frame(scene, camera, beautiful());
    expect(tufts.mesh.count).toBe(all);
    // Until the lawn's texture is here it is drawn in its tint: no green tufts on it.
    const material = lawn.material as MeshStandardMaterial;
    const map = material.map;
    material.map = texture(1);
    frame(scene, camera, beautiful());
    expect(tufts.mesh.count).toBe(0);
    material.map = map;
    // A rebuilt home: another geometry on the mesh, other tufts.
    lawn.geometry = lawnGeometry(20, 8);
    frame(scene, camera, beautiful());
    expect(tufts.mesh.count).toBeGreaterThan(all);
  });

  it('leave out what lies under a stepping stone, and stand around what is higher', () => {
    const scene = new Scene();
    scene.add(lawnMesh());
    const tufts = createTufts(scene);
    const camera = cameraAt(5, 1.6, 4);
    frame(scene, camera, beautiful());
    const open = tufts.mesh.count;
    const places = () => {
      const matrix = new Matrix4();
      return Array.from({ length: tufts.mesh.count }, (_, i) => {
        tufts.mesh.getMatrixAt(i, matrix);
        return new Vector3().setFromMatrixPosition(matrix);
      });
    };
    const under = (p: Vector3) => Math.abs(p.x - 5) < 0.5 && Math.abs(p.z - 4) < 0.5;
    expect(places().filter(under).length).toBeGreaterThan(15);
    // A slab of a metre, 3 cm thick, lying on the lawn.
    const stone = new Mesh(new BoxGeometry(1, 0.03, 1), new MeshStandardMaterial());
    stone.position.set(5, 0.015, 4);
    stone.updateMatrixWorld();
    scene.add(stone);
    frame(scene, camera, beautiful());
    expect(places().filter(under)).toHaveLength(0);
    expect(tufts.mesh.count).toBeLessThan(open);
    expect(tufts.mesh.count).toBeGreaterThan(open - 60);
    // Moved away, the grass is back where it lay.
    stone.position.set(50, 0.015, 4);
    stone.updateMatrixWorld();
    frame(scene, camera, beautiful());
    expect(tufts.mesh.count).toBe(open);
    // A chair-high box, a flat surface and a block the size of a terrace cover nothing.
    for (const size of [
      [1, 0.9, 1],
      [1, 0, 1],
      [5, 0.2, 5],
    ] as const) {
      const other = new Mesh(new BoxGeometry(...size), new MeshStandardMaterial());
      other.position.set(5, size[1] / 2, 4);
      other.updateMatrixWorld();
      expect(coverOf(other)).toBeUndefined();
    }
    // A slab that lies a storey higher (on another level) covers nothing down here.
    stone.position.set(5, 2.6, 4);
    stone.updateMatrixWorld();
    expect(covered(coverOf(stone)!, { x: 5, y: 0, z: 4 })).toBe(false);
  });

  it('are cut by a section with the home: they hold the home’s cutting planes', () => {
    const planes: Plane[] = [];
    const scene = new Scene();
    scene.add(lawnMesh(10, 8, texture(2), planes));
    const tufts = createTufts(scene);
    expect((tufts.mesh.material as MeshStandardMaterial).clippingPlanes).toBe(planes);
  });

  it('leave the scene as it was when they go', () => {
    const scene = new Scene();
    scene.add(lawnMesh());
    const before = scene.onBeforeRender;
    const tufts = createTufts(scene);
    expect(scene.onBeforeRender).not.toBe(before);
    tufts.dispose();
    expect(scene.onBeforeRender).toBe(before);
    expect(scene.children).not.toContain(tufts.mesh);
  });

  it('a second set of tufts keeps drawing when the first goes after it came', () => {
    // A new frame output brings a new pass; the old one may be disposed after that.
    const scene = new Scene();
    scene.add(lawnMesh());
    const first = createTufts(scene);
    const second = createTufts(scene);
    first.dispose();
    frame(scene, cameraAt(5, 80, 4), beautiful());
    expect(second.mesh.count).toBeGreaterThan(0);
    expect(first.mesh.count).toBe(0);
    expect(scene.children).toContain(second.mesh);
  });

  it('rewrites nothing while the camera moves far from every lawn, and sends only what is used', () => {
    const scene = new Scene();
    scene.add(lawnMesh());
    const tufts = createTufts(scene);
    frame(scene, cameraAt(5, 80, 4), beautiful());
    const { instanceMatrix, instanceColor } = tufts.mesh;
    const version = instanceMatrix.version;
    expect(instanceMatrix.updateRanges).toEqual([{ start: 0, count: tufts.mesh.count * 16 }]);
    expect(instanceColor!.updateRanges).toEqual([{ start: 0, count: tufts.mesh.count * 3 }]);
    frame(scene, cameraAt(40, 60, -30), beautiful());
    frame(scene, cameraAt(-20, 30, 10), beautiful());
    expect(instanceMatrix.version).toBe(version);
    // Down on the lawn every step is another set of tufts.
    frame(scene, cameraAt(5, 1.6, 4), beautiful());
    frame(scene, cameraAt(5.3, 1.6, 4), beautiful());
    expect(instanceMatrix.version).toBe(version + 2);
  });
});
