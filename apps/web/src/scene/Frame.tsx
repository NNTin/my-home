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
import { Box3, type DirectionalLight, type Light, type WebGLRenderer } from 'three';
import type { FrameGovernor } from '../quality/governor';
import { FrameOutput } from './output';
import { casterBounds, fitShadowCamera } from './sunShadow';

/**
 * The frame loop of the viewer (docs/design/realistic-render.md §4.3, §4.5). Frames are drawn on
 * demand on every device: only when something asked for one. Each frame goes into the offscreen
 * target and through the output pass (`output.ts`); the sun's shadow map is redrawn only when
 * what casts shadows changed; shaders are compiled ahead while the previous frame stays on
 * screen; and the governor is told what was drawn.
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
/** Size of the sun's shadow map; a quarter of the texels on a phone. */
const SHADOW_MAP: [number, number] = [2048, 2048];
const PHONE_SHADOW_MAP: [number, number] = [1024, 1024];

/** A compile that never reports back (a lost context) must not hold the view forever. */
const COMPILE_TIMEOUT_MS = 5000;

const programIds = (gl: WebGLRenderer) => (gl.info.programs ?? []).map((p) => p.id);

interface Pending {
  shadow: boolean;
  compile: boolean;
  compiling: boolean;
  /** Counts the compiles started: see `done` below. */
  generation: number;
  programs: Set<number>;
}

export function FrameLoop({
  governor,
  phone,
  backdrop,
  children,
}: {
  governor: FrameGovernor;
  phone: boolean;
  /** The colour behind the scene, `#rrggbb`. */
  backdrop: string;
  children: ReactNode;
}) {
  const gl = useThree((s) => s.gl);
  const invalidate = useThree((s) => s.invalidate);
  const get = useThree((s) => s.get);
  const sun = useRef<DirectionalLight>(null);
  const output = useMemo(() => new FrameOutput(gl, phone), [gl, phone]);
  useEffect(() => () => output.dispose(), [output]);
  useEffect(() => {
    output.setBackdrop(backdrop);
    invalidate();
  }, [output, backdrop, invalidate]);
  const pending = useRef<Pending>({
    shadow: true,
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
    return governor.attach({ onChange: mark, framePending: () => get().internal.frames > 0 });
  }, [gl, governor, get]);

  const bounds = useMemo(() => new Box3(), []);
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
    const light = sun.current;
    if (light && p.shadow) {
      p.shadow = false;
      fitShadowCamera(light, casterBounds(scene, bounds));
      light.shadow.needsUpdate = true;
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
      litLamps: 0,
    });
  }, 1);

  return (
    <Context.Provider value={control}>
      <directionalLight
        ref={sun}
        position={[20, 30, 15]}
        intensity={1.6}
        castShadow
        shadow-mapSize={phone ? PHONE_SHADOW_MAP : SHADOW_MAP}
        shadow-normalBias={0.03}
        // Static: drawn when the casters changed (`castersChanged`), not every frame.
        shadow-autoUpdate={false}
      />
      {children}
    </Context.Provider>
  );
}
