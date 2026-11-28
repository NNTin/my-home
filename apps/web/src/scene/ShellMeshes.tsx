import { useThree, type ThreeEvent } from '@react-three/fiber';
import { createContext, useContext, useEffect, useMemo, useRef } from 'react';
import { Raycaster, type Object3D } from 'three';
import type { HomeScene } from '../builder/buildHome';
import {
  groupShown,
  scenePieceDraws,
  shellItems,
  type PieceDraw,
  type ShellOptions,
} from '../builder/drawList';
import type { Visibility } from '../builder/visibility';
import { PartsMesh } from './PartsMesh';
import type { PartState } from '../catalog/types';
import { finishMaterials } from '../finishes/materials';
import { batches } from './batches';
import { onCanvas } from './canvasEvent';
import { useFrameControl } from './Frame';

// Thin rendering layer: every shape and position comes from the builder's descriptors, through
// the draw list. The shell and outdoors are merged into batches (`batches.ts`); windows, doors
// and gates are drawn from the parts of their piece modules (src/catalog), a group per piece.

/** Picking windows, doors, roof windows and gates (not while walking). */
export interface PieceHandlers {
  /** A piece was tapped or clicked; undefined: something in front of it was. */
  onSelectPiece(id: string | undefined): void;
  /** Glows like selected furniture (after `?focus=` or a click, for a moment). */
  highlightId?: string | undefined;
  /**
   * A click on the shell (no piece in front): where it landed, for the room under it (HUD v2 #201). Without it the
   * shell takes no clicks, and a click on it is "missed" (deselects).
   */
  onSelectRoom?(point: [number, number, number]): void;
}

const Pieces = createContext<PieceHandlers | undefined>(undefined);
const HIGHLIGHT: PartState = { selected: true, colliding: false };
/** A press that moved further than this many pixels turned the view: not a click. */
const CLICK_SLOP = 6;

/** Whether the object is drawn: neither it nor a group around it is hidden. */
function drawn(object: Object3D) {
  for (let o: Object3D | null = object; o; o = o.parent) if (!o.visible) return false;
  return true;
}

/** Whether `group` is what the ray meets first in the scene (a wall may stand in front of it). */
function frontmost(scene: Object3D, e: ThreeEvent<MouseEvent>, group: Object3D) {
  const raycaster = new Raycaster(e.ray.origin, e.ray.direction);
  // The scene's sprites (the compass letters) are hit with the camera; without it three throws.
  raycaster.camera = e.camera;
  const hit = raycaster
    .intersectObject(scene, true)
    .find((h) => 'isMesh' in h.object && drawn(h.object));
  for (let o: Object3D | null = hit?.object ?? null; o; o = o.parent) if (o === group) return true;
  return false;
}

/** A piece's group: the parts, with the click handler and highlight while picking is on. */
function Piece({ piece, shown }: { piece: PieceDraw; shown: boolean }) {
  const handlers = useContext(Pieces);
  const get = useThree((s) => s.get);
  // A hidden piece keeps its meshes and takes no clicks.
  const onClick =
    handlers && shown
      ? (e: ThreeEvent<MouseEvent>) => {
          if (!onCanvas(e.nativeEvent) || e.delta > CLICK_SLOP) return;
          if (!frontmost(get().scene, e, e.eventObject)) return handlers.onSelectPiece(undefined);
          e.stopPropagation();
          handlers.onSelectPiece(piece.id);
        }
      : undefined;
  return (
    <group
      position={piece.position}
      rotation={[piece.rotationX, piece.rotationY, 0, 'YXZ']}
      visible={shown}
      {...(onClick && { onClick })}
    >
      <PartsMesh
        parts={piece.parts}
        {...(handlers?.highlightId === piece.id && { state: HIGHLIGHT })}
      />
    </group>
  );
}

