import { createContext, useContext } from 'react';
import type { FinishMaterials } from '../finishes/materials';
import type { FrameGovernor, Tier } from '../quality/governor';

/**
 * The frame loop's controls as the parts of the scene see them. A module of its own, apart from
 * the loop (`Frame.tsx`): the piece page draws parts too and must not pull the loop into its chunk.
 */

/** What the parts of the scene tell the frame loop. */
export interface FrameControl {
  governor: FrameGovernor;
  /** What casts shadows changed: the sun's shadow map is fitted and drawn again. */
  castersChanged(): void;
  /** A material may be new to the renderer: compile ahead before the next frame is drawn. */
  materialsChanged(): void;
  /** The materials of finishes for this device, with their textures. */
  finishes: FinishMaterials;
  /** A finish is drawn: its texture files are asked for, once, in this device's size (§5.3). */
  finishShown(finish: string): void;
  /**
   * The camera was put somewhere else at once (a named view, `?focus=`): the lamp pool gathers
   * afresh around the new place, so what is lit and shadowed there does not depend on where the
   * camera was before (§6.4, §6.7).
   */
  cameraJumped(): void;
  /** A section is cut: the frame's targets get a stencil buffer for its caps (§7.2). */
  useStencil(): void;
  /**
   * Resolves once beautiful frames can be drawn, whatever the quality setting: the lazy chunk
   * is asked for if it is not here. False when it does not come. For the image export (§7.4).
   */
  beautifulReady(): Promise<boolean>;
  /** Draws one frame of the view as it is, now and outside the loop: the governor is not told. */
  drawNow(tier: Tier): void;
}

export const FrameContext = createContext<FrameControl | undefined>(undefined);

/** The frame loop's controls; undefined outside the viewer's canvas (the piece page, tests). */
export const useFrameControl = () => useContext(FrameContext);
