import { Html, OrbitControls } from '@react-three/drei';
import { Canvas, useThree } from '@react-three/fiber';
import { useEffect, useMemo, useRef, type RefObject } from 'react';
import type { HomeScene, Vec3 } from '../builder/buildHome';
import type { RoomLabel } from '../builder/visibility';
import type { CompassMarker } from '../compass/compass';
import { CompassMarkers, CompassRose, CompassTracker } from '../compass/Compass';
import type { FurnitureToolbarProps } from '../overlay/FurnitureToolbar';
import { onCanvas } from './canvasEvent';
import { FurnitureLayer, type FurnitureHandlers, type FurnitureView } from './FurnitureLayer';
import { HomeMeshes } from './HomeMeshes';
import {
  PhotoMarkers,
  RequestGhosts,
  ViewpointRig,
  type PhotoMarkerView,
  type RequestGhostView,
  type Viewpoint,
} from './PhotoMarkers';
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
  /** Photos shown as cameras with view cones; clicking one calls `onSelectPhoto`. */
  photoMarkers?: PhotoMarkerView[];
  onSelectPhoto?(id: string): void;
  /** Open photo requests shown as ghost figures. */
  requestGhosts?: RequestGhostView[];
  /** Set to look from a photo's pose ("view from here"). */
  viewpoint?: Viewpoint | undefined;
  /** A touch screen: larger handles and tap targets in the 3D view. */
  touch?: boolean;
  /** The floating toolbar of the selected furniture item. */
  toolbar?: FurnitureToolbarProps | undefined;
  /** Filled with the action that puts the camera back where it started ("Reset view"). */
  resetViewRef?: RefObject<(() => void) | undefined>;
  /** Draw no frames for now: something covers the view (the camera while walking). */
  paused?: boolean;
}

/** Stops the frame loop while `paused`, and puts back whichever loop ran before. */
function PauseFrames({ paused }: { paused: boolean }) {
  const get = useThree((state) => state.get);
  useEffect(() => {
    if (!paused) return;
    const { frameloop, setFrameloop } = get();
    setFrameloop('never');
    return () => setFrameloop(frameloop);
  }, [paused, get]);
  return null;
}

/** Device pixel ratio the canvas renders at, as [min, max]; lower on a phone. */
const DPR: [number, number] = [1, 2];
export const PHONE_DPR: [number, number] = [1, 1.5];
/** Size of the sun's shadow map; a quarter of the texels on a phone. */
const SHADOW_MAP: [number, number] = [2048, 2048];
const PHONE_SHADOW_MAP: [number, number] = [1024, 1024];

/**
 * Initial camera: south-east of the building, far enough to see the whole plot. `aspect` is the
 * view's width over its height: a view narrower than it is high (a phone held upright) sees less
 * to the sides, so the camera stands further back by as much.
 */
export function initialCamera(bounds: HomeScene['bounds'], aspect = 1): Vec3 {
  const [minX, , minZ] = bounds.min;
  const [maxX, maxY, maxZ] = bounds.max;
  // A view that is not measured yet (no width or height) counts as a wide one.
  const back = Number.isFinite(aspect) && aspect > 0 ? Math.max(1, 1 / aspect) : 1;
  const size = Math.max(maxX - minX, maxZ - minZ, 1) * back;
  const cx = (minX + maxX) / 2;
  const cz = (minZ + maxZ) / 2;
  return [cx + size * 0.55, maxY + size * 0.45, cz + size * 0.75];
}

/** Inside the canvas: provides the "Reset view" action, for the view as it is sized now. */
function ViewReset({
  bounds,
  target,
  resetRef,
}: {
  bounds: HomeScene['bounds'];
  target: Vec3;
  resetRef: RefObject<(() => void) | undefined>;
}) {
  const get = useThree((s) => s.get);
  const [x, y, z] = target;
  useEffect(() => {
    resetRef.current = () => {
      const { camera, size } = get();
      const controls = get().controls as unknown as {
        target: { set(x: number, y: number, z: number): void };
        update(): void;
      } | null;
      camera.position.set(...initialCamera(bounds, size.width / size.height));
      controls?.target.set(x, y, z);
      controls?.update();
    };
    return () => {
      resetRef.current = undefined;
    };
  }, [get, bounds, x, y, z, resetRef]);
  return null;
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
  photoMarkers = [],
  onSelectPhoto,
  requestGhosts = [],
  viewpoint,
  touch = false,
  toolbar,
  resetViewRef,
  paused = false,
}: SceneProps) {
  const roseRef = useRef<HTMLButtonElement>(null);
  const northUpRef = useRef<() => void>(undefined);
  const rose = useMemo(() => ({ ref: roseRef, northBearing }), [northBearing]);
  return (
    <>
      <Canvas
        camera={{ position: initialCamera(scene.bounds), fov: 45, near: 0.1, far: 500 }}
        // A phone has more pixels per inch than it can fill at a steady rate, and a battery: a
        // capped pixel ratio, and a new frame only when something changed (docs/mobile.md).
        dpr={touch ? PHONE_DPR : DPR}
        frameloop={touch ? 'demand' : 'always'}
        shadows
        // The camera is placed before the view is measured: stand back if it is a narrow one.
        onCreated={({ camera, size }) =>
          camera.position.set(...initialCamera(scene.bounds, size.width / size.height))
        }
        // Clicking empty space clears the selection.
        onPointerMissed={(e) => onCanvas(e) && handlers.onSelect(undefined)}
        style={{ touchAction: 'none' }}
      >
        <PauseFrames paused={paused} />
        <color attach="background" args={['#cfdde8']} />
        <hemisphereLight args={['#ffffff', '#5b5040', 0.8]} />
        <directionalLight
          position={[20, 30, 15]}
          intensity={1.6}
          castShadow
          shadow-mapSize={touch ? PHONE_SHADOW_MAP : SHADOW_MAP}
          shadow-bias={-0.0005}
          shadow-normalBias={0.03}
        >
          <orthographicCamera attach="shadow-camera" args={[-30, 30, 30, -30, 1, 100]} />
        </directionalLight>
        <HomeMeshes scene={scene} />
        <FurnitureLayer items={furniture} handlers={handlers} touch={touch} toolbar={toolbar} />
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
          enabled={walk?.view !== 'first' && !viewpoint}
        />
        {walk && <WalkRig figure={walk.figure} view={walk.view} rose={rose} />}
        {viewpoint && <ViewpointRig viewpoint={viewpoint} rose={rose} />}
        <PhotoMarkers markers={photoMarkers} touch={touch} onSelect={(id) => onSelectPhoto?.(id)} />
        {resetViewRef && (
          <ViewReset bounds={scene.bounds} target={target} resetRef={resetViewRef} />
        )}
        <RequestGhosts ghosts={requestGhosts} />
        <CompassTracker northBearing={northBearing} roseRef={roseRef} northUpRef={northUpRef} />
      </Canvas>
      <CompassRose roseRef={roseRef} onNorthUp={() => northUpRef.current?.()} />
    </>
  );
}
