import { createElement } from 'react';
import { useHost, useListeners } from './useElement';
import { useLink } from './useLink';

/** The icons of `packages/sakuga-vfx/icons/icons.js` (`SakugaFX.icons`). */
export type IconName =
  | 'walk'
  | 'photos'
  | 'catalogue'
  | 'edit'
  | 'view'
  | 'furniture'
  | 'requests'
  | 'reset'
  | 'rotate-left'
  | 'rotate-right'
  | 'up'
  | 'down'
  | 'chevron-up'
  | 'chevron-down'
  | 'chevron-left'
  | 'chevron-right'
  | 'duplicate'
  | 'delete'
  | 'info'
  | 'more'
  | 'close'
  | 'camera'
  | 'gallery'
  | 'map'
  | 'expand'
  | 'collapse';

export interface SkIconButtonProps {
  /** Its accessible name: required, an icon has no text (docs/design/hud.md §10.3). */
  label: string;
  icon: IconName;
  /** Where its wedges fly; `cw`/`ccw` draw a crescent (a turn). */
  dir?: 'up' | 'down' | 'left' | 'right' | 'cw' | 'ccw';
  /** `puff`: a puff where the icon was (delete). */
  hit?: 'puff';
  size?: 'compact';
  /** `clear`: the resting HUD over the scene (HUD v2, #199): no box at rest, a crisp edge; focus and pressed as ever. */
  appearance?: 'clear';
  /** With `clear`: `dark` (ink, for light scenes, the default) or `light` (paper, for dark scenes). */
  tone?: 'dark' | 'light';
  /** With `clear`: a small flat translucent backing, for a busy scene. */
  backing?: boolean;
  disabled?: boolean;
  pressed?: boolean;
  /** A real link; a plain click goes through the app's router. */
  href?: string;
  title?: string;
  className?: string;
  onClick?(): void;
}

/** `<sakuga-icon-button>` (packages/sakuga-vfx/icon-button). */
export function SkIconButton({
  label,
  icon,
  dir,
  hit,
  size,
  appearance,
  tone,
  backing,
  disabled,
  pressed,
  href,
  title,
  className,
  onClick,
}: SkIconButtonProps) {
  const [host, setHost] = useHost<HTMLElement>();
  useListeners(host, { click: onClick && (() => onClick()) });
  useLink(host, href);
  return createElement('sakuga-icon-button', {
    ref: setHost,
    label,
    icon,
    dir,
    hit,
    size,
    appearance,
    tone,
    backing: backing || undefined,
    href,
    // A property (React sets it on a custom element): a toggle, even when off; a change plays nothing.
    pressed,
    title: title ?? label,
    className,
    disabled: disabled || undefined,
  });
}
