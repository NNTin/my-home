import { catalog, HomeModel, isOutdoorKind } from '@my-home/shared';
import { describe, expect, it } from 'vitest';
import realHomeJson from '../../../../data/homes/home.json';
import mockHomeJson from '../../../../packages/shared/test-fixtures/mock-home.json';
import { buildHome } from '../builder/buildHome';
import { FurnitureLayer, type FurnitureView } from '../scene/FurnitureLayer';
import { HomeMeshes } from '../scene/HomeMeshes';
import { furniture, unknownParts } from './furniture';
import { goldenJson, renderRecords } from './renderRecords';

/**
 * Golden render records (see `renderRecords`). They were recorded from the renderer before the
 * piece modules existed and must not change unless a PR changes a design on purpose; such a PR
 * updates them (`vitest -u`) and says so. See docs/adding-piece-type.md.
 */

const noop = () => {};
const handlers = {
  onSelect: noop,
  onMoveStart: noop,
  onMove: noop,
  onRotateStart: noop,
  onRotate: noop,
  onDragEnd: noop,
};

/**
 * The types at their default size, plain, selected and colliding; then an unknown type. By
 * default every type the "Add" panel offers (furniture and fixtures).
 */
function furnitureViews(types = furniture.categories.flatMap((c) => c.types)): FurnitureView[] {
  const states = [
    { selected: false, colliding: false },
    { selected: true, colliding: false },
    { selected: false, colliding: true },
  ];
  const views = types.flatMap((type, i) =>
    states.map((state, j): FurnitureView => {
      const { size, parts } = furniture.resolve(type.id)!;
      return {
        id: `${type.id}-${j}`,
        position: [i * 3, 0.25 * j, j * 3],
        rotationY: 0.3 * j,
        size,
        parts,
        ...state,
      };
    }),
  );
  const size = { width: 0.6, depth: 0.6, height: 0.6 };
  views.push({
    id: 'unknown',
    position: [-3, 0, 0],
    rotationY: 0,
    size,
    parts: unknownParts(size, '#8a8a8a'),
    selected: false,
    colliding: false,
  });
  return views;
}

describe('golden render records', () => {
  it.each([
    ['home', realHomeJson],
    ['mock-home', mockHomeJson],
  ])('draws %s as recorded', async (name, json) => {
    const scene = buildHome(HomeModel.parse(structuredClone(json)));
    const records = await renderRecords(<HomeMeshes scene={scene} />);
    expect(records.length).toBeGreaterThan(100);
    await expect(goldenJson(records)).toMatchFileSnapshot(`./__golden__/${name}.json`);
  });

  it('draws every furniture type as recorded', async () => {
    const records = await renderRecords(
      <FurnitureLayer items={furnitureViews()} handlers={handlers} />,
    );
    await expect(goldenJson(records)).toMatchFileSnapshot('./__golden__/furniture.json');
  });

  it('draws every outdoor type as recorded', async () => {
    const outdoor = catalog.types.filter(isOutdoorKind).map((t) => furniture.get(t.id)!);
    expect(outdoor).toHaveLength(10);
    const records = await renderRecords(
      <FurnitureLayer items={furnitureViews(outdoor)} handlers={handlers} />,
    );
    await expect(goldenJson(records)).toMatchFileSnapshot('./__golden__/outdoor.json');
  });
});
