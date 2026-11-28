import {
  createElement,
  useEffect,
  useRef,
  type KeyboardEvent,
  type PointerEvent,
  type ReactNode,
  type RefObject,
} from 'react';

/** How much of the screen the sheet takes: only its tabs, about half, or all of it. */
export type SheetSnap = 'collapsed' | 'half' | 'full';

export interface SheetTab<T extends string> {
  id: T;
  label: string;
  icon: string;
  /** A count shown on the tab, when above zero (open photo requests). */
  badge?: number;
}

/** Share of the space below the top bar an open sheet takes, at the bottom and at the side. */
const COMPACT_PERCENT = 28;
const OPEN_SHARE = {
  bottom: { half: 0.5, full: 1 },
  side: { half: 0.45, full: 0.8 },
};

/**
 * The CSS size of the sheet at a snap point: its height at the bottom, its width at the side.
 * Collapsed, only the tab bar shows (`--sheet-collapsed` in the stylesheet).
 */
export function sheetSize(snap: SheetSnap, side: boolean, compact = false): string {
  if (snap === 'collapsed') return 'var(--sheet-collapsed)';
  if (compact && !side && snap === 'half') return `${COMPACT_PERCENT}%`;
  return `${OPEN_SHARE[side ? 'side' : 'bottom'][snap] * 100}%`;
}

/** The snap point whose size is closest to `size`, both in pixels, for the end of a drag. */
export function nearestSnap(
  size: number,
  available: number,
  collapsed: number,
  side: boolean,
  compact = false,
): SheetSnap {
  const share = OPEN_SHARE[side ? 'side' : 'bottom'];
  const sizes: [SheetSnap, number][] = [
    ['collapsed', collapsed],
    ['half', available * (compact && !side ? COMPACT_PERCENT / 100 : share.half)],
    ['full', available * share.full],
  ];
  return sizes.reduce((best, next) =>
    Math.abs(next[1] - size) < Math.abs(best[1] - size) ? next : best,
  )[0];
}

/** Pixels a pointer has to travel before a press on the tab bar counts as a drag. */
const DRAG_THRESHOLD = 8;

interface Props<T extends string> {
  tabs: SheetTab<T>[];
  active: T;
  onTab(id: T): void;
  snap: SheetSnap;
  onSnap(snap: SheetSnap): void;
  /** At the right-hand side (a phone held across) instead of at the bottom. */
  side: boolean;
  /** A short, read-only inspector uses a shallower middle snap in portrait. */
  compact?: boolean;
  children: ReactNode;
}

interface Drag {
  pointerId: number;
  /** Pointer position along the drag axis, and the sheet's size, at the press. */
  from: number;
  size: number;
  moved: boolean;
}

/**
 * The phone's panel: a tab bar that is always there and one panel that opens above it (or beside
 * it). A tap on a tab opens its panel, a tap on the open tab or on the arrow closes it, and the
 * bar can be dragged between the snap points. The size while dragging stays in the DOM, so a
 * drag re-renders nothing.
 */
