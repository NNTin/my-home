import type { Part, PartState } from './types';

/**
 * The one renderer of piece parts: a mesh per part, in order (the order is the draw order of
 * transparent glass, so keep it). With `state` (furniture) every part glows when the piece is
 * selected or colliding, so every type highlights the same way.
 */

export const COLLISION_COLOR = '#ff2d2d';
export const SELECTION_COLOR = '#3d8bff';

/** Cylinders are drawn with this many sides. */
const CYLINDER_SEGMENTS = 24;

function highlight(state: PartState) {
  return {
    emissive: state.colliding ? COLLISION_COLOR : state.selected ? SELECTION_COLOR : '#000000',
    emissiveIntensity: state.colliding ? 0.55 : state.selected ? 0.4 : 0,
  };
}

function PartMesh({ part, state }: { part: Part; state: PartState | undefined }) {
  const { castShadow = true, receiveShadow = true, ...material } = part.material ?? {};
  // Only what the part sets: anything else stays at three.js' default.
  const settings = Object.fromEntries(
    Object.entries(material).filter(([, value]) => value !== undefined),
  );
  const [sx, sy, sz] = part.size;
  return (
    <mesh
      position={part.center}
      // The tilt (about the part's own x) first, then the turn about y.
      rotation={[part.rotationX ?? 0, part.rotationY, 0, 'YXZ']}
      {...(part.shape === 'cylinder' && { scale: [1, 1, sz / sx] as const })}
      castShadow={castShadow}
      receiveShadow={receiveShadow}
    >
      {part.shape === 'box' ? (
        <boxGeometry args={part.size} />
      ) : (
        <cylinderGeometry args={[sx / 2, sx / 2, sy, CYLINDER_SEGMENTS]} />
      )}
      <meshStandardMaterial color={part.color} {...settings} {...(state && highlight(state))} />
    </mesh>
  );
}

export function PartsMesh({ parts, state }: { parts: Part[]; state?: PartState }) {
  return (
    <>
      {parts.map((part, i) => (
        <PartMesh key={i} part={part} state={state} />
      ))}
    </>
  );
}
