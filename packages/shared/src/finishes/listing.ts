import { exteriorAbout } from './definitions/exterior.about';
import { floorsAbout } from './definitions/floors.about';
import { groundAbout } from './definitions/ground.about';
import { partsAbout } from './definitions/parts.about';
import { wallsAbout } from './definitions/walls.about';
import { finishes, type FinishLibrary } from './library';
import { TEXTURE_LICENCE, TEXTURE_PROVIDERS, type FinishAbout, type ListedFinish } from './types';

/**
 * The finishes with what is said about them: a description each, and for a textured one the
 * source of its texture. The viewer draws without either, so they are no part of the library it
 * loads (`library.ts`): the catalogue page, the asset manifest and the fetch tool read this
 * list. It is an entry of its own, `@my-home/shared/finish-listing`, and not part of the
 * package's index: a bundler puts a module where its first importer is, and the index is in the
 * viewer's first chunk.
 */

/**
 * Joins a library with what is said about its finishes. Throws on a finish without a
 * description, a textured one without a CC0 source, a plain one with a source, and an entry for
 * no finish, so a broken definition fails at import, in every test run.
 */
export function createFinishListing(
  library: FinishLibrary,
  about: Readonly<Record<string, FinishAbout>>,
): ListedFinish[] {
  for (const id of Object.keys(about))
    if (!library.get(id)) throw new Error(`Invalid finish "${id}": described, but not defined`);
  return library.finishes.map((finish) => {
    const fail = (message: string): never => {
      throw new Error(`Invalid finish "${finish.id}": ${message}`);
    };
    const said = about[finish.id] ?? fail('a finish needs a description');
    if (said.description.trim() === '') fail('a finish needs a description');
    const { source } = said;
    if (!finish.texture) {
      if (source !== undefined) fail('a plain finish has no source');
    } else {
      const from = source ?? fail('a textured finish needs a source');
      if (!TEXTURE_PROVIDERS.includes(from.provider)) fail('the source must be a CC0 library');
      if (from.licence !== TEXTURE_LICENCE) fail(`the licence must be ${TEXTURE_LICENCE}`);
      if (from.assetId.trim() === '' || !/^https:\/\/\S+$/.test(from.url))
        fail('the source needs an asset id and an https URL');
      if (!/^\d{4}-\d{2}-\d{2}$/.test(from.fetched)) fail('the fetch date is yyyy-mm-dd');
      if (from.crop !== undefined && !(from.crop > 0 && from.crop <= 1))
        fail('the crop is a share from 0 to 1');
    }
    return { ...finish, ...said };
  });
}

/**
 * The groups' texts as one record. Throws on a finish that two groups describe: spreading the
 * groups into one object would keep the later entry and say nothing.
 */
export function joinAbout(
  groups: readonly Readonly<Record<string, FinishAbout>>[],
): Record<string, FinishAbout> {
  const joined: Record<string, FinishAbout> = {};
  for (const group of groups) {
    for (const [id, said] of Object.entries(group)) {
      if (id in joined) throw new Error(`Invalid finish "${id}": described twice`);
      joined[id] = said;
    }
  }
  return joined;
}

/** Every finish with its description and source, in library order. */
export const finishListing: readonly ListedFinish[] = createFinishListing(
  finishes,
  joinAbout([floorsAbout, wallsAbout, exteriorAbout, groundAbout, partsAbout]),
);
