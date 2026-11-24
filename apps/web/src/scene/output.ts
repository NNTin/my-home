import {
  DepthFormat,
  DepthStencilFormat,
  DepthTexture,
  UnsignedInt248Type,
  UnsignedIntType,
  BufferAttribute,
  BufferGeometry,
  Color,
  HalfFloatType,
  LinearFilter,
  Mesh,
  OrthographicCamera,
  RawShaderMaterial,
  ShaderMaterial,
  SRGBColorSpace,
  UnsignedByteType,
  Vector2,
  WebGLRenderTarget,
  type Camera,
  type Material,
  type Scene,
  type WebGLRenderer,
} from 'three';
import type { AmbientOcclusion } from '../beautiful/render-beautiful';
import { FXAAShader } from 'three/addons/shaders/FXAAShader.js';
import type { Tier } from '../quality/governor';

/**
 * The frame's way to the canvas (docs/design/realistic-render.md §4.5, §6.6). Every frame, in
 * every tier, is drawn into an offscreen target in linear light; the output pass brings it to
 * the canvas with tone mapping and the colour-space conversion. Material shaders therefore never
 * tone-map, and a change of tone mapping or of tier compiles none of them.
 *
 * The backdrop is not part of the scene: the target is cleared transparent, and the output pass
 * lays the tone-mapped frame over the backdrop (a colour, or a vertical gradient of two). The
 * backdrop so keeps its exact colour,
 * and what is translucent or half-covered in front of it (glass, an anti-aliased roof line)
 * blends with it as displayed, as it did when the scene was drawn straight to the canvas.
 *
 * Anti-aliasing is a property of the target, not of the programs: a desktop's fast target has 4
 * samples. A phone's has none; its frames get a fixed FXAA step after the output pass instead.
 * The beautiful tier's target has 4 samples on every device, and a depth texture: its frames get
 * ambient occlusion between the scene and the output pass, from the lazy chunk
 * (`beautiful/render-beautiful.ts`). Nothing else differs between the tiers.
 */

/** MSAA samples of a tier's target. The beautiful tier has 4 on every device. */
export const targetSamples = (tier: Tier, phone: boolean): number =>
  tier === 'fast' && phone ? 0 : 4;

/** Whether a tier's frames take the FXAA step: those drawn without MSAA. */
export const usesFxaa = (tier: Tier, phone: boolean): boolean => targetSamples(tier, phone) === 0;

const OUTPUT_VERTEX = /* glsl */ `
  precision highp float;
  attribute vec3 position;
  attribute vec2 uv;
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = vec4(position.xy, 0.0, 1.0);
  }`;

/**
 * The target holds premultiplied linear colour and coverage; the backdrop is in display colours.
 * Tone mapping is Neutral in every tier (§6.6), so a surface has one colour whatever draws it.
 */
const OUTPUT_FRAGMENT = /* glsl */ `
  precision highp float;
  uniform sampler2D tDiffuse;
  uniform vec3 backdropTop;
  uniform vec3 backdropBottom;
  #include <tonemapping_pars_fragment>
  #include <colorspace_pars_fragment>
  varying vec2 vUv;
  void main() {
    vec4 frame = texture2D(tDiffuse, vUv);
    float coverage = clamp(frame.a, 0.0, 1.0);
    vec3 color = coverage > 0.0 ? frame.rgb / coverage : vec3(0.0);
    color = NeutralToneMapping(color);
    color = sRGBTransferOETF(vec4(color, 1.0)).rgb;
    vec3 backdrop = mix(backdropBottom, backdropTop, clamp(vUv.y, 0.0, 1.0));
    gl_FragColor = vec4(mix(backdrop, color, coverage), 1.0);
  }`;

/** How often `gpuIdle` looks. */
const GPU_POLL_MS = 25;
/** How long the warm-up waits for the GPU; the frame loop's own timeout ends the wait sooner. */
const WARM_UP_WAIT_MS = 10_000;

/**
 * Resolves when the GPU has done everything asked of it so far, without holding the page: a
 * fence is put behind the work and looked at now and then, for `maxMs` at most. A WebGL 1 context
 * has no fences and resolves at once.
 */
export function gpuIdle(
  gl: WebGLRenderingContext | WebGL2RenderingContext,
  maxMs: number,
): Promise<void> {
  if (!('fenceSync' in gl)) return Promise.resolve();
  const sync = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0);
  if (!sync) return Promise.resolve();
  gl.flush();
  const started = performance.now();
  return new Promise((resolve) => {
    const look = () => {
      const status = gl.clientWaitSync(sync, 0, 0);
      const waiting = status === gl.TIMEOUT_EXPIRED && performance.now() - started < maxMs;
      if (waiting) return void window.setTimeout(look, GPU_POLL_MS);
      gl.deleteSync(sync);
      resolve();
    };
    look();
  });
}

