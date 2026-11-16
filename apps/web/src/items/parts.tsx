import type { Vec3 } from '../builder/buildHome';

/**
 * Building blocks for item modules: simple meshes whose material shows the selection and
 * collision state, so every type highlights the same way.
 */

export interface PartState {
  selected: boolean;
  colliding: boolean;
}

export const COLLISION_COLOR = '#ff2d2d';
export const SELECTION_COLOR = '#3d8bff';

function PartMaterial({ color, state }: { color: string; state: PartState }) {
  const emissive = state.colliding ? COLLISION_COLOR : state.selected ? SELECTION_COLOR : '#000000';
  const intensity = state.colliding ? 0.55 : state.selected ? 0.4 : 0;
  return <meshStandardMaterial color={color} emissive={emissive} emissiveIntensity={intensity} />;
}

/** A box; `position` is its centre in the item's local frame. */
export function Block({
  position,
  size,
  color,
  state,
}: {
  position: Vec3;
  size: Vec3;
  color: string;
  state: PartState;
}) {
  return (
    <mesh position={position} castShadow receiveShadow>
      <boxGeometry args={size} />
      <PartMaterial color={color} state={state} />
    </mesh>
  );
}

/** An upright cylinder (or an elliptic one via `scale`); `position` is its centre. */
export function Cylinder({
  position,
  radius,
  height,
  color,
  state,
  scale = [1, 1, 1],
}: {
  position: Vec3;
  radius: number;
  height: number;
  color: string;
  state: PartState;
  scale?: Vec3;
}) {
  return (
    <mesh position={position} scale={scale} castShadow receiveShadow>
      <cylinderGeometry args={[radius, radius, height, 24]} />
      <PartMaterial color={color} state={state} />
    </mesh>
  );
}

/** Mixes a `#rrggbb` colour towards black (`amount` < 0) or white (`amount` > 0). */
export function shade(color: string, amount: number) {
  const n = Number.parseInt(color.slice(1), 16);
  const target = amount < 0 ? 0 : 255;
  const t = Math.abs(amount);
  const channel = (shift: number) => {
    const c = (n >> shift) & 0xff;
    return Math.round(c + (target - c) * t);
  };
  return `#${((channel(16) << 16) | (channel(8) << 8) | channel(0)).toString(16).padStart(6, '0')}`;
}
