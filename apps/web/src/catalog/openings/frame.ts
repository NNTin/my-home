import { catalog, type ParamValues } from '@my-home/shared';
import { GLASS, handle, LACQUER, wood } from '../cabinet';
import { box, colorParam, dimension, numberParam, shade } from '../parts';
import type { DimensionLine, Part, PieceContext } from '../types';

/**
 * The frame of a door and what fills it, in the opening's local frame (centre of the hole at the
 * origin, width along x). Members, in this order: left and right jambs, the head, then
 * `divisions - 1` mullions, then the fill. The frame is open at the bottom and its fill reaches
 * the floor: glass as one leaf for each division (stiles and
 * rails around a pane, a handle where it closes), a panel as the sections of a sectional door.
 * A door without a fill is drawn open: its frame with the stop the leaf closes against.
 *
 * The frame is oak veneer stained to its colour, or lacquer for a colour lighter than oak.
 *
 * The frame width is clamped to a quarter of the hole and the depth to the wall, so small holes
 * and thin walls still get a frame.
 */
export interface FrameOptions {
  frameWidth: number;
  frameDepth: number;
  frameColor: string;
  /** Sashes or leaves side by side; between them a mullion of the frame's width and colour. */
  divisions?: number;
  fill?:
    | { kind: 'glass'; depth: number; color: string; opacity: number }
    | { kind: 'panel'; depth: number; color: string };
}

/** A glazed door leaf's stiles and top rail, the least depth of a leaf, and a door stop. */
const STILE = 0.09;
const LEAF = 0.04;
const STOP = 0.015;

export function frameParts(ctx: PieceContext, options: FrameOptions): Part[] {
  const { width: w, height: h, wallDepth } = ctx;
  const f = Math.min(options.frameWidth, w / 4, h / 4);
  const d = Math.min(options.frameDepth, wallDepth);
  const { color, material } = wood(options.frameColor);
  const member = (center: Part['center'], size: Part['size'], role: Part['role'] = 'frame') =>
    box(center, size, color, role, material);
  const parts = [
    member([-w / 2 + f / 2, 0, 0], [f, h, d]),
    member([w / 2 - f / 2, 0, 0], [f, h, d]),
    member([0, h / 2 - f / 2, 0], [w - 2 * f, f, d]),
  ];
  // The space inside the frame, down to the floor.
  const [innerY, innerHeight] = [-f / 2, h - f];
  const divisions = options.divisions ?? 1;
  const mullion = (i: number) => -w / 2 + f + ((w - 2 * f) * i) / divisions;
  for (let i = 1; i < divisions; i++)
    parts.push(member([mullion(i), innerY, 0], [f, innerHeight, d]));
  const fill = options.fill;
  if (fill?.kind === 'glass') {
    const pane = { ...GLASS, transparent: true, opacity: fill.opacity, depthWrite: false };
    // A glazed door: each leaf between two members of the frame.
    const leaves: Part[] = [];
    for (let i = 0; i < divisions; i++) {
      const from = i === 0 ? -w / 2 + f : mullion(i) + f / 2;
      const to = i === divisions - 1 ? w / 2 - f : mullion(i + 1) - f / 2;
      const [cx, lw] = [(from + to) / 2, to - from];
      const stile = Math.min(STILE, lw / 4);
      const depth = Math.min(d, Math.max(fill.depth, LEAF));
      for (const side of [-1, 1])
        parts.push(
          member(
            [cx + side * (lw / 2 - stile / 2), innerY, 0],
            [stile, innerHeight, depth],
            'sash',
          ),
        );
      parts.push(
        member(
          [cx, innerY + innerHeight / 2 - stile / 2, 0],
          [lw - 2 * stile, stile, depth],
          'sash',
        ),
        // The bottom rail is twice as high, as a door's is.
        member(
          [cx, innerY - innerHeight / 2 + stile, 0],
          [lw - 2 * stile, 2 * stile, depth],
          'sash',
        ),
        // It closes towards the middle of the door; a single leaf on its right.
        handle(
          cx + (cx > 1e-6 ? -1 : 1) * (lw / 2 - stile / 2),
          innerY - innerHeight / 2 + Math.min(1.05, innerHeight / 2),
          depth / 2,
          Math.min(0.14, innerHeight / 2),
          shade(options.frameColor, -0.55),
          true,
        ),
      );
      leaves.push(
        box(
          [cx, innerY + stile / 2, 0],
          [lw - 2 * stile, innerHeight - 3 * stile, fill.depth],
          fill.color,
          'glass',
          pane,
        ),
      );
    }
    // The panes last: they are see-through.
    parts.push(...leaves);
  } else if (fill?.kind === 'panel') {
    // A sectional door: sections about half a metre high with a joint between them, in front of
    // a dark backing that shows in the joints.
    const sections = Math.max(1, Math.round(innerHeight / 0.5));
    const each = innerHeight / sections;
    parts.push(
      box(
        [0, innerY, -fill.depth / 4],
        [w - 2 * f, innerHeight, fill.depth / 2],
        shade(fill.color, -0.5),
        'panel',
        LACQUER,
      ),
    );
    for (let i = 0; i < sections; i++)
      parts.push(
        box(
          [0, innerY - innerHeight / 2 + each * (i + 0.5), 0],
          [w - 2 * f, each - 0.012, fill.depth],
          fill.color,
          'panel',
          LACQUER,
        ),
      );
  } else {
    // An open doorway: the stop on both jambs and under the head.
    const [across, deep] = [Math.min(STOP, f / 2), d / 3];
    for (const side of [-1, 1])
      parts.push(
        member([side * (w / 2 - f - across / 2), innerY, 0], [across, innerHeight, deep], 'detail'),
      );
    parts.push(
      member([0, h / 2 - f - across / 2, 0], [w - 2 * f - 2 * across, across, deep], 'detail'),
    );
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
  // The mullions sit where frameParts centres them, evenly between the jambs; each sash spans the
  // gap between two members' inner edges (so the outer ones are wider from 3 sashes on).
  const mullion = (i: number) => -w / 2 + f + ((w - 2 * f) * i) / n;
  for (let i = 0; i < n; i++) {
    const from = i === 0 ? -w / 2 + f : mullion(i) + f / 2;
    const to = i === n - 1 ? w / 2 - f : mullion(i + 1) - f / 2;
    const name = n === 1 ? `${divisions.each} width` : `${divisions.each} ${i + 1} width`;
    lines.push(dimension([from, h / 2 - f, 0], [to, h / 2 - f, 0], to - from, name));
  }
  return lines;
}