/** One triangle that covers the view: a pass draws it with its material. */
function fullScreenTriangle(material: Material): Mesh {
  const geometry = new BufferGeometry();
  geometry.setAttribute(
    'position',
    new BufferAttribute(new Float32Array([-1, 3, 0, -1, -1, 0, 3, -1, 0]), 3),
  );
  geometry.setAttribute('uv', new BufferAttribute(new Float32Array([0, 2, 0, 0, 2, 0]), 2));
  const mesh = new Mesh(geometry, material);
  mesh.frustumCulled = false;
  return mesh;
}

export class FrameOutput {
  private readonly targets = new Map<Tier, WebGLRenderTarget>();
  /** The tone-mapped frame before FXAA: 8 bits, as the canvas holds it. */
  private resolved: WebGLRenderTarget | undefined;
  /** A beautiful frame with its ambient occlusion, before the output pass. */
  private shaded: WebGLRenderTarget | undefined;
  private occlusion: AmbientOcclusion | undefined;
  /** Whether the occlusion pass has run once, so that its programs are compiled. */
  private occlusionWarm = false;
  private readonly camera = new OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private readonly outputMaterial = new RawShaderMaterial({
    name: 'my-home output',
    uniforms: {
      tDiffuse: { value: null },
      toneMappingExposure: { value: 1 },
      backdropTop: { value: new Color() },
      backdropBottom: { value: new Color() },
    },
    vertexShader: OUTPUT_VERTEX,
    fragmentShader: OUTPUT_FRAGMENT,
    depthTest: false,
    depthWrite: false,
  });
  private readonly fxaaMaterial = new ShaderMaterial({
    name: 'my-home fxaa',
    uniforms: { tDiffuse: { value: null }, resolution: { value: new Vector2(1, 1) } },
    vertexShader: FXAAShader.vertexShader,
    fragmentShader: FXAAShader.fragmentShader,
    depthTest: false,
    depthWrite: false,
    toneMapped: false,
  });
  private readonly outputQuad = fullScreenTriangle(this.outputMaterial);
  private readonly fxaaQuad = fullScreenTriangle(this.fxaaMaterial);
  private readonly size = new Vector2();
  /** Whether the targets have a stencil buffer: from the first section on. */
  private stencil = false;

  /**
   * Linear light needs more than 8 bits. Every WebGL 2 device we know draws into half floats; one
   * that cannot gets 8 bits, where bright surfaces clip before tone mapping.
   */
  private readonly targetType: typeof HalfFloatType | typeof UnsignedByteType;

  constructor(
    private readonly renderer: WebGLRenderer,
    private readonly phone: boolean,
  ) {
    const floats =
      renderer.extensions.has('EXT_color_buffer_float') ||
      renderer.extensions.has('EXT_color_buffer_half_float');
    this.targetType = floats ? HalfFloatType : UnsignedByteType;
  }

  /** The target a tier's frames are drawn into, at the size of the drawing buffer. */
  target(tier: Tier): WebGLRenderTarget {
    const { width, height } = this.renderer.getDrawingBufferSize(this.size);
    let target = this.targets.get(tier);
    if (!target) {
      const { stencil } = this;
      target = new WebGLRenderTarget(width, height, {
        type: this.targetType,
        samples: targetSamples(tier, this.phone),
        depthBuffer: true,
        stencilBuffer: stencil,
      });
      // The occlusion pass reads the frame's depth.
      if (tier === 'beautiful') {
        const type = stencil ? UnsignedInt248Type : UnsignedIntType;
        target.depthTexture = new DepthTexture(width, height, type);
        target.depthTexture.format = stencil ? DepthStencilFormat : DepthFormat;
      }
      this.targets.set(tier, target);
    } else if (target.width !== width || target.height !== height) {
      target.setSize(width, height);
    }
    return target;
  }

  private resolvedTarget(): WebGLRenderTarget {
    const { width, height } = this.renderer.getDrawingBufferSize(this.size);
    if (!this.resolved) {
      this.resolved = new WebGLRenderTarget(width, height, {
        type: UnsignedByteType,
        minFilter: LinearFilter,
        magFilter: LinearFilter,
        depthBuffer: false,
      });
    } else if (this.resolved.width !== width || this.resolved.height !== height) {
      this.resolved.setSize(width, height);
    }
    return this.resolved;
  }

  private shadedTarget(): WebGLRenderTarget {
    const { width, height } = this.renderer.getDrawingBufferSize(this.size);
    if (!this.shaded) {
      this.shaded = new WebGLRenderTarget(width, height, {
        type: this.targetType,
        depthBuffer: false,
      });
    } else if (this.shaded.width !== width || this.shaded.height !== height) {
      this.shaded.setSize(width, height);
    }
    return this.shaded;
  }

  /**
   * From now on the frame's targets have a stencil buffer: a section's caps are drawn with it
   * (§7.2). The targets are made again; no program depends on them.
   */
  useStencil() {
    if (this.stencil) return;
    this.stencil = true;
    for (const target of this.targets.values()) target.dispose();
    this.targets.clear();
  }

  /** Whether beautiful frames can be drawn: the lazy chunk's occlusion pass is here and compiled. */
  get beautiful(): boolean {
    return this.occlusion !== undefined && this.occlusionWarm;
  }

