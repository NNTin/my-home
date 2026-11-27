import { createElement } from 'react';
import { useHost, useListeners, useProperties } from './useElement';

export interface SkTab {
  value: string;
  label: string;
}

export interface SkTabsProps {
  /** What a screen reader calls the tab list. */
  label: string;
  tabs: readonly SkTab[];
  value: string;
  className?: string;
  onChange(value: string): void;
}

/** `<sakuga-tabs>` (packages/sakuga-vfx/tabs). It draws the tabs only: show the panel on `onChange`. */
export function SkTabs({ label, tabs, value, className, onChange }: SkTabsProps) {
  const [host, setHost] = useHost<HTMLElement & { selected: number }>();
  const selected = Math.max(
    0,
    tabs.findIndex((tab) => tab.value === value),
  );
  useProperties(host, { selected });
  useListeners(host, {
    change: (event) => onChange((event as CustomEvent<{ value: string }>).detail.value),
  });
  return createElement(
    'sakuga-tabs',
    { ref: setHost, label, selected, className },
    tabs.map((tab) => createElement('option', { key: tab.value, value: tab.value }, tab.label)),
  );
}
