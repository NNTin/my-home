import { createElement, useEffect, useRef } from 'react';
import { useHost, useListeners } from './useElement';

export interface SkSegmentedProps<V extends string> {
  /** The group's name ("Show up to level"). */
  label: string;
  /** `label`: the words shown; `name`: the name read out, when the words are shorter. */
  options: readonly { value: V; label: string; name?: string; disabled?: boolean }[];
  value: V;
  size?: 'compact';
  disabled?: boolean;
  className?: string;
  onChange(value: V): void;
}

/**
 * `<sakuga-segmented>` (packages/sakuga-vfx/segmented, docs/design/hud.md §5.2): one choice of a few short values.
 * `value` is a property: set before the element is on the page it is the first choice; set later from code it moves
 * without effects. A person's pick plays the slide and fires `change`.
 */
export function SkSegmented<V extends string>({
  label,
  options,
  value,
  size,
  disabled,
  className,
  onChange,
}: SkSegmentedProps<V>) {
  const [host, setHost] = useHost<HTMLElement & { value: string }>();
  // The choice is the app's: a pick the app does not take (a mode that falls back, a permission refused) goes back
  // to the app's value once React has had its turn, quietly (#168 PR 7/3).
  const latest = useRef(value);
  useEffect(() => {
    latest.current = value;
  });
  useListeners(host, {
    change: (e) => {
      const next = (e as CustomEvent<{ value: string }>).detail?.value;
      const option = options.find((o) => o.value === next);
      if (option && option.value !== value) onChange(option.value);
      setTimeout(() => {
        if (host && host.value !== latest.current) host.value = latest.current;
      });
    },
  });
  return createElement(
    'sakuga-segmented',
    { ref: setHost, label, size, value, className, disabled: disabled || undefined },
    options.map((o) =>
      createElement(
        'option',
        { key: o.value, value: o.value, label: o.name, disabled: o.disabled },
        o.label,
      ),
    ),
  );
}
