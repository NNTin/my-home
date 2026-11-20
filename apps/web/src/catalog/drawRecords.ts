import type { DrawItem } from '../builder/drawList';

/**
 * Test-only: the draw list as golden text, one JSON line per draw item, so a design change that
 * updates a golden shows as a reviewable diff. Numbers are rounded to 1e-6 against float noise.
 * The draw list is everything the renderer is given (docs/design/realistic-render.md §11.2):
 * a change of the renderer that keeps these records draws the same solids.
 */
const round = (value: unknown): unknown => {
  if (typeof value === 'number') {
    const r = Math.round(value * 1e6) / 1e6;
    return Object.is(r, -0) ? 0 : r;
  }
  if (Array.isArray(value)) return value.map(round);
  if (value && typeof value === 'object')
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, round(v)]));
  return value;
};

export const goldenJson = (items: readonly DrawItem[]) =>
  `[\n${items.map((item) => `  ${JSON.stringify(round(item))}`).join(',\n')}\n]\n`;
