import { useFrame, useThree } from '@react-three/fiber';
import { useEffect, useMemo } from 'react';
import { BufferAttribute, BufferGeometry, type PerspectiveCamera } from 'three';
import type { HomeScene } from '../builder/buildHome';
import { linearRgb } from '../builder/drawList';
import type { Backdrop } from '../lighting/rig';
import { batchMaterial } from '../scene/batches';
import { useFrameControl } from '../scene/Frame';
import type { NamedView } from './named';

/**
 * What a named view adds to the scene (docs/design/realistic-render.md §7.3): the neutral ground
 * the plot stands on, and a depth range that fits a camera standing far away.
 */

/** The ground's colour under each backdrop: neutral, a little darker than a light backdrop. */
const GROUND: Record<Backdrop, string> = {
  sky: '#d9dcd8',
  'studio-light': '#e9e9e6',
  'studio-dark': '#3c3e42',
};
const SEGMENTS = 64;
/** The ground is solid out to this many plot radii, then fades into the backdrop until `FADE_END`. */
const FADE_START = 1.05;
const FADE_END = 2.4;
/** The camera's near plane as the viewer sets it (`scene/Scene.tsx`). */
const NEAR = 0.1;

/** A disc that lies flat, solid to `inner` and fading to nothing at `outer`: colours with alpha. */
export function groundGeometry(inner: number, outer: number, color: string): BufferGeometry {
  const [r, g, b] = linearRgb(color);
  const count = 1 + SEGMENTS * 2;
  const position = new Float32Array(count * 3);
  const normal = new Float32Array(count * 3);
  const colors = new Float32Array(count * 4);
  const index: number[] = [];
  const put = (i: number, x: number, z: number, alpha: number) => {
    position.set([x, 0, z], i * 3);
    normal.set([0, 1, 0], i * 3);
    colors.set([r, g, b, alpha], i * 4);
  };
  put(0, 0, 0, 1);
  for (let s = 0; s < SEGMENTS; s++) {
    const a = (s / SEGMENTS) * Math.PI * 2;
    const [x, z] = [Math.sin(a), Math.cos(a)];
    put(1 + s, x * inner, z * inner, 1);
    put(1 + SEGMENTS + s, x * outer, z * outer, 0);
    const next = (s + 1) % SEGMENTS;
    index.push(0, 1 + s, 1 + next);
    index.push(1 + s, 1 + SEGMENTS + s, 1 + SEGMENTS + next);
    index.push(1 + s, 1 + SEGMENTS + next, 1 + next);
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new BufferAttribute(position, 3));
  geometry.setAttribute('normal', new BufferAttribute(normal, 3));
  geometry.setAttribute('color', new BufferAttribute(colors, 4));
  geometry.setIndex(index);
  return geometry;
}

/**
 * Where the ground lies: at the foot of the ground block, around the middle of the plot. The
 * plot's edges are at different heights (the street, the lower garden), so a plane at one ground
 * level would hover over the one or bury the other; the block stands on it like a model on a table.
 */
export function groundPlace(scene: Pick<HomeScene, 'bounds' | 'terrain' | 'slabs'>) {
  const { min, max } = scene.bounds;
  const bottoms = [...scene.terrain, ...scene.slabs].map((p) => p.bottom);
  return {
    center: [(min[0] + max[0]) / 2, Math.min(min[1], ...bottoms) - 0.01, (min[2] + max[2]) / 2],
    radius: Math.hypot(max[0] - min[0], max[2] - min[2]) / 2,
  } as const;
}

/**
 * The near plane for a camera at `distance` from the middle of a scene of `radius`: as far out as
 * the scene allows. A named view's narrow field of view puts the camera 40 to 120 m away, where
 * a near plane of 10 cm leaves the depth buffer steps of millimetres to centimetres: surfaces
 * a centimetre apart would flicker.
 */
export const nearFor = (distance: number, radius: number): number =>
  Math.max(NEAR, (distance - radius) * 0.9);

export function Stage({
  scene,
  view,
  backdrop,
}: {
  scene: HomeScene;
  view: NamedView;
  backdrop: Backdrop;
}) {
  const place = useMemo(() => groundPlace(scene), [scene]);
  const ground = useMemo(
    () => groundGeometry(place.radius * FADE_START, place.radius * FADE_END, GROUND[backdrop]),
    [place, backdrop],
  );
  useEffect(() => () => ground.dispose(), [ground]);
  // Whatever the stage draws is compiled before its first frame (§4.5).
  const frame = useFrameControl();
  useEffect(() => frame?.materialsChanged(), [frame]);

  // The whole scene, with its height, around the ground's middle.
  const radius = Math.hypot(place.radius, scene.bounds.max[1] - place.center[1]);
  const inside = view.kind === 'eye';
  const get = useThree((s) => s.get);
  useFrame(({ camera }) => {
    const c = camera as PerspectiveCamera;
    const [x, y, z] = place.center;
    const { position } = c;
    const distance = Math.hypot(position.x - x, position.y - y, position.z - z);
    const near = inside ? NEAR : nearFor(distance, radius);
    // Not for every step of a zoom: a change of a tenth, or back to the viewer's own.
    if (near === c.near || (near !== NEAR && Math.abs(near - c.near) < c.near * 0.1)) return;
    c.near = near;
    c.updateProjectionMatrix();
  });
  useEffect(
    () => () => {
      const c = get().camera as PerspectiveCamera;
      c.near = NEAR;
      c.updateProjectionMatrix();
    },
    [get],
  );

  return (
    <mesh
      geometry={ground}
      // The material of every translucent part: nothing new to compile (§4.5).
      material={batchMaterial({ transparent: true, depthWrite: false })}
      position={place.center}
      renderOrder={-1}
      dispose={null}
    />
  );
}
