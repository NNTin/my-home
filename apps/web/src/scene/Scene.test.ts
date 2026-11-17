import { PerspectiveCamera } from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { describe, expect, it } from 'vitest';
import { pointerEvent } from '../test/screen';
import { initialCamera, resetOrbit } from './Scene';

const bounds = { min: [-10, 0, -6], max: [10, 8, 6] } as Parameters<typeof initialCamera>[0];

describe('initialCamera', () => {
  it('stands south-east of the building, above it', () => {
    // 20 m wide: 11 m east, 9 m above the top, 15 m south of the middle.
    expect(initialCamera(bounds)).toEqual([11, 17, 15]);
    // A wide view (a desktop window, a phone held across) needs no more distance.
    expect(initialCamera(bounds, 1.6)).toEqual(initialCamera(bounds));
  });

  it('stands further back for a view that is narrower than it is high', () => {
    // Half as wide as high: twice as far.
    expect(initialCamera(bounds, 0.5)).toEqual([22, 26, 30]);
  });

  it('treats a view that is not measured yet as a wide one', () => {
    for (const aspect of [0, NaN, Infinity, -1])
      expect(initialCamera(bounds, aspect)).toEqual(initialCamera(bounds));
  });
});

describe('resetOrbit', () => {
  /**
   * Orbit controls with damping on, as drei sets them up, after a quick swipe. These are three's
   * own OrbitControls; drei runs three-stdlib's port of them, which damps the same way (the app
   * does not depend on three-stdlib directly, so the test does not either).
   */
  function swiped() {
    const camera = new PerspectiveCamera();
    camera.position.set(0, 5, 10);
    const element = document.createElement('div');
    Object.assign(element, { setPointerCapture() {}, releasePointerCapture() {} });
    document.body.append(element);
    const controls = new OrbitControls(camera, element);
    controls.enableDamping = true;
    controls.update();
    const fire = (type: string, x: number) => {
      const event = pointerEvent(type, x, 100, 1, { pointerType: 'mouse', buttons: 1 });
      Object.defineProperty(event, 'button', { value: 0 });
      (type === 'pointerdown' ? element : element.ownerDocument).dispatchEvent(event);
    };
    fire('pointerdown', 100);
    fire('pointermove', 160);
    fire('pointerup', 160);
    return { camera, controls };
  }

  it('the swipe alone keeps the view moving for many frames', () => {
    const { controls } = swiped();
    let frames = 0;
    while (controls.update() && frames < 1000) frames++;
    expect(frames).toBeGreaterThan(30);
  });

  it('puts the camera exactly back, and nothing moves afterwards', () => {
    const { camera, controls } = swiped();
    controls.update();
    resetOrbit(controls, camera, [11, 17, 15], [0, 1, 0]);
    const at = () => camera.position.toArray().map((v) => Math.round(v * 1e6) / 1e6);
    expect(at()).toEqual([11, 17, 15]);
    expect(controls.target.toArray()).toEqual([0, 1, 0]);
    // No frame is asked for after the reset: the view is at rest at once.
    expect(controls.update()).toBe(false);
    expect(at()).toEqual([11, 17, 15]);
    expect(controls.enableDamping).toBe(true);
  });
});
