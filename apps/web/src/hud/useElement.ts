import { useEffect, useLayoutEffect, useRef, useState } from 'react';

/**
 * How a wrapper drives its element (docs/design/hud.md §7.2): values are properties set through a ref, so a value
 * set from code never plays the reaction (upstream's rule: "from code: no effects"), and events are listened to
 * with `addEventListener`, never through React's names for them. A wrapper never sets React state per frame.
 */

/** The element once it is on the page: pass the setter as its `ref`. */
export function useHost<T extends HTMLElement>() {
  return useState<T | null>(null);
}

/** Sets each value as a property of the element, when it differs from the element's own. */
export function useProperties(host: HTMLElement | null, values: Record<string, unknown>) {
  useLayoutEffect(() => {
    if (!host) return;
    for (const [name, value] of Object.entries(values))
      if (value !== undefined && Reflect.get(host, name) !== value) Reflect.set(host, name, value);
  });
}

type Listeners = Record<string, ((event: Event) => void) | undefined>;

/** Listens to the element's events; the handlers may change on every render without listening again. */
export function useListeners(host: HTMLElement | null, listeners: Listeners) {
  const latest = useRef(listeners);
  useLayoutEffect(() => {
    latest.current = listeners;
  });
  const types = Object.keys(listeners)
    .filter((type) => listeners[type])
    .join(' ');
  useEffect(() => {
    if (!host || !types) return;
    const bound = types.split(' ').map((type) => {
      const listener = (event: Event) => latest.current[type]?.(event);
      host.addEventListener(type, listener);
      return () => host.removeEventListener(type, listener);
    });
    return () => bound.forEach((off) => off());
  }, [host, types]);
}
