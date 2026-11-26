import { finishes } from '@my-home/shared';
import {
  Box3,
  DirectionalLight,
  Matrix4,
  Mesh,
  PerspectiveCamera,
  PointLight,
  Scene,
  type BufferGeometry,
  type Material,
  type Texture,
} from 'three';
// The tracer's types say what it reads off a material beyond three.js' own (`castShadow`).
import type {} from 'three-gpu-pathtracer/webgpu';
import type { HomeScene, Vec3 } from '../builder/buildHome';
import {
  groupShown,
  linearRgb,
  PART_FINISH,
  partItems,
  scenePieceDraws,
  shellItems,
  transform,
  wallSolidItems,
  type DrawItem,
  type DrawMaterial,
  type PlacementDraw,
} from '../builder/drawList';
import type { Visibility } from '../builder/visibility';
import type { FinishMaterials } from '../finishes/materials';
import { lampRooms, sceneEmitters, type EmitterSource } from '../lighting/lamps';
import { backdropColors, type BackdropColors, type LightRig } from '../lighting/rig';
import { batchMaterial, batches, shapeGeometry } from '../scene/batches';
import { extentDistance, frameDistance } from '../scene/Scene';
import type { FrameRequest } from '../placements/focus';
import { CAP_FINISH, capped, furnitureItems, type CapKind } from '../views/caps';
import { stageGround } from '../views/Stage';
import { capGeometry, clipGeometry, sectionLoops, type CutPlane } from './cut';
import { studioEquirect } from './studio';

/**
 * The scene render mode traces (docs/design/realistic-render.md §9), from the same inputs as the
 * frame it replaces: the draw list of what is shown, merged by the viewer's own batching; the
 * finishes with their textures; the light rig; and for a section a real cut of the geometry.
 * Everything here is plain three.js and needs no GPU: the tracer (`tracer.ts`) takes the result.
 */

export interface TraceInputs {
  scene: HomeScene;
  /** The furniture that is drawn, as the viewer's scene gets it (`furnitureViews`). */
  placements: readonly (PlacementDraw & EmitterSource)[];
  visibility: Visibility;
  /** "Plan colours" (§5.5). */
  planColours: boolean;
  /** How the view is lit, with the backdrop that is shown. */
  rig: LightRig;
  /** The view is from inside a room: the backdrop is its gradient (§6.3). */
  eye: boolean;
  /** The cut of a section (`sectionPlane`); nothing is cut without it. */
  plane?: CutPlane | undefined;
  /** A named view stands on the neutral ground (§7.3); the free view does not. */
  ground: boolean;
  /** The materials of finishes, with the textures that have arrived (`whenTexturesArrived`). */
  materials: FinishMaterials;
}

/** One mesh of the traced scene, before it has a material. */
export interface TraceMesh {
  key: string;
  geometry: BufferGeometry;
  finish: string;
  material: DrawMaterial | undefined;
  castShadow: boolean;
}

/** A wall's cap lies this far in front of the soil's, so it is the one that shows (§7.2). */
const CAP_LIFT = 0.001;

const matrix = new Matrix4();
const box = new Box3();

/** Whether the plane goes through the box of a geometry: only then is there anything to cap. */
function straddles(geometry: BufferGeometry, { normal: [nx, ny, nz], constant }: CutPlane) {
  geometry.computeBoundingBox();
  box.copy(geometry.boundingBox!);
  const near =
    Math.min(nx * box.min.x, nx * box.max.x) +
    Math.min(ny * box.min.y, ny * box.max.y) +
    Math.min(nz * box.min.z, nz * box.max.z);
  const far =
    Math.max(nx * box.min.x, nx * box.max.x) +
    Math.max(ny * box.min.y, ny * box.max.y) +
    Math.max(nz * box.min.z, nz * box.max.z);
  return near + constant < 0 && far + constant > 0;
}

