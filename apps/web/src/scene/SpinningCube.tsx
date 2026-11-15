import { useFrame, type ThreeElements } from '@react-three/fiber';
import { useRef } from 'react';
import type { Mesh } from 'three';

export function SpinningCube(props: ThreeElements['mesh']) {
  const ref = useRef<Mesh>(null);
  useFrame((_, delta) => {
    if (!ref.current) return;
    ref.current.rotation.x += delta * 0.5;
    ref.current.rotation.y += delta * 0.8;
  });
  return (
    <mesh ref={ref} {...props}>
      <boxGeometry args={[1, 1, 1]} />
      <meshStandardMaterial color="#4f8cff" />
    </mesh>
  );
}
