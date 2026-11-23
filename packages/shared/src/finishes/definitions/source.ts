import { TEXTURE_LICENCE, type FinishSource } from '../types';

/** The day the starting library was downloaded. */
const FETCHED = '2026-11-23';

/** A texture from Poly Haven (polyhaven.com): every asset there is CC0. */
export const polyHaven = (assetId: string, fetched = FETCHED): FinishSource => ({
  provider: 'Poly Haven',
  assetId,
  url: `https://polyhaven.com/a/${assetId}`,
  licence: TEXTURE_LICENCE,
  fetched,
});

/** A texture from ambientCG (ambientcg.com): every asset there is CC0. */
export const ambientCg = (
  assetId: string,
  rest: Pick<FinishSource, 'crop'> = {},
  fetched = FETCHED,
): FinishSource => ({
  provider: 'ambientCG',
  assetId,
  url: `https://ambientcg.com/a/${assetId}`,
  licence: TEXTURE_LICENCE,
  fetched,
  ...rest,
});
