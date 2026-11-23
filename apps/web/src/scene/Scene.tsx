import { OrbitControls } from '@react-three/drei';
import { Canvas, useThree, type RootState } from '@react-three/fiber';
import { useEffect, useMemo, useRef, type RefObject } from 'react';
import { PCFShadowMap, type PerspectiveCamera } from 'three';
import type { HomeScene, Vec3 } from '../builder/buildHome';
import { roofIndex, type RoomLabel, type Visibility } from '../builder/visibility';
import type { CompassMarker } from '../compass/compass';
import { CompassMarkers, CompassRose, CompassTracker } from '../compass/Compass';
import type { FurnitureToolbarProps } from '../overlay/FurnitureToolbar';
import { lampRooms, sceneEmitters } from '../lighting/lamps';
import { backdropRequested, rigFor } from '../lighting/rig';
import { FrameGovernor } from '../quality/governor';
import { PerfReadout, perfRequested } from '../quality/PerfReadout';
import { perfView } from '../quality/perfReport';
import type { Quality } from '../quality/setting';
import { onCanvas } from './canvasEvent';
import { DPR, FrameLoop, PHONE_DPR } from './Frame';
import { FurnitureLayer, type FurnitureHandlers, type FurnitureView } from './FurnitureLayer';
import type { FrameRequest } from '../placements/focus';
import { ShellMeshes, type PieceHandlers } from './ShellMeshes';
import {
  PhotoMarkers,
  RequestGhosts,
  ViewpointRig,
  type PhotoMarkerView,
  type RequestGhostView,
  type Viewpoint,
} from './PhotoMarkers';
import { RoomLabels, RoomLabelTracker } from './RoomLabels';
import { WalkRig, type WalkRigProps } from './WalkRig';

export interface SceneProps {
  /** The whole home: what is hidden is decided per batch (`visibility`). */
  scene: HomeScene;
  /** What to show of the home; everything when omitted. */
  visibility?: Visibility | undefined;
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
  /** Edit mode: furniture can be dragged and rotated. Off (view mode) it can only be selected. */
  editable?: boolean;
  /** The floating toolbar of the selected furniture item. */
  toolbar?: FurnitureToolbarProps | undefined;
  /** Filled with the action that puts the camera back where it started ("Reset view"). */
  resetViewRef?: RefObject<(() => void) | undefined>;
  /** Draw no frames for now: something covers the view (the camera while walking). */
  paused?: boolean;
  /** Windows, doors, roof windows and gates can be picked (not while walking). */
  pieces?: PieceHandlers | undefined;
  /** Turns the orbit camera to frame a use (`?focus=`); a new `key` frames again. */
  frame?: (FrameRequest & { key: number }) | undefined;
  /** The quality setting (`quality/setting.ts`); the frame governor picks each frame's tier from it. */
  quality?: Quality;
  /** Shows a short message: the viewer stepped down to a faster view, or could not load a part. */
  onNotice?(message: string): void;
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

export { PHONE_DPR };

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

/** What "Reset view" needs of the orbit controls. */
export interface OrbitReset {
  enableDamping: boolean;
  target: { set(x: number, y: number, z: number): void };
  update(): boolean | void;
}

/**
 * Puts the orbit camera back at `position` looking at `target`, exactly and at once. A swipe just
 * before still has damping left: the controls would keep applying it, turning the view away from
 * the reset pose and drawing a frame each time for about a hundred frames (a few seconds on a
 * phone, half a minute under software rendering). It is spent first, with damping off.
 */
export function resetOrbit(
  controls: OrbitReset | null,
  camera: { position: { set(x: number, y: number, z: number): void } },
  position: Vec3,
  target: Vec3,
) {
  if (controls) {
    const damping = controls.enableDamping;
    controls.enableDamping = false;
    controls.update();
    controls.enableDamping = damping;
  }
  camera.position.set(...position);
  controls?.target.set(...target);
  controls?.update();
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
      const { camera, size, controls } = get();
      resetOrbit(
        controls as unknown as OrbitReset | null,
        camera,
        initialCamera(bounds, size.width / size.height),
        [x, y, z],
      );
    };
    return () => {
      resetRef.current = undefined;
    };
  }, [get, bounds, x, y, z, resetRef]);
  return null;
}

