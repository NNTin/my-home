import { useThree } from '@react-three/fiber';
import { useEffect, useMemo } from 'react';
import { IDENTITY, PART_FINISH, partItems, type DrawGroup } from '../builder/drawList';
import { finishMaterials } from '../finishes/materials';
import { batches, batchMaterial, type Batch, type Glow } from './batches';
import { useFrameControl } from './frameControl';
import type { Part, PartState } from '../catalog/types';

/**
 * The one renderer of piece parts. The parts are merged into one opaque mesh and at most one
 * transparent one (docs/design/realistic-render.md §4.2), in the parts' order (the order is the
 * draw order of transparent glass, so keep it); their colours are vertex colours. A part with its
 * own roughness, metalness or shadow flags stays a mesh of its own, and so do the parts of each
 * finish (§5.7), which draw with the finish's material and texture. With `state` (furniture)
 * the whole piece glows when it is selected or colliding, so every type highlights the same way.
 */

export const COLLISION_COLOR = '#ff2d2d';
export const SELECTION_COLOR = '#3d8bff';

function glowOf(state: PartState | undefined): Glow | undefined {
  if (state?.colliding) return { color: COLLISION_COLOR, intensity: 0.55 };
  if (state?.selected) return { color: SELECTION_COLOR, intensity: 0.4 };
  return undefined;
}

const NO_GROUP: DrawGroup = { kind: 'placement', id: '' };

/** The meshes of a piece's parts in the piece's own frame. */
export const partBatches = (parts: readonly Part[]): Batch[] =>
  batches(partItems(parts, '', NO_GROUP, IDENTITY));

export function PartsMesh({ parts, state }: { parts: readonly Part[]; state?: PartState }) {
  // Parts are stable while a piece is only moved (the catalogue caches them per type and
  // parameters), so a drag rebuilds nothing.
  const meshes = useMemo(() => partBatches(parts), [parts]);
  useEffect(() => () => meshes.forEach((m) => m.geometry.dispose()), [meshes]);
  const glow = glowOf(state);
  // In the viewer the frame loop has the device's materials. On a piece page there is none: the
  // phone's (the smaller textures) are asked for here, and a file that arrives draws a frame.
  const frame = useFrameControl();
  const invalidate = useThree((s) => s.invalidate);
  const materials = frame?.finishes ?? finishMaterials('phone');
  useEffect(() => {
    const used = meshes.filter((m) => m.finish !== PART_FINISH).map((m) => m.finish);
    if (used.length === 0) return;
    if (frame) {
      for (const finish of used) frame.finishShown(finish);
      // A finish drawn for the first time brings a material: compiled before it is drawn.
      frame.materialsChanged();
      return;
    }
    for (const finish of used) materials.textures.request(finish);
    return materials.textures.subscribe(() => invalidate());
  }, [meshes, frame, materials, invalidate]);
  return (
    <>
      {meshes.map((m) => (
        <mesh
          key={m.key}
          geometry={m.geometry}
          material={
            m.finish === PART_FINISH
              ? batchMaterial(m.material, glow)
              : materials.material(m.finish, m.material, glow)
          }
          castShadow={m.castShadow}
          receiveShadow={m.receiveShadow}
          // Shared materials and memoised geometry: disposed above, not by R3F on unmount.
          dispose={null}
        />
      ))}
    </>
  );
}
