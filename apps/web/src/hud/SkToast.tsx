import { createElement, useEffect, useImperativeHandle, type Ref } from 'react';
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
  /** `warn`: a pink !, a pink shadow, and its message is an alert. */
  kind?: 'warn';
  className?: string;
  ref?: Ref<SkToastHandle>;
}

/** `<sakuga-toast>` (packages/sakuga-vfx/toast): its message is in a `role="status"` region (`alert` when it warns). */
export function SkToast({ duration, kind, className, ref }: SkToastProps) {
  const [host, setHost] = useHost<ToastElement>();
  useImperativeHandle(ref, () => ({ show: (text) => host?.show(text), hide: () => host?.hide() }), [
    host,
  ]);
  return createElement('sakuga-toast', { ref: setHost, duration, kind, className });
}

/**
 * A warning that streaks in whenever `message` becomes one (docs/design/hud.md §4.3: the app's toasts are warnings),
 * and leaves by shrinking after `duration` seconds.
 */
export function SkNotice({
  message,
  duration,
  className,
}: {
  message: string | undefined;
  duration?: number;
  className?: string;
}) {
  const [host, setHost] = useHost<ToastElement>();
  // Also once the element is there: a message may come with the first render.
  useEffect(() => {
    if (message) host?.show(message);
  }, [message, host]);
  return createElement('sakuga-toast', { ref: setHost, kind: 'warn', duration, className });
}
