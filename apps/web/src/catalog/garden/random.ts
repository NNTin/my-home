/** A repeatable pseudo-random number in [0, 1) for `seed` (pieces must draw the same every time). */
export function jitter(seed: number): number {
  const x = Math.sin(seed * 12.9898 + 78.233) * 43758.5453;
  return x - Math.floor(x);
}