export function ShellMeshes({
  scene,
  visibility,
  pieces,
  planColours = false,
}: {
  /** The whole scene: what is hidden is decided per batch, and hiding rebuilds nothing. */
  scene: HomeScene;
  /** What to show; everything when omitted. */
  visibility?: Visibility | undefined;
  /** Set to make windows, doors, roof windows and gates selectable. */
  pieces?: PieceHandlers | undefined;
  /** "Plan colours": room floors in the colours that tell rooms apart, not their finishes. */
  planColours?: ShellOptions['planColours'];
}) {
  const shell = useMemo(() => batches(shellItems(scene, { planColours })), [scene, planColours]);
  useEffect(() => () => shell.forEach((b) => b.geometry.dispose()), [shell]);
  const pieceDraws = useMemo(() => scenePieceDraws(scene), [scene]);
  // The home or what is shown of it changed: the sun's shadow is drawn again, and what the new
  // meshes need is compiled before they are drawn.
  const frame = useFrameControl();
  useEffect(() => frame?.materialsChanged(), [frame, shell, pieceDraws]);
  useEffect(() => frame?.castersChanged(), [frame, shell, pieceDraws, visibility]);
  const shown = (group: PieceDraw['group']) => !visibility || groupShown(group, scene, visibility);
  // A click on the shell, made of its press and release (R3F's onClick did not reach this group): the same
  // pointer, moved less than a click's slop. R3F calls a handler once per surface hit: each event counts once.
  const press = useRef<{ id: number; x: number; y: number } | undefined>(undefined);
  const seen = useRef<Event | undefined>(undefined);
  const once = (e: ThreeEvent<PointerEvent>) => {
    if (seen.current === e.nativeEvent) return false;
    seen.current = e.nativeEvent;
    return true;
  };
  const onShell = pieces?.onSelectRoom
    ? {
        onPointerDown: (e: ThreeEvent<PointerEvent>) => {
          if (!once(e)) return;
          press.current =
            e.button === 0 && onCanvas(e.nativeEvent)
              ? { id: e.pointerId, x: e.nativeEvent.clientX, y: e.nativeEvent.clientY }
              : undefined;
        },
        onPointerUp: (e: ThreeEvent<PointerEvent>) => {
          if (!once(e)) return;
          const p = press.current;
          press.current = undefined;
          const moved = p && Math.hypot(e.nativeEvent.clientX - p.x, e.nativeEvent.clientY - p.y);
          if (!p || p.id !== e.pointerId || moved === undefined || moved > CLICK_SLOP) return;
          // The first shell surface drawn under the pointer: a hidden upper level takes no click. The shell only:
          // the scene's sprites (the compass letters) cannot be hit without a camera.
          const hit = new Raycaster(e.ray.origin, e.ray.direction)
            .intersectObject(e.eventObject, true)
            .find((h) => 'isMesh' in h.object && drawn(h.object));
          if (hit) pieces.onSelectRoom?.([hit.point.x, hit.point.y, hit.point.z]);
        },
      }
    : undefined;
  // Outside the viewer's frame loop (tests) the materials are a phone's and no texture is asked for.
  const materials = frame?.finishes ?? finishMaterials('phone');
  // A texture is asked for when its finish is first drawn: not for what is hidden (§4.4).
  useEffect(() => {
    if (!frame) return;
    for (const b of shell) {
      if (!visibility || groupShown(b.group, scene, visibility)) frame.finishShown(b.finish);
    }
  }, [frame, shell, scene, visibility]);
  return (
    <Pieces.Provider value={pieces}>
      <group {...onShell}>
        {shell.map((b) => (
          <mesh
            key={b.key}
            geometry={b.geometry}
            material={materials.material(b.finish, b.material)}
            visible={shown(b.group)}
            castShadow={b.castShadow}
            receiveShadow={b.receiveShadow}
            dispose={null}
          />
        ))}
        {pieceDraws.map((p) => (
          <Piece key={p.id} piece={p} shown={shown(p.group)} />
        ))}
      </group>
    </Pieces.Provider>
  );
}
