import { useEffect, useRef, useState } from 'react';
import {
  chunkSize,
  gateDenoiser,
  gateSettings,
  graphicsNames,
  releaseCommit,
  runGate,
  type GateInputs,
  type GateResult,
  type GateStatus,
} from './gate';
import { cleanAt, gateReport, judgedImage, passes, type GateContext } from './measure';
import './render-mode.css';

/**
 * The measuring page of render mode's decision gate (docs/design/realistic-render.md §9), at
 * `/?render=measure`: it traces the three fixed views on this machine, shows each still, and
 * ends with the numbers as a table to copy into the issue.
 */

interface Shown extends GateResult {
  url?: string;
  rawUrl?: string;
}

/** The chunks the page reports: the tracer's and the denoiser's (its weights are in the denoiser's line). */
const CHUNKS = ['render-path', 'render-denoise'];

export function Gate({ inputs }: { inputs: GateInputs }) {
  const host = useRef<HTMLDivElement>(null);
  const [settings] = useState(() => gateSettings(window.location.search));
  const [status, setStatus] = useState<GateStatus>();
  const [results, setResults] = useState<Shown[]>([]);
  const [report, setReport] = useState<string>();
  const [failure, setFailure] = useState<string>();
  const [copied, setCopied] = useState(false);
  // The home as it was when the page opened: an edit elsewhere does not start the gate again.
  const [measured] = useState(inputs);

  useEffect(() => {
    const target = host.current;
    if (!target) return;
    const controller = new AbortController();
    const { signal } = controller;
    const urls: string[] = [];
    const finished: GateResult[] = [];
    void (async () => {
      setStatus({ view: 'denoiser', text: 'Loading', backdrop: '#ffffff' });
      const [names, commit, denoiser] = await Promise.all([
        graphicsNames(),
        releaseCommit(signal),
        gateDenoiser(settings.weights),
      ]);
      if (signal.aborted) return;
      await runGate(
        target,
        settings,
        measured,
        denoiser.source,
        {
          status: setStatus,
          result(result) {
            finished.push(result);
            const url = result.image && URL.createObjectURL(result.image);
            const rawUrl = result.raw && URL.createObjectURL(result.raw);
            for (const made of [url, rawUrl]) if (made) urls.push(made);
            setResults((list) => [
              ...list,
              { ...result, ...(url && { url }), ...(rawUrl && { rawUrl }) },
            ]);
          },
        },
        signal,
      );
      if (signal.aborted) return;
      const chunks = await Promise.all(
        CHUNKS.map(async (name) => ({ name, size: await chunkSize(name) })),
      );
      if (signal.aborted) return;
      const context: GateContext = {
        commit,
        time: new Date(),
        browser: navigator.userAgent,
        ...names,
        width: settings.width,
        height: settings.height,
        samples: settings.samples,
        bounces: settings.bounces,
        limit: settings.limit,
        kernel: settings.megakernel ? 'megakernel' : 'wavefront',
        denoiser: denoiser.text,
        chunks,
      };
      setReport(
        gateReport(
          context,
          finished.map((r) => r.measurement),
        ),
      );
      setStatus(undefined);
    })().catch((error: unknown) => {
      if (!signal.aborted) setFailure(error instanceof Error ? error.message : String(error));
    });
    return () => {
      controller.abort();
      for (const url of urls) URL.revokeObjectURL(url);
    };
  }, [settings, measured]);

  const copy = () => {
    if (!report) return;
    void navigator.clipboard?.writeText(report).then(
      () => setCopied(true),
      () => setCopied(false),
    );
  };

  return (
    <section
      className="render-gate"
      aria-label="Render mode measurement"
      data-gate={failure ? 'failed' : report ? 'done' : 'running'}
    >
      <h1>Render mode: measurement</h1>
      <p>
        This page traces{' '}
        {settings.views.length > 0
          ? `the fixed views ${settings.views.join(', ')}`
          : 'the three fixed views'}{' '}
        of the home, one after the other, at {settings.width} x {settings.height} px to{' '}
        {settings.samples} samples a pixel
        {settings.megakernel ? ' (megakernel)' : ''},{' '}
        {settings.weights === 'none'
          ? 'without the denoiser'
          : `denoised with the ${settings.weights} weights`}
        . Leave the tab in front until the table appears.
      </p>
      {failure && (
        <p className="error" role="alert">
          The tracer could not run: {failure}
        </p>
      )}
      {status && (
        <p role="status">
          <strong>{status.view}</strong>: {status.text}
        </p>
      )}
      <div
        ref={host}
        className="render-gate-canvas"
        style={{
          aspectRatio: `${settings.width} / ${settings.height}`,
          background: status?.backdrop ?? '#ffffff',
        }}
        hidden={report !== undefined || failure !== undefined}
      />
      {results.length > 0 && (
        <ul className="render-gate-stills">
          {results.map(({ measurement: m, url, rawUrl, imageSamples }) => {
            const clean = cleanAt(m.checkpoints, judgedImage(m));
            return (
              <li key={m.view}>
                {url && (
                  <img
                    src={url}
                    alt={`The traced still of the ${m.view} view${m.denoised ? ', denoised' : ''}`}
                  />
                )}
                <p>
                  <strong>{m.view}</strong>:{' '}
                  {m.error
                    ? `failed (${m.error})`
                    : `${m.samples} samples in ${m.seconds.toFixed(1)} s; ${
                        clean
                          ? `${m.denoised ? 'denoised, ' : ''}clean after ${clean.seconds.toFixed(1)} s (${clean.samples} samples)`
                          : 'not clean by the measure'
                      }; gate ${passes(m) ? 'passed' : 'not passed'}`}
                  {url && (
                    <>
                      {' '}
                      <a href={url} download={`my-home-render-${m.view}.png`}>
                        Save image
                      </a>{' '}
                      ({imageSamples} samples{m.denoised ? ', denoised' : ''})
                    </>
                  )}
                  {rawUrl && (
                    <>
                      {' '}
                      <a href={rawUrl} download={`my-home-render-${m.view}-raw.png`}>
                        Save the raw image
                      </a>
                    </>
                  )}
                </p>
              </li>
            );
          })}
        </ul>
      )}
      {report && (
        <>
          <p>
            <button type="button" onClick={copy}>
              {copied ? 'Copied' : 'Copy the table'}
            </button>{' '}
            and paste it into the issue, with the three images.
          </p>
          <textarea
            className="render-gate-report"
            readOnly
            value={report}
            rows={24}
            aria-label="The measurement as a table"
            onFocus={(event) => event.currentTarget.select()}
          />
        </>
      )}
      <p>
        <a href="/">Back to the viewer</a>
      </p>
    </section>
  );
}
