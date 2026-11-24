import type { RootState } from '@react-three/fiber';
import type { Object3D } from 'three';
import type { FrameControl } from '../scene/Frame';
import { exportSize, imageName } from './named';

/**
 * "Save image" (docs/design/realistic-render.md §7.4): the view as it is, drawn once in the
 * beautiful tier at twice the canvas size (at most 3840 px wide), without compass letters or
 * handles, and downloaded as a PNG. Room names and toolbars are not part of the canvas.
 */

/** Draws the export frame and returns it as a PNG; the canvas is as it was when this returns. */
export async function exportImage(state: RootState, frame: FrameControl): Promise<Blob> {
  if (!(await frame.beautifulReady())) throw new Error('the beautiful tier is not available');
  const { gl, scene, size } = state;
  const ratio = gl.getPixelRatio();
  const hidden: Object3D[] = [];
  scene.traverse((object) => {
    if (object.userData.overlay !== true || !object.visible) return;
    object.visible = false;
    hidden.push(object);
  });
  let png: Promise<Blob | null>;
  try {
    // One task from here to the frame that puts the view back: the page never shows the big one.
    gl.setPixelRatio(exportSize(size.width, size.height).ratio);
    frame.drawNow('beautiful');
    png = new Promise((resolve) => gl.domElement.toBlob(resolve, 'image/png'));
  } finally {
    for (const object of hidden) object.visible = true;
    gl.setPixelRatio(ratio);
    frame.drawNow(frame.governor.shownTier);
  }
  const blob = await png;
  if (!blob) throw new Error('the canvas gave no image');
  return blob;
}

/** Hands a file to the browser's downloads. */
export function download(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  document.body.append(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

/** Exports the view and downloads it as `my-home-<view>-<yyyymmdd-hhmm>.png`. */
export async function saveImage(state: RootState, frame: FrameControl, view: string) {
  download(await exportImage(state, frame), imageName(view, new Date()));
}
