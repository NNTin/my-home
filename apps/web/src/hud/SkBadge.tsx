import { createElement, type ReactNode } from 'react';

export interface SkBadgeProps {
  /** The text (a status); a count badge has none. */
  children?: ReactNode;
  /** There or not: changed after the first render it pops in or shrinks away (never fades). */
  shown: boolean;
  kind?: 'warn';
  /** A pink disc with the number; a higher one pops. */
  count?: number;
  /** With `count`: its accessible name; without one the count is decoration. */
  label?: string;
  /** The check draws with a glint ("Saved"). */
  done?: boolean;
  /** Seconds: it leaves by itself that long after it arrived or its text changed. */
  duration?: number;
  /** A role of the page's own; else `status` (`alert` when it warns). */
  role?: string;
  'aria-label'?: string;
  className?: string;
  /** `data-*` attributes stay on the host (what tests and scripts look for). */
  [data: `data-${string}`]: string | undefined;
}

/** `<sakuga-badge>` (packages/sakuga-vfx/badge). */
export function SkBadge({
  children,
  shown,
  kind,
  count,
  label,
  done,
  duration,
  role,
  'aria-label': ariaLabel,
  className,
  ...data
}: SkBadgeProps) {
  return createElement(
    'sakuga-badge',
    {
      // A property (React sets known properties of a custom element): set before the element is on the page it just
      // appears; changed later it pops in or shrinks away, which is the badge's reaction to a state change (§5.12).
      shown,
      kind,
      count,
      label,
      done: done || undefined,
      duration,
      role,
      'aria-label': ariaLabel,
      className,
      ...data,
    },
    children,
  );
}
