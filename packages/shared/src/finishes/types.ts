import { z } from 'zod';

/**
 * Finishes: named surface materials (docs/design/realistic-render.md §5). A finish is a catalogue
 * entry in git, like a piece type; a room or an exterior surface of a home refers to one by id.
 */

/** A finish id: `<material>.<name>`, e.g. `wood.oak-laminate` or `paint.plain`. */
export const FinishId = z
  .string()
  .regex(
    /^[a-z][a-z0-9-]*\.[a-z][a-z0-9-]*$/,
    'Finish ids look like "material.name" (a-z, 0-9, "-")',
  )
  .max(64)
  .meta({ id: 'FinishId', description: 'A finish in the library, e.g. "wood.oak-laminate".' });
export type FinishId = z.infer<typeof FinishId>;

/** The kinds of surface a finish may be used on. */
export const FINISH_SURFACES = [
  'floor',
  'wall',
  'ceiling',
  'facade',
  'roof',
  'ground',
  'part',
] as const;
export type FinishSurface = (typeof FINISH_SURFACES)[number];

/** `color` is multiplied by the tint, `normal` is the relief, `roughness` multiplies the roughness. */
export const TEXTURE_MAPS = ['color', 'normal', 'roughness'] as const;
export type TextureMap = (typeof TEXTURE_MAPS)[number];

/** The only licence a texture may have. */
export const TEXTURE_LICENCE = 'CC0-1.0';

/** The CC0 libraries textures may come from. */
export const TEXTURE_PROVIDERS = ['Poly Haven', 'ambientCG'] as const;
export type TextureProvider = (typeof TEXTURE_PROVIDERS)[number];

/** Where the texture of a finish comes from. */
export interface FinishSource {
  provider: TextureProvider;
  /** The provider's id of the asset. */
  assetId: string;
  /** The asset's page. */
  url: string;
  licence: typeof TEXTURE_LICENCE;
  /** The day the files were downloaded, `yyyy-mm-dd`. */
  fetched: string;
  /**
   * The share of the source's width and height that one repeat is cut from (its top left corner),
   * when the source repeats a pattern more often than a texture of this size can show.
   */
  crop?: number;
}

/** The texture set of a finish: its files are `<id>/<map>-<size>.webp`. */
export interface FinishTexture {
  /** The set's id and its folder name. */
  id: string;
  /** A relief-only set has no `color` map. */
  maps: readonly TextureMap[];
}

/** What a finish is drawn with, and its name. */
export interface Finish {
  /** `<material>.<name>`, lower case. */
  id: string;
  name: string;
  /** Where it may be used. Empty: only the viewer draws it (cut faces), no home may name it. */
  surfaces: readonly FinishSurface[];
  /** Absent for a plain finish: a colour with a roughness, and no files. */
  texture?: FinishTexture;
  /** Metres covered by one repeat of the texture, measured from the source. */
  tileSize?: number;
  /** The default colour, `#rrggbb`; the texture is multiplied by it. */
  tint: string;
  /** Whether a use may change the tint (paint: yes; clay tiles: no). */
  tintable: boolean;
  /** 0 to 1; the roughness map, where the set has one, multiplies it. */
  roughness: number;
  /** 0 to 1. */
  metalness: number;
}

/**
 * What is said about a finish and nothing draws with: its description and where its texture
 * comes from. Kept beside the definition and out of the viewer's first chunk: the catalogue page,
 * the asset manifest and the fetch tool read it (`listing.ts`).
 */
export interface FinishAbout {
  /** For the catalogue page and for people choosing. */
  description: string;
  /** For textured finishes. */
  source?: FinishSource;
}

/** A finish with what is said about it. */
export type ListedFinish = Finish & FinishAbout;
