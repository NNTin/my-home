import { useThree, type ThreeEvent } from '@react-three/fiber';
import { createContext, useContext, useMemo, type ReactNode } from 'react';
import {
  Color,
  DoubleSide,
  Euler,
  ExtrudeGeometry,
  Path,
  Raycaster,
  Shape,
  ShapeGeometry,
  Vector2,
  type BufferGeometry,
  type Object3D,
} from 'three';
import {
  slopeY,
  type Box,
  type HomeScene,
  type PieceUse,
  type PlaneSlope,
  type Prism,
  type ProfileSolid,
  type RoofWindowDescriptor,
  type Surface,
  type Vec2,
  type Vec3,
} from '../builder/buildHome';
import { PartsMesh } from '../catalog/PartsMesh';
import type { PartState } from '../catalog/types';
import { onCanvas } from './canvasEvent';

// Thin rendering layer: every shape and position comes from the builder's descriptors. Windows,
// doors and gates are drawn from the parts of their piece modules (src/catalog).

const colors = {
  exterior: '#d8d2c4',
  interior: '#f1ece2',
  floorSlab: '#a6a29b',
  roof: '#7d5f50',
  terrain: '#7c6a4f',
  garden: '#5e9b4c',
  driveway: '#8e8c88',
  patio: '#b8a184',
  path: '#c2b59b',
  road: '#6f6f6f',
  gravel: '#a9a8a2',
  embankment: '#8d8778',
  stair: '#b9a98c',
  fencePost: '#3d4043',
  brickPillar: '#9a5b40',
  outbuilding: '#e4e0d6',
} as const;

/** Wall colours of outbuildings that are not rendered like the house. */
const outbuildingColors: Partial<Record<HomeScene['outbuildings'][number]['kind'], string>> = {
  shed: '#9a7b56',
  compost: '#3c4038',
};

/** Fences other than gates (a gate is drawn from its piece). */
const fenceColors = {
  'chain-link': '#4a4e52',
  privacy: '#2c2e30',
  trellis: '#7a5a3a',
} as const;

/** Contour lines are a darker shade of the surface they lie on. */
const contourColor = (color: string) => `#${new Color(color).multiplyScalar(0.6).getHexString()}`;

const roomColors = ['#e9d8b4', '#d7e3c8', '#cfdbe6', '#ead0cc', '#ddd3e8', '#e6e0c4'];

function BoxMesh({ box, color, transparent }: { box: Box; color: string; transparent?: boolean }) {
  return (
    <mesh position={box.center} rotation={[0, box.rotationY, 0]} castShadow receiveShadow>
      <boxGeometry args={box.size} />
      {transparent ? (
        <meshStandardMaterial color={color} transparent opacity={0.35} depthWrite={false} />
      ) : (
        <meshStandardMaterial color={color} />
      )}
    </mesh>
  );
}

/** A profile extruded through its depth, centred; see `solidPoint` in the builder. */
function ProfileMesh({
  center,
  rotationY,
  depth,
  outline,
  color,
}: ProfileSolid & { color: string }) {
  // Outlines come from the builder, so they are stable between renders.
  const geometry = useMemo(() => {
    const shape = new Shape(outline.map(([x, y]) => new Vector2(x, y)));
    const g = new ExtrudeGeometry(shape, { depth, bevelEnabled: false });
    g.translate(0, 0, -depth / 2);
    return g;
  }, [outline, depth]);
  return (
    <mesh
      geometry={geometry}
      position={center}
      rotation={[0, rotationY, 0]}
      castShadow
      receiveShadow
    >
      <meshStandardMaterial color={color} />
    </mesh>
  );
}

/** Plan polygon as a three.js shape; `flipZ` for shapes rotated to face up (see SurfaceMesh). */
const toShape = (outline: Vec2[], holes: Vec2[][] = [], flipZ = false) => {
  const v = ([x, z]: Vec2) => new Vector2(x, flipZ ? -z : z);
  const shape = new Shape(outline.map(v));
  shape.holes = holes.map((hole) => new Path(hole.map(v)));
  return shape;
};

