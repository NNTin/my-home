import { finishes } from '@my-home/shared';
import { useThree } from '@react-three/fiber';
import { useEffect, useLayoutEffect, useMemo } from 'react';
import {
  AlwaysDepth,
  AlwaysStencilFunc,
  BackSide,
  DecrementWrapStencilOp,
  DoubleSide,
  FrontSide,
  IncrementWrapStencilOp,
  KeepStencilOp,
  LessEqualDepth,
  MeshBasicMaterial,
  NotEqualStencilFunc,
  Plane,
  ZeroStencilOp,
  type Material,
  type MeshStandardMaterial,
  type Side,
  type Vector3,
  type WebGLRenderer,
} from 'three';
import type { HomeScene, Vec3 } from '../builder/buildHome';
import { groupShown, linearRgb, type PlacementDraw } from '../builder/drawList';
import type { Visibility } from '../builder/visibility';
import { useFrameControl } from '../scene/Frame';
import {
  CAP_FINISH,
  capQuad,
  capSolids,
  furnitureItems,
  homeItems,
  type CapKind,
  type CapSolids,
} from './caps';
import { sectionPlane, type NamedView } from './named';
import { SECTION_PLANES } from './planes';

/**
 * The cut of a section (docs/design/realistic-render.md §7.2): one clipping plane in every
 * material of the home, and the stencil caps that close what it cuts open (`caps.ts`).
 */

/** Draw order: the terrain is counted and capped first, then everything else, so its cap wins. */
const ORDER: Record<CapKind, { count: number; quad: number }> = {
  soil: { count: 1, quad: 2 },
  dark: { count: 3, quad: 4 },
};
/** A slider that moves the cut counts as the view moving for this long after its last step. */
const CUT_REST_MS = 250;

/**
 * Counts faces in the stencil buffer and draws nothing: back faces add, front faces take away.
 * The two materials live as long as the page: a section that is switched on again finds their
 * programs where it left them (§4.5).
 */
const counting = (side: Side) =>
  new MeshBasicMaterial({
    side,
    colorWrite: false,
    depthWrite: false,
    depthTest: false,
    stencilWrite: true,
    stencilFunc: AlwaysStencilFunc,
    stencilFail: side === BackSide ? IncrementWrapStencilOp : DecrementWrapStencilOp,
    stencilZFail: side === BackSide ? IncrementWrapStencilOp : DecrementWrapStencilOp,
    stencilZPass: side === BackSide ? IncrementWrapStencilOp : DecrementWrapStencilOp,
    clippingPlanes: SECTION_PLANES,
  });

/** The section's plane, and its place among the planes every material of the home holds. */
class Cut {
  private readonly plane = new Plane();

  move([x, y, z]: Vec3, constant: number) {
    this.plane.normal.set(x, y, z);
    this.plane.constant = constant;
  }

  /** From now on the home is cut: local clipping is what reads the materials' planes. */
  on(renderer: WebGLRenderer) {
    SECTION_PLANES.push(this.plane);
    renderer.localClippingEnabled = true;
  }

  /** Whether a point is on the side that is cut away: where the section's camera stands. */
  cutAway(point: Vector3): boolean {
    return this.plane.distanceToPoint(point) < 0;
  }

  off(renderer: WebGLRenderer) {
    const at = SECTION_PLANES.indexOf(this.plane);
    if (at >= 0) SECTION_PLANES.splice(at, 1);
    renderer.localClippingEnabled = SECTION_PLANES.length > 0;
  }
}

let countingMaterials: { back: Material; front: Material } | undefined;
const counters = () =>
  (countingMaterials ??= { back: counting(BackSide), front: counting(FrontSide) });

/** After a cap is drawn the count starts again from nothing, for the next cap and frame. */
const clearCount = (renderer: WebGLRenderer) => renderer.clearStencil();

