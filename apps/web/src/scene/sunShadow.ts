import {
  Box3,
  Matrix4,
  Vector3,
  type DirectionalLight,
  type Mesh,
  type Object3D,
  type OrthographicCamera,
} from 'three';

/**
 * The sun's shadow map is static and fitted (docs/design/realistic-render.md §4.3, §6.2): it is
 * drawn only when what casts shadows changed, and its frustum is fitted to the bounds of the
 * visible casters instead of a fixed 60 m square, so the same texels cover less ground.
 */

/** Room around the casters, in metres, so nothing touches the edge of the map. */
const MARGIN = 0.5;
/**
 * The depth bias in metres: what the fixed frustum had (0.0005 of its 99 m depth). The shadow
 * shader takes it as a fraction of the frustum's depth, which now changes with the fit.
 */
const BIAS_METRES = 0.0495;

const corner = new Vector3();
const view = new Matrix4();
const box = new Box3();
const up = new Vector3(0, 1, 0);
const from = new Vector3();
const to = new Vector3();

/** The bounds, in the world, of every visible mesh under `root` that casts a shadow. */
export function casterBounds(root: Object3D, target = new Box3()): Box3 {
  target.makeEmpty();
  root.updateMatrixWorld();
  root.traverseVisible((object) => {
    const mesh = object as Mesh;
    if (!mesh.isMesh || !mesh.castShadow) return;
    if (!mesh.geometry.boundingBox) mesh.geometry.computeBoundingBox();
    target.union(box.copy(mesh.geometry.boundingBox!).applyMatrix4(mesh.matrixWorld));
  });
  return target;
}

/**
 * Fits the light's shadow camera around `bounds` (world), seen along the light's direction.
 * Returns false, changing nothing, when there is nothing to fit.
 */
export function fitShadowCamera(light: DirectionalLight, bounds: Box3): boolean {
  if (bounds.isEmpty()) return false;
  light.updateMatrixWorld();
  light.target.updateMatrixWorld();
  from.setFromMatrixPosition(light.matrixWorld);
  to.setFromMatrixPosition(light.target.matrixWorld);
  // The shadow camera stands at the light and looks at its target (`LightShadow.updateMatrices`).
  view.lookAt(from, to, up).setPosition(from).invert();
  const min = new Vector3(Infinity, Infinity, Infinity);
  const max = new Vector3(-Infinity, -Infinity, -Infinity);
  for (let i = 0; i < 8; i++) {
    corner
      .set(
        i & 1 ? bounds.max.x : bounds.min.x,
        i & 2 ? bounds.max.y : bounds.min.y,
        i & 4 ? bounds.max.z : bounds.min.z,
      )
      .applyMatrix4(view);
    min.min(corner);
    max.max(corner);
  }
  const camera = light.shadow.camera as OrthographicCamera;
  camera.left = min.x - MARGIN;
  camera.right = max.x + MARGIN;
  camera.bottom = min.y - MARGIN;
  camera.top = max.y + MARGIN;
  // The camera looks down -z: the nearest caster has the largest z.
  camera.near = Math.max(0.1, -max.z - MARGIN);
  camera.far = -min.z + MARGIN;
  camera.updateProjectionMatrix();
  light.shadow.bias = -BIAS_METRES / (camera.far - camera.near);
  return true;
}
