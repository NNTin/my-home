import { LiveResponse } from '@my-home/shared';
import { useEffect, useRef, useState } from 'react';
import type { FrameGovernor, PerfData } from './governor';
import { perfReport, perfRows } from './perfReport';
import { SkPanel } from '../hud/SkPanel';
import { SkButton } from '../hud/SkButton';
import { SkField } from '../hud/SkField';

/**
 * The `?perf=1` readout (docs/design/realistic-render.md §10.3): a small panel over the viewer
 * with what a frame costs on this device. Frame times mean something only on real hardware, so
 * it is what the owner reads on a phone and a desktop. "Copy" puts the readout on the clipboard
 * as a markdown table, with the context to compare runs. The same data is
 * `window.__myHomePerf()`, which the smokes read.
 */

export const perfRequested = () => new URLSearchParams(window.location.search).get('perf') === '1';

declare global {
  interface Window {
    __myHomePerf?: () => PerfData;
  }
}

/** How long "Copied" stays. */
const COPIED_MS = 2000;

/** A view too low for the whole panel (a phone held sideways): it starts folded. */
const lowView = () => window.matchMedia?.('(max-height: 500px)').matches ?? false;

/** The commit of the running release, from the public liveness answer; undefined if it has none. */
async function appCommit(signal: AbortSignal): Promise<string | undefined> {
  const response = await fetch('/api/health/live', { signal });
  const live = LiveResponse.safeParse(await response.json());
  return live.success ? (live.data.commit ?? undefined) : undefined;
}

export interface PerfReadoutProps {
  governor: FrameGovernor;
  /** The device class whose budgets apply. */
  phone: boolean;
  /** The view or mode in words, asked when the report is copied. */
  view(): string;
}

export function PerfReadout({ governor, phone, view }: PerfReadoutProps) {
  const [data, setData] = useState(() => governor.perf());
  const [open, setOpen] = useState(() => !lowView());
  const [copied, setCopied] = useState(false);
  // The clipboard was not available: the report, shown selected to be copied by hand.
  const [manual, setManual] = useState<string>();
  const [commit, setCommit] = useState<string>();
  const panel = useRef<HTMLDivElement>(null);
  const text = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    window.__myHomePerf = () => governor.perf();
    // Text only: reading the numbers draws no frame.
    const timer = window.setInterval(() => setData(governor.perf()), 250);
    return () => {
      window.clearInterval(timer);
      delete window.__myHomePerf;
    };
  }, [governor]);

  // Asked once, ahead of the click: a copy must not wait for the network.
  useEffect(() => {
    const abort = new AbortController();
    appCommit(abort.signal).then(setCommit, () => undefined);
    return () => abort.abort();
  }, []);

  useEffect(() => {
    if (!copied) return;
    const timer = window.setTimeout(() => setCopied(false), COPIED_MS);
    return () => window.clearTimeout(timer);
  }, [copied]);

  useEffect(() => {
    if (manual === undefined) return;
    text.current?.focus();
    text.current?.select();
    // iOS selects nothing on `select()` alone.
    text.current?.setSelectionRange(0, manual.length);
  }, [manual]);

  // Nothing here touches the canvas or the scene: copying draws no frame.
  const copy = async () => {
    const canvas = panel.current?.closest('.perf-readout')?.parentElement?.querySelector('canvas');
    const report = perfReport(governor.perf(), {
      commit,
      view: view(),
      phone,
      viewport: { width: window.innerWidth, height: window.innerHeight },
      devicePixelRatio: window.devicePixelRatio,
      canvas: canvas ? { width: canvas.width, height: canvas.height } : undefined,
      userAgent: navigator.userAgent,
      time: new Date(),
    });
    try {
      // Absent without a secure context; refused without permission.
      if (!navigator.clipboard?.writeText) throw new Error('no clipboard');
      await navigator.clipboard.writeText(report);
      setManual(undefined);
      setCopied(true);
    } catch {
      setCopied(false);
      setManual(report);
    }
  };

  return (
    // A note on a paper card (sakuga-panel); its fold stays a button: folded, the readings are not on the page.
    <SkPanel className="perf-readout" kind="note" size="compact" label="Perf readout">
      <div className="perf-head" ref={panel}>
        <SkButton size="compact" variant="secondary" expanded={open} onClick={() => setOpen(!open)}>
          Perf {open ? '▾' : '▸'}
        </SkButton>
        <SkButton size="compact" variant="secondary" onClick={() => void copy()}>
          <span aria-live="polite">{copied ? 'Copied' : 'Copy'}</span>
        </SkButton>
      </div>
      {manual !== undefined && (
        <div className="perf-manual">
          <label>
            Select all and copy:
            <SkField size="compact">
              <textarea ref={text} readOnly rows={4} value={manual} />
            </SkField>
          </label>
          <SkButton size="compact" variant="secondary" onClick={() => setManual(undefined)}>
            Close
          </SkButton>
        </div>
      )}
      {open && (
        <dl aria-label="Performance">
          {perfRows(data, phone).map(({ name, value }) => (
            <div key={name}>
              <dt>{name}</dt>
              <dd>{value}</dd>
            </div>
          ))}
        </dl>
      )}
    </SkPanel>
  );
}
