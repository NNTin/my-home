/**
 * The lazy chunk of render mode's denoiser (docs/design/realistic-render.md §9, D114): Open Image
 * Denoise on WebGPU (`oidn-webgpu`, MIT) and the addresses of its network's weights (RenderKit's
 * `oidn-weights`, Apache-2.0, `weights/LICENSE.txt`). Only `tracer.ts` asks for it, when a still
 * or the measuring page starts: the weights are files of their own, fetched then.
 */
import { initUNetFromBuffer } from 'oidn-webgpu';
import defaultWeights from './weights/oidn-default.tza?url';
import smallWeights from './weights/oidn-small.tza?url';

export { initUNetFromBuffer };

/**
 * The guided HDR networks (colour, albedo, normal): `rt_hdr_alb_nrm_small.tza` (641,480 bytes),
 * which render mode uses, and `rt_hdr_alb_nrm.tza` (1,841,160 bytes), the measuring page's
 * `&weights=default`.
 */
export const WEIGHTS = { small: smallWeights, default: defaultWeights } as const;
