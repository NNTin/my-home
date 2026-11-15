import { Grid, OrbitControls } from '@react-three/drei';
import { Canvas } from '@react-three/fiber';
import { SpinningCube } from './SpinningCube';

/** Full-size canvas; R3F resizes the renderer and camera with its container. */
export function Scene() {
  return (
    <Canvas camera={{ position: [4, 3, 6], fov: 50 }} dpr={[1, 2]}>
      <color attach="background" args={['#1d2129']} />
      <ambientLight intensity={0.4} />
      <directionalLight position={[5, 8, 5]} intensity={1.2} />
      <SpinningCube position={[0, 0.5, 0]} />
      <Grid infiniteGrid cellSize={0.5} sectionSize={2} fadeDistance={30} />
      <OrbitControls makeDefault target={[0, 0.5, 0]} />
    </Canvas>
  );
}
