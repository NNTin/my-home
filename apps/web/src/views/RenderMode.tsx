import { useEffect, useMemo, useState, type RefObject } from 'react';
import { SkBadge } from '../hud/SkBadge';
import type { HomeScene } from '../builder/buildHome';
import type { PlacementDraw } from '../builder/drawList';
import type { Visibility } from '../builder/visibility';
import { finishMaterials } from '../finishes/materials';
import type { EmitterSource } from '../lighting/lamps';
import { rigFor, type Backdrop } from '../lighting/rig';
import type { TraceInputs } from './traceInputs';
import type { SaveImage, ViewCamera } from './ImageExport';
import { sectionPlane, viewRig, type NamedView } from './named';
import { NO_RENDER, renderSupport } from './renderSupport';

/**
 * The way into render mode (docs/design/realistic-render.md §9): "Render" in the Views control,
 * and the measuring page of its decision gate at `/?render=measure`. Either way the browser is
 * asked for WebGPU first, and only then is the lazy chunk `render-path` asked for: a browser
 * without it gets one sentence, keeps its view and downloads nothing. `&adapter=any` lets a
 * software adapter through, for a look without a graphics card.
 */

type Furniture = readonly (PlacementDraw & EmitterSource)[];

export interface RenderModeProps {
  scene: HomeScene;
  /** The furniture the viewer draws for a visibility (`furnitureViews`). */
  furnitureFor(visibility: Visibility): Furniture;
  /** The placements are still on their way: the measurement waits for them. */
  loading: boolean;
  planColours: boolean;
  /** The phone layout: render mode is for desktops. */
  phone: boolean;
  /** "Render" is on: the still of the view on screen is made. */
  on: boolean;
  /** What is shown of the home, and the furniture that is drawn. */
  visibility: Visibility;
  furniture: Furniture;
  /** The named view on screen; the free view when omitted. */
  view: NamedView | undefined;
  /** The backdrop on screen. */
  backdrop: Backdrop;
  /** The camera of the frame on screen (`ImageExport`). */
  camera: RefObject<ViewCamera | undefined>;
  /** Filled with "Save image" for the still while render mode is on. */
  saveRef: RefObject<SaveImage | undefined>;
  /** Render mode ends: "Close", or it could not start. */
  onClose(): void;
  /** Shows a short message. */
  onNotice(message: string): void;
}

/** What the address asks of render mode. */
export function renderRequest(search: string): { measure: boolean; anyAdapter: boolean } {
  const params = new URLSearchParams(search);
  return {
    measure: params.get('render') === 'measure',
    anyAdapter: params.get('adapter') === 'any',
  };
}

type Chunk = typeof import('../render-mode/render-path');

/** Why the chunk is not there: not asked for yet, refused, or failed to load. */
type Loaded = { chunk?: Chunk; refused?: string };

/**
 * The lazy chunk once `wanted`, after the WebGPU check. `refused` is the sentence for a browser
 * that cannot, or that the chunk did not load.
 */
function useRenderChunk(wanted: boolean, anyAdapter: boolean): Loaded {
  const [loaded, setLoaded] = useState<Loaded>({});
  const asked = wanted && !loaded.chunk;
  useEffect(() => {
    if (!asked) return;
    let current = true;
    void renderSupport()
      .then((support) => {
        if (support === 'none' || (support === 'software' && !anyAdapter)) {
          if (current) setLoaded({ refused: NO_RENDER });
          return undefined;
        }
        return import('../render-mode/render-path');
      })
      .then(
        (chunk) => current && chunk && setLoaded({ chunk }),
        () => current && setLoaded({ refused: 'Render mode could not be loaded' }),
      );
    return () => {
      current = false;
    };
  }, [asked, anyAdapter]);
  return loaded;
}

export function RenderMode({
  scene,
  furnitureFor,
  loading,
  planColours,
  phone,
  on,
  visibility,
  furniture,
  view,
  backdrop,
  camera,
  saveRef,
  onClose,
  onNotice,
}: RenderModeProps) {
  const [request] = useState(() => renderRequest(window.location.search));
  const measure = request.measure && !phone;
  const { chunk, refused } = useRenderChunk(measure || (on && !phone), request.anyAdapter);

  // "Render" in a browser that cannot: the sentence, and the view stays as it is.
  useEffect(() => {
    if (!on || measure || (!refused && !phone)) return;
    onNotice(refused ?? NO_RENDER);
    onClose();
    // Told once per press: the handlers are new on every render of the viewer.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [on, measure, refused, phone]);

  // What the frame on screen is made of. A new object is a changed view: the still starts over.
  const rigView = view && viewRig(view);
  const rigKind = rigView?.kind ?? 'free';
  const look = rigView?.kind === 'section' ? rigView.look : undefined;
  const at = view?.kind === 'section' ? view.at : undefined;
  const viewKey = view && JSON.stringify(view);
  const inputs = useMemo((): TraceInputs => {
    const rig = rigFor(
      rigKind === 'section' ? { kind: 'section', look: look ?? 'north' } : { kind: rigKind },
    );
    return {
      scene,
      placements: furniture,
      visibility,
      planColours,
      rig: { ...rig, backdrop },
      eye: rigKind === 'eye',
      plane: look !== undefined && at !== undefined ? sectionPlane(scene, { look, at }) : undefined,
      // A named view stands on the neutral ground (§7.3).
      ground: viewKey !== undefined,
      // The same materials and textures as the viewer draws with on a desktop.
      materials: finishMaterials('desktop'),
    };
    // `viewKey` stands for the view: a new camera (another room, another level) starts over too.
  }, [scene, furniture, visibility, planColours, backdrop, rigKind, look, at, viewKey]);

  if (request.measure) {
    const message = phone ? NO_RENDER : refused;
    if (message)
      return (
        <SkBadge className="render-unsupported" shown kind="warn" data-render="unsupported">
          {message}
        </SkBadge>
      );
    if (!chunk || loading) return null;
    return (
      <chunk.Gate
        inputs={{
          scene,
          furnitureFor,
          planColours,
          materials: finishMaterials('desktop'),
        }}
      />
    );
  }
  if (!on || phone || !chunk) return null;
  return (
    <chunk.RenderStill
      inputs={inputs}
      camera={camera}
      name={view?.kind ?? 'free'}
      saveRef={saveRef}
      onClose={onClose}
      onNotice={onNotice}
    />
  );
}
