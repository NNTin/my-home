import { useFrame, useThree } from '@react-three/fiber';
import { useEffect, useRef, type RefObject } from 'react';
import type { Group, PerspectiveCamera, Vector3 } from 'three';
import type { Figure } from '../walk/figure';
import { EYE_HEIGHT, FIGURE_HEIGHT, FIGURE_RADIUS } from '../walk/world';

export interface WalkRigProps {
  figure: RefObject<Figure>;
  /** `first`: the camera is the figure's eyes. `third`: it orbits the figure from above. */
  view: 'first' | 'third';
}

const FIRST_PERSON_FOV = 70;
const ORBIT_FOV = 45;
/** How fast the drawn figure follows a change of height (per second), so steps look smooth. */
const HEIGHT_EASE = 12;

interface OrbitLike {
  target: Vector3;
  update(): void;
}

/**
 * Draws the figure and drives the camera while walking. It reads the live figure every frame, so
 * walking never re-renders React. In the overview the orbit controls stay usable: their target
 * rides along with the figure.
 */
export function WalkRig({ figure, view }: WalkRigProps) {
  const get = useThree((s) => s.get);
  const group = useRef<Group>(null);
  const feet = useRef(figure.current.y);

  useEffect(() => {
    const camera = get().camera as PerspectiveCamera;
    const now = () => figure.current;
    const f = now();
    camera.fov = view === 'first' ? FIRST_PERSON_FOV : ORBIT_FOV;
    camera.updateProjectionMatrix();
    if (view === 'third') {
      // Behind and above the figure, looking down into the room it is in.
      camera.position.set(f.x + Math.sin(f.yaw) * 3, f.y + 11, f.z + Math.cos(f.yaw) * 3);
    }
    return () => {
      camera.fov = ORBIT_FOV;
      camera.updateProjectionMatrix();
      // Leaving first person: step back out so the orbit view does not start inside a wall.
      if (view === 'first') {
        const at = now();
        camera.position.set(at.x + 5, at.y + 9, at.z + 8);
      }
    };
  }, [get, figure, view]);

  useFrame((state, dt) => {
    const { camera } = state;
    const controls = state.controls as OrbitLike | null;
    const f = figure.current;
    feet.current += (f.y - feet.current) * Math.min(1, dt * HEIGHT_EASE);
    const y = feet.current;
    group.current?.position.set(f.x, y, f.z);
    if (group.current) group.current.rotation.y = f.yaw;
    if (view === 'first') {
      camera.position.set(f.x, y + EYE_HEIGHT, f.z);
      camera.rotation.set(f.pitch, f.yaw, 0, 'YXZ');
    } else if (controls) {
      const dx = f.x - controls.target.x;
      const dy = y + 1 - controls.target.y;
      const dz = f.z - controls.target.z;
      camera.position.set(camera.position.x + dx, camera.position.y + dy, camera.position.z + dz);
      controls.target.set(f.x, y + 1, f.z);
      controls.update();
    }
  });

  const body = FIGURE_HEIGHT - 2 * FIGURE_RADIUS;
  return (
    <group ref={group}>
      {/* Rooms have no lamps: in first person the figure carries a soft light at its head. */}
      {view === 'first' && <pointLight position={[0, EYE_HEIGHT, 0]} intensity={0.9} decay={0} />}
      <group visible={view === 'third'}>
        <mesh position={[0, FIGURE_RADIUS + body / 2, 0]} castShadow>
          <capsuleGeometry args={[FIGURE_RADIUS, body, 6, 16]} />
          <meshStandardMaterial color="#e4572e" />
        </mesh>
        {/* The nose: which way the figure faces (-z at yaw 0). */}
        <mesh position={[0, EYE_HEIGHT, -FIGURE_RADIUS - 0.12]} rotation={[-Math.PI / 2, 0, 0]}>
          <coneGeometry args={[0.1, 0.3, 12]} />
          <meshStandardMaterial color="#ffd23f" />
        </mesh>
        {/* A ring on the floor that stays visible from straight above. */}
        <mesh position={[0, 0.03, 0]} rotation={[-Math.PI / 2, 0, 0]}>
          <ringGeometry args={[FIGURE_RADIUS + 0.05, FIGURE_RADIUS + 0.12, 24]} />
          <meshBasicMaterial color="#e4572e" />
        </mesh>
      </group>
    </group>
  );
}
