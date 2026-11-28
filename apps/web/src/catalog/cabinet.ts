import type { Vec2 } from '../geom/types';
import { box, extrude, shade, strip, veneerTint } from './parts';
import type { Part, PartMaterial } from './types';

/** Shared pieces of cabinets (kitchen units, the shoe cabinet), in the furniture frame. */

/** Lacquer and laminate: carcasses and fronts. */
export const LACQUER: PartMaterial = { finish: 'plastic.matt' };
/**
 * Dark hardware: handles, rails, hooks, taps. The part's colour tints the metal. A metal mirrors
 * what is around it, and under a ceiling that is little (docs/design/realistic-render.md D81): a
 * part in a bright steel or chrome colour is `LACQUER`, or it reads as charcoal.
 */
export const METAL: PartMaterial = { finish: 'metal.brushed' };

/** Glass and glass ceramic: glossy, and see-through only where the part says `transparent`. */
export const GLASS: PartMaterial = { finish: 'glass.clear' };

/** Cloth and woven mesh: a sling seat, a cushion. The weave is a relief; the part's colour shows. */
export const FABRIC: PartMaterial = { finish: 'fabric.weave' };

/**
 * A wooden board's colour and finish: oak veneer stained to `color`, or lacquer where the colour
 * is lighter than oak (`veneerTint`).
 */
export function wood(color: string): { color: string; material: PartMaterial } {
  const stain = veneerTint(color);
  return stain
    ? { color: stain, material: { finish: 'wood.veneer' } }
    : { color, material: LACQUER };
}

/** Board thickness of carcasses and fronts. */
export const BOARD = 0.018;
/** The gap between neighbouring fronts. */
export const FRONT_GAP = 0.003;

export const clamp = (value: number, min: number, max: number) =>
  min > max ? (min + max) / 2 : Math.min(max, Math.max(min, value));

/**
 * The centre (local x) of an inset of `size` placed `at` metres from the left end of a run `width`
 * long, kept inside the run.
 */
export const alongRun = (at: number, size: number, width: number) =>
  clamp(at, size / 2, width - size / 2) - width / 2;

/** How many parts of at least `min` metres fit across `width`, between 1 and `wanted`. */
export const fittingParts = (wanted: number, width: number, min: number) =>
  Math.max(1, Math.min(Math.round(wanted), Math.floor(width / min)));

/**
 * An open box (sides, top, bottom and back) whose front is open at z = `front`, standing on
 * `bottom`: what shows through a glass door or an open shelf.
 */
export function carcass(
  w: number,
  bottom: number,
  top: number,
  back: number,
  front: number,
  color: string,
  material?: PartMaterial,
): Part[] {
  const h = top - bottom;
  const d = front - back;
  const z = (front + back) / 2;
  const board = (center: Part['center'], size: Part['size'], tone = color) =>
    box(center, size, tone, 'body', material);
  return [
    board([-w / 2 + BOARD / 2, bottom + h / 2, z], [BOARD, h, d]),
    board([w / 2 - BOARD / 2, bottom + h / 2, z], [BOARD, h, d]),
    board([0, top - BOARD / 2, z], [w - 2 * BOARD, BOARD, d]),
    board([0, bottom + BOARD / 2, z], [w - 2 * BOARD, BOARD, d]),
    board([0, bottom + h / 2, back + 0.004], [w - 2 * BOARD, h, 0.008], shade(color, -0.08)),
  ];
}

/** How far a bar handle stands off its front, the bar's thickness and its width. */
const HANDLE = { reach: 0.03, gauge: 0.007, width: 0.011 };

/** A bar handle seen along its width: two short posts and the bar, `length` over all. */
const handleOutline = (length: number): Vec2[] => {
  const [end, out] = [length / 2 - HANDLE.gauge / 2, HANDLE.reach - HANDLE.gauge / 2];
  return strip(
    [
      [-end, 0],
      [-end, out],
      [end, out],
      [end, 0],
    ],
    HANDLE.gauge,
  );
};

/**
 * A bar handle on two posts, of brushed metal unless a `material` is given, centred on (x, y) and standing off a front at
 * z = `face`: lying, or `upright`.
 */
export function handle(
  x: number,
  y: number,
  face: number,
  length: number,
  color: string,
  upright = false,
  material = METAL,
): Part {
  const outline = handleOutline(length);
  if (upright)
    // Seen from its side: the outline's x runs out of the front (-π/2 lays it along z).
    return extrude(
      [x, y, face],
      outline.map(([along, out]): Vec2 => [out, along]),
      HANDLE.width,
      color,
      'handle',
      -Math.PI / 2,
      material,
    );
  // Seen from above and laid down: the outline's y becomes the piece's z.
  return {
    ...extrude(
      [x, y - HANDLE.reach / 2, face + HANDLE.reach / 2],
      outline,
      HANDLE.width,
      color,
      'handle',
      0,
      material,
    ),
    rotationX: Math.PI / 2,
  };
}

/**
 * A row of `count` doors across `width` (centred on x = 0), from `bottom` to `top`, their faces at
 * z = `face`. The handles (when a colour is given) sit on the opening edges: a single door opens
 * on its left, a pair in the middle, and an even row is pairs.
 */
export function doors(
  count: number,
  width: number,
  bottom: number,
  top: number,
  face: number,
  color: string,
  bar?: { color: string; y: number; length: number },
  material?: PartMaterial,
): Part[] {
  const dw = width / count;
  const parts: Part[] = [];
  for (let i = 0; i < count; i++) {
    const cx = -width / 2 + dw * (i + 0.5);
    parts.push(
      box(
        [cx, (bottom + top) / 2, face - BOARD / 2],
        [dw - FRONT_GAP, top - bottom - FRONT_GAP, BOARD],
        color,
        'leaf',
        material,
      ),
    );
    if (bar) {
      // An even row is pairs, an odd one opens towards its middle.
      const side = count === 1 ? -1 : count % 2 ? (i < count / 2 ? 1 : -1) : i % 2 ? -1 : 1;
      const x = cx + side * (dw / 2 - 0.04);
      parts.push(handle(x, bar.y, face, bar.length, bar.color, true));
    }
  }
  return parts;
}