/** How far the framed use's sphere is from the edge of the view: 1 = touching it. */
const FRAME_MARGIN = 1.4;
const MIN_FRAME_DISTANCE = 2.5;

/** The camera distance at which a sphere of `radius` fills the narrower side of the view. */
export function frameDistance(radius: number, fovDegrees: number, aspect: number): number {
  const half = (fovDegrees * Math.PI) / 360;
  const narrow = aspect > 0 && aspect < 1 ? Math.atan(Math.tan(half) * aspect) : half;
  return Math.max(MIN_FRAME_DISTANCE, (radius / Math.sin(narrow)) * FRAME_MARGIN);
}

/** Points the orbit camera at `frame` from its direction, at a distance that fits it. */
function applyFrame(state: RootState, frame: FrameRequest) {
  const { camera, size, controls, invalidate } = state;
  const fov = (camera as PerspectiveCamera).fov ?? 45;
  const d = frameDistance(frame.radius, fov, size.width / size.height);
  const [x, y, z] = frame.center;
  const [fx, fy, fz] = frame.from;
  resetOrbit(
    controls as unknown as OrbitReset | null,
    camera,
    [x + fx * d, y + fy * d, z + fz * d],
    frame.center,
  );
  invalidate();
  // Frames are drawn on demand, so only what asks draws one: a few more let overlays that follow the
  // camera, such as the selected item's toolbar, find their place.
  for (const ms of [100, 400, 1000]) setTimeout(() => invalidate(), ms);
}

/**
 * Inside the canvas: frames a use, a frame after the commit that applied the controls' new
 * target (the cutaway), so it has the last word.
 */
