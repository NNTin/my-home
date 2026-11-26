import { useThree } from '@react-three/fiber';
import { useEffect, type RefObject } from 'react';
import type { PerspectiveCamera } from 'three';
import { useFrameControl } from '../scene/Frame';
import { saveImage } from './exportImage';

/** "Save image": saves the view as it is, named after `view` (`exportImage.ts`). */
export type SaveImage = (view: string) => Promise<void>;

/** The view's camera as it stands, and the view's size in CSS pixels: what render mode traces. */
export type ViewCamera = () => { camera: PerspectiveCamera; width: number; height: number };

/**
 * Inside the canvas: provides the "Save image" action (§7.4) and, for render mode (§9), the
 * camera of the frame on screen.
 */
export function ImageExport({
  actionRef,
  cameraRef,
}: {
  actionRef: RefObject<SaveImage | undefined>;
  cameraRef?: RefObject<ViewCamera | undefined>;
}) {
  const get = useThree((s) => s.get);
  const frame = useFrameControl();
  useEffect(() => {
    actionRef.current = frame && ((view) => saveImage(get(), frame, view));
    if (cameraRef)
      cameraRef.current = () => {
        const { camera, size } = get();
        // A copy: the tracer keeps it while the viewer's own camera may move on.
        const copy = (camera as PerspectiveCamera).clone();
        copy.updateMatrixWorld(true);
        return { camera: copy, width: size.width, height: size.height };
      };
    return () => {
      actionRef.current = undefined;
      if (cameraRef) cameraRef.current = undefined;
    };
  }, [get, frame, actionRef, cameraRef]);
  return null;
}
