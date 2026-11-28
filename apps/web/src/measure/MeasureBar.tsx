import { useEffect, useRef, type KeyboardEvent } from 'react';
import { SkButton } from '../hud/SkButton';
import { AXES, metres, status, type Measurement } from './measure';

/** How far an arrow moves the cross: a fiftieth of the view, a tenth with Shift. */
const STEP = 0.02;
const BIG_STEP = 0.1;

const ARROWS: Record<string, [number, number]> = {
  ArrowLeft: [-1, 0],
  ArrowRight: [1, 0],
  ArrowUp: [0, -1],
  ArrowDown: [0, 1],
};

const clamp = (v: number) => Math.min(0.98, Math.max(0.02, v));

export interface MeasureBarProps {
  points: Measurement;
  /** The last pick met nothing of the model; the points are as they were. */
  missed: boolean;
  /** The keyboard's cross, as fractions of the view (the middle to start with). */
  cross: readonly [number, number];
  onCross(cross: [number, number]): void;
  /** Picks the point under the cross. */
  onPickCross(): void;
  onClear(): void;
  onDone(): void;
}

/**
 * The measure tool's task bar (HUD v2 #206): what to do next or the distance, the last point's coordinates in the
 * model's own axes, and its controls: the cross for the keyboard (arrows aim it, Enter picks), Clear and Done.
 * The cross is drawn over the view; a click or a tap on the model picks too.
 */
export function MeasureBar({
  points,
  missed,
  cross,
  onCross,
  onPickCross,
  onClear,
  onDone,
}: MeasureBarProps) {
  const aim = useRef<HTMLDivElement>(null);
  // The focus comes into the task: the cross's button first, so the keyboard can aim at once.
  useEffect(() => {
    aim.current?.querySelector<HTMLElement>('sakuga-button, button')?.focus();
  }, []);
  const onKeyDown = (e: KeyboardEvent) => {
    const step = ARROWS[e.key];
    if (!step) return;
    // The cross's own keys: no other control and no shortcut takes them.
    e.preventDefault();
    e.stopPropagation();
    const by = e.shiftKey ? BIG_STEP : STEP;
    onCross([clamp(cross[0] + step[0] * by), clamp(cross[1] + step[1] * by)]);
  };
  const last = points[points.length - 1];
  return (
    <>
      <div
        className="measure-cross"
        aria-hidden="true"
        style={{ left: `${cross[0] * 100}%`, top: `${cross[1] * 100}%` }}
      />
      <section className="measure-bar" aria-label="Measure">
        <p className={missed ? 'measure-status warning' : 'measure-status'} role="status">
          {status(points, missed)}
        </p>
        {last && (
          <dl
            className="measure-coords"
            aria-label={`Point ${points.length === 2 ? 'B' : 'A'}, model coordinates`}
          >
            {AXES.map(({ axis, toward }, i) => (
              <div key={axis}>
                <dt>
                  {axis} <span>({toward})</span>
                </dt>
                <dd>{metres(last[i]!)}</dd>
              </div>
            ))}
          </dl>
        )}
        <div className="measure-actions">
          <div ref={aim} className="measure-aim" onKeyDown={onKeyDown}>
            <SkButton
              size="compact"
              variant="secondary"
              aria-label="Pick the point under the cross. Arrow keys aim"
              onClick={onPickCross}
            >
              Pick at ✛
            </SkButton>
          </div>
          <SkButton
            size="compact"
            variant="secondary"
            disabled={points.length === 0}
            onClick={onClear}
          >
            Clear
          </SkButton>
          <SkButton size="compact" onClick={onDone}>
            Done
          </SkButton>
        </div>
      </section>
    </>
  );
}
