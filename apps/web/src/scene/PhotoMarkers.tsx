import { Billboard } from '@react-three/drei';
import { useFrame, useThree } from '@react-three/fiber';
import { useEffect, useMemo, useRef } from 'react';
import type { Group, Mesh, PerspectiveCamera } from 'three';
import type { PhotoPose } from '@my-home/shared';
import type { Vec3 } from '../builder/buildHome';
import { turnRose, type RoseTarget } from '../compass/Compass';
import { onCanvas } from './canvasEvent';
import { matchingVerticalFov } from '../photos/frustum';
import { EYE_HEIGHT, FIGURE_HEIGHT, FIGURE_RADIUS } from '../walk/world';

/** A photo in the 3D view: a camera at its pose with the cone it saw. */
export interface PhotoMarkerView {
  id: string;
  position: Vec3;
  /** Corners of the image plane some way in front of the camera (see `frustumCorners`). */
  corners: Vec3[];
  selected: boolean;
  /** The heading was measured by the phone's sensors, not set by hand. */
  measured?: boolean;
}

const MARKER_COLOR = '#1f6feb';
const SELECTED_COLOR = '#ffd23f';

/**
 * A marker keeps the size it has from this far away, in metres: further off it is drawn larger,
 * so the camera and the ring of a measured heading stay readable in an overview of the whole
 * home. The view cone stays true to scale.
 */
const MARKER_FULL_SIZE_DISTANCE = 7;
const MARKER_MAX_SCALE = 5;

/** How much larger than life a marker is drawn from `distance` metres away. */
export const markerScale = (distance: number) =>
  Math.min(MARKER_MAX_SCALE, Math.max(1, distance / MARKER_FULL_SIZE_DISTANCE));

/** Radius of the camera ball, and of the invisible ball around it that takes the tap. */
const MARKER_RADIUS = 0.12;
const TAP_RADIUS = 0.2;
const TOUCH_TAP_RADIUS = 0.4;
/** The tap target grows with the marker only this far, and otherwise just covers the ball. */
const TAP_MAX_SCALE = 2;

/**
 * Radius in metres of what takes the tap on a marker drawn `scale` times larger than life. It
 * always covers the ball that is drawn, but does not grow with the ring around it: a tap near a
 * camera in an overview must not open its photo by accident.
 */
export const markerTapRadius = (scale: number, touch: boolean) =>
  Math.max(
    MARKER_RADIUS * scale * 1.1,
    (touch ? TOUCH_TAP_RADIUS : TAP_RADIUS) * Math.min(scale, TAP_MAX_SCALE),
  );

function PhotoMarker({
  marker,
  touch,
  onSelect,
}: {
  marker: PhotoMarkerView;
  touch: boolean;
  onSelect(id: string): void;
}) {
  const lines = useMemo(() => {
    const [a, b, c, d] = marker.corners as [Vec3, Vec3, Vec3, Vec3];
    const p = marker.position;
    // Four edges from the camera and the frame of the image plane.
    return new Float32Array([p, a, p, b, p, c, p, d, a, b, b, c, c, d, d, a].flat());
  }, [marker]);
  const color = marker.selected ? SELECTED_COLOR : MARKER_COLOR;
  const head = useRef<Group>(null);
  const tap = useRef<Mesh>(null);
  useFrame(({ camera }) => {
    const group = head.current;
    if (!group) return;
    const scale = markerScale(camera.position.distanceTo(group.position));
    group.scale.setScalar(scale);
    // The tap target is a unit ball inside the scaled group: undo the group's scale.
    tap.current?.scale.setScalar(markerTapRadius(scale, touch) / scale);
  });
  return (
    <group>
      <group ref={head} position={marker.position}>
        <mesh>
          <sphereGeometry args={[MARKER_RADIUS, 16, 12]} />
          <meshStandardMaterial color={color} emissive={color} emissiveIntensity={0.4} />
        </mesh>
        {/* The tap target: larger than the ball, and larger still for a finger. */}
        <mesh
          ref={tap}
          onClick={(e) => {
            if (!onCanvas(e.nativeEvent)) return;
            e.stopPropagation();
            onSelect(marker.id);
          }}
        >
          <sphereGeometry args={[1, 12, 8]} />
          <meshBasicMaterial transparent opacity={0} depthWrite={false} />
        </mesh>
        {/*
        A ring marks a heading the phone measured. It faces the viewer, so it reads as a ring
        around the camera from every angle, and it is drawn over walls like the view cone's
        lines are not: a measured heading is what to look for.
      */}
        {marker.measured && (
          <Billboard>
            <mesh renderOrder={2}>
              <ringGeometry args={[0.2, 0.27, 32]} />
              <meshBasicMaterial color="#ffffff" transparent opacity={0.95} depthTest={false} />
            </mesh>
            <mesh renderOrder={3}>
              <ringGeometry args={[0.215, 0.255, 32]} />
              <meshBasicMaterial color={color} transparent depthTest={false} />
            </mesh>
          </Billboard>
        )}
      </group>
      <lineSegments>
        <bufferGeometry>
          <bufferAttribute attach="attributes-position" args={[lines, 3]} />
        </bufferGeometry>
        <lineBasicMaterial color={color} />
      </lineSegments>
    </group>
  );
}

