import {
  ACESFilmicToneMapping,
  AmbientLight,
  Box3,
  DirectionalLight,
  DoubleSide,
  Mesh,
  MeshStandardMaterial,
  PerspectiveCamera,
  Scene,
  Sphere,
  Vector3,
  WebGLRenderer,
} from 'three';
import { PART_FINISH, partItems, partShape } from '../builder/drawList';
import type { Part } from '../catalog/types';
import { finishMaterials } from '../finishes/materials';
import { batches, shapeGeometry } from '../scene/batches';

/** Thumbnails are square, this many pixels a side. */
export const THUMBNAIL_SIZE = 256;

const FOV = 30;
/** Three-quarter view: from the front (+z), a little right and above. */
const VIEW = new Vector3(0.9, 0.7, 1.6).normalize();

/** The one offscreen renderer: a phone allows only a few WebGL contexts per page. */
let renderer: WebGLRenderer | undefined;

function getRenderer(): WebGLRenderer {
  if (renderer) return renderer;
  const canvas = document.createElement('canvas');
  const created = new WebGLRenderer({
    canvas,
    alpha: true,
    antialias: true,
    preserveDrawingBuffer: true,
  });
  created.setPixelRatio(1);
  created.setSize(THUMBNAIL_SIZE, THUMBNAIL_SIZE, false);
  created.setClearColor(0x000000, 0);
  // As in the viewer (R3F's default).
  created.toneMapping = ACESFilmicToneMapping;
  canvas.addEventListener('webglcontextlost', () => {
    if (renderer === created) renderer = undefined;
  });
  renderer = created;
  return created;
}

/**
 * A mesh per part, with the part's own colour and transform. The viewer merges a piece's parts
 * (`PartsMesh`); a thumbnail is drawn once and cached, so it keeps the simple way.
 */
function partMesh(part: Part): Mesh {
  // No shadows here: only the material settings the part sets.
  const settings = Object.fromEntries(
    Object.entries(part.material ?? {}).filter(
      ([key, value]) => value !== undefined && key !== 'castShadow' && key !== 'receiveShadow',
    ),
  );
  // The viewer's own geometry of the part's shape (`scene/batches.ts`).
  const { shape, closed } = partShape(part);
  const mesh = new Mesh(
    shapeGeometry(shape),
    new MeshStandardMaterial({
      color: part.color,
      ...settings,
      // An open skin (a lathed shade) is seen from both sides.
      ...(!closed && { side: DoubleSide }),
    }),
  );
  mesh.position.set(...part.center);
  // The tilt about the part's own x first, then the turn about y (as the draw list's `transform`).
  mesh.rotation.set(part.rotationX ?? 0, part.rotationY, 0, 'YXZ');
  if (part.shape === 'cylinder') mesh.scale.set(1, 1, part.size[2] / part.size[0]);
  return mesh;
}

/** A thumbnail waits this long for the textures of its finishes, then draws their tints. */
const TEXTURE_WAIT_MS = 10_000;

/**
 * The parts that name a finish (§5.7), merged as the viewer merges them, with the finish's
 * material: its roughness, its metalness and, once the files are here, its texture.
 */
async function finishMeshes(parts: readonly Part[]): Promise<Mesh[]> {
  const items = partItems(parts, '', { kind: 'placement', id: '' }).filter(
    (item) => item.finish !== PART_FINISH,
  );
  if (items.length === 0) return [];
  const set = finishMaterials('phone');
  for (const item of items) set.textures.request(item.finish);
  if (set.textures.pending > 0) {
    await new Promise<void>((resolve) => {
      const done = () => {
        clearTimeout(timer);
        stop();
        resolve();
      };
      const timer = setTimeout(done, TEXTURE_WAIT_MS);
      const stop = set.textures.subscribe(() => set.textures.pending === 0 && done());
    });
  }
  return batches(items).map((b) => new Mesh(b.geometry, set.material(b.finish, b.material)));
}

/** Renders the parts with a fixed light and a three-quarter camera into a transparent PNG. */
export async function renderThumbnail(parts: readonly Part[]): Promise<Blob> {
  const gl = getRenderer();
  const scene = new Scene();
  const meshes = parts.filter((p) => p.material?.finish === undefined).map(partMesh);
  // Their materials are the finishes' own, shared with the pages: only the geometry is freed.
  const finished = await finishMeshes(parts);
  scene.add(...meshes, ...finished);
  scene.add(new AmbientLight(0xffffff, 1.1));
  const sun = new DirectionalLight(0xffffff, 2.2);
  sun.position.set(3, 5, 4);
  scene.add(sun);

  const sphere = new Box3().setFromObject(scene).getBoundingSphere(new Sphere());
  const radius = Math.max(sphere.radius, 0.05);
  const distance = (radius / Math.sin(((FOV / 2) * Math.PI) / 180)) * 1.08;
  const camera = new PerspectiveCamera(FOV, 1, distance / 100, distance * 4);
  camera.position.copy(sphere.center).addScaledVector(VIEW, distance);
  camera.lookAt(sphere.center);

  try {
    gl.render(scene, camera);
    return await new Promise<Blob>((resolve, reject) =>
      gl.domElement.toBlob(
        (blob) => (blob ? resolve(blob) : reject(new Error('The thumbnail could not be read'))),
        'image/png',
      ),
    );
  } finally {
    for (const mesh of meshes) {
      mesh.geometry.dispose();
      (mesh.material as MeshStandardMaterial).dispose();
    }
    for (const mesh of finished) mesh.geometry.dispose();
  }
}
