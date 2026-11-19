import { formatCm, mountingOf, type CatalogType } from '@my-home/shared';
import { box } from '../catalog/parts';
import type { Part, PieceContext } from '../catalog/types';
import { STUB_HEAD, STUB_SIDE, WALL_COLOR } from './section';

/**
 * How the piece page shows a piece placed in a room on its own, before #63 mounts it in the house:
 * pure, in the piece's local frame (the furniture frame: origin at its bottom, its back at
 * -depth / 2; a ceiling piece's origin is the ceiling).
 */

/** The ceiling's colour in the viewer. */
const CEILING_COLOR = '#f1efe9';
/** A stand-in worktop under a piece that stands on one (the microwave). */
const WORKTOP_COLOR = '#6b5a4a';
const WALL_THICKNESS = 0.1;
const CEILING_THICKNESS = 0.12;

export interface MountingStage {
  /** Drawn around the piece and not framed: a wall behind, a ceiling above, a worktop below. */
  context: Part[];
  /** The floor under the piece (at its type's elevation), or undefined (a ceiling piece). */
  ground: number | undefined;
  /** The camera looks up at a ceiling piece. */
  from: 'above' | 'below';
}

export function mountingStage(type: CatalogType, ctx: PieceContext): MountingStage {
  const { width: w, height: h, wallDepth: d } = ctx;
  const elevation = type.elevation ?? 0;
  switch (mountingOf(type)) {
    case 'ceiling': {
      const size = Math.max(w * 6, 0.6);
      return {
        context: [
          box(
            [0, CEILING_THICKNESS / 2, 0],
            [size, CEILING_THICKNESS, size],
            CEILING_COLOR,
            'body',
          ),
        ],
        ground: undefined,
        from: 'below',
      };
    }
    case 'wall': {
      const top = Math.max(h, 0) + STUB_HEAD;
      return {
        context: [
          box(
            [0, (top - elevation) / 2, -d / 2 - WALL_THICKNESS / 2],
            [w + 2 * STUB_SIDE, top + elevation, WALL_THICKNESS],
            WALL_COLOR,
            'body',
          ),
        ],
        ground: elevation > 0 ? -elevation : 0,
        from: 'above',
      };
    }
    case 'floor':
      return {
        context:
          elevation > 0
            ? [box([0, -elevation / 2, 0], [w + 0.4, elevation, d + 0.15], WORKTOP_COLOR, 'body')]
            : [],
        ground: elevation > 0 ? -elevation : 0,
        from: 'above',
      };
  }
}

/** "Stands on the floor", "Hangs on a wall, its bottom 133.0 cm above the floor", … */
export function mountingText(type: CatalogType): string {
  const height = type.elevation ? formatCm(type.elevation) : undefined;
  switch (mountingOf(type)) {
    case 'ceiling':
      return 'Fixed to the ceiling.';
    case 'wall':
      return height
        ? `Hangs on a wall, its bottom ${height} above the floor by default.`
        : 'Hangs on a wall.';
    case 'floor':
      return height
        ? `Stands on a worktop, ${height} above the floor by default.`
        : 'Stands on the floor.';
  }
}
