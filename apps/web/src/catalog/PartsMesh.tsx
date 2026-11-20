import { useEffect, useMemo } from 'react';
import { IDENTITY, partItems, type DrawGroup } from '../builder/drawList';
import { batches, batchMaterial, type Batch, type Glow } from '../scene/batches';
import type { Part, PartState } from './types';

/**
 * The one renderer of piece parts. The parts are merged into one opaque mesh and at most one
 * transparent one (docs/design/realistic-render.md §4.2), in the parts' order (the order is the
 * draw order of transparent glass, so keep it); their colours are vertex colours. A part with its
 * own roughness, metalness or shadow flags stays a mesh of its own. With `state` (furniture)
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
  return (
    <>
      {meshes.map((m) => (
        <mesh
          key={m.key}
          geometry={m.geometry}
          material={batchMaterial(m.material, glow)}
          castShadow={m.castShadow}
          receiveShadow={m.receiveShadow}
          // Shared materials and memoised geometry: disposed above, not by R3F on unmount.
          dispose={null}
        />
      ))}
    </>
  );
}
