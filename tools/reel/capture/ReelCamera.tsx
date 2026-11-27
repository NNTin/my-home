import { useFrame, useThree } from '@react-three/fiber';
import { useEffect } from 'react';
import type { PerspectiveCamera } from 'three';

type Point = [number, number, number];
type Pose = { position: Point; fov: number } & ({ target: Point } | { yaw: number; pitch: number });

let pose: Pose | null = null;
let renderCount = 0;
let lastTier = '';
let texturesReady = true;

export function recordReelDraw(tier: string, pendingTextures = 0) {
  renderCount++;
  lastTier = tier;
  texturesReady = pendingTextures === 0;
}

export function ReelCamera({ frameLoop }: { frameLoop: boolean }) {
  const get = useThree((state) => state.get);
  useFrame(({ camera }) => {
    if (!pose) return;
    const view = camera as PerspectiveCamera;
    view.position.set(...pose.position);
    if ('target' in pose) view.lookAt(...pose.target);
    else view.rotation.set(pose.pitch, pose.yaw, 0, 'YXZ');
    if (view.fov !== pose.fov) {
      view.fov = pose.fov;
      view.updateProjectionMatrix();
    }
  });

  useEffect(() => {
    const capture = async (next: Pose | null, tier: string, size: number, time: number) => {
      const state = get();
      const { gl, controls } = state;
      if (controls) {
        Object.assign(controls, { enabled: false, enableDamping: false });
      }
      if (state.frameloop !== 'never') state.setFrameloop('never');
      pose = next;
      const canvas = gl.domElement;
      if (canvas.width !== size || canvas.height !== size) {
        throw new Error(
          'Expected a ' + size + ' square canvas, got ' + canvas.width + '×' + canvas.height,
        );
      }

      const deadline = performance.now() + 120_000;
      for (;;) {
        const before = renderCount;
        state.advance(time, true);
        if (gl.getContext().isContextLost()) throw new Error('The viewer lost its WebGL context.');
        if (!frameLoop || (renderCount > before && lastTier === tier && texturesReady)) {
          // toBlob snapshots the drawing buffer in the same task as the verified draw.
          const blob = await new Promise<Blob>((resolve, reject) => {
            canvas.toBlob(
              (image) => (image ? resolve(image) : reject(new Error('Empty canvas export'))),
              'image/png',
            );
          });
          return await new Promise<string>((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(String(reader.result).split(',')[1]!);
            reader.onerror = reject;
            reader.readAsDataURL(blob);
          });
        }
        if (performance.now() > deadline)
          throw new Error('The requested render tier or textures did not draw.');
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
    };
    Object.assign(window, { __reelCapture: capture });
  }, [frameLoop, get]);

  return null;
}
