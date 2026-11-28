import { z } from 'zod';

/** A colour as `#rrggbb`; input is lower-cased, so it is stored lower case. */
export const HexColor = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^#[0-9a-f]{6}$/, 'Colours are written as #rrggbb');
export type HexColor = z.infer<typeof HexColor>;
