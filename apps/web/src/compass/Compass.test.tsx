import { fireEvent, render, screen } from '@testing-library/react';
import { createRef } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { CompassRose } from './Compass';

describe('CompassRose', () => {
  it('shows N/E/S/W and turns the view north-up on click', () => {
    const onNorthUp = vi.fn();
    const roseRef = createRef<HTMLButtonElement>();
    render(<CompassRose roseRef={roseRef} onNorthUp={onNorthUp} />);
    const button = screen.getByRole('button', { name: 'Compass: turn the view north-up' });
    expect(button.textContent).toBe('NESW');
    expect(roseRef.current).toBe(button);
    fireEvent.click(button);
    expect(onNorthUp).toHaveBeenCalledOnce();
  });
});
