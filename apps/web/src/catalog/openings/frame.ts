import { catalog, type ParamValues } from '@my-home/shared';
import { box, colorParam, dimension, numberParam } from '../parts';
import type { DimensionLine, Part, PieceContext } from '../types';

/**
 * The frame of a wall opening and what fills it, in the opening's local frame (centre of the hole
 * at the origin, width along x). Members, in this order: left and right jambs, the head, the sill
 * (`sill`), then `divisions - 1` mullions, then the fill. A frame without a sill is open at the
 * bottom (a door), and its fill reaches the floor.
 *
 * The frame width is clamped to a quarter of the hole and the depth to the wall, so small holes
 * and thin walls still get a frame.
 */
export interface FrameOptions {
  frameWidth: number;
  frameDepth: number;
  frameColor: string;
  sill: boolean;
  /** Sashes or leaves side by side; between them a mullion of the frame's width and colour. */
  divisions?: number;
  fill?:
    | { kind: 'glass'; depth: number; color: string; opacity: number }
    | { kind: 'panel'; depth: number; color: string };
}

export function frameParts(ctx: PieceContext, options: FrameOptions): Part[] {
  const { width: w, height: h, wallDepth } = ctx;
  const f = Math.min(options.frameWidth, w / 4, h / 4);
  const d = Math.min(options.frameDepth, wallDepth);
  const color = options.frameColor;
  const parts = [
    box([-w / 2 + f / 2, 0, 0], [f, h, d], color, 'frame'),
    box([w / 2 - f / 2, 0, 0], [f, h, d], color, 'frame'),
    box([0, h / 2 - f / 2, 0], [w - 2 * f, f, d], color, 'frame'),
  ];
  if (options.sill) parts.push(box([0, -h / 2 + f / 2, 0], [w - 2 * f, f, d], color, 'frame'));
  // The space inside the frame: down to the floor without a sill.
  const [innerY, innerHeight] = options.sill ? [0, h - 2 * f] : [-f / 2, h - f];
  const divisions = options.divisions ?? 1;
  for (let i = 1; i < divisions; i++) {
    const x = -w / 2 + f + ((w - 2 * f) * i) / divisions;
    parts.push(box([x, innerY, 0], [f, innerHeight, d], color, 'frame'));
  }
  const fill = options.fill;
  if (fill?.kind === 'glass') {
    parts.push(
      box([0, innerY, 0], [w - 2 * f, innerHeight, fill.depth], fill.color, 'glass', {
        transparent: true,
        opacity: fill.opacity,
        depthWrite: false,
      }),
    );
  } else if (fill?.kind === 'panel') {
    parts.push(box([0, innerY, 0], [w - 2 * f, innerHeight, fill.depth], fill.color, 'panel'));
  }
  return parts;
}

/** The frame options every framed opening type shares. */
export const frameOf = (values: ParamValues) => ({
  frameWidth: numberParam(values, 'frameWidth'),
  frameDepth: numberParam(values, 'frameDepth'),
  frameColor: colorParam(values, 'frameColor'),
});

export const glassOf = (values: ParamValues) => ({
  kind: 'glass' as const,
  depth: numberParam(values, 'glassDepth'),
  color: colorParam(values, 'glassColor'),
  opacity: numberParam(values, 'glassOpacity'),
});

/**
 * The count parameter `key` (sashes, leaves) as drawn: reduced to the largest count whose parts
 * keep their minimum width in the hole (at least 1), so an override that no longer fits never
 * breaks the render. `openingFitIssues` reports it.
 */
export function fittingCount(
  typeId: string,
  key: string,
  values: ParamValues,
  width: number,
): number {
  const spec = catalog.get(typeId)?.params[key];
  const requested = Math.max(1, Math.floor(numberParam(values, key)));
  if (spec?.type !== 'count' || !spec.each) return requested;
  const fits = Math.floor(width / spec.each.minWidth + 1e-6);
  return Math.max(1, Math.min(requested, fits));
}

/** Width along the bottom of the hole, height up its right side. */
export const holeDimensions = ({ width: w, height: h }: PieceContext): DimensionLine[] => [
  dimension([-w / 2, -h / 2, 0], [w / 2, -h / 2, 0], w),
  dimension([w / 2, -h / 2, 0], [w / 2, h / 2, 0], h),
];
