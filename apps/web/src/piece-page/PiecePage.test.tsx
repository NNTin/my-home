import { enterEditMode } from '../test/editMode';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { App } from '../App';
import { fakeApi } from '../test/fakeApi';
import { stubScreen } from '../test/screen';
import type { InspectorProps } from './Inspector';
import { encodeOverrides } from './playground';

// jsdom has no WebGL: the R3F inspector is a stub that exposes what it would draw.
let inspector: InspectorProps | undefined;
vi.mock('./Inspector', () => ({
  Inspector: (props: InspectorProps) => {
    inspector = props;
    return <div data-testid="inspector" />;
  },
}));
vi.mock('../catalog-page/renderThumbnail', () => ({
  renderThumbnail: () => Promise.reject(new Error('no WebGL in jsdom')),
  THUMBNAIL_SIZE: 256,
}));

function open(path: string) {
  window.history.replaceState(null, '', path);
  const api = fakeApi();
  render(<App />);
  return api;
}

const panel = () => within(screen.getByRole('region', { name: 'Playground' }));
const dimensions = () =>
  [...document.querySelectorAll('.piece-dimensions div')].map((d) => d.textContent);
const nonGet = (api: ReturnType<typeof fakeApi>) =>
  api.fetch.mock.calls.filter(([, init]) => (init?.method ?? 'GET') !== 'GET');

