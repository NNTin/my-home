// The HUD's wrappers (docs/design/hud.md §7.2) on the plain stand-ins of fallback.ts (§7.5), as every jsdom test
// sees them: found by role and name, driven by touch and keys, and a value from code dispatches nothing.
import { act, fireEvent, render, screen } from '@testing-library/react';
import { createRef } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { FALLBACKS, installFallback } from './fallback';
import { SkButton, type SkButtonHandle } from './SkButton';
import { SkCheckbox } from './SkCheckbox';
import { SkInput } from './SkInput';
import { SkSlider } from './SkSlider';
import { SkTabs } from './SkTabs';
import { SkToast, type SkToastHandle } from './SkToast';

describe('the fallback', () => {
  it('stands in for every HUD tag, and leaves a defined one alone', () => {
    for (const tag of Object.keys(FALLBACKS)) expect(customElements.get(tag), tag).toBeDefined();
    expect(installFallback()).toEqual([]);
  });
});

describe('SkButton', () => {
  it('is a button named by its label, clicked by pointer, Space and Enter', () => {
    const onClick = vi.fn();
    const done = createRef<SkButtonHandle>();
    render(
      <SkButton className="walk" onClick={onClick} ref={done}>
        Walk
      </SkButton>,
    );
    const button = screen.getByRole('button', { name: 'Walk' });
    expect(button).toHaveClass('walk');
    fireEvent.click(button);
    fireEvent.keyDown(button, { key: ' ' });
    fireEvent.keyDown(button, { key: 'Enter' });
    expect(onClick).toHaveBeenCalledTimes(3);
    expect(() => done.current?.done()).not.toThrow();
  });

  it('does nothing while disabled', () => {
    const onClick = vi.fn();
    render(
      <SkButton disabled onClick={onClick}>
        Walk
      </SkButton>,
    );
    const button = screen.getByRole('button', { name: 'Walk' });
    expect(button).toHaveAttribute('aria-disabled', 'true');
    fireEvent.click(button);
    expect(onClick).not.toHaveBeenCalled();
  });
});

describe('SkCheckbox', () => {
  it('ticks by click and Space, and says so; checked from code dispatches nothing', () => {
    const onChange = vi.fn();
    const { rerender } = render(
      <SkCheckbox checked={false} onChange={onChange}>
        Terrain
      </SkCheckbox>,
    );
    const box = screen.getByRole('checkbox', { name: 'Terrain' });
    fireEvent.click(box);
    expect(onChange).toHaveBeenLastCalledWith(true);
    fireEvent.keyDown(box, { key: ' ' });
    expect(onChange).toHaveBeenLastCalledWith(false);
    rerender(
      <SkCheckbox checked onChange={onChange}>
        Terrain
      </SkCheckbox>,
    );
    expect(box).toBeChecked();
    expect(onChange).toHaveBeenCalledTimes(2);
  });
});

describe('SkSlider', () => {
  it('is a slider named by its label; the arrow keys move it by its step', () => {
    const onChange = vi.fn();
    render(
      <SkSlider
        label="Cut at"
        value={1.2}
        min={0}
        max={3}
        step={0.05}
        unit=" m"
        onChange={onChange}
      />,
    );
    const slider = screen.getByRole('slider', { name: 'Cut at' });
    expect(slider).toHaveAttribute('aria-valuenow', '1.2');
    fireEvent.keyDown(slider, { key: 'ArrowRight' });
    expect(onChange).toHaveBeenLastCalledWith(1.25);
    fireEvent.keyDown(slider, { key: 'End' });
    expect(onChange).toHaveBeenLastCalledWith(3);
  });
});

describe('SkInput', () => {
  it('is a text box named by its label, its value set from code', () => {
    const onInput = vi.fn();
    const { rerender } = render(
      <SkInput label="Search the catalogue" type="search" value="" onInput={onInput} />,
    );
    const input = screen.getByRole('searchbox', { name: 'Search the catalogue' });
    fireEvent.input(input, { target: { value: 'sofa' } });
    expect(onInput).toHaveBeenLastCalledWith('sofa');
    rerender(<SkInput label="Search the catalogue" type="search" value="bed" onInput={onInput} />);
    expect(input).toHaveValue('bed');
    expect(onInput).toHaveBeenCalledTimes(1);
  });
});

describe('SkTabs', () => {
  const tabs = [
    { value: 'photos', label: 'Photos' },
    { value: 'requests', label: 'Requests' },
  ];

  it('is a tab list; click and the arrow keys choose; the value from code moves it quietly', async () => {
    const onChange = vi.fn();
    const { rerender } = render(
      <SkTabs label="Photos panel" tabs={tabs} value="photos" onChange={onChange} />,
    );
    expect(screen.getByRole('tablist', { name: 'Photos panel' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Photos' })).toHaveAttribute('aria-selected', 'true');
    fireEvent.click(screen.getByRole('tab', { name: 'Requests' }));
    expect(onChange).toHaveBeenLastCalledWith('requests');
    fireEvent.keyDown(screen.getByRole('tab', { name: 'Requests' }), { key: 'ArrowRight' });
    expect(onChange).toHaveBeenLastCalledWith('photos');
    rerender(<SkTabs label="Photos panel" tabs={tabs} value="requests" onChange={onChange} />);
    expect(screen.getByRole('tab', { name: 'Requests' })).toHaveAttribute('aria-selected', 'true');
    expect(onChange).toHaveBeenCalledTimes(2);
    // Tabs that change are read again.
    rerender(
      <SkTabs
        label="Photos panel"
        tabs={[...tabs, { value: 'map', label: 'Map' }]}
        value="requests"
        onChange={onChange}
      />,
    );
    await act(async () => {});
    expect(screen.getAllByRole('tab')).toHaveLength(3);
  });
});

describe('SkToast', () => {
  it('shows its message in a status region, and hides', () => {
    const toast = createRef<SkToastHandle>();
    render(<SkToast ref={toast} />);
    act(() => toast.current?.show('Not found in this home'));
    expect(screen.getByRole('status')).toHaveTextContent('Not found in this home');
    act(() => toast.current?.hide());
    expect(screen.getByRole('status')).toHaveTextContent('');
  });
});
