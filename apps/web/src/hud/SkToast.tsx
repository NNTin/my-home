import { createElement, useImperativeHandle, type Ref } from 'react';
import { useHost } from './useElement';

interface ToastElement extends HTMLElement {
  show(text?: string): void;
  hide(): void;
}

export interface SkToastHandle {
  show(text: string): void;
  hide(): void;
}

export interface SkToastProps {
  /** Seconds it stays. */
  duration?: number;
  className?: string;
  ref?: Ref<SkToastHandle>;
}

/** `<sakuga-toast>` (packages/sakuga-vfx/toast): its message is in a `role="status"` region. */
export function SkToast({ duration, className, ref }: SkToastProps) {
  const [host, setHost] = useHost<ToastElement>();
  useImperativeHandle(ref, () => ({ show: (text) => host?.show(text), hide: () => host?.hide() }), [
    host,
  ]);
  return createElement('sakuga-toast', { ref: setHost, duration, className });
}
