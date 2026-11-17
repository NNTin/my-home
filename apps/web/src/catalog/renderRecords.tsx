import ReactThreeTestRenderer from '@react-three/test-renderer';
import type { ReactNode } from 'react';
import { Color, type BufferGeometry, type Material, type Mesh, type Object3D } from 'three';

/**
 * Test-only: renders R3F children into a three.js scene without WebGL and serialises every mesh,
 * in draw order, into plain records. The golden snapshots in `__golden__/` are these records:
 * a refactor of the renderer that keeps them unchanged draws the same pixels.
 *
 * `path` is the index of the top-level object the mesh belongs to plus its index among that
 * object's meshes, so wrapping a mesh in a group does not change it (the world matrix is what
 * counts). Numbers are rounded to 1e-6 against float noise.
 */
export interface RenderRecord {
  path: string;
  kind: 'mesh';
  geometry: {
    type: string;
    parameters?: Record<string, unknown>;
    vertices?: number;
    hash?: string;
  };
  matrixWorld: number[];
  material: Record<string, unknown>;
  castShadow: boolean;
  receiveShadow: boolean;
}

let exact = false;
const round = (n: number) => {
  const r = exact ? n : Math.round(n * 1e6) / 1e6;
  return Object.is(r, -0) ? 0 : r;
};

/** FNV-1a over the rounded vertex positions: a short fingerprint of a non-parametric shape. */
function positionHash(geometry: BufferGeometry) {
  const position = geometry.getAttribute('position');
  let h = 0x811c9dc5;
  for (let i = 0; i < position.count * position.itemSize; i++) {
    const text = String(round(position.array[i]!));
    for (let j = 0; j < text.length; j++) {
      h ^= text.charCodeAt(j);
      h = Math.imul(h, 0x01000193) >>> 0;
    }
    h ^= 0x2c;
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}

const PARAMETRIC = new Set(['BoxGeometry', 'CylinderGeometry', 'RingGeometry']);

function geometryRecord(geometry: BufferGeometry): RenderRecord['geometry'] {
  const { type } = geometry;
  if (PARAMETRIC.has(type)) {
    const parameters = (geometry as BufferGeometry & { parameters: Record<string, unknown> })
      .parameters;
    return {
      type,
      parameters: Object.fromEntries(
        Object.entries(parameters).map(([k, v]) => [k, typeof v === 'number' ? round(v) : v]),
      ),
    };
  }
  return {
    type,
    vertices: geometry.getAttribute('position').count,
    hash: positionHash(geometry),
  };
}

function materialRecord(material: Material) {
  const m = material as Material & {
    color?: Color;
    emissive?: Color;
    emissiveIntensity?: number;
    metalness?: number;
    roughness?: number;
  };
  return {
    type: m.type,
    ...(m.color && { color: `#${m.color.getHexString()}` }),
    ...(m.emissive && { emissive: `#${m.emissive.getHexString()}` }),
    ...(m.emissiveIntensity !== undefined && { emissiveIntensity: round(m.emissiveIntensity) }),
    opacity: round(m.opacity),
    transparent: m.transparent,
    depthWrite: m.depthWrite,
    ...(m.metalness !== undefined && { metalness: round(m.metalness) }),
    ...(m.roughness !== undefined && { roughness: round(m.roughness) }),
    side: m.side,
  };
}

/** The meshes of `root`'s subtree in depth-first (draw) order. */
function meshesOf(root: Object3D): Mesh[] {
  const meshes: Mesh[] = [];
  root.traverse((o) => {
    if ((o as Mesh).isMesh) meshes.push(o as Mesh);
  });
  return meshes;
}

/** `exact` skips the rounding: for checking a refactor for float noise locally. */
export async function renderRecords(
  element: ReactNode,
  options: { exact?: boolean } = {},
): Promise<RenderRecord[]> {
  exact = options.exact ?? false;
  const renderer = await ReactThreeTestRenderer.create(element);
  const scene = renderer.scene.instance as Object3D;
  scene.updateMatrixWorld(true);
  // The single root group the component returns, or the scene itself.
  const root = scene.children.length === 1 ? scene.children[0]! : scene;
  const records = root.children.flatMap((top, i) =>
    meshesOf(top).map((mesh, j): RenderRecord => ({
      path: `${i}/${j}`,
      kind: 'mesh',
      geometry: geometryRecord(mesh.geometry),
      matrixWorld: mesh.matrixWorld.elements.map(round),
      material: materialRecord(Array.isArray(mesh.material) ? mesh.material[0]! : mesh.material),
      castShadow: mesh.castShadow,
      receiveShadow: mesh.receiveShadow,
    })),
  );
  await renderer.unmount();
  return records;
}

/** One JSON line per record: a reviewable diff when a design change updates a golden. */
export const goldenJson = (records: RenderRecord[]) =>
  `[\n${records.map((r) => `  ${JSON.stringify(r)}`).join(',\n')}\n]\n`;