/** The draw items of what the view shows, in the world. */
export function shownItems(
  inputs: Pick<TraceInputs, 'scene' | 'placements' | 'visibility' | 'planColours'>,
): { drawn: DrawItem[]; solids: DrawItem[] } {
  const { scene, visibility } = inputs;
  const shown = (item: DrawItem) => groupShown(item.group, scene, visibility);
  const home = [
    ...shellItems(scene, { planColours: inputs.planColours }),
    ...scenePieceDraws(scene).flatMap((p) =>
      partItems(p.parts, p.id, p.group, transform(p.position, p.rotationY, p.rotationX)),
    ),
  ].filter(shown);
  const placed = furnitureItems(inputs.placements);
  return {
    drawn: [...home, ...placed],
    // What a section caps: the closed solids. A wall is drawn as faces, which have no inside:
    // it is capped as its solid stretches (§7.2).
    solids: [...home, ...wallSolidItems(scene).filter(shown), ...placed].filter(capped),
  };
}

/** The caps of the solids the plane cuts: one mesh for the soil and one for everything else. */
function caps(solids: readonly DrawItem[], plane: CutPlane): TraceMesh[] {
  const loops: Record<CapKind, Vec3[][][]> = { soil: [], dark: [] };
  for (const item of solids) {
    const geometry = shapeGeometry(item.shape).applyMatrix4(matrix.fromArray(item.matrix));
    if (straddles(geometry, plane)) {
      const found = sectionLoops(geometry, plane);
      if (found.length > 0) loops[item.finish === CAP_FINISH.soil ? 'soil' : 'dark'].push(found);
    }
    geometry.dispose();
  }
  return (['soil', 'dark'] as const).flatMap((kind): TraceMesh[] => {
    const finish = CAP_FINISH[kind];
    const geometry = capGeometry(
      loops[kind],
      plane,
      linearRgb(finishes.get(finish)?.tint ?? '#ffffff'),
      kind === 'dark' ? CAP_LIFT : 0,
    );
    return geometry
      ? [{ key: `cap:${kind}`, geometry, finish, material: undefined, castShadow: true }]
      : [];
  });
}

/**
 * The meshes of the traced scene: the viewer's batches of what is shown, the ground of a named
 * view, and with a plane everything cut by it and the cut solids capped.
 */
export function traceMeshes(
  inputs: Pick<
    TraceInputs,
    'scene' | 'placements' | 'visibility' | 'planColours' | 'plane' | 'ground' | 'rig'
  >,
): TraceMesh[] {
  const { plane } = inputs;
  const { drawn, solids } = shownItems(inputs);
  const meshes: TraceMesh[] = batches(drawn).map((b) => ({
    key: b.key,
    geometry: b.geometry,
    finish: b.finish,
    material: b.material,
    castShadow: b.castShadow,
  }));
  if (inputs.ground) {
    const { place, geometry } = stageGround(inputs.scene, inputs.rig.backdrop);
    meshes.push({
      key: 'ground',
      geometry: geometry.translate(...place.center),
      finish: PART_FINISH,
      material: { transparent: true, depthWrite: false },
      castShadow: false,
    });
  }
  if (!plane) return meshes;
  const cut = meshes.flatMap((mesh): TraceMesh[] => {
    const geometry = clipGeometry(mesh.geometry, plane);
    if (geometry !== mesh.geometry) mesh.geometry.dispose();
    return geometry ? [{ ...mesh, geometry }] : [];
  });
  return [...cut, ...caps(solids, plane)];
}

/** The finishes whose textures the scene needs: asked for before it is built. */
export const traceFinishes = (meshes: readonly TraceMesh[]): string[] => [
  ...new Set(meshes.map((m) => m.finish).filter((finish) => finish !== PART_FINISH)),
];

/** Resolves when every texture file of the finishes has arrived or failed (§4.4). */
export function whenTexturesArrived(
  materials: FinishMaterials,
  used: readonly string[],
): Promise<void> {
  const { textures } = materials;
  for (const finish of used) textures.request(finish);
  return new Promise((resolve) => {
    if (textures.pending === 0) return resolve();
    const stop = textures.subscribe(() => {
      if (textures.pending > 0) return;
      stop();
      resolve();
    });
  });
}

/** How far the sun stands from the middle of the scene: a direction is all the tracer reads. */
const SUN_DISTANCE = 39;

