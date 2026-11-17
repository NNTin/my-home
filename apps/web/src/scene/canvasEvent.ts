/**
 * Whether a pointer event was made on the canvas itself. R3F listens on the element around the
 * canvas, so an event on DOM that floats over the 3D view (the furniture toolbar) reaches the
 * scene as well: without this check a tap on a toolbar button would also count as a tap on
 * whatever lies behind it, or on nothing, which clears the selection.
 */
export const onCanvas = (event: Event) => event.target instanceof HTMLCanvasElement;

/**
 * Makes the release of the current press count for nothing. A long press opens a panel, which
 * may slide in under the finger: lifting the finger must not tap what has appeared there. The
 * next press ends it, in case no click came.
 */
export function swallowNextClick() {
  const swallow = (event: Event) => {
    event.stopPropagation();
    event.preventDefault();
  };
  window.addEventListener('click', swallow, { capture: true, once: true });
  window.addEventListener(
    'pointerdown',
    () => window.removeEventListener('click', swallow, { capture: true }),
    { capture: true, once: true },
  );
}
