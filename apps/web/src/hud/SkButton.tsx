import { createElement, useImperativeHandle, type ReactNode, type Ref } from 'react';
import { useHost, useListeners } from './useElement';

interface ButtonElement extends HTMLElement {
  done(hold?: number): void;
}

export interface SkButtonHandle {
  /** A check lands on it with a glint (primary only): call it when the action has worked. */
  done(hold?: number): void;
}

export interface SkButtonProps {
  /** The label, and its accessible name. */
  children: ReactNode;
  /** `secondary`: the quiet one, no impact and no word. */
  variant?: 'primary' | 'secondary';
  type?: 'button' | 'submit';
  disabled?: boolean;
  title?: string;
  /** Stays on the host: the stylesheet's layout and the smokes' selectors keep working. */
  className?: string;
  onClick?(): void;
  ref?: Ref<SkButtonHandle>;
}

/** `<sakuga-button>` (packages/sakuga-vfx/button). */
export function SkButton({
  children,
  variant,
  type,
  disabled,
  title,
  className,
  onClick,
  ref,
}: SkButtonProps) {
  const [host, setHost] = useHost<ButtonElement>();
  useListeners(host, { click: onClick && (() => onClick()) });
  useImperativeHandle(ref, () => ({ done: (hold) => host?.done(hold) }), [host]);
  return createElement(
    'sakuga-button',
    { ref: setHost, variant, type, title, className, disabled: disabled || undefined },
    children,
  );
}