/** `#rrggbb` of a backdrop as a CSS background: the image stands in front of it (D23). */
export const backdropCss = ({ top, bottom }: BackdropColors): string =>
  top === bottom ? top : `linear-gradient(${top}, ${bottom})`;

export interface TraceScene {
  scene: Scene;
  meshes: number;
  triangles: number;
  lamps: number;
  /** What is behind the image, as a CSS background (D23). */
  backdrop: string;
  /** Tone-mapping exposure of the rig. */
  exposure: number;
  dispose(): void;
}

/** The three.js scene the tracer is given: meshes with materials, the lights, the environment. */
export function buildTraceScene(inputs: TraceInputs, meshes = traceMeshes(inputs)): TraceScene {
  const { rig, materials } = inputs;
  const scene = new Scene();
  // The tracer reads its own copy of a material: a setting it adds (`castShadow`) is not the
  // viewer's. The textures are the same images, uploaded to the tracer's own device.
  const copies = new Map<string, Material>();
  const materialOf = (mesh: TraceMesh): Material => {
    const source =
      mesh.finish === PART_FINISH
        ? batchMaterial(mesh.material)
        : materials.material(mesh.finish, mesh.material);
    const key = `${source.uuid}|${mesh.castShadow}`;
    let copy = copies.get(key);
    if (!copy) {
      copy = source.clone();
      copy.clippingPlanes = null;
      copy.castShadow = mesh.castShadow;
      copies.set(key, copy);
    }
    return copy;
  };
  let triangles = 0;
  for (const mesh of meshes) {
    scene.add(new Mesh(mesh.geometry, materialOf(mesh)));
    triangles += (mesh.geometry.index?.count ?? mesh.geometry.getAttribute('position').count) / 3;
  }

  const sun = new DirectionalLight(rig.sun.color, rig.sun.intensity);
  const [x, y, z] = rig.sun.direction;
  const scale = SUN_DISTANCE / (Math.hypot(x, y, z) || 1);
  sun.position.set(x * scale, y * scale, z * scale);
  scene.add(sun, sun.target);

  // Every fixture that is drawn is lit: the pool of the real-time tiers is a budget of theirs.
  const emitters = rig.lamps.on ? sceneEmitters(inputs.placements, lampRooms(inputs.scene)) : [];
  for (const emitter of emitters) {
    const lamp = new PointLight(
      emitter.color,
      emitter.intensity * rig.lamps.intensity,
      emitter.range,
      2,
    );
    lamp.position.set(...emitter.position);
    scene.add(lamp);
  }

  // The studio lights the scene; what the tracer finds in the way of it is its own shade, so
  // the intensity is the rig's everywhere (the real-time tiers lower it under a ceiling, §6.3).
  const environment: Texture = studioEquirect();
  scene.environment = environment;
  scene.environmentIntensity = rig.environment;
  // Nothing behind the scene: the image is laid over the backdrop, which keeps its colour (D23).
  scene.background = null;
  scene.updateMatrixWorld(true);

  return {
    scene,
    meshes: meshes.length,
    triangles,
    lamps: emitters.length,
    backdrop: backdropCss(backdropColors(rig.backdrop, inputs.eye)),
    exposure: rig.exposure,
    dispose() {
      for (const mesh of meshes) mesh.geometry.dispose();
      for (const copy of copies.values()) copy.dispose();
      environment.dispose();
      sun.dispose();
    },
  };
}

/** The camera of a framing (`applyFrame` in the viewer), for a view of `aspect`. */
export function frameCamera(frame: FrameRequest, aspect: number, fallbackFov = 45) {
  const fov = frame.fov ?? fallbackFov;
  const distance =
    frame.distance ??
    (frame.extent
      ? extentDistance(frame.extent, fov, aspect)
      : frameDistance(frame.radius, fov, aspect));
  const camera = new PerspectiveCamera(fov, aspect, 0.1, 500);
  const [cx, cy, cz] = frame.center;
  const [fx, fy, fz] = frame.from;
  camera.position.set(cx + fx * distance, cy + fy * distance, cz + fz * distance);
  camera.lookAt(cx, cy, cz);
  camera.updateMatrixWorld(true);
  return camera;
}
