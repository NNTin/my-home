import type { Plane } from 'three';

/**
 * The planes that cut the home in a section (docs/design/realistic-render.md §7.2). Every
 * material of the home holds this one array from the start: it is empty, and nothing is cut,
 * until a section puts its plane in (`views/SectionCut.tsx`). Moving the plane is a uniform; only
 * the first plane compiles the programs' clipped variants, ahead of the first cut frame (§4.5).
 */
export const SECTION_PLANES: Plane[] = [];
