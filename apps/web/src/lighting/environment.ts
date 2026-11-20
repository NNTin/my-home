import {
  BackSide,
  BoxGeometry,
  Mesh,
  MeshBasicMaterial,
  PMREMGenerator,
  Scene,
  type WebGLRenderer,
  type WebGLRenderTarget,
} from 'three';

/**
 * The neutral studio environment (docs/design/realistic-render.md §6.3): a grey room with a few
 * lit panels, drawn once in the browser and prefiltered. It costs no download, has no colour cast
 * and shows no place. It lights both real-time tiers in place of the old hemisphere light; its
 * intensity is a uniform (`scene.environmentIntensity`), set from the light rig.
 */

/** One lit panel: a flat box at `position` of `size`, with its radiance (1 = white). */
export interface StudioPanel {
  position: [number, number, number];
  size: [number, number, number];
  radiance: number;
}

/** Half the side of the studio room, in its own units. */
const ROOM = 10;
/** The room's surfaces: the walls, and the darker floor that light from below comes off. */
const WALL_RADIANCE = 0.55;
const FLOOR_RADIANCE = 0.3;

/**
 * A large soft box overhead and one on each wall. The four are alike, so the environment lights
 * every side of the house the same: the direction of the light is the sun's alone.
 */
export const STUDIO_PANELS: readonly StudioPanel[] = [
  { position: [0, ROOM - 0.1, 0], size: [14, 0.1, 14], radiance: 2.2 },
  { position: [ROOM - 0.1, 1, 0], size: [0.1, 7, 10], radiance: 1.1 },
  { position: [-ROOM + 0.1, 1, 0], size: [0.1, 7, 10], radiance: 1.1 },
  { position: [0, 1, ROOM - 0.1], size: [10, 7, 0.1], radiance: 1.1 },
  { position: [0, 1, -ROOM + 0.1], size: [10, 7, 0.1], radiance: 1.1 },
];

const lit = (radiance: number) => {
  const material = new MeshBasicMaterial();
  material.color.setScalar(radiance);
  return material;
};

/** The studio as a scene of unlit surfaces: what the environment is drawn from. */
export function studioScene(): Scene {
  const scene = new Scene();
  const box = new BoxGeometry(1, 1, 1);
  const room = new Mesh(box, lit(WALL_RADIANCE));
  (room.material as MeshBasicMaterial).side = BackSide;
  room.scale.setScalar(ROOM * 2);
  scene.add(room);
  const floor = new Mesh(box, lit(FLOOR_RADIANCE));
  floor.position.set(0, -ROOM + 0.05, 0);
  floor.scale.set(ROOM * 2, 0.1, ROOM * 2);
  scene.add(floor);
  for (const panel of STUDIO_PANELS) {
    const mesh = new Mesh(box, lit(panel.radiance));
    mesh.position.set(...panel.position);
    mesh.scale.set(...panel.size);
    scene.add(mesh);
  }
  return scene;
}

/** How much the environment is blurred when it is prefiltered: soft boxes, no sharp reflections. */
const BLUR = 0.04;

/**
 * Draws and prefilters the environment once. Its `texture` is the scene's environment; the caller
 * disposes the target.
 */
export function studioEnvironment(renderer: WebGLRenderer): WebGLRenderTarget {
  const generator = new PMREMGenerator(renderer);
  const scene = studioScene();
  const target = generator.fromScene(scene, BLUR);
  // Only the target is kept: the generator's own programs and the studio go again.
  generator.dispose();
  const geometries = new Set<BoxGeometry>();
  scene.traverse((object) => {
    const mesh = object as Mesh<BoxGeometry, MeshBasicMaterial>;
    if (!mesh.isMesh) return;
    geometries.add(mesh.geometry);
    mesh.material.dispose();
  });
  for (const geometry of geometries) geometry.dispose();
  return target;
}
