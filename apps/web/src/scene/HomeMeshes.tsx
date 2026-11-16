import { useMemo } from 'react';
import {
  DoubleSide,
  Euler,
  ExtrudeGeometry,
  Path,
  Shape,
  ShapeGeometry,
  Vector2,
  type BufferGeometry,
} from 'three';
import {
  openingParts,
  slopeY,
  type Box,
  type HomeScene,
  type OpeningDescriptor,
  type PlaneSlope,
  type Prism,
  type ProfileSolid,
  type RoofWindowDescriptor,
  type Surface,
  type Vec2,
} from '../builder/buildHome';

// Thin rendering layer: every shape and position comes from the builder's descriptors.

const colors = {
  exterior: '#d8d2c4',
  interior: '#f1ece2',
  floorSlab: '#a6a29b',
  roof: '#7d5f50',
  terrain: '#7c6a4f',
  frame: '#f7f7f5',
  doorFrame: '#7b5a3c',
  glass: '#a8d4ff',
  garden: '#5e9b4c',
  driveway: '#8e8c88',
  patio: '#b8a184',
  path: '#c2b59b',
  road: '#6f6f6f',
  outbuilding: '#e4e0d6',
  garageDoor: '#8a8d90',
} as const;

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
    const g = new ShapeGeometry(toShape(surface.outline, [], true));
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

function OpeningMesh({
  opening,
}: {
  opening: Pick<OpeningDescriptor, 'type' | 'size' | 'center' | 'rotationY'>;
}) {
  const { frame, glass, panel } = useMemo(() => openingParts(opening), [opening]);
  const frameColor = opening.type === 'door' ? colors.doorFrame : colors.frame;
  return (
    <group position={opening.center} rotation={[0, opening.rotationY, 0]}>
      {frame.map((part, i) => (
        <BoxMesh key={i} box={part} color={frameColor} />
      ))}
      {glass && <BoxMesh box={glass} color={colors.glass} transparent />}
      {panel && <BoxMesh box={panel} color={colors.garageDoor} />}
    </group>
  );
}

function RoofWindowMesh({ window: w }: { window: RoofWindowDescriptor }) {
  const rotation = useMemo(() => new Euler(w.tilt, w.rotationY, 0, 'YXZ'), [w]);
  return (
    <mesh position={w.center} rotation={rotation} castShadow>
      <boxGeometry args={w.size} />
      <meshStandardMaterial color={colors.glass} metalness={0.3} roughness={0.2} />
    </mesh>
  );
}

export function HomeMeshes({ scene }: { scene: HomeScene }) {
  return (
    <group>
      {scene.terrain.map((t) => (
        <PrismMesh key={t.id} prism={t} color={colors.terrain} />
      ))}
      {scene.outdoorAreas.map((a) => (
        <SurfaceMesh key={a.id} surface={a} color={colors[a.kind]} />
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
      {scene.outbuildings.map((b) => (
        <group key={b.id}>
          {b.walls.map((w) => (
            <BoxMesh key={w.id} box={w} color={colors.outbuilding} />
          ))}
          <PrismMesh prism={b.roof} color={colors.floorSlab} />
          {b.openings.map((o) => (
            <OpeningMesh key={o.id} opening={o} />
          ))}
        </group>
      ))}
    </group>
  );
}
