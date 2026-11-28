// The HUD's wrappers (docs/design/hud.md §7.2) on the plain stand-ins of fallback.ts (§7.5), as every jsdom test
// sees them: found by role and name, driven by touch and keys, and a value from code dispatches nothing.
import { act, fireEvent, render, screen } from '@testing-library/react';
import { createRef } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { FALLBACKS, installFallback } from './fallback';
import { SkBadge } from './SkBadge';
import { SkButton, type SkButtonHandle } from './SkButton';
import { SkCard } from './SkCard';
import { SkCheckbox } from './SkCheckbox';
import { SkFold } from './SkFold';
import { SkIconButton } from './SkIconButton';
import { SkInput } from './SkInput';
import { SkPanel } from './SkPanel';
import { SkSegmented } from './SkSegmented';
import { SkSlider } from './SkSlider';
import { SkTabs } from './SkTabs';
import { SkNotice, SkToast, type SkToastHandle } from './SkToast';

describe('the fallback', () => {
  it('stands in for every HUD tag, and leaves a defined one alone', () => {
    for (const tag of Object.keys(FALLBACKS)) expect(customElements.get(tag), tag).toBeDefined();
    expect(installFallback()).toEqual([]);
  });
});

describe('SkButton, made here: label, pressed, href', () => {
  afterEach(() => window.history.replaceState(null, '', '/'));

  it('is named by its label when the text is shorter, and is a toggle when given pressed', () => {
    const { rerender } = render(
      <SkButton aria-label="Photos (3)" pressed={false}>
        Photos
      </SkButton>,
    );
    expect(screen.getByRole('button', { name: 'Photos (3)' })).toHaveAttribute(
      'aria-pressed',
      'false',
    );
    rerender(
      <SkButton aria-label="Photos (3)" pressed>
        Photos
      </SkButton>,
    );
    expect(screen.getByRole('button', { name: 'Photos (3)' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
  });

  it('is a plain button, not a toggle, without pressed', () => {
    render(<SkButton>Walk</SkButton>);
    expect(screen.getByRole('button', { name: 'Walk' })).not.toHaveAttribute('aria-pressed');
  });

  it('with href is a link, and a plain click goes through the router', () => {
    render(
      <SkButton variant="secondary" href="/catalog">
        Catalogue
      </SkButton>,
    );
    fireEvent.click(screen.getByRole('link', { name: 'Catalogue' }));
    expect(window.location.pathname).toBe('/catalog');
  });
});

describe('SkIconButton', () => {
  afterEach(() => window.history.replaceState(null, '', '/'));

  it('is a button named by its label, its icon decoration', () => {
    const onClick = vi.fn();
    render(<SkIconButton label="Rotate left" icon="rotate-left" dir="ccw" onClick={onClick} />);
    const button = screen.getByRole('button', { name: 'Rotate left' });
    fireEvent.click(button);
    fireEvent.keyDown(button, { key: 'Enter' });
    expect(onClick).toHaveBeenCalledTimes(2);
  });

  it('is a toggle with pressed, and a link with href', () => {
    render(
      <>
        <SkIconButton label="Photos on the map" icon="photos" pressed />
        <SkIconButton label="Catalogue" icon="catalogue" href="/catalog" />
      </>,
    );
    expect(screen.getByRole('button', { name: 'Photos on the map' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    fireEvent.click(screen.getByRole('link', { name: 'Catalogue' }));
    expect(window.location.pathname).toBe('/catalog');
  });
});

describe('the clear appearance (HUD v2, #199)', () => {
  it('reaches the elements as attributes; the control and its name stay', () => {
    render(
      <>
        <SkIconButton
          label="Views"
          icon="view"
          size="compact"
          appearance="clear"
          tone="light"
          backing
        />
        <SkButton size="compact" appearance="clear">
          Walk
        </SkButton>
      </>,
    );
    const views = screen.getByRole('button', { name: 'Views' });
    expect(views).toHaveAttribute('appearance', 'clear');
    expect(views).toHaveAttribute('tone', 'light');
    expect(views).toHaveAttribute('backing');
    expect(screen.getByRole('button', { name: 'Walk' })).toHaveAttribute('appearance', 'clear');
  });
});

describe('SkBadge', () => {
  it('is a status while shown, gone while not, and an alert when it warns', () => {
    const { rerender } = render(<SkBadge shown={false}>Saving…</SkBadge>);
    expect(screen.queryByRole('status')).toBeNull();
    rerender(<SkBadge shown>Saving…</SkBadge>);
    expect(screen.getByRole('status')).toHaveTextContent('Saving…');
    rerender(
      <SkBadge shown kind="warn">
        Offline: changes kept on this phone
      </SkBadge>,
    );
    expect(screen.getByRole('alert')).toHaveTextContent('Offline');
  });

  it("keeps the page's role and name, and its data attributes", () => {
    render(
      <SkBadge shown role="status" aria-label="Status" data-render="x">
        Saved
      </SkBadge>,
    );
    expect(screen.getByRole('status', { name: 'Status' })).toHaveAttribute('data-render', 'x');
  });

  it('a count is decoration without a label', () => {
    render(<SkBadge shown count={3} />);
    expect(screen.queryByRole('img')).toBeNull();
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
    // Hidden while it says nothing, as the element's toast is.
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('is an alert when it warns: SkNotice shows each new message', () => {
    const { rerender } = render(<SkNotice message={undefined} />);
    expect(screen.queryByRole('alert')).toBeNull();
    rerender(<SkNotice message="The image could not be saved" />);
    expect(screen.getByRole('alert')).toHaveTextContent('The image could not be saved');
  });
});

describe('the containers (HUD v2, #200)', () => {
  afterEach(() => window.history.replaceState(null, '', '/'));

  it('SkPanel is a region named by its label, a note complementary; arriving, it is shown after its first render', () => {
    render(
      <>
        <SkPanel label="Photos" arrive>
          <p>Six photos</p>
        </SkPanel>
        <SkPanel label="Perf readout" kind="note" />
      </>,
    );
    expect(screen.getByRole('region', { name: 'Photos' })).toHaveTextContent('Six photos');
    expect(screen.getByRole('complementary', { name: 'Perf readout' })).toBeInTheDocument();
  });

  it('SkFold is a group named by its title; its summary opens and closes it', () => {
    const onClick = vi.fn();
    render(
      <SkFold title="Outdoor" note="4 of 4 shown">
        <SkButton onClick={onClick}>Hide all</SkButton>
      </SkFold>,
    );
    const fold = screen.getByRole('group', { name: 'Outdoor' });
    expect(fold).not.toHaveAttribute('open');
    expect(fold).toHaveTextContent('4 of 4 shown');
    const summary = screen.getByRole('button', { name: 'Outdoor' });
    expect(summary).toHaveAttribute('aria-expanded', 'false');
    fireEvent.click(summary);
    expect(fold).toHaveAttribute('open');
    expect(summary).toHaveAttribute('aria-expanded', 'true');
    // A click in its body is the body's.
    fireEvent.click(screen.getByRole('button', { name: 'Hide all' }));
    expect(onClick).toHaveBeenCalledTimes(1);
    expect(fold).toHaveAttribute('open');
    fireEvent.keyDown(summary, { key: 'Enter' });
    expect(fold).not.toHaveAttribute('open');
  });

  it('SkCard is a link named by its label and described, its click through the router; else a toggle button', () => {
    const onClick = vi.fn();
    render(
      <>
        <SkCard href="/catalog/furniture/bed" label="Bed, 1 use" description="A double bed">
          Bed
        </SkCard>
        <SkCard label="Armchair" selected={false} onClick={onClick}>
          Armchair
        </SkCard>
      </>,
    );
    const bed = screen.getByRole('link', { name: 'Bed, 1 use' });
    expect(bed).toHaveAccessibleDescription('A double bed');
    fireEvent.click(bed);
    expect(window.location.pathname).toBe('/catalog/furniture/bed');
    const armchair = screen.getByRole('button', { name: 'Armchair' });
    expect(armchair).toHaveAttribute('aria-pressed', 'false');
    fireEvent.click(armchair);
    expect(onClick).toHaveBeenCalledTimes(1);
  });
});

describe('SkSegmented: the app owns the choice (#168 PR 7/3)', () => {
  it('goes back to the app’s value when the app does not take a pick', async () => {
    const onChange = vi.fn();
    render(
      <SkSegmented
        label="Camera mode"
        options={[
          { value: 'sensors', label: 'Sensors' },
          { value: 'manual', label: 'Manual' },
        ]}
        value="manual"
        onChange={onChange}
      />,
    );
    fireEvent.click(screen.getByRole('radio', { name: 'Sensors' }));
    expect(onChange).toHaveBeenCalledWith('sensors');
    // The app kept Manual (a permission refused): the switch shows it again.
    await act(() => new Promise((r) => setTimeout(r, 0)));
    expect(screen.getByRole('radio', { name: 'Manual' })).toHaveAttribute('aria-checked', 'true');
  });
});

describe('SkButton as a disclosure (#168 PR 7/3)', () => {
  it('says aria-expanded, not aria-pressed', () => {
    const { rerender } = render(
      <SkButton expanded={false} onClick={() => {}}>
        More
      </SkButton>,
    );
    const button = screen.getByRole('button', { name: 'More' });
    expect(button).toHaveAttribute('aria-expanded', 'false');
    expect(button).not.toHaveAttribute('aria-pressed');
    rerender(
      <SkButton expanded onClick={() => {}}>
        More
      </SkButton>,
    );
    expect(button).toHaveAttribute('aria-expanded', 'true');
  });
});
