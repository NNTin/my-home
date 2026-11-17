import { useFrame, useThree } from '@react-three/fiber';
import { useEffect, useMemo, type RefObject } from 'react';
import { Vector3, type Camera } from 'three';
import type { RoomLabel } from '../builder/visibility';

/**
 * Room names are plain DOM over the canvas, placed from inside it. They are not drei `Html`: that
 * mounts a React root of its own per label and unmounts it while the parent is committing, which
 * React cannot finish cleanly (a `removeChild` NotFoundError when the labels change as walk mode
 * is left, see docs/walking.md).
 */

/** Where a point in the scene falls on a view of `width` x `height` pixels, if it is in front of the camera. */
export function projectLabel(
  at: readonly [number, number, number],
  camera: Camera,
  width: number,
  height: number,
  out = new Vector3(),
): { x: number; y: number } | undefined {
  out.set(at[0], at[1], at[2]).project(camera);
  if (out.z > 1) return undefined;
  return { x: (out.x * 0.5 + 0.5) * width, y: (-out.y * 0.5 + 0.5) * height };
}

/** Outside the canvas: one element per room name, positioned by `RoomLabelTracker`. */
export function RoomLabels({
  labels,
  layerRef,
}: {
  labels: RoomLabel[];
  layerRef: RefObject<HTMLDivElement | null>;
}) {
  return (
    <div className="room-labels" ref={layerRef}>
      {labels.map((l) => (
        <div key={l.id} className="room-label" data-id={l.id} style={{ visibility: 'hidden' }}>
          {l.name}
        </div>
      ))}
    </div>
  );
}

/** Inside the canvas: moves the label elements to where their rooms are on every frame drawn. */
export function RoomLabelTracker({
  labels,
  layerRef,
}: {
  labels: RoomLabel[];
  layerRef: RefObject<HTMLDivElement | null>;
}) {
  const invalidate = useThree((s) => s.invalidate);
  const byId = useMemo(() => new Map(labels.map((l) => [l.id, l.at])), [labels]);
  const point = useMemo(() => new Vector3(), []);
  // Where frames are drawn on demand, new labels ask for one to be placed.
  useEffect(() => invalidate(), [byId, invalidate]);
  useFrame(({ camera, size }) => {
    for (const el of layerRef.current?.children ?? []) {
      const node = el as HTMLElement;
      const at = byId.get(node.dataset.id ?? '');
      const p = at && projectLabel(at, camera, size.width, size.height, point);
      node.style.setProperty('visibility', p ? 'visible' : 'hidden');
      if (p)
        node.style.setProperty(
          'transform',
          `translate3d(${p.x}px, ${p.y}px, 0) translate(-50%, -50%)`,
        );
    }
  });
  return null;
}
