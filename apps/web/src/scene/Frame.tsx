import { useFrame, useThree } from '@react-three/fiber';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  type ReactNode,
} from 'react';
import { Box3, type Light, type Vector3, type WebGLRenderer } from 'three';
import type { Vec3 } from '../builder/buildHome';
import { finishMaterials, releaseOtherDevices, type FinishMaterials } from '../finishes/materials';
import { studioEnvironment } from '../lighting/environment';
import { roomAt, type Emitter, type LampRoom } from '../lighting/lamps';
import { backdropColors, environmentIntensity, type LightRig } from '../lighting/rig';
import { SceneLights } from '../lighting/sceneLights';
import type { FrameGovernor } from '../quality/governor';
import { FrameOutput, gpuIdle } from './output';
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
  /** The materials of finishes for this device, with their textures. */
  finishes: FinishMaterials;
  /** A finish is drawn: its texture files are asked for, once, in this device's size (§5.3). */
  finishShown(finish: string): void;
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

/** What the frame loop needs of the orbit controls. */
interface Damped {
  enableDamping?: boolean;
  update?(): unknown;
}

/**
 * Ends what is left of the orbit controls' damping. It is applied a step per frame drawn, and
 * below a threshold asks for no frame: a remainder would move the view with the refined frame
 * and so ask for more frames after it (§3.3: exactly one refined frame).
 */
export function endDamping(controls: Damped | null) {
  if (!controls?.enableDamping || !controls.update) return;
  controls.enableDamping = false;
  // The first update applies what is left; one more finds the view at rest.
  for (let i = 0; i < 3 && controls.update(); i++);
  controls.enableDamping = true;
}

/** The toasts of §3.4 and §4.4. */
const STEPPED_DOWN = 'Showing a faster view on this device';
const CHUNK_FAILED = 'The beautiful view could not be loaded';
const TEXTURE_FAILED = 'Some surfaces could not be loaded';

/** How long a settle waits for the GPU at most: a software renderer takes many seconds a frame. */
const DRAWN_TIMEOUT_MS = 120_000;

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
  beautiful,
  onNotice,
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
  /** The setting may draw beautiful frames (`auto`, `beautiful`): the lazy chunk is asked for. */
  beautiful: boolean;
  /** Something the person should know: the viewer stepped down, or the chunk did not load. */
  onNotice?: ((message: string) => void) | undefined;
  children: ReactNode;
}) {
  const gl = useThree((s) => s.gl);
  const invalidate = useThree((s) => s.invalidate);
  const get = useThree((s) => s.get);
  const output = useMemo(() => new FrameOutput(gl, phone), [gl, phone]);
  useEffect(() => () => output.dispose(), [output]);
  // One size of every texture set per device, in every tier (§5.3).
  const finishSet = useMemo(() => finishMaterials(phone ? 'phone' : 'desktop'), [phone]);
  // The other class's textures and materials go once this one is in use.
  useEffect(() => releaseOtherDevices(finishSet.device), [finishSet]);
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
  const notice = useRef(onNotice);
  useEffect(() => {
    notice.current = onNotice;
  }, [onNotice]);
  /** Whether a frame has been drawn, and whether this output is still the one in use. */
  const drawn = useRef(false);
  const current = useRef(true);
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
      finishes: finishSet,
      finishShown(finish) {
        finishSet.textures.request(finish);
        // The view has not settled while a texture is on its way: a capture waits for it.
        governor.setMoving('textures', finishSet.textures.pending > 0);
      },
    }),
    [governor, invalidate, finishSet],
  );

  // A texture arrives: the next frame draws with it, and compiles nothing (§4.5). One that fails
  // leaves its finish on its tint, in whatever tier is drawn, and is said once a visit (§4.4).
  const textureNoticed = useRef(false);
  useEffect(() => {
    const textures = finishSet.textures;
    governor.setMoving('textures', textures.pending > 0);
    const off = textures.subscribe((event) => {
      if (!event.texture && !textureNoticed.current) {
        textureNoticed.current = true;
        notice.current?.(TEXTURE_FAILED);
      }
      governor.setMoving('textures', textures.pending > 0);
      invalidate();
    });
    return () => {
      off();
      governor.setMoving('textures', false);
    };
  }, [finishSet, governor, invalidate]);

  useLayoutEffect(() => {
    const canvas = gl.domElement;
    // The tier is that of the frame on screen: `auto` shows `beautiful` once it has refined.
    const mark = () => {
      canvas.setAttribute('data-frame', governor.state);
      canvas.setAttribute('data-tier', governor.shownTier);
    };
    mark();
    return governor.attach({
      onChange: mark,
      framePending: () => get().internal.frames > 0,
      requestFrame: () => invalidate(),
      beforeRefine: () => endDamping(get().controls as Damped | null),
      // The lamps' shadows of what moved are drawn once it rests.
      onStill: () => pending.current.lampShadows && invalidate(),
      onStepDown: () => notice.current?.(STEPPED_DOWN),
      whenDrawn: (done) => void gpuIdle(gl.getContext(), DRAWN_TIMEOUT_MS).then(done),
    });
  }, [gl, governor, get, invalidate]);

  // The lazy chunk of the beautiful tier (§4.4): asked for once the first fast frame is on screen
  // and the setting can use it. Until it has arrived and is compiled, every frame is a fast one;
  // if it does not arrive, the viewer stays fast and says so once.
  const chunk = useRef<'idle' | 'loading' | 'here'>('idle');
  const wanted = useRef(beautiful);
  const loadBeautiful = useCallback(() => {
    if (chunk.current !== 'idle' || !wanted.current || !drawn.current) return;
    chunk.current = 'loading';
    import('../beautiful/render-beautiful').then(
      ({ createAmbientOcclusion }) => {
        if (!current.current) return;
        chunk.current = 'here';
        const { scene, camera } = get();
        output.setAmbientOcclusion(createAmbientOcclusion(scene, camera, phone));
        // Its programs are compiled ahead, then frames may be beautiful.
        pending.current.compile = true;
        invalidate();
      },
      () => {
        if (current.current) notice.current?.(CHUNK_FAILED);
      },
    );
  }, [get, output, phone, invalidate]);
  useEffect(() => {
    // A new output (the device class changed) starts without the pass.
    current.current = true;
    chunk.current = 'idle';
    return () => {
      current.current = false;
      governor.setBeautifulReady(false);
    };
  }, [output, governor]);
  useEffect(() => {
    wanted.current = beautiful;
    loadBeautiful();
  }, [beautiful, loadBeautiful]);

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
        // With the occlusion pass compiled too, frames may be beautiful from now on.
        if (output.beautiful) governor.setBeautifulReady(true);
        invalidate();
      };
      const timeout = window.setTimeout(done, COMPILE_TIMEOUT_MS);
      void output
        .compile(scene, camera)
        .catch(() => undefined)
        .then(() => {
          window.clearTimeout(timeout);
          done();
        });
    }
    // Compiling ahead: the previous frame stays on screen.
    if (p.compiling) return;

    const tier = governor.frameStarted();
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
    // The tiers share the sun's shadow map; a beautiful frame filters it wider (§6.2).
    lights.setShadowFilter(tier === 'beautiful');
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
      textureFiles: finishSet.textures.counts().loaded,
      textureFailures: finishSet.textures.counts().failed,
      shadowLights,
      litLamps: lamps.lit,
      lampChanges: lampChanges.current,
    });
    if (!drawn.current) {
      drawn.current = true;
      loadBeautiful();
    }
  }, 1);

  return (
    <Context.Provider value={control}>
      <primitive object={lights.group} />
      {children}
    </Context.Provider>
  );
}
