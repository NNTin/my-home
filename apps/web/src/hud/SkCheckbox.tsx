import { createElement, type ReactNode } from 'react';
import { useHost, useListeners, useProperties } from './useElement';

export interface SkCheckboxProps {
  /** The label: clicking it ticks the box. */
  children: ReactNode;
  checked: boolean;
  disabled?: boolean;
  className?: string;
  onChange(checked: boolean): void;
}

/** `<sakuga-checkbox>` (packages/sakuga-vfx/checkbox). `checked` from code plays nothing. */
export function SkCheckbox({ children, checked, disabled, className, onChange }: SkCheckboxProps) {
  const [host, setHost] = useHost<HTMLElement & { checked: boolean }>();
  useProperties(host, { checked });
  useListeners(host, { change: () => host && onChange(host.checked) });
  return createElement(
    'sakuga-checkbox',
    { ref: setHost, className, disabled: disabled || undefined },
    children,
  );
}
