import { useThree } from '@react-three/fiber';
import { useEffect, useMemo } from 'react';
import { BufferGeometry, Shape, ShapeGeometry, Vector2, Vector3 } from 'three';
import type { Vec2 } from '../geom/types';

/**
 * The selected room's outline (HUD v2 #201): its floor in a light primary tint with a violet line around it, just
 * above the floor. Flat colours, no light: it reads on any finish and draws nothing else again.
 */
export function RoomOutline({ outline, y }: { outline: Vec2[]; y: number }) {
  const { fill, line } = useMemo(() => {
    // The shape in plan (x, -z), turned to lie on the floor: (x, 0, z).
    const fill = new ShapeGeometry(new Shape(outline.map(([x, z]) => new Vector2(x, -z))));
    fill.rotateX(-Math.PI / 2);
    const line = new BufferGeometry().setFromPoints(outline.map(([x, z]) => new Vector3(x, 0, z)));
    return { fill, line };
  }, [outline]);
  useEffect(
    () => () => {
      fill.dispose();
      line.dispose();
    },
    [fill, line],
  );
  // Frames are drawn on demand: a new outline asks for one.
  const invalidate = useThree((s) => s.invalidate);
  useEffect(() => invalidate(), [invalidate, fill, y]);
  return (
    <group position={[0, y + 0.03, 0]}>
      <mesh geometry={fill} renderOrder={2}>
        <meshBasicMaterial color="#8f8df7" transparent opacity={0.3} depthWrite={false} />
      </mesh>
      <lineLoop geometry={line} renderOrder={3}>
        <lineBasicMaterial color="#5a4fd8" />
      </lineLoop>
    </group>
  );
}
