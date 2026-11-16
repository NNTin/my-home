import { useMemo } from 'react';
import { DoubleSide, ExtrudeGeometry, Path, Shape, ShapeGeometry, Vector2 } from 'three';
import {
  openingParts,
  type Box,
  type HomeScene,
  type OpeningDescriptor,
  type Prism,
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

/** Plan polygon as a three.js shape; `flipZ` for shapes rotated to face up (see SurfaceMesh). */
const toShape = (outline: Vec2[], holes: Vec2[][] = [], flipZ = false) => {
  const v = ([x, z]: Vec2) => new Vector2(x, flipZ ? -z : z);
  const shape = new Shape(outline.map(v));
  shape.holes = holes.map((hole) => new Path(hole.map(v)));
  return shape;
};

/** Plan polygon extruded from `bottom` to `top` (shape in x/z, rotated so depth runs down y). */
function PrismMesh({ prism, color }: { prism: Prism; color: string }) {
  const geometry = useMemo(
    () =>
      new ExtrudeGeometry(toShape(prism.outline, prism.holes), {
        depth: prism.top - prism.bottom,
        bevelEnabled: false,
      }),
    [prism],
  );
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

/** Flat plan polygon at height `y`, facing up. */
function SurfaceMesh({ surface, color }: { surface: Surface; color: string }) {
  const geometry = useMemo(() => new ShapeGeometry(toShape(surface.outline, [], true)), [surface]);
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

function OpeningMesh({ opening }: { opening: OpeningDescriptor }) {
  const { frame, glass } = useMemo(() => openingParts(opening), [opening]);
  const frameColor = opening.type === 'door' ? colors.doorFrame : colors.frame;
  return (
    <group position={opening.center} rotation={[0, opening.rotationY, 0]}>
      {frame.map((part, i) => (
        <BoxMesh key={i} box={part} color={frameColor} />
      ))}
      {glass && <BoxMesh box={glass} color={colors.glass} transparent />}
    </group>
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
      {scene.walls.map((w) => (
        <BoxMesh key={w.id} box={w} color={colors[w.kind]} />
      ))}
      {scene.openings.map((o) => (
        <OpeningMesh key={o.id} opening={o} />
      ))}
    </group>
  );
}
