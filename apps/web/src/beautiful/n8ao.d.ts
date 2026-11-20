declare module 'n8ao' {
  import type { Camera, Color, Scene, WebGLRenderer, WebGLRenderTarget } from 'three';

  /** The part of n8ao 2.1 the viewer uses (`render-beautiful.ts`). */
  export class N8AOPass {
    constructor(scene: Scene, camera: Camera, width?: number, height?: number);
    scene: Scene;
    camera: Camera;
    /** The frame the occlusion is computed for and laid over: its colour and its depth texture. */
    beautyRenderTarget: WebGLRenderTarget;
    autoDetectTransparency: boolean;
    renderToScreen: boolean;
    configuration: {
      aoSamples: number;
      aoRadius: number;
      aoTones: number;
      denoiseSamples: number;
      denoiseRadius: number;
      denoiseIterations: number;
      distanceFalloff: number;
      intensity: number;
      color: Color;
      gammaCorrection: boolean;
      screenSpaceRadius: boolean;
      halfRes: boolean;
      autoRenderBeauty: boolean;
      transparencyAware: boolean;
      accumulate: boolean;
    };
    setSize(width: number, height: number): void;
    render(renderer: WebGLRenderer, writeBuffer: WebGLRenderTarget | null): void;
    dispose?(): void;
  }
}
