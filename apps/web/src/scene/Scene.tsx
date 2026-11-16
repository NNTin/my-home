import { OrbitControls } from '@react-three/drei';
import { Canvas } from '@react-three/fiber';
import type { HomeScene, Vec3 } from '../builder/buildHome';
import { HomeMeshes } from './HomeMeshes';

export interface SceneProps {
  scene: HomeScene;
  /** Orbit target; the viewer moves it to the top visible level. */
  target: Vec3;
}

/** Initial camera: south-east of the building, far enough to see the whole plot. */
export function initialCamera(bounds: HomeScene['bounds']): Vec3 {
  const [minX, , minZ] = bounds.min;
  const [maxX, maxY, maxZ] = bounds.max;
  const size = Math.max(maxX - minX, maxZ - minZ, 1);
  const cx = (minX + maxX) / 2;
  const cz = (minZ + maxZ) / 2;
  return [cx + size * 0.55, maxY + size * 0.45, cz + size * 0.75];
}

/** Full-size canvas; R3F resizes the renderer and camera with its container. */
export function Scene({ scene, target }: SceneProps) {
  return (
    <Canvas
      camera={{ position: initialCamera(scene.bounds), fov: 45, near: 0.1, far: 500 }}
      dpr={[1, 2]}
      shadows
    >
      <color attach="background" args={['#cfdde8']} />
      <hemisphereLight args={['#ffffff', '#5b5040', 0.8]} />
      <directionalLight
        position={[20, 30, 15]}
        intensity={1.6}
        castShadow
        shadow-mapSize={[2048, 2048]}
        shadow-bias={-0.0005}
        shadow-normalBias={0.03}
      >
        <orthographicCamera attach="shadow-camera" args={[-30, 30, 30, -30, 1, 100]} />
      </directionalLight>
      <HomeMeshes scene={scene} />
      <OrbitControls makeDefault target={target} maxPolarAngle={Math.PI * 0.95} />
    </Canvas>
  );
}
