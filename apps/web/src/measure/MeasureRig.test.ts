import {
  BoxGeometry,
  Group,
  Mesh,
  MeshBasicMaterial,
  PerspectiveCamera,
  Scene,
  Sprite,
  Vector2,
} from 'three';
import { describe, expect, it, vi } from 'vitest';
import { clickPicker, pickPoint } from './MeasureRig';

/** A camera at (0, 1, 10) looking down -z, and a wall whose front face is at z = 1. */
function stage() {
  const scene = new Scene();
  const camera = new PerspectiveCamera(50, 1, 0.1, 100);
  camera.position.set(0, 1, 10);
  camera.lookAt(0, 1, 0);
  camera.updateMatrixWorld();
  const wall = new Mesh(new BoxGeometry(4, 4, 2), new MeshBasicMaterial());
  wall.position.set(0, 1, 0);
  scene.add(wall);
  scene.updateMatrixWorld();
  return { scene, camera, wall };
}

describe('picking a point of the model (HUD v2 #206)', () => {
  it('gives the point the ray meets first on a surface of the model, in model coordinates', () => {
    const { scene, camera } = stage();
    const p = pickPoint(scene, camera, new Vector2(0, 0));
    expect(p![0]).toBeCloseTo(0);
    expect(p![1]).toBeCloseTo(1);
    expect(p![2]).toBeCloseTo(1);
  });

  it('looks through markers, letters and hidden parts; nothing of the model there is a miss', () => {
    const { scene, camera, wall } = stage();
    // A photo marker in front (an overlay), and a compass letter (a sprite, hit only with the camera).
    const markers = new Group();
    markers.userData.overlay = true;
    const marker = new Mesh(new BoxGeometry(1, 1, 1), new MeshBasicMaterial());
    marker.position.set(0, 1, 5);
    markers.add(marker);
    const letter = new Sprite();
    letter.position.set(0, 1, 6);
    scene.add(markers, letter);
    scene.updateMatrixWorld();
    expect(pickPoint(scene, camera, new Vector2(0, 0))![2]).toBeCloseTo(1);
    wall.visible = false;
    expect(pickPoint(scene, camera, new Vector2(0, 0))).toBeUndefined();
    // The sky.
    wall.visible = true;
    expect(pickPoint(scene, camera, new Vector2(0, 0.99))).toBeUndefined();
  });
});

describe('a pick by mouse, pen or touch (HUD v2 #206)', () => {
  const press = (pointerId: number, clientX: number, clientY: number, button = 0) => ({
    pointerId,
    clientX,
    clientY,
    button,
  });

  it('picks on a tap or a click that barely moved, where it was released', () => {
    const at = vi.fn();
    const p = clickPicker(at);
    p.down(press(7, 100, 100));
    p.up(press(7, 103, 101));
    expect(at).toHaveBeenCalledWith(103, 101);
  });

  it('picks nothing for a drag, a pinch, a cancelled touch or another button', () => {
    const at = vi.fn();
    const p = clickPicker(at);
    // A drag turns the view.
    p.down(press(1, 100, 100));
    p.up(press(1, 160, 100));
    // A second finger makes it a pinch: neither finger picks.
    p.down(press(2, 100, 100));
    p.down(press(3, 200, 100));
    p.up(press(2, 100, 100));
    p.up(press(3, 200, 100));
    // The browser took the touch over (a scroll).
    p.down(press(4, 100, 100));
    p.cancel();
    p.up(press(4, 100, 100));
    // The right button.
    p.down(press(1, 100, 100, 2));
    p.up(press(1, 100, 100, 2));
    expect(at).not.toHaveBeenCalled();
  });

  it('forgets a press released outside the view: the next click picks', () => {
    const at = vi.fn();
    const p = clickPicker(at);
    p.down(press(1, 10, 10));
    p.down(press(1, 50, 50));
    p.up(press(1, 50, 50));
    expect(at).toHaveBeenCalledWith(50, 50);
  });
});
