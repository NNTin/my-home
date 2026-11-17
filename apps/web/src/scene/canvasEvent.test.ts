import { afterEach, describe, expect, it, vi } from 'vitest';
import { onCanvas, swallowNextClick } from './canvasEvent';

describe('onCanvas', () => {
  it('tells an event on the canvas from one on DOM floating over it', () => {
    const canvas = document.createElement('canvas');
    const button = document.createElement('button');
    document.body.append(canvas, button);
    const seen: boolean[] = [];
    const listen = (e: Event) => seen.push(onCanvas(e));
    document.body.addEventListener('click', listen);
    canvas.click();
    button.click();
    document.body.removeEventListener('click', listen);
    canvas.remove();
    button.remove();
    expect(seen).toEqual([true, false]);
  });
});

describe('swallowNextClick', () => {
  const button = document.createElement('button');
  const onClick = vi.fn();
  button.addEventListener('click', onClick);
  document.body.append(button);
  afterEach(() => onClick.mockClear());

  it('swallows the one click that ends the press', () => {
    swallowNextClick();
    button.click();
    expect(onClick).not.toHaveBeenCalled();
    button.click();
    expect(onClick).toHaveBeenCalledOnce();
  });

  it('lets go when the next press begins without a click in between', () => {
    swallowNextClick();
    button.dispatchEvent(new Event('pointerdown', { bubbles: true }));
    button.click();
    expect(onClick).toHaveBeenCalledOnce();
  });
});
