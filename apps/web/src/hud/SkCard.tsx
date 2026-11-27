import { createElement, type ReactNode } from 'react';
import { useHost, useListeners } from './useElement';
import { useLink } from './useLink';

export interface SkCardProps {
  children?: ReactNode;
  /** Its accessible name, when its text is longer than what it should be called. */
  label?: string;
  /** Read after its name. */
  description?: string;
  /** A real link; a plain click goes through the app's router. Without it, a button. */
  href?: string;
  /** A choice among cards: on or off. Without it, not one. */
  selected?: boolean;
  disabled?: boolean;
  className?: string;
  onClick?(): void;
  /** `data-*` attributes stay on the host (what tests and scripts look for). */
  [data: `data-${string}`]: string | undefined;
}

/** `<sakuga-card>` (packages/sakuga-vfx/card): a paper card that is a link or a button (docs/design/hud.md §5.9). */
export function SkCard({
  children,
  label,
  description,
  href,
  selected,
  disabled,
  className,
  onClick,
  ...data
}: SkCardProps) {
  const [host, setHost] = useHost<HTMLElement>();
  useListeners(host, { click: onClick && (() => onClick()) });
  useLink(host, href);
  return createElement(
    'sakuga-card',
    {
      ref: setHost,
      label,
      description,
      href,
      selected,
      disabled: disabled || undefined,
      className,
      ...data,
    },
    children,
  );
}
