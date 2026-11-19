import { box, shade } from './parts';
import type { Part } from './types';

/** Shared pieces of cabinets (kitchen units, the shoe cabinet), in the furniture frame. */

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
): Part[] {
  const h = top - bottom;
  const d = front - back;
  const z = (front + back) / 2;
  return [
    box([-w / 2 + BOARD / 2, bottom + h / 2, z], [BOARD, h, d], color, 'body'),
    box([w / 2 - BOARD / 2, bottom + h / 2, z], [BOARD, h, d], color, 'body'),
    box([0, top - BOARD / 2, z], [w - 2 * BOARD, BOARD, d], color, 'body'),
    box([0, bottom + BOARD / 2, z], [w - 2 * BOARD, BOARD, d], color, 'body'),
    box([0, bottom + h / 2, back + 0.004], [w - 2 * BOARD, h, 0.008], shade(color, -0.08), 'body'),
  ];
}

/** A horizontal bar handle centred on (x, y), standing off a front at z = `face`. */
export const barHandle = (x: number, y: number, face: number, length: number, color: string) =>
  box([x, y, face + 0.012], [length, 0.012, 0.016], color, 'handle');

/** A vertical bar handle. */
export const uprightHandle = (x: number, y: number, face: number, length: number, color: string) =>
  box([x, y, face + 0.012], [0.012, length, 0.016], color, 'handle');

/**
 * A row of `count` doors across `width` (centred on x = 0), from `bottom` to `top`, their faces at
 * z = `face`. The handles (when a colour is given) sit on the opening edges: a single door opens
 * on its left, a pair in the middle.
 */
export function doors(
  count: number,
  width: number,
  bottom: number,
  top: number,
  face: number,
  color: string,
  handle?: { color: string; y: number; length: number },
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
      ),
    );
    if (handle) {
      const side = count === 1 ? -1 : i < count / 2 ? 1 : -1;
      const x = cx + side * (dw / 2 - 0.04);
      parts.push(uprightHandle(x, handle.y, face, handle.length, handle.color));
    }
  }
  return parts;
}