/** Camera markers with view cones for the photos; clicking one selects its photo. */
export function PhotoMarkers({
  markers,
  touch = false,
  onSelect,
}: {
  markers: PhotoMarkerView[];
  /** A touch screen: a larger tap target around each camera. */
  touch?: boolean;
  onSelect(id: string): void;
}) {
  return markers.map((marker) => (
    <PhotoMarker key={marker.id} marker={marker} touch={touch} onSelect={onSelect} />
  ));
}

/** An open photo request in the 3D view: where to stand and, if asked for, which way to look. */
export interface RequestGhostView {
  id: string;
  /** Where the feet go. */
  position: Vec3;
  yaw: number | null;
  /** The request the next photo will answer. */
  active: boolean;
}

/** "Ghost" figures marking where a requested photo should be taken. */
export function RequestGhosts({ ghosts }: { ghosts: RequestGhostView[] }) {
  const body = FIGURE_HEIGHT - 2 * FIGURE_RADIUS;
  return ghosts.map((ghost) => {
    const color = ghost.active ? '#ffd23f' : '#7ee0ff';
    return (
      <group key={ghost.id} position={ghost.position} rotation={[0, ghost.yaw ?? 0, 0]}>
        <mesh position={[0, FIGURE_RADIUS + body / 2, 0]}>
          <capsuleGeometry args={[FIGURE_RADIUS, body, 6, 16]} />
          <meshStandardMaterial color={color} transparent opacity={0.35} depthWrite={false} />
        </mesh>
        {ghost.yaw !== null && (
          <mesh position={[0, EYE_HEIGHT, -FIGURE_RADIUS - 0.25]} rotation={[-Math.PI / 2, 0, 0]}>
            <coneGeometry args={[0.12, 0.5, 12]} />
            <meshStandardMaterial color={color} transparent opacity={0.7} />
          </mesh>
        )}
        <mesh position={[0, 0.03, 0]} rotation={[-Math.PI / 2, 0, 0]}>
          <ringGeometry args={[FIGURE_RADIUS + 0.1, FIGURE_RADIUS + 0.22, 24]} />
          <meshBasicMaterial color={color} />
        </mesh>
      </group>
    );
  });
}

export interface Viewpoint {
  pose: PhotoPose;
  /** The photo's horizontal field of view and its width over height. */
  fovH: number;
  aspect: number;
}

/**
 * "View from here": holds the 3D camera at a photo's pose with a matching field of view, so the
 * model can be compared with the photo (and the photo laid over it lines up).
 */
export function ViewpointRig({ viewpoint, rose }: { viewpoint: Viewpoint; rose?: RoseTarget }) {
  const get = useThree((s) => s.get);
  useEffect(() => {
    const camera = get().camera as PerspectiveCamera;
    const { x, y, z } = viewpoint.pose.position;
    // Where frames are drawn on demand: one for the new view, and one for leaving it.
    get().invalidate();
    return () => {
      // Back to the orbit view: step back out of the building.
      camera.fov = 45;
      camera.updateProjectionMatrix();
      camera.position.set(x + 5, y + 8, z + 8);
      get().invalidate();
    };
  }, [get, viewpoint]);

  useFrame((state) => {
    const camera = state.camera as PerspectiveCamera;
    const { pose } = viewpoint;
    camera.position.set(pose.position.x, pose.position.y, pose.position.z);
    camera.rotation.set(pose.pitch, pose.yaw, 0, 'YXZ');
    if (rose) turnRose(rose, pose.yaw);
    const fov =
      (matchingVerticalFov(viewpoint.fovH, viewpoint.aspect, state.size.width / state.size.height) *
        180) /
      Math.PI;
    if (Math.abs(camera.fov - fov) > 1e-3) {
      camera.fov = fov;
      camera.updateProjectionMatrix();
    }
  });
  // The room is lit by its lamps, or by the pool's head lamp at the eye (`lighting/sceneLights.ts`).
  return null;
}