function FrameView({ frame }: { frame: (FrameRequest & { key: number }) | undefined }) {
  const get = useThree((s) => s.get);
  const key = frame?.key;
  useEffect(() => {
    if (!frame) return;
    // A frame later: on the first render the camera and controls are still being set up.
    const id = requestAnimationFrame(() => applyFrame(get(), frame));
    return () => cancelAnimationFrame(id);
    // Only a new request frames: the same one must not pull the camera back on a re-render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [get, key]);
  return null;
}

/** Full-size canvas; R3F resizes the renderer and camera with its container. */
export function Scene({
  scene,
  visibility,
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
  editable = true,
  toolbar,
  resetViewRef,
  paused = false,
  pieces,
  frame,
  quality = 'fast',
  onNotice,
}: SceneProps) {
  const roseRef = useRef<HTMLButtonElement>(null);
  const labelsRef = useRef<HTMLDivElement>(null);
  const northUpRef = useRef<() => void>(undefined);
  const rose = useMemo(() => ({ ref: roseRef, northBearing }), [northBearing]);
  // The view is from inside a room: the rig's environment is lowered and lamps light it (§6.3).
  const eye = walk?.view === 'first' || viewpoint !== undefined;
  const rig = useMemo(() => {
    const chosen = rigFor({ kind: eye ? 'eye' : 'free' });
    const backdrop = backdropRequested(window.location.search);
    return backdrop ? { ...chosen, backdrop } : chosen;
  }, [eye]);
  const rooms = useMemo(() => lampRooms(scene), [scene]);
  const emitters = useMemo(() => sceneEmitters(furniture, rooms), [furniture, rooms]);
  // `?stepdown=off`: for captures under software rendering, where every frame is slow (§3.4).
  const governor = useMemo(
    () =>
      new FrameGovernor(undefined, {
        stepDown: new URLSearchParams(window.location.search).get('stepdown') !== 'off',
      }),
    [],
  );
  useEffect(() => () => governor.dispose(), [governor]);
  useEffect(() => governor.setSetting(quality), [governor, quality]);
  // A furniture drag moves the view's content like the orbit controls move the camera.
  const dragHandlers = useMemo(
    (): FurnitureHandlers => ({
      ...handlers,
      onMoveStart(id) {
        governor.setMoving('drag', true);
        handlers.onMoveStart(id);
      },
      onRotateStart(id) {
        governor.setMoving('drag', true);
        handlers.onRotateStart(id);
      },
      onDragEnd() {
        governor.setMoving('drag', false);
        handlers.onDragEnd();
      },
    }),
    [handlers, governor],
  );
  return (
    <>
      <Canvas
        camera={{ position: initialCamera(scene.bounds), fov: 45, near: 0.1, far: 500 }}
        // A phone has more pixels per inch than it can fill at a steady rate: a capped pixel ratio.
        dpr={touch ? PHONE_DPR : DPR}
        // On every device a new frame is drawn only when something changed (docs/mobile.md).
        frameloop="demand"
        // Anti-aliasing belongs to the frame's offscreen target (`output.ts`), not to the canvas.
        gl={{ antialias: false }}
        // three r187 has no soft PCF any more: ask for the type it would fall back to.
        shadows={{ type: PCFShadowMap }}
        // The camera is placed before the view is measured: stand back if it is a narrow one.
        onCreated={({ camera, size, gl }) => {
          camera.position.set(...initialCamera(scene.bounds, size.width / size.height));
          // A frame is several render calls (the scene, the passes): counted together, per frame.
          gl.info.autoReset = false;
        }}
        // Clicking empty space clears the selection.
        onPointerMissed={(e) => onCanvas(e) && handlers.onSelect(undefined)}
        style={{ touchAction: 'none' }}
      >
        <PauseFrames paused={paused} />
        <FrameLoop
          governor={governor}
          phone={touch}
          rig={rig}
          emitters={emitters}
          rooms={rooms}
          eye={eye}
          beautiful={quality !== 'fast'}
          onNotice={onNotice}
        >
          <ShellMeshes scene={scene} visibility={visibility} pieces={pieces} />
          <FurnitureLayer
            items={furniture}
            handlers={dragHandlers}
            touch={touch}
            toolbar={toolbar}
            editable={editable}
          />
          <CompassMarkers markers={markers} />
          <RoomLabelTracker labels={labels} layerRef={labelsRef} />
          <OrbitControls
            makeDefault
            target={target}
            maxPolarAngle={Math.PI * 0.95}
            // In first person the camera is the figure's eyes; dragging looks around instead.
            enabled={walk?.view !== 'first' && !viewpoint}
            onStart={() => governor.setMoving('orbit', true)}
            onEnd={() => governor.setMoving('orbit', false)}
          />
          {walk && <WalkRig figure={walk.figure} view={walk.view} rose={rose} />}
          {viewpoint && <ViewpointRig viewpoint={viewpoint} rose={rose} />}
          <PhotoMarkers
            markers={photoMarkers}
            touch={touch}
            onSelect={(id) => onSelectPhoto?.(id)}
          />
          {resetViewRef && (
            <ViewReset bounds={scene.bounds} target={target} resetRef={resetViewRef} />
          )}
          <FrameView frame={frame} />
          <RequestGhosts ghosts={requestGhosts} />
          <CompassTracker northBearing={northBearing} roseRef={roseRef} northUpRef={northUpRef} />
        </FrameLoop>
      </Canvas>
      <RoomLabels labels={labels} layerRef={labelsRef} />
      <CompassRose roseRef={roseRef} onNorthUp={() => northUpRef.current?.()} />
      {perfRequested() && (
        <PerfReadout
          governor={governor}
          phone={touch}
          view={() =>
            perfView({
              levels: scene.levels,
              // Everything is shown when no visibility is given.
              maxLevelIndex: visibility?.maxLevelIndex ?? roofIndex(scene),
              ...(walk && { walk: { view: walk.view, levelId: walk.figure.current.levelId } }),
              viewpoint: viewpoint !== undefined,
            })
          }
        />
      )}
    </>
  );
}
