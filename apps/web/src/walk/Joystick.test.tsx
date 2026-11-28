import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { Joystick } from './Joystick';

describe('the movement pad (HUD v2 #202)', () => {
  it('is the control; its knob, sakuga-pad, follows the press and goes back on release', () => {
    const onChange = vi.fn();
    render(<Joystick onChange={onChange} />);
    const pad = screen.getByRole('application', { name: 'Movement pad' });
    pad.getBoundingClientRect = () => ({ left: 0, top: 0, width: 132, height: 132 }) as DOMRect;
    const knob = () => pad.querySelector('sakuga-pad > span') as HTMLElement;
    fireEvent.pointerDown(pad, { pointerId: 1, clientX: 66 + 30, clientY: 66 });
    expect(knob().style.transform).toMatch(/^translate\(30px(, 0px)?\)$/);
    expect(onChange).toHaveBeenLastCalledWith(30 / 44, 0);
    fireEvent.pointerUp(pad, { pointerId: 1 });
    expect(knob().style.transform).toBe('');
    expect(onChange).toHaveBeenLastCalledWith(0, 0);
  });
});
