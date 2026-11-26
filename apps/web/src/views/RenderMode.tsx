import { useEffect, useState, type ComponentType } from 'react';
import type { HomeScene } from '../builder/buildHome';
import type { PlacementDraw } from '../builder/drawList';
import type { Visibility } from '../builder/visibility';
import { finishMaterials } from '../finishes/materials';
import type { EmitterSource } from '../lighting/lamps';
import type { GateInputs } from '../render-mode/render-path';
import { NO_RENDER, renderSupport } from './renderSupport';

/**
 * The way into render mode (docs/design/realistic-render.md §9). For now that is the measuring
 * page of its decision gate, at `/?render=measure`: the browser is asked for WebGPU, and only
 * then is the lazy chunk `render-path` asked for. A browser without it gets one sentence.
 * `&adapter=any` lets a software adapter through, for a look without a graphics card.
 */

export interface RenderModeProps {
  scene: HomeScene;
  /** The furniture the viewer draws for a visibility (`furnitureViews`). */
  furnitureFor(visibility: Visibility): readonly (PlacementDraw & EmitterSource)[];
  /** The placements are still on their way: the measurement waits for them. */
  loading: boolean;
  planColours: boolean;
  /** The phone layout: render mode is for desktops. */
  phone: boolean;
}

/** What the address asks of render mode. */
export function renderRequest(search: string): { measure: boolean; anyAdapter: boolean } {
  const params = new URLSearchParams(search);
  return {
    measure: params.get('render') === 'measure',
    anyAdapter: params.get('adapter') === 'any',
  };
}

type Chunk = { Gate: ComponentType<{ inputs: GateInputs }> };

export function RenderMode({ scene, furnitureFor, loading, planColours, phone }: RenderModeProps) {
  const [request] = useState(() => renderRequest(window.location.search));
  const [chunk, setChunk] = useState<Chunk>();
  const [refused, setRefused] = useState<string>();
  const wanted = request.measure && !phone;
  useEffect(() => {
    if (!wanted) return;
    let current = true;
    void renderSupport()
      .then((support) => {
        if (support === 'none' || (support === 'software' && !request.anyAdapter)) {
          if (current) setRefused(NO_RENDER);
          return undefined;
        }
        return import('../render-mode/render-path');
      })
      .then(
        (loaded) => current && loaded && setChunk(loaded),
        () => current && setRefused('Render mode could not be loaded'),
      );
    return () => {
      current = false;
    };
  }, [wanted, request]);

  if (!request.measure) return null;
  const message = phone ? NO_RENDER : refused;
  if (message)
    return (
      <p className="toast" role="alert" data-render="unsupported">
        {message}
      </p>
    );
  if (!chunk || loading) return null;
  return (
    <chunk.Gate
      inputs={{
        scene,
        furnitureFor,
        planColours,
        // The same materials and textures as the viewer draws with on this device.
        materials: finishMaterials('desktop'),
      }}
    />
  );
}
