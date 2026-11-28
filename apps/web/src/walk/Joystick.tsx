import { createElement, useRef, type PointerEvent } from 'react';

interface Props {
  /** Deflection, each axis from -1 to 1; y grows downwards, as on screen. (0, 0) on release. */
  onChange(x: number, y: number): void;
}

/** Knob travel in px, and the part around the centre that counts as "not touched". */
const TRAVEL = 44;
const DEAD_ZONE = 0.12;

/** `<sakuga-pad>`'s knob, moved by the page (packages/sakuga-vfx/pad). */
type Pad = HTMLElement & { move?(dx: number, dy: number, pressed: boolean): void };

/**
 * The on-screen movement pad: a knob dragged with a thumb or the mouse. It keeps following the
 * pointer that grabbed it, also outside the pad, until that pointer is lifted. The control is this
 * element; its look and motion are `<sakuga-pad>`'s (HUD v2 #202), told where the knob is.
 */
export function Joystick({ onChange }: Props) {
  const pointer = useRef<number | undefined>(undefined);
  const pad = useRef<Pad | null>(null);
  const setKnob = ([dx, dy]: [number, number], pressed: boolean) =>
    pad.current?.move?.(dx, dy, pressed);

  const move = (e: PointerEvent<HTMLDivElement>) => {
    const box = e.currentTarget.getBoundingClientRect();
    let dx = e.clientX - (box.left + box.width / 2);
    let dy = e.clientY - (box.top + box.height / 2);
    const distance = Math.hypot(dx, dy);
    if (distance > TRAVEL) {
      dx *= TRAVEL / distance;
      dy *= TRAVEL / distance;
    }
    setKnob([dx, dy], true);
    const [x, y] = [dx / TRAVEL, dy / TRAVEL];
    if (Math.hypot(x, y) < DEAD_ZONE) onChange(0, 0);
    else onChange(x, y);
  };
  const release = (e: PointerEvent<HTMLDivElement>) => {
    if (pointer.current !== e.pointerId) return;
    pointer.current = undefined;
    setKnob([0, 0], false);
    onChange(0, 0);
  };

  return (
    <div
      className="joystick"
      role="application"
      aria-label="Movement pad"
      onPointerDown={(e) => {
        if (pointer.current !== undefined) return;
        pointer.current = e.pointerId;
        e.currentTarget.setPointerCapture?.(e.pointerId);
        move(e);
      }}
      onPointerMove={(e) => {
        if (pointer.current === e.pointerId) move(e);
      }}
      onPointerUp={release}
      onPointerCancel={release}
    >
      {createElement('sakuga-pad', { ref: pad, travel: TRAVEL, 'aria-hidden': 'true' })}
    </div>
  );
}
