import { catalog, HomeModel, isOutdoorKind } from '@my-home/shared';
import { describe, expect, it } from 'vitest';
import realHomeJson from '../../../../data/homes/home.json';
import mockHomeJson from '../../../../packages/shared/test-fixtures/mock-home.json';
import { buildHome } from '../builder/buildHome';
import { drawList, type DrawItem } from '../builder/drawList';
import { shapeGeometry } from '../scene/batches';
import { furniture, unknownParts } from './furniture';
import furnitureGolden from './__golden__/furniture.json';
import homeGolden from './__golden__/home.json';
import mockHomeGolden from './__golden__/mock-home.json';
import outdoorGolden from './__golden__/outdoor.json';
import { COLLISION_COLOR, SELECTION_COLOR } from './PartsMesh';
import { geometryRecord, round, type RenderRecord } from './renderRecords';

/**
 * The step from a mesh per solid to merged batches (#110): the golden render records in
 * `__golden__/` were recorded from the old renderer, one record per mesh. This test derives the
 * same records from the draw list, one per draw item, and compares them with the unchanged
 * files: the draw list holds exactly the solids, transforms, colours, material settings and
 * shadow flags the old renderer drew. The next commit moves the goldens to the draw list itself.
 */

type Legacy = Omit<RenderRecord, 'path'>;

const states = [
  { emissive: '#000000', emissiveIntensity: 0 },
  { emissive: SELECTION_COLOR, emissiveIntensity: 0.4 },
  { emissive: COLLISION_COLOR, emissiveIntensity: 0.55 },
];

/** The record of the mesh the old renderer drew for this item. */
function legacyRecord(
  item: DrawItem,
  glow = { emissive: '#000000', emissiveIntensity: 1 },
): Legacy {
  const m = item.material;
  return {
    kind: 'mesh',
    geometry: geometryRecord(shapeGeometry(item.shape)),
    matrixWorld: item.matrix.map(round),
    material: {
      type: 'MeshStandardMaterial',
      color: item.tint,
      ...glow,
      opacity: m?.opacity ?? 1,
      transparent: m?.transparent ?? false,
      depthWrite: m?.depthWrite ?? true,
      metalness: m?.metalness ?? 0,
      roughness: m?.roughness ?? 1,
      side: m?.doubleSided ? 2 : 0,
    },
    castShadow: item.castShadow,
    receiveShadow: item.receiveShadow,
  };
}

/** Records as sorted lines: the old order was the order of React elements, not of solids. */
const sorted = (records: Legacy[]) => records.map((r) => JSON.stringify(sortKeys(r))).sort();
function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    return Object.fromEntries(
      Object.keys(record)
        .filter((k) => k !== 'path')
        .sort()
        .map((k) => [k, sortKeys(record[k])]),
    );
  }
  return value;
}

/** The old furniture goldens: every type plain, selected and colliding, then an unknown type. */
function furnitureRecords(types = furniture.categories.flatMap((c) => c.types)): Legacy[] {
  const records = types.flatMap((type, i) =>
    states.flatMap((glow, j) => {
      const { parts } = furniture.resolve(type.id)!;
      const placement = {
        id: `${type.id}-${j}`,
        position: [i * 3, 0.25 * j, j * 3] as [number, number, number],
        rotationY: 0.3 * j,
        parts,
      };
      return drawList(emptyScene, [placement]).map((item) => legacyRecord(item, glow));
    }),
  );
  const size = { width: 0.6, depth: 0.6, height: 0.6 };
  const unknown = { id: 'unknown', position: [-3, 0, 0] as [number, number, number], rotationY: 0 };
  return [
    ...records,
    ...drawList(emptyScene, [{ ...unknown, parts: unknownParts(size, '#8a8a8a') }]).map((item) =>
      legacyRecord(item, states[0]),
    ),
  ];
}

const emptyScene = buildHome(HomeModel.parse(structuredClone(mockHomeJson)));
Object.assign(emptyScene, {
  walls: [],
  openings: [],
  slabs: [],
  ceilings: [],
  roomFloors: [],
  terrain: [],
  outdoorAreas: [],
  roofPlanes: [],
  roofWindows: [],
  outbuildings: [],
  stairs: [],
  fences: [],
});

/** The rotate ring of a selected item was in the old records; it is not part of a piece. */
const withoutRings = (records: Legacy[]) =>
  records.filter((r) => r.geometry.type !== 'RingGeometry');

describe('the draw list holds what the old renderer drew', () => {
  it.each([
    ['home', realHomeJson, homeGolden],
    ['mock-home', mockHomeJson, mockHomeGolden],
  ])('%s', (_name, json, golden) => {
    const scene = buildHome(HomeModel.parse(structuredClone(json)));
    const records = drawList(scene).map((item) => legacyRecord(item));
    expect(records.length).toBeGreaterThan(100);
    expect(sorted(records)).toEqual(sorted(golden as Legacy[]));
  });

  it('every furniture type', () => {
    expect(sorted(furnitureRecords())).toEqual(sorted(withoutRings(furnitureGolden as Legacy[])));
  });

  it('every outdoor type', () => {
    const outdoor = catalog.types.filter(isOutdoorKind).map((t) => furniture.get(t.id)!);
    expect(outdoor).toHaveLength(11);
    expect(sorted(furnitureRecords(outdoor))).toEqual(
      sorted(withoutRings(outdoorGolden as Legacy[])),
    );
  });
});
