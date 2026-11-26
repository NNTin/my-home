/**
 * The lazy chunk of render mode (docs/design/realistic-render.md §9): the WebGPU renderer, the
 * path tracer, the scene they are given, the still on screen, and the measuring page of the
 * decision gate. Nothing else imports this file statically: `views/RenderMode.tsx` asks for it
 * once the browser has said it has WebGPU.
 */
export { Gate } from './Gate';
export type { GateInputs } from './gate';
export { RenderStill, type RenderStillProps } from './RenderStill';
export type { TraceInputs } from './traceScene';
