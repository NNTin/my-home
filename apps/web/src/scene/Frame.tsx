import { useFrame, useThree } from '@react-three/fiber';
import {
  createContext,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  type ReactNode,
} from 'react';
import { Box3, type Light, type Vector3, type WebGLRenderer } from 'three';
import type { Vec3 } from '../builder/buildHome';
import { studioEnvironment } from '../lighting/environment';
import { roomAt, type Emitter, type LampRoom } from '../lighting/lamps';
import { backdropColors, environmentIntensity, type LightRig } from '../lighting/rig';
import { SceneLights } from '../lighting/sceneLights';
import type { FrameGovernor } from '../quality/governor';
import { FrameOutput } from './output';
import { casterBounds } from './sunShadow';

/**
 * The frame loop of the viewer (docs/design/realistic-render.md §4.3, §4.5). Frames are drawn on
 * demand on every device: only when something asked for one. Each frame goes into the offscreen
 * target and through the output pass (`output.ts`); the shadow maps are redrawn only when what
 * casts shadows changed; shaders are compiled ahead while the previous frame stays on screen; and
 * the governor is told what was drawn. The scene is lit here too (§6): the light rig's sun, the
 * studio environment and the lamp pool, the same in every tier.
 */

/** What the parts of the scene tell the frame loop. */
export interface FrameControl {
  governor: FrameGovernor;
  /** What casts shadows changed: the sun's shadow map is fitted and drawn again. */
  castersChanged(): void;
  /** A material may be new to the renderer: compile ahead before the next frame is drawn. */
  materialsChanged(): void;
}

const Context = createContext<FrameControl | undefined>(undefined);

/** The frame loop's controls; undefined outside the viewer's canvas (the piece page, tests). */
export const useFrameControl = () => useContext(Context);

/** Device pixel ratio the canvas renders at, as [min, max]; lower on a phone. */
export const DPR: [number, number] = [1, 2];
export const PHONE_DPR: [number, number] = [1, 1.5];
/** A compile that never reports back (a lost context) must not hold the view forever. */
const COMPILE_TIMEOUT_MS = 5000;

const programIds = (gl: WebGLRenderer) => (gl.info.programs ?? []).map((p) => p.id);

const vec3 = (v: Vector3): Vec3 => [v.x, v.y, v.z];

interface Pending {
  shadow: boolean;
  /** The lamps' shadow maps wait for the view to stop moving: they are not drawn per frame. */
  lampShadows: boolean;
  compile: boolean;
  compiling: boolean;
  /** Counts the compiles started: see `done` below. */
  generation: number;
  programs: Set<number>;
}

