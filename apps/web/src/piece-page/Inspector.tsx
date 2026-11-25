import { Line, OrbitControls } from '@react-three/drei';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { useEffect, useMemo, useRef, type RefObject } from 'react';
import { Vector3 } from 'three';
import type { Vec3 } from '../builder/buildHome';
import { PartsMesh } from '../catalog/PartsMesh';
import { projectLabel } from '../scene/RoomLabels';
import type { DimensionLine, Part } from '../catalog/types';

/**
 * The piece page's 3D view: the piece on its own (an opening in a wall stub, furniture and gates
 * on the ground), orbit and zoom, framed to fit whenever its parameters change, and its
 * dimensions drawn as lines with labels in cm. A new frame only when something changed.
 */

/**
 * Labels are DOM elements over the canvas moved on every frame drawn (not drei `Html`, which
 * mounts a React root per label; see `RoomLabels`): at most this many per piece.
 */
export const MAX_LABELS = 8;
/** Where "Reset view" looks from, from the piece's centre: front right, a little above. */
const VIEW_FROM = new Vector3(0.9, 0.6, 1.8).normalize();
/** A ceiling piece is seen from front right, a little below. */
const VIEW_FROM_BELOW = new Vector3(0.9, -0.6, 1.8).normalize();
const FOV = 35;
const DIMENSION_COLOR = '#1f4e8c';
const TICK = 0.03;

export interface Bounds {
  min: Vec3;
  max: Vec3;
}

/** The box around the parts and the dimension lines. */
export function boundsOf(parts: readonly Part[], lines: readonly DimensionLine[] = []): Bounds {
  const min: Vec3 = [Infinity, Infinity, Infinity];
  const max: Vec3 = [-Infinity, -Infinity, -Infinity];
  const add = (p: readonly number[], half: readonly number[] = [0, 0, 0]) => {
    for (let i = 0; i < 3; i++) {
      min[i] = Math.min(min[i]!, p[i]! - half[i]!);
      max[i] = Math.max(max[i]!, p[i]! + half[i]!);
    }
  };
  for (const part of parts) {
    // The box around the part's own box once it is tilted about its x axis (a rail lying down, a
    // slab laid flat) and then turned about y.
    const [sx, uy, uz] = part.size;
    const abs = (angle: number) => [Math.abs(Math.cos(angle)), Math.abs(Math.sin(angle))] as const;
    const [cx, sn] = abs(part.rotationX ?? 0);
    const [sy, sz] = [uy * cx + uz * sn, uy * sn + uz * cx];
    const [cy, sm] = abs(part.rotationY);
    add(part.center, [(sx * cy + sz * sm) / 2, sy / 2, (sx * sm + sz * cy) / 2]);
  }
  for (const line of lines) {
    add(line.from);
    add(line.to);
  }
  if (!Number.isFinite(min[0])) return { min: [-0.5, -0.5, -0.5], max: [0.5, 0.5, 0.5] };
  return { min, max };
}

/** How far from the centre the camera stands to see a sphere of `radius` at this aspect. */
export function fitDistance(radius: number, aspect: number, fov = FOV): number {
  const vertical = (fov * Math.PI) / 360;
  const horizontal = Math.atan(Math.tan(vertical) * (aspect > 0 ? aspect : 1));
  return (radius * 1.1) / Math.sin(Math.min(vertical, horizontal));
}

interface Controls {
  target: Vector3;
  enableDamping: boolean;
  update(): unknown;
}

