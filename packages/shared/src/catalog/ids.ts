import { z } from 'zod';

/** A catalogue type id: `<family>.<name>`, e.g. `window.casement` or `furniture.bed`. */
export const TypeId = z
  .string()
  .regex(/^[a-z][a-z0-9-]*\.[a-z][a-z0-9-]*$/, 'Type ids look like "family.name" (a-z, 0-9, "-")')
  .max(64)
  .meta({ id: 'TypeId', description: 'A piece type in the catalogue, e.g. "window.casement".' });
export type TypeId = z.infer<typeof TypeId>;

/**
 * The catalogue's top-level groups (later: `outdoor`). `furniture` and `fixtures` (lights, the
 * radiator) are placed in rooms as database placements; `openings` are uses in the home model.
 */
export const CatalogKind = z.enum(['openings', 'furniture', 'fixtures']);
export type CatalogKind = z.infer<typeof CatalogKind>;

/** A colour as `#rrggbb`; input is lower-cased, so it is stored lower case. */
export const HexColor = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^#[0-9a-f]{6}$/, 'Colours are written as #rrggbb');
export type HexColor = z.infer<typeof HexColor>;
