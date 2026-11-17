import { useFrame, useThree } from '@react-three/fiber';
import { useEffect, useMemo } from 'react';
import type { PerspectiveCamera } from 'three';
import type { PhotoPose } from '@my-home/shared';
import type { Vec3 } from '../builder/buildHome';
import { turnRose, type RoseTarget } from '../compass/Compass';
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

function PhotoMarker({
  marker,
  onSelect,
}: {
  marker: PhotoMarkerView;
  onSelect(id: string): void;
}) {
  const lines = useMemo(() => {
    const [a, b, c, d] = marker.corners as [Vec3, Vec3, Vec3, Vec3];
    const p = marker.position;
    // Four edges from the camera and the frame of the image plane.
    return new Float32Array([p, a, p, b, p, c, p, d, a, b, b, c, c, d, d, a].flat());
  }, [marker]);
  const color = marker.selected ? SELECTED_COLOR : MARKER_COLOR;
  return (
    <group>
      <mesh
        position={marker.position}
        onClick={(e) => {
          e.stopPropagation();
          onSelect(marker.id);
        }}
      >
        <sphereGeometry args={[0.12, 16, 12]} />
        <meshStandardMaterial color={color} emissive={color} emissiveIntensity={0.4} />
      </mesh>
      {/* A level ring, like a compass card, marks a heading the phone measured. */}
      {marker.measured && (
        <mesh position={marker.position} rotation={[-Math.PI / 2, 0, 0]}>
          <torusGeometry args={[0.2, 0.025, 8, 24]} />
          <meshStandardMaterial color={color} emissive={color} emissiveIntensity={0.4} />
        </mesh>
      )}
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
  onSelect,
}: {
  markers: PhotoMarkerView[];
  onSelect(id: string): void;
}) {
  return markers.map((marker) => (
    <PhotoMarker key={marker.id} marker={marker} onSelect={onSelect} />
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
    return () => {
      // Back to the orbit view: step back out of the building.
      camera.fov = 45;
      camera.updateProjectionMatrix();
      camera.position.set(x + 5, y + 8, z + 8);
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
  return (
    <pointLight
      position={[viewpoint.pose.position.x, viewpoint.pose.position.y, viewpoint.pose.position.z]}
      intensity={0.9}
      decay={0}
    />
  );
}
