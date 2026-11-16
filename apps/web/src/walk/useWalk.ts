import {
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type RefObject,
} from 'react';
import {
  advance,
  combineInputs,
  inputFromKeys,
  inputFromPad,
  look,
  NO_INPUT,
  stride,
  type Figure,
  type WalkInput,
} from './figure';
import type { WalkWorld } from './world';

export interface Walk {
  /** The live figure, updated every frame; the 3D scene reads it without re-rendering React. */
  figureRef: RefObject<Figure>;
  /** The level the figure is on (undefined outdoors); changes rarely, so it is React state. */
  levelId: string | undefined;
  /** The figure as last announced to subscribers. */
  published(): Figure;
  /** Calls `listener` a few times a second while the figure changes. */
  subscribe(listener: () => void): () => void;
  /** Movement pad deflection, each axis from -1 to 1 (y down, as on screen). */
  setPad(x: number, y: number): void;
  /** Turns the view; `dPitch` positive looks up. */
  lookBy(dYaw: number, dPitch: number): void;
  /** Moves by metres relative to where the figure faces. */
  nudge(forward: number, right: number): void;
  setYaw(yaw: number): void;
}

/**
 * The figure as of a moment ago, for a component that shows where it is. Only that component
 * re-renders as the figure moves, not the viewer around it.
 */
export function useFigure(walk: Pick<Walk, 'published' | 'subscribe'>): Figure {
  return useSyncExternalStore(walk.subscribe, walk.published);
}

/** Longest time one frame may stand for, so a slow device still walks at a usable pace. */
const MAX_FRAME_SECONDS = 0.25;
/** How often the React copy of the figure is refreshed while it moves. */
const PUBLISH_INTERVAL_MS = 100;
const WALK_KEYS = new Set([
  'w',
  'a',
  's',
  'd',
  'q',
  'e',
  'arrowup',
  'arrowdown',
  'arrowleft',
  'arrowright',
]);

const isTyping = (target: EventTarget | null) =>
  target instanceof HTMLElement &&
  (target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName));

/**
 * Runs the figure: a frame loop that applies the movement pad and the keyboard while `active`.
 * The loop lives outside the 3D canvas, so it also runs (and is tested) without WebGL.
 */
export function useWalk(world: WalkWorld, start: Figure, active: boolean): Walk {
  const figureRef = useRef(start);
  const [levelId, setLevelId] = useState(start.levelId);
  const announced = useRef(start);
  const listeners = useRef(new Set<() => void>());
  const worldRef = useRef(world);
  const pad = useRef<WalkInput>(NO_INPUT);
  const keys = useRef(new Set<string>());
  const tapped = useRef(new Set<string>());
  useEffect(() => {
    worldRef.current = world;
  }, [world]);

  useEffect(() => {
    if (!active) return;
    let frame = 0;
    let last = performance.now();
    let published = figureRef.current;
    let publishedAt = 0;
    const tick = (now: number) => {
      // A long pause (a hidden tab) must not become one giant stride.
      const dt = Math.min(MAX_FRAME_SECONDS, Math.max(0, (now - last) / 1000));
      last = now;
      // A key tapped between two frames still counts for one.
      const held = new Set([...keys.current, ...tapped.current]);
      tapped.current.clear();
      const input = combineInputs(pad.current, inputFromKeys(held));
      figureRef.current = advance(worldRef.current, figureRef.current, input, dt);
      if (figureRef.current !== published && now - publishedAt >= PUBLISH_INTERVAL_MS) {
        published = figureRef.current;
        publishedAt = now;
        announced.current = published;
        setLevelId(published.levelId);
        for (const listener of listeners.current) listener();
      }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);

    const down = (e: KeyboardEvent) => {
      const key = e.key.toLowerCase();
      if (!WALK_KEYS.has(key) || e.ctrlKey || e.metaKey || e.altKey || isTyping(e.target)) return;
      keys.current.add(key);
      tapped.current.add(key);
      // Arrow keys would scroll the page or move a focused radio button.
      e.preventDefault();
    };
    const up = (e: KeyboardEvent) => keys.current.delete(e.key.toLowerCase());
    const release = () => {
      keys.current.clear();
      pad.current = NO_INPUT;
    };
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    window.addEventListener('blur', release);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
      window.removeEventListener('blur', release);
      release();
    };
  }, [active]);

  const setPad = useCallback((x: number, y: number) => {
    pad.current = inputFromPad(x, y);
  }, []);
  const lookBy = useCallback((dYaw: number, dPitch: number) => {
    figureRef.current = look(figureRef.current, dYaw, dPitch);
  }, []);
  const nudge = useCallback((forward: number, right: number) => {
    figureRef.current = stride(worldRef.current, figureRef.current, forward, right);
  }, []);
  const setYaw = useCallback((yaw: number) => {
    figureRef.current = look({ ...figureRef.current, yaw }, 0, 0);
  }, []);

  const subscribe = useCallback((listener: () => void) => {
    listeners.current.add(listener);
    return () => void listeners.current.delete(listener);
  }, []);
  const published = useCallback(() => announced.current, []);

  return { figureRef, levelId, published, subscribe, setPad, lookBy, nudge, setYaw };
}
