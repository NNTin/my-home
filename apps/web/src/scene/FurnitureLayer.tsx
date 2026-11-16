import { useThree, type ThreeEvent } from '@react-three/fiber';
import { useRef, type ComponentType } from 'react';
import { DoubleSide, Plane, Vector3, type Ray } from 'three';
import type { Vec2, Vec3 } from '../builder/buildHome';
import { Block, SELECTION_COLOR } from '../items/parts';
import type { ItemRenderProps, ItemSize } from '../items/types';

/** One item as the scene draws it; built by the viewer from the layout and the registry. */
export interface FurnitureView {
  id: string;
  /** World position of the item's floor centre. */
  position: Vec3;
  rotationY: number;
  size: ItemSize;
  color: string;
  /** Undefined for an unknown item type: drawn as a plain box. */
  Render?: ComponentType<ItemRenderProps>;
  selected: boolean;
  colliding: boolean;
}

export interface FurnitureHandlers {
  onSelect(id: string | undefined): void;
  onMoveStart(id: string): void;
  /** `target` is where the item's centre should go (pointer on the floor plus grab offset). */
  onMove(id: string, target: Vec2): void;
  onRotateStart(id: string): void;
  /** The rotate handle was dragged around the item from `from` to `to` (plan points). */
  onRotate(id: string, from: Vec2, to: Vec2): void;
  onDragEnd(): void;
}

const hitFloor = (ray: Ray, elevation: number): Vec2 | undefined => {
  const hit = ray.intersectPlane(new Plane(new Vector3(0, 1, 0), -elevation), new Vector3());
  return hit ? [hit.x, hit.z] : undefined;
};

interface Drag {
  kind: 'move' | 'rotate';
  pointerId: number;
  offset: Vec2;
  from: Vec2;
}

function useControlsLock() {
  // Read at event time: the orbit controls must not turn the view while an item is dragged.
  const get = useThree((s) => s.get);
  return (locked: boolean) => {
    const controls = get().controls as { enabled: boolean } | null;
    if (controls) controls.enabled = !locked;
  };
}

/** Pointer handling shared by the item body (move) and its rotate ring (rotate). */
function useDrag(item: FurnitureView, handlers: FurnitureHandlers) {
  const drag = useRef<Drag>(undefined);
  const lock = useControlsLock();
  const elevation = item.position[1];

  const start = (kind: Drag['kind']) => (e: ThreeEvent<PointerEvent>) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    const hit = hitFloor(e.ray, elevation);
    if (!hit) return;
    (e.target as Element).setPointerCapture(e.pointerId);
    lock(true);
    drag.current = {
      kind,
      pointerId: e.pointerId,
      offset: [item.position[0] - hit[0], item.position[2] - hit[1]],
      from: hit,
    };
    if (kind === 'move') handlers.onMoveStart(item.id);
    else handlers.onRotateStart(item.id);
  };

  const move = (e: ThreeEvent<PointerEvent>) => {
    const d = drag.current;
    if (!d || d.pointerId !== e.pointerId) return;
    e.stopPropagation();
    const hit = hitFloor(e.ray, elevation);
    if (!hit) return;
    if (d.kind === 'move') handlers.onMove(item.id, [hit[0] + d.offset[0], hit[1] + d.offset[1]]);
    else handlers.onRotate(item.id, d.from, hit);
  };

  const end = (e: ThreeEvent<PointerEvent>) => {
    const d = drag.current;
    if (!d || d.pointerId !== e.pointerId) return;
    e.stopPropagation();
    (e.target as Element).releasePointerCapture(e.pointerId);
    drag.current = undefined;
    lock(false);
    handlers.onDragEnd();
  };

  return { start, move, end };
}

function FurnitureItem({ item, handlers }: { item: FurnitureView; handlers: FurnitureHandlers }) {
  const { start, move, end } = useDrag(item, handlers);
  const { size, Render } = item;
  const state = { selected: item.selected, colliding: item.colliding };
  const ring = Math.max(size.width, size.depth) / 2 + 0.2;
  return (
    <group position={item.position} rotation={[0, item.rotationY, 0]}>
      <group
        onPointerDown={start('move')}
        onPointerMove={move}
        onPointerUp={end}
        onPointerCancel={end}
      >
        {Render ? (
          <Render size={size} color={item.color} {...state} />
        ) : (
          <Block
            position={[0, size.height / 2, 0]}
            size={[size.width, size.height, size.depth]}
            color={item.color}
            state={state}
          />
        )}
      </group>
      {item.selected && (
        // Rotate handle: a flat ring on the floor around the item.
        <mesh
          rotation={[-Math.PI / 2, 0, 0]}
          position={[0, 0.02, 0]}
          onPointerDown={start('rotate')}
          onPointerMove={move}
          onPointerUp={end}
          onPointerCancel={end}
        >
          <ringGeometry args={[ring, ring + 0.12, 48]} />
          <meshBasicMaterial color={SELECTION_COLOR} side={DoubleSide} transparent opacity={0.8} />
        </mesh>
      )}
    </group>
  );
}

export function FurnitureLayer({
  items,
  handlers,
}: {
  items: FurnitureView[];
  handlers: FurnitureHandlers;
}) {
  return (
    <group>
      {items.map((item) => (
        <FurnitureItem key={item.id} item={item} handlers={handlers} />
      ))}
    </group>
  );
}
