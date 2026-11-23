import { HomeModel } from '@my-home/shared';
import { Color, Euler, Matrix4, Quaternion, Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import realHomeJson from '../../../../data/homes/home.json';
import mockHomeJson from '../../../../packages/shared/test-fixtures/mock-home.json';
import { box, cylinder, tilted } from '../catalog/parts';
import { buildHome, type HomeScene } from './buildHome';
import {
  batchKey,
  contourColor,
  drawList,
  groupShown,
  IDENTITY,
  linearRgb,
  multiply,
  partItems,
  scenePieceDraws,
  shellItems,
  transform,
} from './drawList';
import {
  defaultVisibility,
  showUpTo,
  visibleScene,
  wholeVisibility,
  type Visibility,
} from './visibility';

const home = buildHome(HomeModel.parse(structuredClone(realHomeJson)));
const mock = buildHome(HomeModel.parse(structuredClone(mockHomeJson)));

const close = (a: number[], b: number[]) =>
  a.forEach((value, i) => expect(value).toBeCloseTo(b[i]!, 12));

describe('transform', () => {
  it('is three.js’ matrix of a scale, a YXZ rotation and a position', () => {
    for (const [ry, rx, scale] of [
      [0, 0, [1, 1, 1]],
      [0.7, 0, [1, 1, 1]],
      [-2.1, 0.4, [1, 1, 0.5]],
      [Math.PI / 2, -Math.PI / 2, [2, 3, 4]],
    ] as const) {
      const expected = new Matrix4().compose(
        new Vector3(1, 2, 3),
        new Quaternion().setFromEuler(new Euler(rx, ry, 0, 'YXZ')),
        new Vector3(...scale),
      );
      close(transform([1, 2, 3], ry, rx, [...scale]), expected.elements);
    }
  });

  it('multiplies like three.js: the right-hand matrix first', () => {
    const a = transform([1, 2, 3], 0.3, 0.2);
    const b = transform([-4, 0, 2], -1.1, 0, [1, 1, 2]);
    const expected = new Matrix4().fromArray(a).multiply(new Matrix4().fromArray(b));
    close(multiply(a, b), expected.elements);
    close(multiply(IDENTITY, b), b);
  });
});

describe('colours', () => {
  const samples = ['#000000', '#ffffff', '#5e9b4c', '#b8a184', '#0a0b0c', '#7c6a4f'];

  it('reads a colour as three.js does, in linear light', () => {
    for (const hex of samples) close(linearRgb(hex), new Color(hex).toArray());
  });

  it('darkens a contour as the old renderer did', () => {
    for (const hex of samples)
      expect(contourColor(hex)).toBe(`#${new Color(hex).multiplyScalar(0.6).getHexString()}`);
  });
});

describe('the shell items', () => {
  it('have unique ids, and a contour is a tint of its area’s finish', () => {
    const items = shellItems(home);
    expect(new Set(items.map((i) => i.id)).size).toBe(items.length);
    const contours = items.filter((i) => i.id.includes('/contour-'));
    expect(contours.length).toBeGreaterThan(0);
    for (const contour of contours) {
      const area = items.find((i) => i.id === contour.id.split('/contour-')[0])!;
      expect(contour.finish).toBe(area.finish);
      expect(contour.tint).not.toBe(area.tint);
      expect(batchKey(contour)).toBe(batchKey(area));
    }
  });

  it('flat polygons are open, cast no shadow and are drawn from both sides', () => {
    for (const item of shellItems(home)) {
      const flat = item.shape.kind === 'surface';
      expect(item.closed).toBe(!flat);
      expect(item.castShadow).toBe(!flat);
      expect(item.material?.doubleSided ?? false).toBe(flat);
    }
  });
});

describe('groupShown', () => {
  /** Visibilities the panels can produce: cutaways, hidden levels, apartments, areas, terrain. */
  function visibilities(scene: HomeScene): Visibility[] {
    const whole = wholeVisibility(scene);
    return [
      whole,
      defaultVisibility(scene),
      ...scene.levels.map((l) => showUpTo(scene, whole, l.index)),
      ...scene.levels.map((l) => ({ ...whole, hiddenLevels: [l.id] })),
      ...scene.levels.map((l) => ({ ...showUpTo(scene, whole, l.index), hiddenLevels: [l.id] })),
      ...scene.apartments.map((a) => ({ ...whole, hiddenApartments: [a.id] })),
      { ...whole, hiddenOutdoorAreas: scene.outdoorAreas.slice(0, 2).map((a) => a.id) },
      { ...whole, showTerrain: false },
    ];
  }

  it.each([
    ['home', home],
    ['mock-home', mock],
  ])('shows exactly what visibleScene keeps: %s', (_name, scene) => {
    const shell = shellItems(scene);
    const pieces = scenePieceDraws(scene);
    for (const v of visibilities(scene)) {
      const kept = visibleScene(scene, v);
      expect(shell.filter((i) => groupShown(i.group, scene, v)).map((i) => i.id)).toEqual(
        shellItems(kept).map((i) => i.id),
      );
      expect(pieces.filter((p) => groupShown(p.group, scene, v)).map((p) => p.id)).toEqual(
        scenePieceDraws(kept).map((p) => p.id),
      );
    }
  });
});

describe('partItems', () => {
  const parts = [
    box([0, 0.5, 0], [1, 1, 1], '#aa0000', 'body'),
    tilted(cylinder([0, 1, 0], 0.4, 0.2, '#00aa00', 'detail', 0.2), Math.PI / 2),
    box([0, 0.5, 0.5], [1, 1, 0.01], '#88aacc', 'glass', {
      transparent: true,
      opacity: 0.35,
      depthWrite: false,
      castShadow: false,
    }),
  ];
  const group = { kind: 'placement', id: 'p' } as const;

  it('keeps the order, the colours as tints, and the shadow flags out of the material', () => {
    const items = partItems(parts, 'p', group);
    expect(items.map((i) => i.id)).toEqual(['p/0', 'p/1', 'p/2']);
    expect(items.map((i) => i.tint)).toEqual(['#aa0000', '#00aa00', '#88aacc']);
    expect(items.every((i) => i.finish === 'part' && i.piece === 'p')).toBe(true);
    expect(items[2]!.material).toEqual({ transparent: true, opacity: 0.35, depthWrite: false });
    expect(items[2]!.castShadow).toBe(false);
    expect(items[0]!.material).toBeUndefined();
  });

  it('an elliptic cylinder is a round one scaled along z', () => {
    const [, item] = partItems(parts, 'p', group);
    expect(item!.shape).toEqual({ kind: 'cylinder', diameter: 0.4, height: 0.2 });
    close(item!.matrix, transform([0, 1, 0], 0, Math.PI / 2, [1, 1, 0.5]));
  });

  it('puts a placement’s parts into the world', () => {
    const placed = { id: 'p', position: [3, 0.2, -1] as [number, number, number], rotationY: 0.5 };
    const items = drawList(emptyOf(mock), [{ ...placed, parts }]);
    expect(items).toHaveLength(3);
    close(
      items[0]!.matrix,
      multiply(transform(placed.position, placed.rotationY), transform([0, 0.5, 0])),
    );
    expect(items[0]!.group).toEqual({ kind: 'placement', id: 'p' });
  });
});

/** A scene with nothing in it. */
function emptyOf(scene: HomeScene): HomeScene {
  return {
    ...scene,
    walls: [],
    openings: [],
    slabs: [],
    ceilings: [],
    roomFloors: [],
    roomCeilings: [],
    terrain: [],
    outdoorAreas: [],
    roofPlanes: [],
    roofWindows: [],
    outbuildings: [],
    stairs: [],
    fences: [],
  };
}