export function Sheet<T extends string>({
  tabs,
  active,
  onTab,
  snap,
  onSnap,
  side,
  compact,
  children,
}: Props<T>) {
  const sheet = useRef<HTMLElement>(null);
  const bar = useRef<HTMLDivElement>(null);
  const drag = useRef<Drag | undefined>(undefined);
  const dragged = useRef(false);
  const open = snap !== 'collapsed';
  const axis = side ? 'width' : 'height';

  // Some mobile browsers scroll the page under a drag in spite of `touch-action: none`.
  useEffect(() => {
    const element = bar.current;
    if (!element) return;
    const hold = (e: TouchEvent) => e.preventDefault();
    element.addEventListener('touchmove', hold, { passive: false });
    return () => element.removeEventListener('touchmove', hold);
  }, []);

  const along = (e: PointerEvent) => (side ? e.clientX : e.clientY);

  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    const element = sheet.current;
    // A second finger does not take over a drag; a press that never became one is replaced.
    if (drag.current?.moved || !element || e.button > 0) return;
    const box = element.getBoundingClientRect();
    drag.current = { pointerId: e.pointerId, from: along(e), size: box[axis], moved: false };
    dragged.current = false;
  };

  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    const element = sheet.current;
    if (!element || d?.pointerId !== e.pointerId) return;
    // A mouse that moves over the bar with no button down is not dragging: its release was
    // missed (outside the window).
    if (e.pointerType === 'mouse' && e.buttons === 0) return finish(e.pointerId);
    // The sheet grows towards the top (or the left): against the pointer's coordinate.
    const delta = d.from - along(e);
    if (!d.moved) {
      if (Math.abs(delta) < DRAG_THRESHOLD) return;
      d.moved = true;
      // Capture only now: a captured press would send the tap to the bar instead of its tab.
      e.currentTarget.setPointerCapture?.(e.pointerId);
      element.classList.add('dragging');
      // The element stops its spring: the finger has the size.
      element.toggleAttribute('dragging', true);
    }
    const available = element.parentElement?.getBoundingClientRect()[axis] ?? Infinity;
    element.style[axis] = `${Math.max(0, Math.min(available, d.size + delta))}px`;
  };

  const finish = (pointerId: number) => {
    const d = drag.current;
    const element = sheet.current;
    if (d?.pointerId !== pointerId) return;
    drag.current = undefined;
    if (!element || !d.moved) return;
    dragged.current = true;
    const size = element.getBoundingClientRect()[axis];
    const available = element.parentElement?.getBoundingClientRect()[axis] ?? size;
    const collapsed = bar.current?.getBoundingClientRect()[axis] ?? 0;
    element.classList.remove('dragging');
    element.style[axis] = '';
    // The element springs from the size the finger left to the snap's (the same snap, too).
    element.toggleAttribute('dragging', false);
    onSnap(nearestSnap(size, available, collapsed, side, compact));
  };

  // The press ends wherever the pointer is released. Until it has become a drag the pointer is
  // not captured, so a release over the panel or outside the sheet never reaches the bar.
  const finishRef = useRef(finish);
  useEffect(() => {
    finishRef.current = finish;
  });
  useEffect(() => {
    const end = (e: globalThis.PointerEvent) => finishRef.current(e.pointerId);
    window.addEventListener('pointerup', end);
    window.addEventListener('pointercancel', end);
    return () => {
      window.removeEventListener('pointerup', end);
      window.removeEventListener('pointercancel', end);
    };
  }, []);

  // The tabs are one stop in the tab order; the arrow keys move between them (Home and End to
  // the first and last), and Enter or Space opens the one in focus.
  const onTabKey = (e: KeyboardEvent<HTMLDivElement>) => {
    const all = [...e.currentTarget.querySelectorAll<HTMLElement>('[role="tab"]')];
    const at = all.indexOf(document.activeElement as HTMLElement);
    const step = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[e.key];
    const next =
      e.key === 'Home'
        ? all[0]
        : e.key === 'End'
          ? all.at(-1)
          : step !== undefined && at >= 0
            ? all[(at + step + all.length) % all.length]
            : undefined;
    if (!next) return;
    e.preventDefault();
    next.focus();
  };

  const select = (id: T) => {
    if (id === active && open) return onSnap('collapsed');
    onTab(id);
    if (!open) onSnap('half');
  };

  return (
    <SheetFrame
      sheet={sheet}
      className={`sheet sheet-${snap}${side ? ' sheet-side' : ''}`}
      snap={snap}
      side={side}
    >
      <div
        ref={bar}
        className="sheet-bar"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        // The click that ends a drag belongs to the drag, not to the tab under the finger.
        onClickCapture={(e) => {
          if (!dragged.current) return;
          dragged.current = false;
          e.stopPropagation();
        }}
      >
        <div
          className="sheet-tabs"
          role="tablist"
          aria-label="Panels"
          aria-orientation={side ? 'vertical' : 'horizontal'}
          onKeyDown={onTabKey}
        >
          {tabs.map((tab) => (
            <button
              key={tab.id}
              type="button"
              role="tab"
              id={`sheet-tab-${tab.id}`}
              aria-selected={tab.id === active}
              aria-controls="sheet-panel"
              tabIndex={tab.id === active ? 0 : -1}
              onClick={() => select(tab.id)}
            >
              <span className="sheet-tab-icon" aria-hidden="true">
                {tab.icon}
              </span>
              {tab.label}{' '}
              {tab.badge !== undefined && tab.badge > 0 && (
                <span className="badge" aria-label={`${tab.badge} open`}>
                  {tab.badge}
                </span>
              )}
            </button>
          ))}
        </div>
        {open && (
          <button
            type="button"
            className="sheet-size"
            aria-label={snap === 'full' ? 'Make the panel smaller' : 'Make the panel larger'}
            title={snap === 'full' ? 'Smaller' : 'Larger'}
            onClick={() => onSnap(snap === 'full' ? 'half' : 'full')}
          >
            <span aria-hidden="true">{snap === 'full' ? '⤡' : '⤢'}</span>
          </button>
        )}
        <button
          type="button"
          className="sheet-toggle"
          aria-expanded={open}
          aria-controls="sheet-panel"
          aria-label={open ? 'Close the panel' : 'Open the panel'}
          title={open ? 'Close the panel' : 'Open the panel'}
          onClick={() => onSnap(open ? 'collapsed' : 'half')}
        >
          <span className="sheet-arrow" aria-hidden="true" />
        </button>
      </div>
      <div
        className="sheet-body"
        role="tabpanel"
        id="sheet-panel"
        aria-labelledby={`sheet-tab-${active}`}
        hidden={!open}
      >
        {children}
      </div>
    </SheetFrame>
  );
}

/**
 * `<sakuga-sheet>` (packages/sakuga-vfx/sheet): the paper and the motion. A new snap springs from the size on
 * screen (the one a drag left, too) to the page's CSS size, and lands with two puffs; the gestures and the tabs
 * stay here (docs/design/hud-v2/visual-design.md V9).
 */
function SheetFrame({
  sheet,
  className,
  snap,
  side,
  children,
}: {
  sheet: RefObject<HTMLElement | null>;
  className: string;
  snap: SheetSnap;
  side: boolean;
  children: ReactNode;
}) {
  return createElement(
    'sakuga-sheet',
    {
      ref: sheet,
      className,
      snap,
      side: side || undefined,
      role: 'region',
      'aria-label': 'Panels',
    },
    children,
  );
}
