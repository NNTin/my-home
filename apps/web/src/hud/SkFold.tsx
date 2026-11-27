import { createElement, type ReactNode } from 'react';

export interface SkFoldProps {
  /** Its title, the button that opens and closes it; also the group's name. */
  title: string;
  /** A short note after the title ("2 of 3 shown"). */
  note?: ReactNode;
  /** Open on the first render; then it is the person's. */
  defaultOpen?: boolean;
  size?: 'compact';
  className?: string;
  children?: ReactNode;
}

/**
 * `<sakuga-fold>` (packages/sakuga-vfx/fold): a group that opens and closes, its body springing to its height
 * (docs/design/hud.md §5.6). A group named by its title, as the `<details>` it replaces.
 */
export function SkFold({ title, note, defaultOpen, size, className, children }: SkFoldProps) {
  return createElement(
    'sakuga-fold',
    {
      role: 'group',
      'aria-label': title,
      // An attribute on the first render only: React leaves it alone while it does not change.
      open: defaultOpen || undefined,
      size,
      className,
    },
    createElement('span', { slot: 'summary' }, title),
    note !== undefined && createElement('span', { slot: 'note' }, note),
    children,
  );
}
