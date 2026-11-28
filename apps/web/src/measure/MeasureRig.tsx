import { useFrame, useThree } from '@react-three/fiber';
import { useEffect, useMemo, useRef, type RefObject } from 'react';
import {
  OrthographicCamera,
  PerspectiveCamera,
  Raycaster,
  Vector2,
  Vector3,
  type Camera,
  type Mesh,
  type Object3D,
} from 'three';
import { projectLabel } from '../scene/RoomLabels';
import type { Measurement, Point } from './measure';

/** A press that moved further than this many pixels turned the view: not a pick. */
const CLICK_SLOP = 6;
/** A point's radius and the span's half width on screen, in CSS pixels. */
const MARKER_PX = 6;
const SPAN_PX = 1.5;
const UP = new Vector3(0, 1, 0);

/** The size of one CSS pixel of the view at a point in the scene, in metres. */
function pixelAt(camera: Camera, height: number, at: Vector3): number {
  if (camera instanceof PerspectiveCamera) {
    const fov = (camera.fov * Math.PI) / 180;
    return (2 * camera.position.distanceTo(at) * Math.tan(fov / 2)) / camera.zoom / height;
  }
  if (camera instanceof OrthographicCamera)
    return (camera.top - camera.bottom) / camera.zoom / height;
  return 0.01;
}

/** Whether the object is drawn and part of the model: not hidden, not a marker, a letter or this tool's span. */
function modelPart(object: Object3D) {
  for (let o: Object3D | null = object; o; o = o.parent) {
    if (!o.visible || o.userData.overlay === true) return false;
  }
  return 'isMesh' in object;
}

/**
 * The point of the model a ray meets first, or undefined (the sky, the ground's edge, a marker only). The camera
 * goes with the ray: the scene's sprites (the compass letters) cannot be hit without it.
 */
export function pickPoint(scene: Object3D, camera: Camera, ndc: Vector2): Point | undefined {
  const raycaster = new Raycaster();
  raycaster.setFromCamera(ndc, camera);
  raycaster.camera = camera;
  const hit = raycaster.intersectObject(scene, true).find((h) => modelPart(h.object));
  return hit && [hit.point.x, hit.point.y, hit.point.z];
}

type Press = Pick<PointerEvent, 'button' | 'pointerId' | 'clientX' | 'clientY'>;

/**
 * A pick by mouse, pen or touch: a press and a release of the same pointer that barely moved. A drag still turns the
 * view, a second finger (a pinch) is not the first one, and a press the browser took over (pointercancel) picks
 * nothing.
 */
export function clickPicker(at: (x: number, y: number) => void) {
  let press: { id: number; x: number; y: number } | undefined;
  return {
    down(e: Press) {
      // Another pointer while one is down: a pinch, no pick. The same one again: its release went elsewhere.
      if (press && press.id !== e.pointerId) return void (press = undefined);
      press = e.button === 0 ? { id: e.pointerId, x: e.clientX, y: e.clientY } : undefined;
    },
    up(e: Press) {
      const p = press;
      if (p?.id !== e.pointerId) return;
      press = undefined;
      if (Math.hypot(e.clientX - p.x, e.clientY - p.y) <= CLICK_SLOP) at(e.clientX, e.clientY);
    },
    cancel() {
      press = undefined;
    },
  };
}

export interface MeasureRigProps {
  points: Measurement;
  /** A pick: the point, or undefined where the ray met nothing of the model. */
  onPick(point: Point | undefined): void;
  /** Picks at a place of the view given as fractions of its size (the keyboard's cross). */
  pickRef: RefObject<((x: number, y: number) => void) | undefined>;
  /** The distance's label outside the canvas, placed beside the span's middle every frame. */
  labelRef: RefObject<HTMLElement | null>;
}

/**
 * Inside the canvas while measuring (HUD v2 #206): turns a click or a tap on the model into a point, and draws the
 * two points and the line between them over everything, as an overlay (not part of an exported image).
 */
export function MeasureRig({ points, onPick, pickRef, labelRef }: MeasureRigProps) {
  const { gl, camera, scene, invalidate } = useThree();
  const onPickRef = useRef(onPick);
  useEffect(() => {
    onPickRef.current = onPick;
  });

  useEffect(() => {
    const canvas = gl.domElement;
    const at = (x: number, y: number) => {
      const r = canvas.getBoundingClientRect();
      const ndc = new Vector2(((x - r.left) / r.width) * 2 - 1, -((y - r.top) / r.height) * 2 + 1);
      onPickRef.current(pickPoint(scene, camera, ndc));
    };
    pickRef.current = (fx, fy) => {
      const r = canvas.getBoundingClientRect();
      at(r.left + fx * r.width, r.top + fy * r.height);
    };
    const { down, up, cancel } = clickPicker(at);
    canvas.addEventListener('pointerdown', down);
    canvas.addEventListener('pointerup', up);
    canvas.addEventListener('pointercancel', cancel);
    return () => {
      canvas.removeEventListener('pointerdown', down);
      canvas.removeEventListener('pointerup', up);
      canvas.removeEventListener('pointercancel', cancel);
      pickRef.current = undefined;
    };
  }, [gl, camera, scene, pickRef]);

  // Frames are drawn on demand: a new point asks for one.
  useEffect(() => invalidate(), [invalidate, points]);

  // The points and the span keep their size on screen, near or far: scaled every frame drawn by the size of a pixel
  // where they are. The label goes beside the span's middle, as the room names are placed.
  const markers = useRef<(Mesh | null)[]>([]);
  const span = useRef<Mesh>(null);
  const scratch = useMemo(() => ({ a: new Vector3(), b: new Vector3(), mid: new Vector3() }), []);
  useFrame(({ camera: eye, size }) => {
    points.forEach((p, i) => {
      markers.current[i]?.scale.setScalar(
        MARKER_PX * pixelAt(eye, size.height, scratch.a.set(...p)),
      );
    });
    const [a, b] = points;
    const bar = span.current;
    if (a && b && bar) {
      scratch.a.set(...a);
      scratch.b.set(...b);
      scratch.mid.addVectors(scratch.a, scratch.b).multiplyScalar(0.5);
      const length = scratch.a.distanceTo(scratch.b);
      const r = SPAN_PX * pixelAt(eye, size.height, scratch.mid);
      bar.position.copy(scratch.mid);
      if (length > 0)
        bar.quaternion.setFromUnitVectors(UP, scratch.b.sub(scratch.a).divideScalar(length));
      bar.scale.set(r, length, r);
    }
    const label = labelRef.current;
    if (!label) return;
    const at =
      a &&
      b &&
      projectLabel([scratch.mid.x, scratch.mid.y, scratch.mid.z], eye, size.width, size.height);
    label.style.setProperty('visibility', at ? 'visible' : 'hidden');
    if (at)
      label.style.setProperty(
        'transform',
        `translate3d(${at.x}px, ${at.y}px, 0) translate(-50%, -150%)`,
      );
  });

  return (
    <group userData={{ overlay: true }}>
      {points.map((p, i) => (
        <mesh
          key={i}
          ref={(m) => void (markers.current[i] = m)}
          position={p as [number, number, number]}
          renderOrder={10}
        >
          <sphereGeometry args={[1, 16, 12]} />
          <meshBasicMaterial color="#5a4fd8" depthTest={false} transparent />
        </mesh>
      ))}
      {points.length === 2 && (
        <mesh ref={span} renderOrder={10}>
          <cylinderGeometry args={[1, 1, 1, 8]} />
          <meshBasicMaterial color="#5a4fd8" depthTest={false} transparent />
        </mesh>
      )}
    </group>
  );
}
