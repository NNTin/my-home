import { Html } from '@react-three/drei';
import { useThree, type ThreeEvent } from '@react-three/fiber';
import { useEffect, useRef } from 'react';
import { DoubleSide, Plane, Vector3, type Camera, type Object3D, type Ray } from 'three';
import type { Vec2, Vec3 } from '../geom/types';
import type { ItemSize } from '../catalog/furniture';
import { PartsMesh, SELECTION_COLOR } from '../catalog/PartsMesh';
import type { Part, PieceEmitter } from '../catalog/types';
import { FurnitureToolbar, type FurnitureToolbarProps } from '../overlay/FurnitureToolbar';
import { onCanvas, swallowNextClick } from './canvasEvent';
import { useFrameControl } from './Frame';

/** One item as the scene draws it; built by the viewer from the layout and the catalogue. */
export interface FurnitureView {
  id: string;
  /** World position of the item's floor centre. */
  position: Vec3;
  rotationY: number;
  size: ItemSize;
  /** In the item's local frame; an unknown type is a plain box (`unknownParts`). */
  parts: Part[];
  /** The light the item emits, in its local frame (`lighting/lamps.ts`). */
  emitters?: PieceEmitter[];
  /** The room it is in, where known: a lamp's light ends at its room. */
  roomId?: string;
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
  /** An item was pressed and held without moving it (touch: "more"). */
  onLongPress?(id: string): void;
}

/**
 * How long an item is held before it counts as a long press, and how far the finger may stray.
 * Shorter than the browser's own long press (about 500 ms), which cancels the touch.
 */
const LONG_PRESS_MS = 450;
const LONG_PRESS_SLOP = 10;

/** Width of the rotate ring in metres: wider for a finger than for a mouse pointer. */
const RING_WIDTH = 0.12;
const TOUCH_RING_WIDTH = 0.34;

/** Half the toolbar's width and its height in pixels, to keep it inside the view. */
const TOOLBAR_HALF_WIDTH = 160;
const TOOLBAR_HEIGHT = 48;
/** How far above the item's top the toolbar floats, in pixels. */
const TOOLBAR_LIFT = 44;

/**
 * Where the toolbar goes on screen: above the point it is anchored to, and pushed back inside
 * the view when the item is near an edge.
 */
export function toolbarPosition(
  anchor: [number, number],
  size: { width: number; height: number },
): [number, number] {
  const clamp = (value: number, min: number, max: number) =>
    max < min ? (min + max) / 2 : Math.max(min, Math.min(max, value));
  return [
    clamp(anchor[0], TOOLBAR_HALF_WIDTH + 4, size.width - TOOLBAR_HALF_WIDTH - 4),
    clamp(anchor[1] - TOOLBAR_LIFT, TOOLBAR_HEIGHT / 2 + 4, size.height - TOOLBAR_HEIGHT / 2 - 4),
  ];
}

/**
 * Whether the item the toolbar belongs to is in the picture, given its anchor in normalised
 * device coordinates: in front of the camera and inside the view, or just outside it (the toolbar
 * is then held at the edge). An item behind the camera projects to a mirrored point on screen.
 */
export const toolbarInView = (ndc: { x: number; y: number; z: number }) =>
  ndc.z < 1 && Math.abs(ndc.x) <= TOOLBAR_VIEW_MARGIN && Math.abs(ndc.y) <= TOOLBAR_VIEW_MARGIN;
const TOOLBAR_VIEW_MARGIN = 1.15;
/** Where a toolbar goes whose item is out of the picture: nowhere to be seen or tapped. */
const OUT_OF_VIEW: [number, number] = [-10000, -10000];

const projected = new Vector3();
const placeToolbar = (
  anchor: Object3D,
  camera: Camera,
  size: { width: number; height: number },
) => {
  projected.setFromMatrixPosition(anchor.matrixWorld).project(camera);
  if (!toolbarInView(projected)) return OUT_OF_VIEW;
  return toolbarPosition(
    [(projected.x + 1) * (size.width / 2), (1 - projected.y) * (size.height / 2)],
    size,
  );
};

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
  const hold = useRef<{ timer: number; x: number; y: number } | undefined>(undefined);
  const lock = useControlsLock();
  const elevation = item.position[1];
  const { onLongPress } = handlers;

  const release = () => {
    if (hold.current) window.clearTimeout(hold.current.timer);
    hold.current = undefined;
  };
  useEffect(() => release, []);

  const start = (kind: Drag['kind']) => (e: ThreeEvent<PointerEvent>) => {
    if (e.button !== 0 || !onCanvas(e.nativeEvent)) return;
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
    release();
    if (kind === 'move' && onLongPress) {
      hold.current = {
        timer: window.setTimeout(() => {
          hold.current = undefined;
          swallowNextClick();
          onLongPress(item.id);
        }, LONG_PRESS_MS),
        x: e.nativeEvent.clientX,
        y: e.nativeEvent.clientY,
      };
    }
  };

  const move = (e: ThreeEvent<PointerEvent>) => {
    const d = drag.current;
    if (!d || d.pointerId !== e.pointerId) return;
    e.stopPropagation();
    // A finger that travels is dragging, not holding.
    const h = hold.current;
    if (h && Math.hypot(e.nativeEvent.clientX - h.x, e.nativeEvent.clientY - h.y) > LONG_PRESS_SLOP)
      release();
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
    release();
    lock(false);
    handlers.onDragEnd();
  };

  return { start, move, end };
}

