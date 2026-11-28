import { useEffect, useRef, useState, type RefObject } from 'react';
import type { PerspectiveCamera } from 'three';
import { download } from '../views/exportImage';
import { imageName } from '../views/named';
import { NO_PROGRESS, Still, type StillProgress } from './still';
import { SAMPLE_TARGET } from './tracer';
import type { TraceInputs } from './traceScene';
import './render-mode.css';
import { SkButton } from '../hud/SkButton';

/**
 * Render mode on screen (docs/design/realistic-render.md §9): the still over the viewer, a line
 * that says how far it is, and "Stop", "Save image" and "Close". The viewer underneath rests;
 * when the view is changed it draws the new one once, which is what shows until the first sample.
 */

export interface RenderStillProps {
  /** What the frame on screen is made of. A new object is a changed view: the still starts over. */
  inputs: TraceInputs;
  /** The camera of the frame on screen, and the view's size in CSS pixels. */
  camera: RefObject<
    (() => { camera: PerspectiveCamera; width: number; height: number }) | undefined
  >;
  /** What the saved file is named after: the named view, or "free". */
  name: string;
  /** Filled with "Save image" while render mode is on: the panel's button saves the still. */
  saveRef: RefObject<((view: string) => Promise<void>) | undefined>;
  onClose(): void;
  /** Says why render mode ended by itself. */
  onNotice(message: string): void;
}

/** A change of view settles (the camera is placed a frame after the view is chosen) before the still starts. */
const RESTART_MS = 200;

export const statusText = (p: StillProgress): string => {
  const time = `${p.seconds.toFixed(0)} s`;
  // A still without its denoiser (the network did not load) says so once it has samples.
  const raw = p.undenoised !== undefined && p.samples > 0 ? ' (not denoised)' : '';
  if (p.done) return `Done: ${p.samples} samples in ${time}${raw}`;
  if (p.settling) return `Stopped at ${p.samples} of ${SAMPLE_TARGET} samples, ${time}: denoising`;
  if (!p.running) return `Stopped at ${p.samples} of ${SAMPLE_TARGET} samples, ${time}${raw}`;
  if (p.stage === 'denoising')
    return `Denoising at ${p.samples} of ${SAMPLE_TARGET} samples, ${time}`;
  if (p.stage === 'rendering')
    return `Rendering: ${p.samples} of ${SAMPLE_TARGET} samples, ${time}${raw}`;
  return p.stage === 'compiling' ? `Preparing the tracer, ${time}` : 'Preparing the scene';
};

export function RenderStill({
  inputs,
  camera,
  name,
  saveRef,
  onClose,
  onNotice,
}: RenderStillProps) {
  const host = useRef<HTMLDivElement>(null);
  const [still, setStill] = useState<Still>();
  const [progress, setProgress] = useState<StillProgress>(NO_PROGRESS);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!host.current) return;
    const made = new Still(host.current);
    setStill(made);
    const timer = window.setInterval(() => setProgress(made.progress()), 250);
    return () => {
      window.clearInterval(timer);
      made.dispose();
    };
  }, []);

  // The view, what is shown of it or the window's size changed: the still starts over.
  const [resized, setResized] = useState(0);
  useEffect(() => {
    const onResize = () => setResized((n) => n + 1);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);
  useEffect(() => {
    if (!still) return;
    const timer = window.setTimeout(() => {
      const view = camera.current?.();
      if (view) still.show(inputs, view);
    }, RESTART_MS);
    return () => window.clearTimeout(timer);
  }, [still, inputs, camera, resized]);

  const { failed } = progress;
  useEffect(() => {
    if (failed === undefined) return;
    onNotice('The render could not be made');
    onClose();
    // Only the failure ends render mode, once.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [failed]);

  useEffect(() => {
    if (!still) return;
    // The panel's "Save image": nothing to save before the first sample, and nothing to say.
    saveRef.current = async (view) => {
      if (still.hasImage) download(await still.image(), imageName(`${view}-render`, new Date()));
    };
    return () => {
      saveRef.current = undefined;
    };
  }, [still, saveRef]);

  useEffect(() => {
    // Escape closes, but not out of a field of the panel: there it is that field's own key.
    const onKey = (event: KeyboardEvent) => {
      const field =
        event.target instanceof HTMLElement && event.target.closest('input, select, textarea');
      if (event.key === 'Escape' && !field) onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const save = () => {
    if (!still || saving) return;
    setSaving(true);
    still
      .image()
      .then((blob) => download(blob, imageName(`${name}-render`, new Date())))
      .catch(() => onNotice('The image could not be saved'))
      .finally(() => setSaving(false));
  };

  return (
    <section
      className="render-still"
      aria-label="Render"
      data-render={progress.done ? 'done' : progress.running ? 'running' : 'stopped'}
    >
      <div ref={host} className="render-still-canvas" />
      <div className="render-still-bar">
        <p role="status">{statusText(progress)}</p>
        {progress.running && (
          <SkButton size="compact" variant="secondary" onClick={() => still?.stop()}>
            Stop
          </SkButton>
        )}
        <SkButton
          size="compact"
          variant="secondary"
          onClick={save}
          disabled={saving || progress.samples < 1 || progress.settling}
        >
          {saving ? 'Saving…' : 'Save image'}
        </SkButton>
        <SkButton size="compact" variant="secondary" onClick={onClose}>
          Close
        </SkButton>
      </div>
    </section>
  );
}
