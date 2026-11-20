import { useThree, type ThreeEvent } from '@react-three/fiber';
import { createContext, useContext, useEffect, useMemo } from 'react';
import { Raycaster, type Object3D } from 'three';
import type { HomeScene } from '../builder/buildHome';
import { groupShown, scenePieceDraws, shellItems, type PieceDraw } from '../builder/drawList';
import type { Visibility } from '../builder/visibility';
import { PartsMesh } from '../catalog/PartsMesh';
import type { PartState } from '../catalog/types';
import { batches, batchMaterial } from './batches';
import { onCanvas } from './canvasEvent';

// Thin rendering layer: every shape and position comes from the builder's descriptors, through
// the draw list. The shell and outdoors are merged into batches (`batches.ts`); windows, doors
// and gates are drawn from the parts of their piece modules (src/catalog), a group per piece.

/** Picking windows, doors, roof windows and gates (not while walking). */
export interface PieceHandlers {
  /** A piece was tapped or clicked; undefined: something in front of it was. */
  onSelectPiece(id: string | undefined): void;
  /** Glows like selected furniture (after `?focus=` or a click, for a moment). */
  highlightId?: string | undefined;
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
  const hit = new Raycaster(e.ray.origin, e.ray.direction)
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
}: {
  /** The whole scene: what is hidden is decided per batch, and hiding rebuilds nothing. */
  scene: HomeScene;
  /** What to show; everything when omitted. */
  visibility?: Visibility | undefined;
  /** Set to make windows, doors, roof windows and gates selectable. */
  pieces?: PieceHandlers | undefined;
}) {
  const shell = useMemo(() => batches(shellItems(scene)), [scene]);
  useEffect(() => () => shell.forEach((b) => b.geometry.dispose()), [shell]);
  const pieceDraws = useMemo(() => scenePieceDraws(scene), [scene]);
  const shown = (group: PieceDraw['group']) => !visibility || groupShown(group, scene, visibility);
  return (
    <Pieces.Provider value={pieces}>
      <group>
        {shell.map((b) => (
          <mesh
            key={b.key}
            geometry={b.geometry}
            material={batchMaterial(b.material)}
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
