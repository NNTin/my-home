import { useSyncExternalStore } from 'react';
import { perfRequested } from './PerfReadout';

/**
 * The performance readout, on or off (HUD v2 #203: a diagnostic in Tools). It starts from the address (`?perf=1`, what
 * the smokes and the owner's links use) and a change writes the address back, so a reload keeps it.
 */
const listeners = new Set<() => void>();

// Read from the address every time: an in-app navigation to `?perf=1` turns it on too (#217 review).
const read = () => perfRequested();

export function setPerfShown(next: boolean): void {
  const url = new URL(window.location.href);
  if (next) url.searchParams.set('perf', '1');
  else url.searchParams.delete('perf');
  window.history.replaceState(window.history.state, '', url);
  for (const listener of listeners) listener();
}

export function usePerfShown(): boolean {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      window.addEventListener('popstate', listener);
      return () => {
        listeners.delete(listener);
        window.removeEventListener('popstate', listener);
      };
    },
    read,
    read,
  );
}
