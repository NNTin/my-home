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

/**
 * Width along the bottom of the hole, height up its right side, and (where the context knows it)
 * the sill height from the floor up to the hole's left corner.
 */
export function holeDimensions({ width: w, height: h, sill }: PieceContext): DimensionLine[] {
  const lines = [
    dimension([-w / 2, -h / 2, 0], [w / 2, -h / 2, 0], w, 'Width'),
    dimension([w / 2, -h / 2, 0], [w / 2, h / 2, 0], h, 'Height'),
  ];
  if (sill !== undefined && sill > 0) {
    lines.push(dimension([-w / 2, -h / 2 - sill, 0], [-w / 2, -h / 2, 0], sill, 'Sill height'));
  }
  return lines;
}

/**
 * A framed opening's dimensions: the hole's, the frame width along the top of the left jamb, and
 * the clear width of each sash or leaf under the head (`each` names them: "Sash", "Leaf"), as
 * `frameParts` draws them.
 */
export function framedDimensions(
  values: ParamValues,
  ctx: PieceContext,
  divisions?: { count: number; each: string },
): DimensionLine[] {
  const { width: w, height: h } = ctx;
  const f = Math.min(numberParam(values, 'frameWidth'), w / 4, h / 4);
  const lines = [
    ...holeDimensions(ctx),
    dimension([-w / 2, h / 2, 0], [-w / 2 + f, h / 2, 0], f, 'Frame width'),
  ];
  if (!divisions) return lines;
  const n = divisions.count;
  const clear = (w - 2 * f - (n - 1) * f) / n;
  for (let i = 0; i < n; i++) {
    const x = -w / 2 + f + i * (clear + f);
    const name = n === 1 ? `${divisions.each} width` : `${divisions.each} ${i + 1} width`;
    lines.push(dimension([x, h / 2 - f, 0], [x + clear, h / 2 - f, 0], clear, name));
  }
  return lines;
}
