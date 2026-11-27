import { createElement, type ReactNode } from 'react';
import { useHost, useListeners, useProperties } from './useElement';

interface ToggleElement extends HTMLElement {
  checked: boolean;
  flip?(): void;
}

export interface SkToggleProps {
  /** Its accessible name ("Edit", "Room names"). */
  label: string;
  /** The words beside it; a click on them flips it too. Read once: the switch has the name. */
  children?: ReactNode;
  checked: boolean;
  /** `compact`: the phone, the panel's header (the drawing at 0.6). */
  size?: 'compact';
  disabled?: boolean;
  title?: string;
  className?: string;
  onChange(checked: boolean): void;
}

/**
 * `<sakuga-toggle>`, the painted switch (packages/sakuga-vfx/toggle, docs/design/hud.md §5.13), in a row with its
 * words. `checked` from code goes straight to the end frame; only a person's flip plays the drawing.
 */
export function SkToggle({
  label,
  children,
  checked,
  size,
  disabled,
  title,
  className,
  onChange,
}: SkToggleProps) {
  const [host, setHost] = useHost<ToggleElement>();
  useProperties(host, { checked });
  useListeners(host, { change: () => host && onChange(host.checked) });
  const toggle = createElement('sakuga-toggle', {
    ref: setHost,
    label,
    size,
    title,
    disabled: disabled || undefined,
    className: children === undefined ? className : undefined,
  });
  if (children === undefined) return toggle;
  const flip = () => {
    if (!host || disabled) return;
    if (host.flip) host.flip();
    else host.click();
  };
  return (
    <span className={['sk-toggle-row', className].filter(Boolean).join(' ')}>
      <span className="sk-toggle-words" aria-hidden="true" onClick={flip}>
        {children}
      </span>
      {toggle}
    </span>
  );
}
