import { fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { pointerEvent } from '../test/screen';
import { nearestSnap, Sheet, sheetSize, type SheetSnap } from './Sheet';

type Tab = 'view' | 'furniture';

function Harness({ side = false, start = 'collapsed' }: { side?: boolean; start?: SheetSnap }) {
  const [active, setActive] = useState<Tab>('view');
  const [snap, setSnap] = useState<SheetSnap>(start);
  return (
    <div data-testid="space">
      <Sheet<Tab>
        tabs={[
          { id: 'view', label: 'View', icon: '👁' },
          { id: 'furniture', label: 'Furniture', icon: '🛋', badge: 2 },
        ]}
        active={active}
        onTab={setActive}
        snap={snap}
        onSnap={setSnap}
        side={side}
      >
        <p>Content of {active}</p>
      </Sheet>
    </div>
  );
}

const sheet = () => screen.getByRole('region', { name: 'Panels' });
const tab = (name: RegExp | string) => screen.getByRole('tab', { name });
const snapOf = () => /sheet-(collapsed|half|full)/.exec(sheet().className)?.[1];

describe('sheetSize', () => {
  it('is the tab bar when collapsed and a share of the space when open', () => {
    expect(sheetSize('collapsed', false)).toBe('var(--sheet-collapsed)');
    expect(sheetSize('half', false)).toBe('50%');
    expect(sheetSize('full', false)).toBe('100%');
    // At the side the 3D view keeps most of the width.
    expect(sheetSize('half', true)).toBe('45%');
    expect(sheetSize('full', true)).toBe('80%');
  });
});

describe('nearestSnap', () => {
  it('picks the snap point closest to where the drag ended', () => {
    // 700 px of space, a 56 px tab bar: collapsed 56, half 350, full 700.
    expect(nearestSnap(80, 700, 56, false)).toBe('collapsed');
    expect(nearestSnap(202, 700, 56, false)).toBe('collapsed');
    expect(nearestSnap(204, 700, 56, false)).toBe('half');
    expect(nearestSnap(500, 700, 56, false)).toBe('half');
    expect(nearestSnap(560, 700, 56, false)).toBe('full');
    // At the side of an 844 px wide screen: collapsed 64, half 380, full 675.
    expect(nearestSnap(300, 844, 64, true)).toBe('half');
    expect(nearestSnap(600, 844, 64, true)).toBe('full');
  });
});

describe('Sheet', () => {
  afterEach(() => vi.restoreAllMocks());

  it('shows only its tabs when collapsed and opens a panel with one tap', () => {
    render(<Harness />);
    expect(snapOf()).toBe('collapsed');
    expect(screen.queryByRole('tabpanel')).not.toBeInTheDocument();
    expect(screen.getByText('Content of view')).not.toBeVisible();

    fireEvent.click(tab('Furniture 2 open'));
    expect(snapOf()).toBe('half');
    expect(tab(/Furniture/)).toHaveAttribute('aria-selected', 'true');
    expect(tab('View')).toHaveAttribute('aria-selected', 'false');
    expect(screen.getByRole('tabpanel', { name: /Furniture/ })).toHaveTextContent(
      'Content of furniture',
    );
  });

  it('switches panels while open and closes with a tap on the open tab', () => {
    render(<Harness start="half" />);
    fireEvent.click(tab(/Furniture/));
    expect(snapOf()).toBe('half');
    expect(screen.getByRole('tabpanel')).toHaveTextContent('Content of furniture');

    fireEvent.click(tab(/Furniture/));
    expect(snapOf()).toBe('collapsed');
    // The panel keeps its tab for the next time.
    expect(tab(/Furniture/)).toHaveAttribute('aria-selected', 'true');
  });

  it('opens and closes with the arrow, and grows to the full height and back', () => {
    render(<Harness />);
    const toggle = screen.getByRole('button', { name: 'Open the panel' });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByRole('button', { name: 'Make the panel larger' })).not.toBeInTheDocument();

    fireEvent.click(toggle);
    expect(snapOf()).toBe('half');
    expect(screen.getByRole('button', { name: 'Close the panel' })).toHaveAttribute(
      'aria-expanded',
      'true',
    );

    fireEvent.click(screen.getByRole('button', { name: 'Make the panel larger' }));
    expect(snapOf()).toBe('full');
    fireEvent.click(screen.getByRole('button', { name: 'Make the panel smaller' }));
    expect(snapOf()).toBe('half');
    fireEvent.click(screen.getByRole('button', { name: 'Close the panel' }));
    expect(snapOf()).toBe('collapsed');
  });

  it('is a rail of tabs at the side when the phone is held across', () => {
    render(<Harness side />);
    expect(sheet()).toHaveClass('sheet-side');
    expect(screen.getByRole('tablist')).toHaveAttribute('aria-orientation', 'vertical');
  });

  describe('dragging the tab bar', () => {
    /** Layout for jsdom: 700 px of space, a 56 px bar, and the sheet at its inline size. */
    const layOut = (axis: 'height' | 'width', collapsed: number, available: number) =>
      vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (
        this: HTMLElement,
      ) {
        const size =
          this.dataset.testid === 'space'
            ? available
            : this.classList.contains('sheet')
              ? parseFloat(this.style[axis]) || collapsed
              : collapsed;
        return { width: size, height: size } as DOMRect;
      });

    it('follows the finger and snaps to the nearest size on release', () => {
      layOut('height', 56, 700);
      render(<Harness />);
      const bar = tab('View').closest('.sheet-bar')!;

      fireEvent(tab('View'), pointerEvent('pointerdown', 100, 680));
      fireEvent(bar, pointerEvent('pointermove', 100, 420));
      // 260 px up from a 56 px bar.
      expect(sheet().style.height).toBe('316px');
      expect(sheet()).toHaveClass('dragging');

      fireEvent(bar, pointerEvent('pointerup', 100, 420));
      expect(snapOf()).toBe('half');
      expect(sheet().style.height).toBe('');
      expect(sheet()).not.toHaveClass('dragging');

      // The click that ends the drag does not also close the tab under the finger.
      fireEvent.click(tab('View'));
      expect(snapOf()).toBe('half');
      // The next tap is a tap again.
      fireEvent.click(tab('View'));
      expect(snapOf()).toBe('collapsed');
    });

    it('goes all the way up and back down', () => {
      layOut('height', 56, 700);
      render(<Harness />);
      const bar = tab('View').closest('.sheet-bar')!;
      fireEvent(bar, pointerEvent('pointerdown', 100, 680));
      fireEvent(bar, pointerEvent('pointermove', 100, -400));
      // Never larger than the space it has.
      expect(sheet().style.height).toBe('700px');
      fireEvent(bar, pointerEvent('pointerup', 100, -400));
      expect(snapOf()).toBe('full');

      fireEvent(bar, pointerEvent('pointerdown', 100, 20, 2));
      fireEvent(bar, pointerEvent('pointermove', 100, 900, 2));
      fireEvent(bar, pointerEvent('pointerup', 100, 900, 2));
      expect(snapOf()).toBe('collapsed');
    });

    it('treats a press that barely moves as a tap', () => {
      layOut('height', 56, 700);
      render(<Harness />);
      fireEvent(tab(/Furniture/), pointerEvent('pointerdown', 100, 680));
      fireEvent(tab(/Furniture/), pointerEvent('pointermove', 102, 676));
      fireEvent(tab(/Furniture/), pointerEvent('pointerup', 102, 676));
      expect(sheet().style.height).toBe('');
      fireEvent.click(tab(/Furniture/));
      expect(snapOf()).toBe('half');
      expect(tab(/Furniture/)).toHaveAttribute('aria-selected', 'true');
    });

    it('recovers from a press that is released outside the bar', () => {
      layOut('height', 56, 700);
      render(<Harness start="half" />);
      const bar = tab('View').closest('.sheet-bar')!;
      const body = screen.getByRole('tabpanel');
      const mouse = (buttons: number) => ({ pointerType: 'mouse', buttons });

      // A press on a tab, a small move down into the panel, and the release there: the bar
      // never sees the pointer go up.
      fireEvent(tab('View'), pointerEvent('pointerdown', 100, 380, 1, mouse(1)));
      fireEvent(body, pointerEvent('pointermove', 100, 384, 1, mouse(1)));
      fireEvent(body, pointerEvent('pointerup', 100, 384, 1, mouse(0)));

      // Moving the mouse over the bar with no button down drags nothing.
      fireEvent(bar, pointerEvent('pointermove', 100, 200, 1, mouse(0)));
      fireEvent(bar, pointerEvent('pointermove', 100, 100, 1, mouse(0)));
      expect(sheet().style.height).toBe('');
      expect(sheet()).not.toHaveClass('dragging');
      expect(snapOf()).toBe('half');

      // And the next drag is a drag: from the 56 px the layout reports, 300 px up.
      fireEvent(bar, pointerEvent('pointerdown', 100, 400, 1, mouse(1)));
      fireEvent(bar, pointerEvent('pointermove', 100, 100, 1, mouse(1)));
      expect(sheet().style.height).toBe('356px');
      fireEvent(bar, pointerEvent('pointerup', 100, 100, 1, mouse(0)));
      expect(snapOf()).toBe('half');
      expect(sheet().style.height).toBe('');
    });

    it('drops a mouse press whose release was missed outside the window', () => {
      layOut('height', 56, 700);
      render(<Harness />);
      const bar = tab('View').closest('.sheet-bar')!;
      const mouse = (buttons: number) => ({ pointerType: 'mouse', buttons });
      fireEvent(bar, pointerEvent('pointerdown', 100, 680, 1, mouse(1)));
      // No pointerup at all; the mouse comes back with no button down.
      fireEvent(bar, pointerEvent('pointermove', 100, 300, 1, mouse(0)));
      expect(sheet().style.height).toBe('');
      expect(snapOf()).toBe('collapsed');
      // A stale press does not block the next one either.
      fireEvent(bar, pointerEvent('pointerdown', 100, 680, 1, mouse(1)));
      fireEvent(bar, pointerEvent('pointerdown', 100, 680, 1, mouse(1)));
      fireEvent(bar, pointerEvent('pointermove', 100, 380, 1, mouse(1)));
      expect(sheet().style.height).toBe('356px');
      fireEvent(window, pointerEvent('pointerup', 100, 380, 1, mouse(0)));
      expect(snapOf()).toBe('half');
    });

    it('is dragged sideways when it is at the side', () => {
      layOut('width', 64, 844);
      render(<Harness side />);
      const bar = tab('View').closest('.sheet-bar')!;
      fireEvent(bar, pointerEvent('pointerdown', 800, 100));
      fireEvent(bar, pointerEvent('pointermove', 500, 100));
      expect(sheet().style.width).toBe('364px');
      fireEvent(bar, pointerEvent('pointerup', 500, 100));
      expect(snapOf()).toBe('half');
    });
  });
});
