import type { HomeScene } from '../builder/buildHome';
import type { PlacementDraw } from '../builder/drawList';
import type { Visibility } from '../builder/visibility';
import type { FinishMaterials } from '../finishes/materials';
import type { Vec3 } from '../geom/types';
import type { EmitterSource } from '../lighting/lamps';
import type { LightRig } from '../lighting/rig';

/** `normal · p + constant = 0`; what has `normal · p + constant >= 0` is kept (`sectionPlane`). */
export interface CutPlane {
  normal: Vec3;
  constant: number;
}

export interface TraceInputs {
  scene: HomeScene;
  /** The furniture that is drawn, as the viewer's scene gets it (`furnitureViews`). */
  placements: readonly (PlacementDraw & EmitterSource)[];
  visibility: Visibility;
  /** "Plan colours" (§5.5). */
  planColours: boolean;
  /** How the view is lit, with the backdrop that is shown. */
  rig: LightRig;
  /** The view is from inside a room: the backdrop is its gradient (§6.3). */
  eye: boolean;
  /** The cut of a section (`sectionPlane`); nothing is cut without it. */
  plane?: CutPlane | undefined;
  /** A named view stands on the neutral ground (§7.3); the free view does not. */
  ground: boolean;
  /** The materials of finishes, with the textures that have arrived (`whenTexturesArrived`). */
  materials: FinishMaterials;
}