export function FrameLoop({
  governor,
  phone,
  rig,
  emitters,
  rooms,
  eye,
  children,
}: {
  governor: FrameGovernor;
  phone: boolean;
  /** How the view is lit (`lighting/rig.ts`). */
  rig: LightRig;
  /** The fixtures that emit light, of what is drawn. */
  emitters: readonly Emitter[];
  rooms: readonly LampRoom[];
  /** The view is from inside a room, under its ceiling: walking in first person, "view from here". */
  eye: boolean;
  children: ReactNode;
}) {
  const gl = useThree((s) => s.gl);
  const invalidate = useThree((s) => s.invalidate);
  const get = useThree((s) => s.get);
  const output = useMemo(() => new FrameOutput(gl, phone), [gl, phone]);
  useEffect(() => () => output.dispose(), [output]);
  const lights = useMemo(() => new SceneLights(phone), [phone]);
  useEffect(() => () => lights.dispose(), [lights]);
  // The environment is drawn once, before the first frame is compiled.
  useLayoutEffect(() => {
    const { scene } = get();
    const environment = studioEnvironment(gl);
    scene.environment = environment.texture;
    return () => {
      scene.environment = null;
      environment.dispose();
    };
  }, [gl, get]);
  const pending = useRef<Pending>({
    shadow: true,
    lampShadows: false,
    compile: true,
    compiling: false,
    generation: 0,
    programs: new Set(),
  });

  const control = useMemo(
    (): FrameControl => ({
      governor,
      castersChanged() {
        pending.current.shadow = true;
        pending.current.lampShadows = true;
        invalidate();
      },
      materialsChanged() {
        pending.current.compile = true;
        invalidate();
      },
    }),
    [governor, invalidate],
  );

  useLayoutEffect(() => {
    const canvas = gl.domElement;
    const mark = () => {
      canvas.setAttribute('data-frame', governor.state);
      canvas.setAttribute('data-tier', governor.tier());
    };
    mark();
    return governor.attach({
      onChange: mark,
      framePending: () => get().internal.frames > 0,
      // The lamps' shadows of what moved are drawn once it rests.
      onStill: () => pending.current.lampShadows && invalidate(),
    });
  }, [gl, governor, get, invalidate]);

  // The rig: the sun (its shadow follows), the exposure and the backdrop.
  useLayoutEffect(() => {
    lights.setRig(rig);
    output.setExposure(rig.exposure);
    const { top, bottom } = backdropColors(rig.backdrop, eye);
    output.setBackdrop(top, bottom);
    pending.current.shadow = true;
    invalidate();
  }, [lights, output, rig, eye, invalidate]);
  // Lamps are assigned by the frame: one is drawn when they changed.
  useEffect(() => invalidate(), [emitters, rooms, invalidate]);

  const bounds = useMemo(() => new Box3(), []);
  const lampChanges = useRef(0);
  // Priority 1: this draws the frame instead of R3F.
  useFrame(({ scene, camera }) => {
    const p = pending.current;
    const tier = governor.tier();
    if (p.compile) {
      p.compile = false;
      p.compiling = true;
      // Only the newest compile ends the wait: an older one that reports back, or whose
      // timeout fires, while a newer one runs must not let a frame through.
      const generation = ++p.generation;
      const done = () => {
        if (p.generation !== generation || !p.compiling) return;
        p.compiling = false;
        // Compiled ahead: the frame that uses them compiles nothing.
        for (const id of programIds(gl)) p.programs.add(id);
        invalidate();
      };
      const timeout = window.setTimeout(done, COMPILE_TIMEOUT_MS);
      void output
        .compile(scene, camera, tier)
        .catch(() => undefined)
        .then(() => {
          window.clearTimeout(timeout);
          done();
        });
    }
    // Compiling ahead: the previous frame stays on screen.
    if (p.compiling) return;

    governor.frameStarted();
    // The pool gathers around the orbit target, or around the eye in a view from inside.
    const at = vec3(camera.position);
    const target = (get().controls as { target?: Vector3 } | null)?.target;
    const lamps = lights.update({
      emitters,
      focus: eye || !target ? at : vec3(target),
      ...(eye && { eye: { position: at, roomId: roomAt(rooms, at)?.id } }),
    });
    lampChanges.current += lamps.reassigned;
    scene.environmentIntensity = environmentIntensity(rig, eye);
    if (p.shadow) {
      p.shadow = false;
      lights.fitSunShadow(casterBounds(scene, bounds));
    }
    if (p.lampShadows && !governor.moving) {
      p.lampShadows = false;
      lights.redrawLampShadows();
    }
    gl.info.reset();
    output.render(scene, camera, tier);

    let compiled = false;
    for (const id of programIds(gl)) {
      if (p.programs.has(id)) continue;
      p.programs.add(id);
      compiled = true;
    }
    let shadowLights = 0;
    scene.traverseVisible((o) => {
      if ((o as Light).isLight && o.castShadow) shadowLights += 1;
    });
    governor.frameDrawn({
      drawCalls: gl.info.render.calls,
      triangles: gl.info.render.triangles,
      programs: gl.info.programs?.length ?? 0,
      compiles: p.programs.size,
      compiled,
      textures: gl.info.memory.textures,
      shadowLights,
      litLamps: lamps.lit,
      lampChanges: lampChanges.current,
    });
  }, 1);

  return (
    <Context.Provider value={control}>
      <primitive object={lights.group} />
      {children}
    </Context.Provider>
  );
}