/**
 * Moves the vertices of a flat face onto a sloped plane. `toPlan` maps a vertex's local (x, y) to
 * plan [x, z]; `isFace(z)` picks the face's vertices by local z; `localZ(y)` maps a height back.
 */
function slopeVertices(
  geometry: BufferGeometry,
  slope: PlaneSlope,
  toPlan: (x: number, y: number) => Vec2,
  isFace: (z: number) => boolean,
  localZ: (y: number) => number,
) {
  const position = geometry.getAttribute('position');
  for (let i = 0; i < position.count; i++) {
    if (!isFace(position.getZ(i))) continue;
    position.setZ(i, localZ(slopeY(slope, toPlan(position.getX(i), position.getY(i)))));
  }
  position.needsUpdate = true;
  geometry.computeVertexNormals();
}

/** Plan polygon extruded from `bottom` to `top` (shape in x/z, rotated so depth runs down y). */
function PrismMesh({ prism, color }: { prism: Prism; color: string }) {
  const geometry = useMemo(() => {
    const g = new ExtrudeGeometry(toShape(prism.outline, prism.holes), {
      depth: prism.top - prism.bottom,
      bevelEnabled: false,
    });
    // Local z = 0 is the top face (world y = top - z), local (x, y) is plan (x, z).
    if (prism.slope) {
      slopeVertices(
        g,
        prism.slope,
        (x, y) => [x, y],
        (z) => Math.abs(z) < 1e-6,
        (y) => prism.top - y,
      );
    }
    return g;
  }, [prism]);
  return (
    <mesh
      geometry={geometry}
      position={[0, prism.top, 0]}
      rotation={[Math.PI / 2, 0, 0]}
      receiveShadow
      castShadow
    >
      <meshStandardMaterial color={color} />
    </mesh>
  );
}

/** Plan polygon at height `y` (or on its slope), facing up. */
function SurfaceMesh({ surface, color }: { surface: Surface; color: string }) {
  const geometry = useMemo(() => {
    const g = new ShapeGeometry(toShape(surface.outline, surface.holes, true));
    // Rotated to face up: local (x, y, z) is world (x, y + z, -y), so plan z = -local y.
    if (surface.slope) {
      slopeVertices(
        g,
        surface.slope,
        (x, y) => [x, -y],
        () => true,
        (y) => y - surface.y,
      );
    }
    return g;
  }, [surface]);
  return (
    <mesh
      geometry={geometry}
      position={[0, surface.y, 0]}
      rotation={[-Math.PI / 2, 0, 0]}
      receiveShadow
    >
      <meshStandardMaterial color={color} side={DoubleSide} />
    </mesh>
  );
}

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

/** Whether `group` is what the ray meets first in the scene (a wall may stand in front of it). */
function frontmost(scene: Object3D, e: ThreeEvent<MouseEvent>, group: Object3D) {
  const hit = new Raycaster(e.ray.origin, e.ray.direction)
    .intersectObject(scene, true)
    .find((h) => h.object.visible && 'isMesh' in h.object);
  for (let o: Object3D | null = hit?.object ?? null; o; o = o.parent) if (o === group) return true;
  return false;
}

/** A piece's group: the parts, with the click handler and highlight while picking is on. */
function Piece({
  id,
  parts,
  children,
  ...group
}: {
  id: string;
  parts: PieceUse['parts'];
  children?: ReactNode;
  position?: Vec3;
  rotation?: [number, number, number] | Euler;
}) {
  const handlers = useContext(Pieces);
  const get = useThree((s) => s.get);
  const onClick = handlers
    ? (e: ThreeEvent<MouseEvent>) => {
        if (!onCanvas(e.nativeEvent) || e.delta > CLICK_SLOP) return;
        if (!frontmost(get().scene, e, e.eventObject)) return handlers.onSelectPiece(undefined);
        e.stopPropagation();
        handlers.onSelectPiece(id);
      }
    : undefined;
  return (
    <group {...group} {...(onClick && { onClick })}>
      <PartsMesh parts={parts} {...(handlers?.highlightId === id && { state: HIGHLIGHT })} />
      {children}
    </group>
  );
}

