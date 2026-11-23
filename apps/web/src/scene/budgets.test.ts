import { HomeModel, HomeSeed } from '@my-home/shared';
import { describe, expect, it } from 'vitest';
import homeJson from '../../../../data/homes/home.json';
import seedJson from '../../../../data/homes/home.seed.json';
import { buildHome } from '../builder/buildHome';
import { groupShown, scenePieceDraws, shellItems } from '../builder/drawList';
import { defaultVisibility, wholeVisibility, type Visibility } from '../builder/visibility';
import { furniture } from '../catalog/furniture';
import { partBatches } from '../catalog/PartsMesh';
import { createContext, defaultSettings } from '../editor/operations';
import { batches } from './batches';
import { BUDGETS } from '../quality/perfReport';
import { furnitureViews } from './furnitureViews';

/**
 * The budgets of docs/design/realistic-render.md §10.1 that can be counted without a GPU: the
 * meshes one frame draws (a draw call each) and the triangles, for "Our home" with its seed.
 */

/** Per frame, for a phone and a desktop. */
const DRAW_CALLS = BUDGETS.drawCalls;
const TRIANGLES_WHOLE = BUDGETS.trianglesWhole;
const TRIANGLES_PER_PIECE = BUDGETS.trianglesPerPiece;
/**
 * What a frame draws besides the home: the compass letters, the output pass (two steps on a
 * phone), and the selected item's rotate ring.
 */
const OTHER_DRAW_CALLS = 8;

const model = HomeModel.parse(structuredClone(homeJson));
const seed = HomeSeed.parse(structuredClone(seedJson));
const scene = buildHome(model);
const ctx = createContext(model, furniture, defaultSettings);
const items = seed.placements.map((p) => ({
  id: p.id,
  typeId: p.typeId,
  name: p.name,
  levelId: p.levelId,
  position: p.position,
  rotationY: p.rotationY,
  ...(p.mounting !== undefined && p.mounting !== 'floor' && { mounting: p.mounting }),
  ...(p.elevation !== undefined && p.elevation !== 0 && { elevation: p.elevation }),
  params: { ...p.params },
}));
const shell = batches(shellItems(scene));
const pieceDraws = scenePieceDraws(scene).map((p) => ({ ...p, meshes: partBatches(p.parts) }));

/** The meshes of one frame of the view, and their triangles. */
function frame(v: Visibility) {
  const shellShown = shell.filter((b) => groupShown(b.group, scene, v));
  const piecesShown = pieceDraws.filter((p) => groupShown(p.group, scene, v));
  const placed = furnitureViews(ctx, items, scene, v).map((f) => partBatches(f.parts));
  const meshes = [...shellShown, ...piecesShown.flatMap((p) => p.meshes), ...placed.flat()];
  return {
    shell: shellShown.length,
    pieces: piecesShown.length,
    pieceMeshes: piecesShown.reduce((n, p) => n + p.meshes.length, 0),
    placements: placed.length,
    placementMeshes: placed.flat().length,
    drawCalls: meshes.length + OTHER_DRAW_CALLS,
    triangles: meshes.reduce((n, m) => n + m.triangles, 0),
  };
}

describe('draw-call and triangle budgets of "Our home"', () => {
  it('has placements in its seed', () => {
    expect(items.length).toBeGreaterThan(20);
  });

  it.each([
    ['default', defaultVisibility(scene)],
    ['whole', wholeVisibility(scene)],
  ] as const)('the %s view is within the draw-call budget of a phone', (name, v) => {
    const f = frame(v);
    const { phone, desktop } = DRAW_CALLS[name];
    expect(f.drawCalls).toBeLessThanOrEqual(phone);
    expect(f.drawCalls).toBeLessThanOrEqual(desktop);
  });

  it('the whole house is within the triangle budget', () => {
    expect(frame(wholeVisibility(scene)).triangles).toBeLessThanOrEqual(TRIANGLES_WHOLE);
  });

  it('every placed type at its default size and every piece of the home is within a piece\u2019s triangles', () => {
    for (const type of furniture.categories.flatMap((c) => c.types)) {
      const triangles = partBatches(furniture.resolve(type.id)!.parts).reduce(
        (n, m) => n + m.triangles,
        0,
      );
      expect(triangles, type.id).toBeLessThanOrEqual(TRIANGLES_PER_PIECE);
    }
    for (const piece of pieceDraws) {
      const triangles = piece.meshes.reduce((n, m) => n + m.triangles, 0);
      expect(triangles, piece.id).toBeLessThanOrEqual(TRIANGLES_PER_PIECE);
    }
  });

  it('merging cut the meshes of the default view at least fivefold', () => {
    const v = defaultVisibility(scene);
    const before =
      shellItems(scene).filter((i) => groupShown(i.group, scene, v)).length +
      pieceDraws
        .filter((p) => groupShown(p.group, scene, v))
        .reduce((n, p) => n + p.parts.length, 0) +
      furnitureViews(ctx, items, scene, v).reduce((n, f) => n + f.parts.length, 0);
    expect(before).toBeGreaterThan(600);
    expect(frame(v).drawCalls * 5).toBeLessThan(before);
  });
});