export function SectionCut({
  scene,
  view,
  visibility,
  furniture,
}: {
  scene: HomeScene;
  view: Extract<NamedView, { kind: 'section' }>;
  /** What is shown of the home: what is hidden is not capped. */
  visibility: Visibility;
  /** The furniture that is drawn. */
  furniture: readonly PlacementDraw[];
}) {
  const frame = useFrameControl();
  const gl = useThree((s) => s.gl);
  const invalidate = useThree((s) => s.invalidate);
  const cut = useMemo(() => new Cut(), []);
  const { normal, constant } = sectionPlane(scene, view);
  const [nx, ny, nz] = normal;

  // The plane goes into every material of the home. The first time, their clipped variants are
  // compiled ahead while the frame before stays on screen; taking it out compiles nothing.
  useLayoutEffect(() => {
    cut.move([nx, ny, nz], constant);
    cut.on(gl);
    frame?.useStencil();
    frame?.materialsChanged();
    frame?.castersChanged();
    return () => {
      cut.off(gl);
      frame?.castersChanged();
    };
    // Only when the cut comes and goes: moving it is the effect below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cut, gl, frame]);
  // Moving the cut is a uniform: the shadow follows, and the view moves meanwhile.
  useEffect(() => {
    cut.move([nx, ny, nz], constant);
    frame?.castersChanged();
    frame?.governor.setMoving('cut', true);
    invalidate();
    const rest = window.setTimeout(() => frame?.governor.setMoving('cut', false), CUT_REST_MS);
    return () => {
      window.clearTimeout(rest);
      frame?.governor.setMoving('cut', false);
    };
  }, [cut, nx, ny, nz, constant, frame, invalidate]);

  const home = useMemo(() => capSolids(homeItems(scene)), [scene]);
  const placed = useMemo(() => capSolids(furnitureItems(furniture)), [furniture]);
  useEffect(() => () => home.forEach((s) => s.geometry.dispose()), [home]);
  useEffect(() => () => placed.forEach((s) => s.geometry.dispose()), [placed]);

  // The caps: the finishes' own materials, drawn where the count is not zero, and not cut.
  const caps = useMemo(() => {
    const cap = (kind: CapKind) => {
      const source = frame?.finishes.material(CAP_FINISH[kind]);
      if (!source) return undefined;
      const material = source.clone();
      material.side = DoubleSide;
      material.clippingPlanes = null;
      material.stencilWrite = true;
      material.stencilFunc = NotEqualStencilFunc;
      material.stencilRef = 0;
      material.stencilFail = KeepStencilOp;
      material.stencilZFail = ZeroStencilOp;
      material.stencilZPass = ZeroStencilOp;
      return { kind, source, material };
    };
    return [cap('soil'), cap('dark')].filter((c) => c !== undefined);
  }, [frame]);
  useEffect(() => () => caps.forEach((c) => c.material.dispose()), [caps]);
  useEffect(() => {
    for (const c of caps) frame?.finishShown(CAP_FINISH[c.kind]);
  }, [caps, frame]);

  const quads = useMemo(
    () =>
      caps.map((c) => ({
        ...c,
        geometry: capQuad(
          { normal: [nx, ny, nz], constant },
          scene.bounds,
          linearRgb(finishes.get(CAP_FINISH[c.kind])?.tint ?? '#ffffff'),
        ),
      })),
    [caps, scene, nx, ny, nz, constant],
  );
  useEffect(() => () => quads.forEach((q) => q.geometry.dispose()), [quads]);

  const counted = (s: CapSolids, material: Material, side: string) => (
    <mesh
      key={`${s.key}|${side}`}
      geometry={s.geometry}
      material={material}
      visible={!s.group || groupShown(s.group, scene, visibility)}
      renderOrder={ORDER[s.cap].count}
      frustumCulled={false}
      dispose={null}
    />
  );
  return (
    <group>
      {[...home, ...placed].flatMap((s) => [
        counted(s, counters().back, 'back'),
        counted(s, counters().front, 'front'),
      ])}
      {quads.map((q) => (
        <mesh
          key={q.kind}
          geometry={q.geometry}
          material={q.material}
          renderOrder={ORDER[q.kind].quad}
          // A cut face takes no shadow: what could cast one on it is cut away, and the edges of
          // what stands right behind it would graze it.
          onBeforeRender={(_renderer, _scene, camera) => {
            // A texture that arrived went to the finish's own material: the cap follows it.
            syncMaps(q.source, q.material);
            // Seen from the side that is cut away, nothing of the home is in front of the plane:
            // the cap is drawn wherever it is counted. The depth test would leave hairlines: a
            // cut is decided per pixel but depth is kept per sample, so of a face that crosses
            // the plane edge-on (the ends of wall stretches) slivers in front of it survive.
            // From the other side the home is in front of the cap and hides it.
            q.material.depthFunc = cut.cutAway(camera.position) ? AlwaysDepth : LessEqualDepth;
          }}
          onAfterRender={clearCount}
          dispose={null}
        />
      ))}
    </group>
  );
}

function syncMaps(from: MeshStandardMaterial, to: MeshStandardMaterial) {
  to.map = from.map;
  to.normalMap = from.normalMap;
  to.roughnessMap = from.roughnessMap;
}