  /** Hands in the occlusion pass of the lazy chunk; beautiful frames need it. */
  setAmbientOcclusion(occlusion: AmbientOcclusion) {
    this.occlusion?.dispose();
    this.occlusion = occlusion;
    this.occlusionWarm = false;
  }

  /** The tone-mapping exposure, from the light rig. */
  setExposure(exposure: number) {
    this.outputMaterial.uniforms.toneMappingExposure!.value = exposure;
  }

  /** The backdrop behind the scene, as `#rrggbb` display colours at the top and foot of the view. */
  setBackdrop(top: string, bottom = top) {
    // The uniforms hold the colours as displayed, not in linear light.
    const set = (name: 'backdropTop' | 'backdropBottom', value: string) => {
      const color = this.outputMaterial.uniforms[name]!.value as Color;
      color.set(value).getRGB(color, SRGBColorSpace);
    };
    set('backdropTop', top);
    set('backdropBottom', bottom);
  }

  /**
   * Draws `scene` into a tier's target and returns the frame in linear light: for a beautiful
   * frame, with its ambient occlusion. Without the occlusion pass a beautiful frame is drawn as
   * a fast one.
   */
  private draw(scene: Scene, camera: Camera, tier: Tier): { frame: WebGLRenderTarget; tier: Tier } {
    const { renderer, occlusion } = this;
    const drawn: Tier = tier === 'beautiful' && occlusion ? 'beautiful' : 'fast';
    const target = this.target(drawn);
    // Transparent where nothing is drawn: the output pass shows the backdrop there.
    renderer.setClearColor(0x000000, 0);
    renderer.setRenderTarget(target);
    renderer.render(scene, camera);
    if (drawn === 'fast' || !occlusion) return { frame: target, tier: drawn };
    const shaded = this.shadedTarget();
    occlusion.render(renderer, scene, camera, target, shaded);
    return { frame: shaded, tier: drawn };
  }

  /** Draws `scene` in a tier, then the output pass (and FXAA) onto the canvas. */
  render(scene: Scene, camera: Camera, tier: Tier) {
    const { renderer } = this;
    const { frame, tier: drawn } = this.draw(scene, camera, tier);
    tier = drawn;

    this.outputMaterial.uniforms.tDiffuse!.value = frame.texture;
    if (usesFxaa(tier, this.phone)) {
      const resolved = this.resolvedTarget();
      renderer.setRenderTarget(resolved);
      renderer.render(this.outputQuad, this.camera);
      this.fxaaMaterial.uniforms.tDiffuse!.value = resolved.texture;
      (this.fxaaMaterial.uniforms.resolution!.value as Vector2).set(
        1 / resolved.width,
        1 / resolved.height,
      );
      renderer.setRenderTarget(null);
      renderer.render(this.fxaaQuad, this.camera);
    } else {
      renderer.setRenderTarget(null);
      renderer.render(this.outputQuad, this.camera);
    }
  }

  /**
   * Compiles ahead what the frames of every tier need: the scene's materials as they are drawn
   * into a target, the output pass onto the canvas and into the FXAA step's target, and, once the
   * lazy chunk is here, the occlusion pass's own programs. Resolves when a frame of either tier
   * can be drawn without stalling on a shader. Both tiers draw the scene with the same programs
   * (§4.5): the targets differ in their samples only.
   */
  async compile(scene: Scene, camera: Camera): Promise<void> {
    const { renderer } = this;
    // Programs depend on where a material is drawn (no tone mapping into a target).
    renderer.setRenderTarget(this.target('fast'));
    const sceneReady = renderer.compileAsync(scene, camera);
    const ready: Promise<unknown>[] = [sceneReady];
    if (usesFxaa('fast', this.phone)) {
      renderer.setRenderTarget(this.resolvedTarget());
      ready.push(renderer.compileAsync(this.outputQuad, this.camera));
      renderer.setRenderTarget(null);
      ready.push(renderer.compileAsync(this.fxaaQuad, this.camera));
    }
    renderer.setRenderTarget(null);
    ready.push(renderer.compileAsync(this.outputQuad, this.camera));
    await Promise.all(ready);
    if (this.occlusion && !this.occlusionWarm) {
      // The pass compiles its programs when it first runs: one frame that is not shown, once.
      this.occlusionWarm = true;
      this.draw(scene, camera, 'beautiful');
      renderer.setRenderTarget(null);
      // Not ready before the GPU has drawn it: the first frame that is shown, and timed, must
      // not wait for this one.
      await gpuIdle(renderer.getContext(), WARM_UP_WAIT_MS);
    }
  }

  dispose() {
    for (const target of this.targets.values()) target.dispose();
    this.resolved?.dispose();
    this.shaded?.dispose();
    this.occlusion?.dispose();
    this.outputMaterial.dispose();
    this.fxaaMaterial.dispose();
    this.outputQuad.geometry.dispose();
    this.fxaaQuad.geometry.dispose();
  }
}