function FurnitureItem({
  item,
  handlers,
  touch,
  toolbar,
  editable,
}: {
  item: FurnitureView;
  handlers: FurnitureHandlers;
  touch: boolean;
  toolbar: FurnitureToolbarProps | undefined;
  editable: boolean;
}) {
  const { start, move, end } = useDrag(item, handlers);
  const { size } = item;
  const state = { selected: item.selected, colliding: item.colliding };
  const ring = Math.max(size.width, size.depth) / 2 + 0.2;
  const ringWidth = touch ? TOUCH_RING_WIDTH : RING_WIDTH;
  return (
    <group position={item.position} rotation={[0, item.rotationY, 0]}>
      <group
        {...(editable
          ? {
              onPointerDown: start('move'),
              onPointerMove: move,
              onPointerUp: end,
              onPointerCancel: end,
            }
          : {
              // View mode: a tap selects (to inspect), nothing drags, the orbit controls stay free.
              onClick: (e: ThreeEvent<MouseEvent>) => {
                if (e.button !== 0 || !onCanvas(e.nativeEvent)) return;
                e.stopPropagation();
                handlers.onSelect(item.id);
              },
            })}
      >
        <PartsMesh parts={item.parts} state={state} />
      </group>
      {editable && item.selected && (
        // Rotate handle: a flat ring on the floor around the item.
        <mesh
          rotation={[-Math.PI / 2, 0, 0]}
          position={[0, 0.02, 0]}
          // A handle: not part of an exported image (§7.4).
          userData={{ overlay: true }}
          onPointerDown={start('rotate')}
          onPointerMove={move}
          onPointerUp={end}
          onPointerCancel={end}
        >
          <ringGeometry args={[ring, ring + ringWidth, 48]} />
          <meshBasicMaterial color={SELECTION_COLOR} side={DoubleSide} transparent opacity={0.8} />
        </mesh>
      )}
      {editable && item.selected && toolbar && (
        // Above the item's top; the room names (z-index up to 5) stay below it.
        <Html
          position={[0, size.height, 0]}
          center
          zIndexRange={[9, 6]}
          calculatePosition={placeToolbar}
        >
          <FurnitureToolbar {...toolbar} />
        </Html>
      )}
    </group>
  );
}

export function FurnitureLayer({
  items,
  handlers,
  touch = false,
  toolbar,
  editable = true,
}: {
  items: FurnitureView[];
  handlers: FurnitureHandlers;
  /** A touch screen: a rotate ring wide enough for a finger. */
  touch?: boolean;
  /** The floating toolbar of the selected item; none on a desktop screen. */
  toolbar?: FurnitureToolbarProps | undefined;
  /** Edit mode: items can be dragged and rotated. Off, they can only be selected. */
  editable?: boolean;
}) {
  // Furniture casts shadows: the sun's map is drawn again when an item is placed, moved (each
  // frame of a drag), turned or removed. A glow (selected, colliding) is a material of its own,
  // compiled ahead the first time.
  const frame = useFrameControl();
  const casters = items.map((i) => `${i.id}:${i.position.join(',')}:${i.rotationY}`).join('|');
  const glows = items.map((i) => (i.colliding ? 'c' : i.selected ? 's' : '')).join('');
  useEffect(() => frame?.castersChanged(), [frame, casters]);
  useEffect(() => frame?.materialsChanged(), [frame, glows, items.length]);
  return (
    <group>
      {items.map((item) => (
        <FurnitureItem
          key={item.id}
          item={item}
          handlers={handlers}
          touch={touch}
          toolbar={toolbar}
          editable={editable}
        />
      ))}
    </group>
  );
}
