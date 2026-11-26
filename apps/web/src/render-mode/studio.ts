import {
  BackSide,
  DataTexture,
  EquirectangularReflectionMapping,
  FloatType,
  LinearFilter,
  LinearSRGBColorSpace,
  RGBAFormat,
  Vector3,
  type Mesh,
  type MeshBasicMaterial,
} from 'three';
import { studioScene } from '../lighting/environment';

/**
 * The studio environment for the path tracer (docs/design/realistic-render.md §6.3, §9). The
 * viewer draws its studio (`lighting/environment.ts`) with its WebGL renderer and prefilters it;
 * that texture belongs to the viewer's GPU context. The tracer wants the same room as an
 * equirectangular image, so it is worked out here from the same scene of lit boxes, on the CPU:
 * per pixel, the radiance of the surface a ray from the middle of the room meets first.
 */

interface Box {
  min: Vector3;
  max: Vector3;
  radiance: number;
  /** The room itself: seen from inside, so the ray meets it where it leaves. */
  around: boolean;
}

function boxes(): Box[] {
  const scene = studioScene();
  scene.updateMatrixWorld(true);
  const found: Box[] = [];
  scene.traverse((object) => {
    const mesh = object as Mesh;
    if (!mesh.isMesh) return;
    const material = mesh.material as MeshBasicMaterial;
    // Every surface of the studio is a unit box, moved and scaled.
    const half = mesh.scale.clone().multiplyScalar(0.5);
    found.push({
      min: mesh.position.clone().sub(half),
      max: mesh.position.clone().add(half),
      radiance: material.color.r,
      around: material.side === BackSide,
    });
    material.dispose();
    mesh.geometry.dispose();
  });
  return found;
}

/** How far along the ray from the origin the box is met; Infinity when it is not. */
function meet(box: Box, direction: Vector3): number {
  let enter = -Infinity;
  let leave = Infinity;
  for (const axis of ['x', 'y', 'z'] as const) {
    const d = direction[axis];
    if (Math.abs(d) < 1e-12) {
      if (box.min[axis] > 0 || box.max[axis] < 0) return Infinity;
      continue;
    }
    const [a, b] = [box.min[axis] / d, box.max[axis] / d];
    enter = Math.max(enter, Math.min(a, b));
    leave = Math.min(leave, Math.max(a, b));
  }
  if (leave < enter || leave <= 0) return Infinity;
  return box.around ? leave : enter > 0 ? enter : Infinity;
}

/** The radiance the studio shows in a direction (a unit vector). */
export function studioRadiance(direction: Vector3, studio: readonly Box[] = boxes()): number {
  let nearest = Infinity;
  let radiance = 0;
  for (const box of studio) {
    const t = meet(box, direction);
    if (t < nearest) [nearest, radiance] = [t, box.radiance];
  }
  return radiance;
}

/**
 * The studio as an equirectangular texture, linear and unclamped. Its rows run from straight
 * down to straight up, its columns once around: three.js' mapping of a direction to a texture
 * coordinate (`equirectUv`).
 */
export function studioEquirect(width = 256, height = 128): DataTexture {
  const studio = boxes();
  const data = new Float32Array(width * height * 4);
  const direction = new Vector3();
  for (let row = 0; row < height; row++) {
    const latitude = ((row + 0.5) / height - 0.5) * Math.PI;
    for (let column = 0; column < width; column++) {
      const longitude = ((column + 0.5) / width - 0.5) * Math.PI * 2;
      direction.set(
        Math.cos(latitude) * Math.cos(longitude),
        Math.sin(latitude),
        Math.cos(latitude) * Math.sin(longitude),
      );
      const radiance = studioRadiance(direction, studio);
      data.set([radiance, radiance, radiance, 1], (row * width + column) * 4);
    }
  }
  const texture = new DataTexture(data, width, height, RGBAFormat, FloatType);
  texture.mapping = EquirectangularReflectionMapping;
  texture.colorSpace = LinearSRGBColorSpace;
  texture.minFilter = texture.magFilter = LinearFilter;
  texture.needsUpdate = true;
  return texture;
}
