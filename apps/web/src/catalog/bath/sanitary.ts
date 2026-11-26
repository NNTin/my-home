import type { ParamValues } from '@my-home/shared';
import type { PartMaterial } from '../types';

/** Sanitary ceramic: the finish's own white, whatever the part's colour. */
export const CERAMIC: PartMaterial = { finish: 'ceramic.white' };
export const WHITE = '#ffffff';

/** A corner piece's second wall: -1 when it is on the left (-x), 1 on the right. */
export const wallSide = (values: ParamValues) => (String(values.corner) === 'right' ? 1 : -1);
