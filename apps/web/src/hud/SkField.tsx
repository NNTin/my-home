import { createElement, type ReactNode } from 'react';

export interface SkFieldProps {
  /** The native control: a select, an input (number, date, color, file) or a textarea; React keeps owning it. */
  children: ReactNode;
  /** A caption inside the frame; the control keeps its own name. */
  label?: string;
  size?: 'compact';
  invalid?: boolean;
  className?: string;
}

/** `<sakuga-field>` (packages/sakuga-vfx/field, docs/design/hud.md §5.3): a paper frame around a native control. */
export function SkField({ children, label, size, invalid, className }: SkFieldProps) {
  return createElement(
    'sakuga-field',
    { label, size, className, invalid: invalid || undefined },
    children,
  );
}
