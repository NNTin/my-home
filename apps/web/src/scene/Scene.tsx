import { Html, OrbitControls } from '@react-three/drei';
import { Canvas } from '@react-three/fiber';
import { useRef } from 'react';
import type { HomeScene, Vec3 } from '../builder/buildHome';
import type { RoomLabel } from '../builder/visibility';
import type { CompassMarker } from '../compass/compass';
import { CompassMarkers, CompassRose, CompassTracker } from '../compass/Compass';
import { FurnitureLayer, type FurnitureHandlers, type FurnitureView } from './FurnitureLayer';
import { HomeMeshes } from './HomeMeshes';
import { WalkRig, type WalkRigProps } from './WalkRig';

export interface SceneProps {
  scene: HomeScene;
  /** Orbit target; the viewer moves it to the top visible level. */
  target: Vec3;
  furniture: FurnitureView[];
  handlers: FurnitureHandlers;
  /** Bearing of true north, degrees clockwise from -z (`building.northBearing`). */
  northBearing: number;
  /** N/E/S/W letters on the ground. */
  markers: CompassMarker[];
  /** Room names shown over their floors. */
  labels: RoomLabel[];
  /** Set while walking: the figure to draw and whose eyes or overview the camera takes. */
  walk?: WalkRigProps | undefined;
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
export function Scene({
  scene,
  target,
  furniture,
  handlers,
  northBearing,
  markers,
  labels,
  walk,
}: SceneProps) {
  const roseRef = useRef<HTMLButtonElement>(null);
  const northUpRef = useRef<() => void>(undefined);
  return (
    <>
      <Canvas
        camera={{ position: initialCamera(scene.bounds), fov: 45, near: 0.1, far: 500 }}
        dpr={[1, 2]}
        shadows
        // Clicking empty space clears the selection.
        onPointerMissed={() => handlers.onSelect(undefined)}
        style={{ touchAction: 'none' }}
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
        <FurnitureLayer items={furniture} handlers={handlers} />
        <CompassMarkers markers={markers} />
        {labels.map((l) => (
          <Html key={l.id} position={l.at} center zIndexRange={[5, 0]} className="room-label">
            {l.name}
          </Html>
        ))}
        <OrbitControls
          makeDefault
          target={target}
          maxPolarAngle={Math.PI * 0.95}
          // In first person the camera is the figure's eyes; dragging looks around instead.
          enabled={walk?.view !== 'first'}
        />
        {walk && <WalkRig figure={walk.figure} view={walk.view} />}
        <CompassTracker northBearing={northBearing} roseRef={roseRef} northUpRef={northUpRef} />
      </Canvas>
      <CompassRose roseRef={roseRef} onNorthUp={() => northUpRef.current?.()} />
    </>
  );
}