describe('the piece page', () => {
  afterEach(() => {
    inspector = undefined;
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it('shows the type of a deep link: name, kind, description, 3D, dimensions', async () => {
    open('/catalog/openings/window.casement?home=mock-home');
    const heading = await screen.findByRole('heading', { level: 1, name: /Casement window/ });
    expect(heading).toBeInTheDocument();
    // The title is set in an effect, which may run a moment after the lazy page is shown.
    await waitFor(() => expect(document.title).toBe('Casement window · my-home'));
    expect(screen.getByText('Windows & doors · Window')).toBeInTheDocument();
    expect(screen.getByText(/sashes swing open on side hinges/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: '← Catalogue' })).toHaveAttribute(
      'href',
      '/catalog?home=mock-home',
    );
    expect(screen.getByTestId('inspector')).toBeInTheDocument();
    // The window in its wall stub, standing on the floor under its 90 cm sill.
    expect(inspector!.context).toHaveLength(4);
    expect(inspector!.ground).toBeCloseTo(-1.5);
    expect(dimensions()).toEqual([
      'Width120.0 cm',
      'Height120.0 cm',
      'Sill height90.0 cm',
      'Frame width6.5 cm',
      'Sash width107.0 cm',
    ]);
    expect(inspector!.lines.map((l) => l.label)).toEqual(
      expect.arrayContaining(['120.0 cm', '90.0 cm']),
    );
  });

  it('shows furniture on the ground, without a section', async () => {
    open('/catalog/furniture/furniture.table');
    await screen.findByRole('heading', { level: 1, name: /Round table/ });
    expect(screen.getByText('Furniture · Dining')).toBeInTheDocument();
    expect(inspector!.ground).toBe(0);
    expect(inspector!.context).toEqual([]);
    expect(screen.queryByRole('button', { name: 'Section' })).not.toBeInTheDocument();
    expect(dimensions()).toEqual(['Diameter110.0 cm', 'Height75.0 cm']);
  });

  it('shows a ceiling fixture from below, under a ceiling, with Place (#63)', async () => {
    enterEditMode();
    open('/catalog/fixtures/fixture.downlight?home=mock-home');
    await screen.findByRole('heading', { level: 1, name: /Downlight/ });
    expect(screen.getByText('Fixtures · Lighting')).toBeInTheDocument();
    expect(screen.getByText('Fixed to the ceiling.')).toBeInTheDocument();
    expect(inspector!.ground).toBeUndefined();
    expect(inspector!.from).toBe('below');
    expect(inspector!.context).toHaveLength(1);
    expect(inspector!.context![0]!.center[1]).toBeGreaterThan(0);
    expect(dimensions()).toEqual(['Diameter8.5 cm', 'Housing depth7.0 cm']);
    // Its uses are loaded like furniture's (placements), and it is placed from here too.
    await screen.findByText(/uses? in this environment/);
    expect(await screen.findByRole('button', { name: 'Place…' })).toBeInTheDocument();
  });

  it('hangs a wall piece on a wall stub, its floor at its elevation', async () => {
    open('/catalog/furniture/kitchen.wall-cabinet');
    await screen.findByRole('heading', { level: 1, name: /Wall cabinet/ });
    expect(screen.getByText('Furniture · Kitchen')).toBeInTheDocument();
    expect(
      screen.getByText('Hangs on a wall, its bottom 133.0 cm above the floor by default.'),
    ).toBeInTheDocument();
    expect(inspector!.ground).toBeCloseTo(-1.33);
    expect(inspector!.from).toBe('above');
    const [wall] = inspector!.context!;
    // Behind the cabinet (its back is at -depth / 2), from the floor to above its top.
    expect(wall!.center[2]).toBeLessThan(-0.35 / 2);
    expect(wall!.center[1] - wall!.size[1] / 2).toBeCloseTo(-1.33);
    expect(screen.queryByRole('button', { name: 'Section' })).not.toBeInTheDocument();
  });

  it('stands the microwave on a worktop, and offers Place for it and floor pieces', async () => {
    enterEditMode();
    open('/catalog/furniture/appliance.microwave');
    await screen.findByRole('heading', { level: 1, name: /Microwave/ });
    expect(screen.getByText('Furniture · Appliance · Kitchen')).toBeInTheDocument();
    expect(inspector!.ground).toBeCloseTo(-0.9);
    expect(inspector!.context).toHaveLength(1);
    await screen.findByText(/uses? in this environment/);
    expect(await screen.findByRole('button', { name: 'Place…' })).toBeInTheDocument();
    cleanup();
    open('/catalog/furniture/kitchen.base-cabinet');
    await screen.findByRole('heading', { level: 1, name: /Base cabinet run/ });
    expect(screen.getByText('Stands on the floor.')).toBeInTheDocument();
    expect(inspector!.ground).toBe(0);
    expect(inspector!.context).toEqual([]);
    expect(await screen.findByRole('button', { name: 'Place…' })).toBeInTheDocument();
  });

  it('is not found for an unknown type', async () => {
    open('/catalog/openings/window.porthole');
    expect(await screen.findByRole('heading', { name: 'Page not found' })).toBeInTheDocument();
  });

  it('swaps the 3D view for the section of an opening', async () => {
    open('/catalog/openings/window.casement');
    await screen.findByRole('heading', { level: 1, name: /Casement/ });
    fireEvent.click(screen.getByRole('button', { name: 'Section' }));
    expect(screen.queryByTestId('inspector')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Section' })).toHaveAttribute('aria-pressed', 'true');
    const svg = screen.getByRole('img', { name: /^Section:/ });
    expect(svg.querySelectorAll('rect[data-role="frame"]').length).toBeGreaterThan(0);
    expect(svg.querySelectorAll('rect[data-role="glass"]')).toHaveLength(1);
    expect(svg.querySelectorAll('rect[data-role="wall"]')).toHaveLength(2);
    expect(
      within(screen.getByRole('list', { name: 'Legend' }))
        .getAllByRole('listitem')
        .map((l) => l.textContent),
    ).toEqual(['Wall', 'Frame', 'Sash', 'Glass', 'Window board', 'Outside sill']);
    expect(screen.getByText('Glass depth').nextElementSibling).toHaveTextContent('2.4 cm');
    expect(
      screen.getByText(/the outdoors on the left and the room on the right/),
    ).toBeInTheDocument();
    // The section follows the playground.
    fireEvent.click(panel().getByRole('button', { name: 'More sashes' }));
    expect(svg.querySelectorAll('rect[data-role="frame"]')).toHaveLength(3);
    fireEvent.click(screen.getByRole('button', { name: '3D' }));
    expect(screen.getByTestId('inspector')).toBeInTheDocument();
  });

  it('updates the preview live, shows fit issues, and never writes', async () => {
    const api = open('/catalog/openings/door.french');
    await screen.findByRole('heading', { level: 1, name: /French door/ });
    const before = inspector!.parts.length;
    const more = panel().getByRole('button', { name: 'More leaves' });
    fireEvent.click(more);
    // A mullion, and the second leaf: four members, a handle and a pane.
    expect(inspector!.parts.length).toBe(before + 7);
    expect(dimensions()).toContain('Leaf 2 width41.0 cm');
    fireEvent.click(more);
    // Three leaves need 120 cm; the preview hole is 100 cm.
    expect(screen.getByRole('status', { name: 'Does not fit' })).toHaveTextContent(
      '3 leaves need at least 120.0 cm, the opening is 100.0 cm',
    );
    fireEvent.change(panel().getByRole('textbox', { name: 'Frame colour, hex' }), {
      target: { value: '#eee' },
    });
    // A colour lighter than oak: the frame is lacquer in it (a darker one would be a stain).
    expect(inspector!.parts[0]!.color).toBe('#eeeeee');
    fireEvent.click(panel().getByRole('button', { name: 'Reset to defaults' }));
    expect(inspector!.parts.length).toBe(before);
    fireEvent.click(screen.getByRole('checkbox', { name: 'Dimensions' }));
    expect(inspector!.showDimensions).toBe(false);
    await act(() => new Promise((r) => setTimeout(r, 500)));
    expect(nonGet(api)).toEqual([]);
  });

  it('changing any control of every type sends no request but GETs', async () => {
    const { catalog } = await import('@my-home/shared');
    for (const type of catalog.types) {
      const api = open(`/catalog/${type.kind}/${type.id}`);
      await screen.findByRole('heading', { level: 1, name: new RegExp(type.name) });
      const region = panel();
      for (const field of region.queryAllByRole('textbox'))
        fireEvent.change(field, { target: { value: '#abc' } });
      for (const slider of region.queryAllByRole('slider'))
        fireEvent.change(slider, { target: { value: slider.getAttribute('max') } });
      for (const button of region.queryAllByRole('button')) fireEvent.click(button);
      await act(() => new Promise((r) => setTimeout(r, 450)));
      expect(nonGet(api), type.id).toEqual([]);
      cleanup();
    }
  }, 30_000);

  it('keeps the playground in ?p=, and opens a shared state', async () => {
    const p = encodeOverrides({ width: 1.8 });
    open(`/catalog/furniture/furniture.bed?home=mock-home&p=${p}`);
    await screen.findByRole('heading', { level: 1, name: /Bed/ });
    expect(panel().getByRole('textbox', { name: 'Width' })).toHaveValue('180.0');
    expect(dimensions()[0]).toBe('Width180.0 cm');
    fireEvent.change(panel().getByRole('textbox', { name: 'Width' }), { target: { value: '200' } });
    await waitFor(() =>
      expect(new URLSearchParams(window.location.search).get('p')).toBe(
        encodeOverrides({ width: 2 }),
      ),
    );
    expect(new URLSearchParams(window.location.search).get('home')).toBe('mock-home');
    fireEvent.click(panel().getByRole('button', { name: 'Reset to defaults' }));
    await waitFor(() => expect(window.location.search).toBe('?home=mock-home'));
  });

  it('ignores a ?p= that is not valid for the type', async () => {
    open(`/catalog/furniture/furniture.bed?p=${encodeOverrides({ width: 9 })}`);
    await screen.findByRole('heading', { level: 1, name: /Bed/ });
    expect(panel().getByRole('textbox', { name: 'Width' })).toHaveValue('160.0');
  });

  it('stacks the preview over the panel on a phone held upright', async () => {
    stubScreen('portrait');
    open('/catalog/furniture/furniture.bed');
    const heading = await screen.findByRole('heading', { level: 1, name: /Bed/ });
    expect(heading.closest('.piece-page')).toHaveClass('mobile', 'portrait');
  });

  it('puts the preview beside the panel on a phone held across', async () => {
    stubScreen('landscape');
    open('/catalog/furniture/furniture.bed');
    const heading = await screen.findByRole('heading', { level: 1, name: /Bed/ });
    expect(heading.closest('.piece-page')).toHaveClass('mobile', 'landscape');
  });
});
