import { fireEvent, render, screen } from '@testing-library/react';
import { createRef } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { yawFromCompass } from '../walk/figure';
import { CompassRose, turnRose } from './Compass';

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

  it('follows a first-person view: north on the rose points to true north on screen', () => {
    const roseRef = createRef<HTMLButtonElement>();
    render(<CompassRose roseRef={roseRef} onNorthUp={() => {}} />);
    const rose = { ref: roseRef, northBearing: 20 };
    const turned = () => roseRef.current!.style.getPropertyValue('--rose');

    // Looking true north: N is at the top. Looking east: N is to the left (a quarter turn back).
    turnRose(rose, yawFromCompass(0, 20));
    expect(parseFloat(turned())).toBeCloseTo(0);
    turnRose(rose, yawFromCompass(90, 20));
    expect(parseFloat(turned())).toBeCloseTo(-90);
    turnRose(rose, yawFromCompass(270, 20));
    expect(parseFloat(turned())).toBeCloseTo(90);
    // Looking along the plan's -z (yaw 0), north is 20° clockwise of straight ahead.
    turnRose(rose, 0);
    expect(parseFloat(turned())).toBeCloseTo(20);
  });
});
