import { catalog, HomeModel, isOutdoorKind } from '@my-home/shared';
import { describe, expect, it } from 'vitest';
import realHomeJson from '../../../../data/homes/home.json';
import mockHomeJson from '../../../../packages/shared/test-fixtures/mock-home.json';
import { buildHome } from '../builder/buildHome';
import { drawList, partItems, type DrawItem } from '../builder/drawList';
import { goldenJson } from './drawRecords';
import { furniture, unknownParts } from './furniture';

/**
 * Golden draw lists (see `goldenJson`): the ordered draw items of the home, of the mock home and
 * of each catalogue type at its default size. They must not change unless a PR changes a design
 * on purpose; such a PR updates them (`vitest -u`) and says so. See docs/adding-piece-type.md.
 */

/** The types at their default size, each in its own frame; then an unknown type. */
function typeItems(types = furniture.categories.flatMap((c) => c.types)): DrawItem[] {
  const size = { width: 0.6, depth: 0.6, height: 0.6 };
  return [
    ...types.flatMap((type) =>
      partItems(furniture.resolve(type.id)!.parts, type.id, { kind: 'placement', id: type.id }),
    ),
    ...partItems(unknownParts(size, '#8a8a8a'), 'unknown', { kind: 'placement', id: 'unknown' }),
  ];
}

describe('golden draw lists', () => {
  it.each([
    ['home', realHomeJson],
    ['mock-home', mockHomeJson],
  ])('draws %s as recorded', async (name, json) => {
    const items = drawList(buildHome(HomeModel.parse(structuredClone(json))));
    expect(items.length).toBeGreaterThan(100);
    await expect(goldenJson(items)).toMatchFileSnapshot(`./__golden__/${name}.json`);
  });

  it('draws every furniture type as recorded', async () => {
    await expect(goldenJson(typeItems())).toMatchFileSnapshot('./__golden__/furniture.json');
  });

  it('draws every outdoor type as recorded', async () => {
    const outdoor = catalog.types.filter(isOutdoorKind).map((t) => furniture.get(t.id)!);
    expect(outdoor).toHaveLength(12);
    await expect(goldenJson(typeItems(outdoor))).toMatchFileSnapshot('./__golden__/outdoor.json');
  });
});
