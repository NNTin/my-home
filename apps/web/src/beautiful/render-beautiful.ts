import { N8AOPass } from 'n8ao';
import type { Camera, Scene, WebGLRenderer, WebGLRenderTarget } from 'three';

/**
 * The lazy chunk of the beautiful tier (docs/design/realistic-render.md §4.4, §6.6): ambient
 * occlusion, laid over a frame between the scene and the output pass. The main chunk never
 * imports this file statically; `scene/Frame.tsx` asks for it once the first fast frame is on
 * screen, and frames stay fast until it has arrived and its programs are compiled.
 *
 * The pass is n8ao's, with nothing that depends on time: no accumulation over frames, a fixed
 * sample pattern, a fixed noise texture. The same view draws the same pixels (§6.7).
 */

/** What the frame's output needs of the occlusion pass (`scene/output.ts`). */
export interface AmbientOcclusion {
  /**
   * Lays the occlusion of `beauty` (its colour and its depth texture) over it, into `into`, in
   * linear light with the coverage kept.
   */
  render(
    renderer: WebGLRenderer,
    scene: Scene,
    camera: Camera,
    beauty: WebGLRenderTarget,
    into: WebGLRenderTarget,
  ): void;
  dispose(): void;
}

/**
 * Metres: how far a surface looks for what shades it, and how strongly it is shaded. Contact
 * shading where surfaces meet, and open surfaces as bright as in a fast frame: a view must not
 * change brightness when it settles (§3.1).
 *
 * The pass must hold from eye level out to the overview of the whole plot, where this radius is
 * a few pixels wide. There a stronger, tighter setting (0.45 m, a strength of 4, 16 samples)
 * showed its samples as speckle on the walls; these values stay clean in both.
 */
const RADIUS = 0.6;
const INTENSITY = 3;
const FALLOFF = 1;
const SAMPLES = 32;
const DENOISE_SAMPLES = 16;
const DENOISE_RADIUS = 12;

/** The targets n8ao holds besides the frame it is given. */
type Held = Partial<
  Record<
    | 'writeTargetInternal'
    | 'readTargetInternal'
    | 'accumulationRenderTarget'
    | 'depthDownsampleTarget',
    { dispose(): void }
  >
>;

/**
 * The occlusion pass for one device. A phone computes it at half the resolution. The settings
 * are fixed here: changing one later would compile the pass's programs again (§4.5).
 */
export function createAmbientOcclusion(
  scene: Scene,
  camera: Camera,
  phone: boolean,
): AmbientOcclusion {
  const pass = new N8AOPass(scene, camera, 1, 1);
  // The frame is drawn by the frame's output, into its own multisampled target.
  const own = pass.beautyRenderTarget;
  pass.configuration.autoRenderBeauty = false;
  // Translucent surfaces write no depth here: they are shaded as what stands behind them.
  pass.autoDetectTransparency = false;
  pass.configuration.transparencyAware = false;
  pass.configuration.accumulate = false;
  // The output pass converts to the display's colours, not this one.
  pass.configuration.gammaCorrection = false;
  pass.configuration.screenSpaceRadius = false;
  pass.configuration.aoRadius = RADIUS;
  pass.configuration.distanceFalloff = FALLOFF;
  pass.configuration.intensity = INTENSITY;
  pass.configuration.aoSamples = SAMPLES;
  pass.configuration.denoiseSamples = DENOISE_SAMPLES;
  pass.configuration.denoiseRadius = DENOISE_RADIUS;
  pass.configuration.halfRes = phone;
  own.dispose();
  let width = 0;
  let height = 0;
  return {
    render(renderer, frameScene, frameCamera, beauty, into) {
      pass.scene = frameScene;
      pass.camera = frameCamera;
      pass.beautyRenderTarget = beauty;
      if (beauty.width !== width || beauty.height !== height) {
        width = beauty.width;
        height = beauty.height;
        // The frame's target is sized by its owner; this sizes the pass's own.
        pass.setSize(width, height);
      }
      pass.render(renderer, into);
    },
    dispose() {
      const held = pass as unknown as Held;
      held.writeTargetInternal?.dispose();
      held.readTargetInternal?.dispose();
      held.accumulationRenderTarget?.dispose();
      held.depthDownsampleTarget?.dispose();
    },
  };
}
