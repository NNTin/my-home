import { createElement, useEffect, useRef, useState } from 'react';
import { afterEffects, HOLD_MS, LEAVE_MS } from './loading';

interface ProgressElement extends HTMLElement {
  set(n: number, instant?: boolean): void;
}

interface Props {
  /** Progress from 0 to 1: real progress only (an upload's bytes sent). */
  value: number;
  /** What a screen reader calls it. */
  label: string;
  /**
   * The bar has reached the end (it is marked `data-leaving` meanwhile: the page shrinks it, or its card), played it (the burst, ドン! and the check) and shrunk away: the
   * owner may take it off the page now.
   */
  onEnd?: () => void;
}

/** progress.js ran (index.html loads it ahead of the main chunk); not in jsdom. */
const defined = () =>
  typeof customElements !== 'undefined' && !!customElements.get('sakuga-progress');

/**
 * Sakuga VFX's `<sakuga-progress>` (packages/sakuga-vfx/progress) for a React page. Without the
 * element (its script did not load) it is the browser's own bar, and ends at once.
 */
export function SakugaProgress({ value, label, onEnd }: Props) {
  const [bar, setBar] = useState<HTMLElement | null>(null);
  const [leaving, setLeaving] = useState(false);
  const sakuga = defined();
  const ended = useRef(onEnd);
  useEffect(() => {
    ended.current = onEnd;
  }, [onEnd]);

  useEffect(() => {
    if (sakuga) (bar as ProgressElement | null)?.set(value);
    else if (value >= 1) ended.current?.();
  }, [sakuga, bar, value]);

  useEffect(() => {
    if (!sakuga || !bar) return;
    const timers: ReturnType<typeof setTimeout>[] = [];
    const waits: (() => void)[] = [];
    let live = true;
    const calm = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
    const done = () => {
      if (calm) return ended.current?.();
      waits.push(
        afterEffects(HOLD_MS, () => {
          if (!live) return;
          setLeaving(true);
          timers.push(setTimeout(() => ended.current?.(), LEAVE_MS));
        }),
      );
    };
    bar.addEventListener('sakuga:done', done);
    return () => {
      live = false;
      bar.removeEventListener('sakuga:done', done);
      for (const timer of timers) clearTimeout(timer);
      for (const cancel of waits) cancel();
    };
  }, [sakuga, bar]);

  if (!sakuga)
    return (
      <>
        <progress max={1} value={value} aria-label={label} />
        <span>{Math.round(value * 100)}%</span>
      </>
    );
  return createElement('sakuga-progress', {
    ref: setBar,
    label,
    className: 'sakuga-progress',
    'data-leaving': leaving ? '' : undefined,
  });
}
