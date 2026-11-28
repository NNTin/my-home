import { createElement, useImperativeHandle, type ReactNode, type Ref } from 'react';
import { useHost, useListeners } from './useElement';
import { useLink } from './useLink';

interface ButtonElement extends HTMLElement {
  done(hold?: number): void;
}

export interface SkButtonHandle {
  /** A check lands on it with a glint (primary only): call it when the action has worked. */
  done(hold?: number): void;
}

export interface SkButtonProps {
  /** The label, and its accessible name unless `aria-label` is given (then the element's `label`). */
  children: ReactNode;
  /** `secondary`: the quiet one, no impact and no word. */
  variant?: 'primary' | 'secondary';
  /** `compact`: the phone's bars and the floating tools (docs/design/hud.md §3.3). */
  size?: 'compact';
  /** `clear`: the resting HUD over the scene (HUD v2, #199): no box at rest, a crisp edge; focus and pressed as ever. */
  appearance?: 'clear';
  /** With `clear`: `dark` (ink, for light scenes, the default) or `light` (paper, for dark scenes). */
  tone?: 'dark' | 'light';
  /** With `clear`: a small flat translucent backing, for a busy scene. */
  backing?: boolean;
  type?: 'button' | 'submit';
  disabled?: boolean;
  /** A toggle button: `aria-pressed` and an ink fill. Set from code, it plays nothing. */
  pressed?: boolean;
  /** A disclosure (it opens a section): `aria-expanded`, no look of its own. Not with `pressed`. */
  expanded?: boolean;
  /** A real link; a plain click goes through the app's router. */
  href?: string;
  title?: string;
  'aria-label'?: string;
  /** Stays on the host: the stylesheet's layout and the smokes' selectors keep working. */
  className?: string;
  onClick?(): void;
  ref?: Ref<SkButtonHandle>;
}

/** `<sakuga-button>` (packages/sakuga-vfx/button). */
export function SkButton({
  children,
  variant,
  size,
  appearance,
  tone,
  backing,
  type,
  disabled,
  pressed,
  expanded,
  href,
  title,
  'aria-label': ariaLabel,
  className,
  onClick,
  ref,
}: SkButtonProps) {
  const [host, setHost] = useHost<ButtonElement>();
  useListeners(host, { click: onClick && (() => onClick()) });
  useLink(host, href);
  useImperativeHandle(ref, () => ({ done: (hold) => host?.done(hold) }), [host]);
  return createElement(
    'sakuga-button',
    {
      ref: setHost,
      variant,
      size,
      appearance,
      tone,
      backing: backing || undefined,
      type,
      href,
      // A property (React sets it on a custom element): a toggle, even when off; a change plays nothing.
      pressed,
      // An attribute, "true" or "false": the element reads it as such.
      expanded: expanded === undefined ? undefined : String(expanded),
      title,
      label: ariaLabel,
      className,
      disabled: disabled || undefined,
    },
    children,
  );
}
