import { createElement, type ReactNode } from 'react';

export interface SkMapProps {
  /** Large over the view; small in its corner. A change springs the frame between the two. */
  large: boolean;
  className?: string;
  children?: ReactNode;
  /** The element, for `placed(x, y)` (a ring and ポン where something was put on the map). */
  hostRef?: (el: HTMLElement | null) => void;
}

/** `<sakuga-map>` (packages/sakuga-vfx/map, HUD v2 #202): the frame of the minimap; the map is the app's. */
export function SkMap({ large, className, children, hostRef }: SkMapProps) {
  return createElement(
    'sakuga-map',
    { ref: hostRef, className, large: large || undefined },
    children,
  );
}

/** Plays the element's placement beat at a point of the page, where Sakuga is there. */
export function mapPlaced(el: HTMLElement | null, x: number, y: number) {
  (el as (HTMLElement & { placed?(x: number, y: number): void }) | null)?.placed?.(x, y);
}
