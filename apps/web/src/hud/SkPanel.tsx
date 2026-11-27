import { createElement, useEffect, useState, type ReactNode } from 'react';
import { useHost } from './useElement';

export interface SkPanelProps {
  children?: ReactNode;
  /** Its accessible name. */
  label: string;
  /** `region` (the default), `note` (complementary) or `dialog`. */
  kind?: 'note' | 'dialog';
  size?: 'compact';
  /**
   * Brought by a person (a toggle opened it): it lands from above with a squash and two puffs on the first frame.
   * Without it, it is just there (the panels of the first load).
   */
  arrive?: boolean;
  className?: string;
  /** `data-*` attributes stay on the host (what tests and scripts look for). */
  [data: `data-${string}`]: string | undefined;
}

/** `<sakuga-panel>` (packages/sakuga-vfx/panel): a part of the HUD on a paper card (docs/design/hud.md §5.4). */
export function SkPanel({ children, label, kind, size, arrive, className, ...data }: SkPanelProps) {
  const [host, setHost] = useHost<HTMLElement>();
  // Arriving, it is shown once on the page: the element plays its landing on the change. Read on the first render.
  const [lands] = useState(arrive);
  useEffect(() => {
    if (host && lands) Reflect.set(host, 'shown', true);
  }, [host, lands]);
  return createElement(
    'sakuga-panel',
    // `shown` is a property (React sets known properties of a custom element).
    { ref: setHost, shown: lands ? undefined : true, label, kind, size, className, ...data },
    children,
  );
}
