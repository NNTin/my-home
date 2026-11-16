import type { HomeModel, HomeSummary } from '@my-home/shared';
import { useMemo, useState } from 'react';
import { buildHome, type HomeScene, type Vec3 } from './builder/buildHome';
import { defaultVisibility, visibleScene, type Visibility } from './builder/visibility';
import { ControlPanel } from './overlay/ControlPanel';
import { Scene } from './scene/Scene';

/** Orbit around the middle of the highest level still shown, so a cutaway looks into it. */
export function orbitTarget(scene: HomeScene, v: Visibility): Vec3 {
  const shown = scene.levels.filter(
    (l) => l.index <= v.maxLevelIndex && !v.hiddenLevels.includes(l.id),
  );
  const top = shown.at(-1) ?? scene.levels[0];
  const { min, max } = scene.bounds;
  return [(min[0] + max[0]) / 2, top ? top.elevation + top.height / 2 : 0, (min[2] + max[2]) / 2];
}

interface Props {
  model: HomeModel;
  homes: HomeSummary[];
  onSelectHome(id: string): void;
}

/** Renders one home; mount with `key={model.id}` so switching homes resets the view. */
export function Viewer({ model, homes, onSelectHome }: Props) {
  const scene = useMemo(() => buildHome(model), [model]);
  const [visibility, setVisibility] = useState(() => defaultVisibility(scene));
  const shown = useMemo(() => visibleScene(scene, visibility), [scene, visibility]);
  return (
    <>
      <Scene scene={shown} target={orbitTarget(scene, visibility)} />
      <ControlPanel
        homes={homes}
        homeId={model.id}
        onSelectHome={onSelectHome}
        scene={scene}
        visibility={visibility}
        onChange={setVisibility}
      />
    </>
  );
}
