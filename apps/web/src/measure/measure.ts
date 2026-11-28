/**
 * The measure tool (HUD v2 #206): two points of the model, the straight line between them and the model-local
 * coordinates of the last point picked. Transient: nothing here is saved, and the model is never written.
 */

/** A point in the model's own frame, metres (docs/home-model.md § Conventions). */
export type Point = readonly [x: number, y: number, z: number];

/** Up to two points: none yet, the first, or both (a span). */
export type Measurement = readonly Point[];

export const NO_MEASUREMENT: Measurement = [];

/** The next measurement after a pick: the second point closes a span, a third starts a new one. */
export const withPoint = (m: Measurement, p: Point): Measurement =>
  m.length === 1 ? [m[0]!, p] : [p];

export const distance = (a: Point, b: Point) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

/** A length or coordinate as shown: centimetres, a real minus sign ("−0.25 m"), never "−0.00 m". */
export function metres(value: number): string {
  const text = (Math.round(value * 100) / 100).toFixed(2);
  return `${text === '-0.00' ? '0.00' : text.replace('-', '−')} m`;
}

/** The model's axes with the direction each one grows in (Y-up; x plan east, z plan south). */
export const AXES = [
  { axis: 'x', toward: 'east' },
  { axis: 'y', toward: 'up' },
  { axis: 'z', toward: 'south' },
] as const;

/** What the readout says after a pick, for its live status. */
export function status(m: Measurement, missed: boolean): string {
  if (missed) return 'Nothing of the model there: pick a surface.';
  if (m.length === 0) return 'Pick the first point.';
  if (m.length === 1) return 'Pick the second point.';
  return `Distance ${metres(distance(m[0]!, m[1]!))}.`;
}
