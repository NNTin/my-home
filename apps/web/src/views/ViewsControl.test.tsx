import { HomeModel } from '@my-home/shared';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import realHomeJson from '../../../../data/homes/home.json';
import { buildHome } from '../builder/buildHome';
import { sectionRange, type NamedView } from './named';
import { ViewsControl } from './ViewsControl';

const home = buildHome(HomeModel.parse(structuredClone(realHomeJson)));

function show(view?: NamedView, saving = false) {
  const onView = vi.fn();
  const onBackdrop = vi.fn();
  const onSave = vi.fn();
  render(
    <ViewsControl
      scene={home}
      view={view}
      onView={onView}
      backdrop={view ? 'studio-light' : 'sky'}
      onBackdrop={onBackdrop}
      levelId="ground-floor"
      onSave={onSave}
      saving={saving}
    />,
  );
  const group = within(screen.getByRole('group', { name: 'Views' }));
  return { onView, onBackdrop, onSave, group };
}

describe('the Views control', () => {
  it('opens each named view with its defaults; the cutaway on the level looked into', () => {
    const { onView, group } = show();
    expect(group.getByRole('button', { name: 'Free' })).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(group.getByRole('button', { name: 'Cutaway' }));
    expect(onView).toHaveBeenLastCalledWith({ kind: 'cutaway', levelId: 'ground-floor' });
    fireEvent.click(group.getByRole('button', { name: 'Section' }));
    expect(onView).toHaveBeenLastCalledWith({
      kind: 'section',
      look: 'north',
      at: sectionRange(home, 'north').depth / 2,
    });
    fireEvent.click(group.getByRole('button', { name: 'Eye level' }));
    expect(onView).toHaveBeenLastCalledWith(
      expect.objectContaining({ kind: 'eye', roomId: 'souterrain-stair-hall' }),
    );
  });

  it('"Free" goes back to the free view', () => {
    const { onView, group } = show({ kind: 'cutaway', levelId: 'souterrain' });
    expect(group.getByRole('button', { name: 'Cutaway' })).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(group.getByRole('button', { name: 'Free' }));
    expect(onView).toHaveBeenLastCalledWith(undefined);
  });

  it('a cutaway chooses its level', () => {
    const cutaway = show({ kind: 'cutaway', levelId: 'souterrain' });
    fireEvent.change(cutaway.group.getByLabelText('Level'), { target: { value: 'first-floor' } });
    expect(cutaway.onView).toHaveBeenLastCalledWith({ kind: 'cutaway', levelId: 'first-floor' });
    cutaway.group.getByLabelText('Backdrop');
  });

  it('the eye chooses its room among those modelled inside', () => {
    const { onView, group } = show({ kind: 'eye', roomId: 'souterrain-kitchen', look: 10 });
    const rooms = within(group.getByLabelText('Room')).getAllByRole('option');
    expect(rooms.map((o) => o.textContent)).not.toContain('Ground floor');
    expect(rooms.length).toBe(8);
    fireEvent.change(group.getByLabelText('Room'), { target: { value: 'souterrain-bed-room' } });
    expect(onView).toHaveBeenLastCalledWith(
      expect.objectContaining({ kind: 'eye', roomId: 'souterrain-bed-room' }),
    );
  });

  it('a section chooses where it looks and moves its cut with a slider', () => {
    const { onView, group } = show({ kind: 'section', look: 'north', at: 2 });
    const slider = group.getByLabelText(/Cut at/);
    expect(slider).toHaveAttribute('min', '0');
    expect(Number(slider.getAttribute('max'))).toBeCloseTo(sectionRange(home, 'north').depth);
    expect(slider).toHaveAttribute('aria-valuetext', '2.00 m');
    fireEvent.change(slider, { target: { value: '3.5' } });
    expect(onView).toHaveBeenLastCalledWith({ kind: 'section', look: 'north', at: 3.5 });
    // Turning the look keeps the cut the same share of the way through the house.
    fireEvent.change(group.getByLabelText('Looking'), { target: { value: 'east' } });
    const turned = onView.mock.lastCall![0] as Extract<NamedView, { kind: 'section' }>;
    expect(turned.look).toBe('east');
    expect(turned.at / sectionRange(home, 'east').depth).toBeCloseTo(
      2 / sectionRange(home, 'north').depth,
    );
  });

  it('chooses the backdrop', () => {
    const { onBackdrop, group } = show();
    const backdrop = group.getByLabelText('Backdrop');
    expect(backdrop).toHaveValue('sky');
    expect(
      within(backdrop)
        .getAllByRole('option')
        .map((o) => o.textContent),
    ).toEqual(['Sky', 'Studio, light', 'Studio, dark']);
    fireEvent.change(backdrop, { target: { value: 'studio-dark' } });
    expect(onBackdrop).toHaveBeenLastCalledWith('studio-dark');
  });

  it('"Save image" saves the view, and waits while one is being drawn', () => {
    const idle = show();
    fireEvent.click(idle.group.getByRole('button', { name: 'Save image' }));
    expect(idle.onSave).toHaveBeenCalledTimes(1);
    cleanup();
    const busy = show({ kind: 'cutaway', levelId: 'souterrain' }, true);
    expect(busy.group.getByRole('button', { name: 'Saving…' })).toBeDisabled();
  });
});