/** Frames the bounds on every change (keeping the direction), and provides "Reset view". */
function Framer({
  bounds,
  view,
  resetRef,
}: {
  bounds: Bounds;
  view: Vector3;
  resetRef: RefObject<(() => void) | undefined>;
}) {
  const get = useThree((s) => s.get);
  const controls = useThree((s) => s.controls) as unknown as Controls | null;
  const key = [...bounds.min, ...bounds.max].map((n) => n.toFixed(4)).join(',');
  // The first view (once the controls exist) is the default one; later ones keep the direction.
  const placed = useRef(false);

  useEffect(() => {
    const center = new Vector3(...bounds.min).add(new Vector3(...bounds.max)).multiplyScalar(0.5);
    const radius = Math.max(new Vector3(...bounds.max).distanceTo(center), 0.1);
    const frame = (from?: Vector3) => {
      const { camera, size, invalidate } = get();
      const direction =
        from ??
        (controls && placed.current
          ? camera.position.clone().sub(controls.target).normalize()
          : view.clone());
      if (controls) placed.current = true;
      if (controls) {
        // Spend any damping left from a swipe first, or it turns the view away again.
        const damping = controls.enableDamping;
        controls.enableDamping = false;
        controls.update();
        controls.enableDamping = damping;
      }
      const distance = fitDistance(radius, size.width / Math.max(size.height, 1));
      camera.position.copy(center).addScaledVector(direction, distance);
      camera.near = distance / 100;
      camera.far = distance * 100;
      camera.updateProjectionMatrix();
      controls?.target.copy(center);
      controls?.update();
      invalidate();
    };
    frame();
    resetRef.current = () => frame(view.clone());
    return () => {
      resetRef.current = undefined;
    };
    // The key stands for the bounds' values.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, controls, get, resetRef, view]);
  return null;
}

const midpoint = (line: DimensionLine): Vec3 => [
  (line.from[0] + line.to[0]) / 2,
  (line.from[1] + line.to[1]) / 2,
  (line.from[2] + line.to[2]) / 2,
];

/** Each dimension as a line with end ticks. */
function DimensionLines({ lines }: { lines: readonly DimensionLine[] }) {
  return (
    <>
      {lines.map((line, i) => {
        const [from, to] = [new Vector3(...line.from), new Vector3(...line.to)];
        const along = to.clone().sub(from).normalize();
        const tick = Math.abs(along.y) > 0.9 ? new Vector3(TICK, 0, 0) : new Vector3(0, TICK, 0);
        const ends = [from, to].flatMap((p) => [p.clone().add(tick), p.clone().sub(tick)]);
        return (
          <Line
            key={i}
            points={[from, to, ...ends]}
            segments
            color={DIMENSION_COLOR}
            lineWidth={2}
            depthTest={false}
            renderOrder={10}
          />
        );
      })}
    </>
  );
}

/** Inside the canvas: moves the label elements to their lines' midpoints on every frame drawn. */
function DimensionLabelTracker({
  lines,
  layerRef,
}: {
  lines: readonly DimensionLine[];
  layerRef: RefObject<HTMLDivElement | null>;
}) {
  const invalidate = useThree((s) => s.invalidate);
  const points = useMemo(() => lines.slice(0, MAX_LABELS).map(midpoint), [lines]);
  const scratch = useMemo(() => new Vector3(), []);
  useEffect(() => invalidate(), [points, invalidate]);
  useFrame(({ camera, size }) => {
    const children = layerRef.current?.children ?? [];
    for (let i = 0; i < children.length; i++) {
      const node = children[i] as HTMLElement;
      const at = points[i];
      const p = at && projectLabel(at, camera, size.width, size.height, scratch);
      node.style.setProperty('visibility', p ? 'visible' : 'hidden');
      if (p) {
        node.style.setProperty(
          'transform',
          `translate3d(${p.x}px, ${p.y}px, 0) translate(-50%, -50%)`,
        );
      }
    }
  });
  return null;
}

/** A ground plane at `y` under the piece. */
function Ground({ y, size }: { y: number; size: number }) {
  return (
    <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, y - 0.001, 0]} receiveShadow>
      <planeGeometry args={[size, size]} />
      <meshStandardMaterial color="#a6a29b" />
    </mesh>
  );
}

export interface InspectorProps {
  parts: Part[];
  /** Drawn around the piece and not framed: an opening's wall stub. */
  context?: Part[];
  lines: DimensionLine[];
  showDimensions: boolean;
  /** The floor or ground height, when the piece stands on one. */
  ground?: number | undefined;
  /** Where the first view and "Reset view" look from: above (default) or below (a ceiling piece). */
  from?: 'above' | 'below' | undefined;
  touch: boolean;
  /** Filled with "Reset view". */
  resetRef: RefObject<(() => void) | undefined>;
}

export function Inspector({
  parts,
  context = [],
  lines,
  showDimensions,
  ground,
  from = 'above',
  touch,
  resetRef,
}: InspectorProps) {
  const view = from === 'below' ? VIEW_FROM_BELOW : VIEW_FROM;
  const bounds = useMemo(() => boundsOf(parts, lines), [parts, lines]);
  const groundSize = Math.max(...bounds.max.map((v, i) => v - bounds.min[i]!)) * 4 + 2;
  const layerRef = useRef<HTMLDivElement>(null);
  return (
    <>
      <Canvas
        className="inspector-canvas"
        camera={{ position: view.clone().multiplyScalar(4).toArray(), fov: FOV }}
        dpr={touch ? [1, 1.5] : [1, 2]}
        frameloop="demand"
        style={{ touchAction: 'none' }}
      >
        <color attach="background" args={['#cfdde8']} />
        <hemisphereLight args={['#ffffff', '#5b5040', 1.1]} />
        <directionalLight position={[3, 5, 4]} intensity={1.8} />
        <directionalLight position={[-3, 2, -4]} intensity={0.5} />
        {from === 'below' && <directionalLight position={[3, -5, 4]} intensity={1.8} />}
        <PartsMesh parts={context} />
        <PartsMesh parts={parts} />
        {ground !== undefined && <Ground y={ground} size={groundSize} />}
        {showDimensions && <DimensionLines lines={lines} />}
        <OrbitControls makeDefault enableDamping />
        <Framer bounds={bounds} view={view} resetRef={resetRef} />
        <DimensionLabelTracker lines={lines} layerRef={layerRef} />
      </Canvas>
      <div className="dimension-labels" ref={layerRef} hidden={!showDimensions}>
        {lines.slice(0, MAX_LABELS).map((line, i) => (
          <div key={i} className="dimension-label" style={{ visibility: 'hidden' }}>
            {line.label}
          </div>
        ))}
      </div>
    </>
  );
}