/** A window or door: its parts in the frame of its hole. */
function OpeningMesh({
  opening,
}: {
  opening: PieceUse & { id: string; center: Vec3; rotationY: number };
}) {
  return (
    <Piece
      id={opening.id}
      parts={opening.parts}
      position={opening.center}
      rotation={[0, opening.rotationY, 0]}
    />
  );
}

/** A roof window: its parts turned by `tilt`, then by `rotationY` (YXZ) onto the roof plane. */
function RoofWindowMesh({ window: w }: { window: RoofWindowDescriptor }) {
  const rotation = useMemo(() => new Euler(w.tilt, w.rotationY, 0, 'YXZ'), [w]);
  return <Piece id={w.id} parts={w.parts} position={w.center} rotation={rotation} />;
}

export function HomeMeshes({
  scene,
  pieces,
}: {
  scene: HomeScene;
  /** Set to make windows, doors, roof windows and gates selectable. */
  pieces?: PieceHandlers | undefined;
}) {
  return (
    <Pieces.Provider value={pieces}>
      <group>
        {scene.terrain.map((t) => (
          <PrismMesh key={t.id} prism={t} color={colors.terrain} />
        ))}
        {scene.outdoorAreas.map((a) => (
          <group key={a.id}>
            <SurfaceMesh surface={a} color={colors[a.kind]} />
            {a.contours.map((c, i) => (
              <SurfaceMesh key={i} surface={c} color={contourColor(colors[a.kind])} />
            ))}
          </group>
        ))}
        {scene.slabs.map((s) => (
          <PrismMesh
            key={s.id}
            prism={s}
            color={s.kind === 'roof' ? colors.roof : colors.floorSlab}
          />
        ))}
        {scene.roomFloors.map((r, i) => (
          <SurfaceMesh key={r.id} surface={r} color={roomColors[i % roomColors.length]!} />
        ))}
        {scene.walls.map((w) =>
          w.outline ? (
            <ProfileMesh
              key={w.id}
              center={w.center}
              rotationY={w.rotationY}
              depth={w.size[2]}
              outline={w.outline}
              color={colors[w.kind]}
            />
          ) : (
            <BoxMesh key={w.id} box={w} color={colors[w.kind]} />
          ),
        )}
        {scene.roofPlanes.map((r) => (
          <ProfileMesh key={r.id} {...r} color={colors.roof} />
        ))}
        {scene.roofWindows.map((w) => (
          <RoofWindowMesh key={w.id} window={w} />
        ))}
        {scene.openings.map((o) => (
          <OpeningMesh key={o.id} opening={o} />
        ))}
        {scene.stairs.flatMap((s) =>
          s.steps.map((step) => <BoxMesh key={step.id} box={step} color={colors.stair} />),
        )}
        {scene.fences.map((f) =>
          f.parts ? (
            <Piece key={f.id} id={f.id} parts={f.parts} />
          ) : (
            <group key={f.id}>
              {f.posts.map((post) => (
                <BoxMesh
                  key={post.id}
                  box={post}
                  color={f.kind === 'trellis' ? colors.brickPillar : colors.fencePost}
                />
              ))}
              {f.panels.map((panel) => (
                <BoxMesh
                  key={panel.id}
                  box={panel}
                  color={fenceColors[f.kind as keyof typeof fenceColors]}
                  transparent={f.kind === 'chain-link'}
                />
              ))}
            </group>
          ),
        )}
        {scene.outbuildings.map((b) => (
          <group key={b.id}>
            {b.walls.map((w) => (
              <BoxMesh key={w.id} box={w} color={outbuildingColors[b.kind] ?? colors.outbuilding} />
            ))}
            <PrismMesh prism={b.roof} color={colors.floorSlab} />
            {b.openings.map((o) => (
              <OpeningMesh key={o.id} opening={o} />
            ))}
          </group>
        ))}
      </group>
    </Pieces.Provider>
  );
}
