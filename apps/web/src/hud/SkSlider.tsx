import { createElement } from 'react';
import { useHost, useListeners, useProperties } from './useElement';

export interface SkSliderProps {
  /** Its accessible name. */
  label: string;
  value: number;
  min?: number;
  max?: number;
  step?: number;
  /** Shown after the number in the bubble (`" m"`, `"%"`). */
  unit?: string;
  disabled?: boolean;
  className?: string;
  /** While it moves. */
  onInput?(value: number): void;
  /** When it is let go. */
  onChange?(value: number): void;
}

/** `<sakuga-slider>` (packages/sakuga-vfx/slider): a real range input underneath. */
export function SkSlider({
  label,
  value,
  min,
  max,
  step,
  unit,
  disabled,
  className,
  onInput,
  onChange,
}: SkSliderProps) {
  const [host, setHost] = useHost<HTMLElement & { value: string; valueAsNumber: number }>();
  // Compared as the element holds it: a string.
  useProperties(host, { value: String(value) });
  useListeners(host, {
    input: onInput && (() => host && onInput(host.valueAsNumber)),
    change: onChange && (() => host && onChange(host.valueAsNumber)),
  });
  return createElement('sakuga-slider', {
    ref: setHost,
    label,
    min,
    max,
    step,
    unit,
    value: String(value),
    className,
    disabled: disabled || undefined,
  });
}
