import { createElement } from 'react';
import { useHost, useListeners, useProperties } from './useElement';

export interface SkInputProps {
  /** Its accessible name. */
  label: string;
  value: string;
  type?: 'text' | 'search' | 'email' | 'url' | 'tel' | 'password';
  placeholder?: string;
  disabled?: boolean;
  className?: string;
  onInput(value: string): void;
}

/** `<sakuga-input>` (packages/sakuga-vfx/input): one line of text, dust where the caret is. */
export function SkInput({
  label,
  value,
  type,
  placeholder,
  disabled,
  className,
  onInput,
}: SkInputProps) {
  const [host, setHost] = useHost<HTMLElement & { value: string }>();
  useProperties(host, { value });
  useListeners(host, { input: () => host && onInput(host.value) });
  return createElement('sakuga-input', {
    ref: setHost,
    label,
    type,
    placeholder,
    className,
    disabled: disabled || undefined,
  });
}
