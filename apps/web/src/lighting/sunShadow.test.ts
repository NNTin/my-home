import {
  Box3,
  BoxGeometry,
  DirectionalLight,
  Group,
  Mesh,
  MeshBasicMaterial,
  Vector3,
  type OrthographicCamera,
} from 'three';
import { describe, expect, it } from 'vitest';
import { targetSamples, usesFxaa } from '../scene/output';
import { casterBounds, fitShadowCamera } from './sunShadow';

function sun() {
  const light = new DirectionalLight();
  light.position.set(20, 30, 15);
  return light;
}

const box = (position: [number, number, number], castShadow = true) => {
  const mesh = new Mesh(new BoxGeometry(2, 2, 2), new MeshBasicMaterial());
  mesh.position.set(...position);
  mesh.castShadow = castShadow;
  return mesh;
};

describe('casterBounds', () => {
  it('covers the visible meshes that cast a shadow, and no others', () => {
    const root = new Group();
    const hidden = new Group();
    hidden.visible = false;
    hidden.add(box([100, 0, 0]));
    root.add(box([0, 1, 0]), box([10, 1, 4]), box([-50, 0, 0], false), hidden);
    const bounds = casterBounds(root);
    expect(bounds.min.toArray()).toEqual([-1, 0, -1]);
    expect(bounds.max.toArray()).toEqual([11, 2, 5]);
  });

  it('is empty when nothing casts', () => {
    expect(casterBounds(new Group()).isEmpty()).toBe(true);
  });
});

describe('fitShadowCamera', () => {
  it('holds every corner of the bounds inside the shadow frustum, closely', () => {
    const light = sun();
    const bounds = new Box3(new Vector3(-5, -1, -8), new Vector3(12, 6, 3));
    expect(fitShadowCamera(light, bounds)).toBe(true);
    const camera = light.shadow.camera as OrthographicCamera;
    // As three.js places it when it draws the map.
    camera.position.copy(light.position);
    camera.lookAt(light.target.position);
    camera.updateMatrixWorld();
    for (const x of [bounds.min.x, bounds.max.x])
      for (const y of [bounds.min.y, bounds.max.y])
        for (const z of [bounds.min.z, bounds.max.z]) {
          const ndc = new Vector3(x, y, z).project(camera);
          for (const v of ndc.toArray()) expect(Math.abs(v)).toBeLessThanOrEqual(1);
        }
    // Much tighter than the fixed 60 m square it replaces.
    expect(camera.right - camera.left).toBeLessThan(30);
    expect(camera.top - camera.bottom).toBeLessThan(30);
    expect(camera.far - camera.near).toBeLessThan(40);
  });

  it('keeps the depth bias at the same distance in metres', () => {
    const light = sun();
    fitShadowCamera(light, new Box3(new Vector3(-5, -1, -8), new Vector3(12, 6, 3)));
    const camera = light.shadow.camera as OrthographicCamera;
    expect(light.shadow.bias * (camera.far - camera.near)).toBeCloseTo(-0.0495, 6);
  });

  it('leaves the camera alone when there is nothing to fit', () => {
    const light = sun();
    const before = (light.shadow.camera as OrthographicCamera).left;
    expect(fitShadowCamera(light, new Box3())).toBe(false);
    expect((light.shadow.camera as OrthographicCamera).left).toBe(before);
  });
});

describe('anti-aliasing of the frame’s target', () => {
  it('a desktop’s fast target has 4 samples; a phone’s has none and takes FXAA', () => {
    expect(targetSamples('fast', false)).toBe(4);
    expect(usesFxaa('fast', false)).toBe(false);
    expect(targetSamples('fast', true)).toBe(0);
    expect(usesFxaa('fast', true)).toBe(true);
  });

  it('the beautiful target has 4 samples on every device', () => {
    expect(targetSamples('beautiful', true)).toBe(4);
    expect(usesFxaa('beautiful', true)).toBe(false);
  });
});
