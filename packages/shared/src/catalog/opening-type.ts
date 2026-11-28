import { z } from 'zod';

/** `door` is drawn open, `french-door` glazed to the floor, `garage-door` closed. */
export const OpeningType = z.enum(['door', 'window', 'french-door', 'garage-door']);
export type OpeningType = z.infer<typeof OpeningType>;
