import { useEffect, useState } from 'react';
import type { FrameGovernor, PerfData } from './governor';

/**
 * The `?perf=1` readout (docs/design/realistic-render.md §10.3): a small panel over the viewer
 * with what a frame costs on this device. Frame times mean something only on real hardware, so
 * it is what the owner reads on a phone and a desktop. The same data is `window.__myHomePerf()`,
 * which the smokes read.
 */

export const perfRequested = () => new URLSearchParams(window.location.search).get('perf') === '1';

declare global {
  interface Window {
    __myHomePerf?: () => PerfData;
  }
}

const ms = (value: number | undefined) => (value === undefined ? '–' : `${value.toFixed(1)} ms`);

export function PerfReadout({ governor }: { governor: FrameGovernor }) {
  const [data, setData] = useState(() => governor.perf());
  useEffect(() => {
    window.__myHomePerf = () => governor.perf();
    // Text only: reading the numbers draws no frame.
    const timer = window.setInterval(() => setData(governor.perf()), 250);
    return () => {
      window.clearInterval(timer);
      delete window.__myHomePerf;
    };
  }, [governor]);
  const rows: [string, string][] = [
    ['Setting', data.setting],
    ['Tier', data.tier],
    ['View', data.state === 'settled' ? 'resting' : 'moving'],
    ['Draw calls, last frame', String(data.drawCalls)],
    [
      'Draw calls while resting',
      data.state === 'settled' ? String(data.drawCallsSinceSettled) : '–',
    ],
    ['Triangles', String(data.triangles)],
    ['Textures', String(data.textures)],
    ['Lit lamps', String(data.litLamps)],
    ['Lights with shadows', String(data.shadowLights)],
    ['Shader programs', `${data.programs} (${data.compiles} compiled)`],
    ['Frame, median', ms(data.medianFrameMs)],
    ['Frame, 95th percentile', ms(data.p95FrameMs)],
    ['Refined frame', ms(data.refinedFrameMs)],
    ['Frames', String(data.frames)],
  ];
  return (
    <dl className="perf-readout" aria-label="Performance">
      {rows.map(([name, value]) => (
        <div key={name}>
          <dt>{name}</dt>
          <dd>{value}</dd>
        </div>
      ))}
    </dl>
  );
}
