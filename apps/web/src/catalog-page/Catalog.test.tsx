import { catalog, finishes } from '@my-home/shared';
import { finishListing } from '@my-home/shared/finish-listing';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeApi } from '../test/fakeApi';
import { stubScreen } from '../test/screen';
import CatalogPage from './CatalogPage';
import { listedFinishes, surfacesText } from './Finishes';
import { catalogSections } from './sections';

// jsdom has no WebGL: the offscreen renderer is replaced.
const renderThumbnail = vi.hoisted(() =>
  vi.fn(() => Promise.resolve(new Blob(['png'], { type: 'image/png' }))),
);
vi.mock('./renderThumbnail', () => ({ renderThumbnail, THUMBNAIL_SIZE: 256 }));

const section = (name: string) => within(screen.getByRole('region', { name }));
const search = () => screen.getByRole('searchbox', { name: 'Search the catalogue' });

beforeEach(() => {
  URL.createObjectURL = vi.fn((blob: Blob) => `blob:${blob.size}`);
});

afterEach(() => {
  vi.unstubAllGlobals();
  window.history.replaceState(null, '', '/');
});

describe('catalogSections', () => {
  it('groups by kind, openings in catalogue order, the placed kinds by category, then name', () => {
    const sections = catalogSections(catalog.types);
    expect(sections.map((s) => s.title)).toEqual([
      'Windows & doors',
      'Furniture',
      'Fixtures',
      'Outdoor',
    ]);
    expect(sections[0]!.groups.map((g) => g.types.map((t) => t.id))).toEqual([
      catalog.types.filter((t) => t.kind === 'openings').map((t) => t.id),
    ]);
    expect(sections[1]!.groups.map((g) => [g.name, g.types.map((t) => t.name)])).toEqual([
      [
        'Bath room',
        [
          'Corner bathtub',
          'Tiled ledge',
          'Walk-in shower',
          'Wall-hung toilet',
          'Washbasin cabinet',
          'Washing machine',
        ],
      ],
      ['Bed room', ['Bed', 'Wardrobe']],
      ['Corridor', ['Shoe cabinet']],
      ['Dining', ['Chair', 'Round table']],
      ['Facade', ['Satellite dish']],
      [
        'Kitchen',
        [
          'Base cabinet run',
          'Fridge-freezer',
          'Microwave',
          'Storage shelf with bins',
          'Tall cabinet',
          'Wall cabinet',
          'Wall shelf',
        ],
      ],
      ['Living room', ['Sofa']],
      ['Work room', ['Desk']],
    ]);
    expect(sections[2]!.groups.map((g) => [g.name, g.types.map((t) => t.id)])).toEqual([
      ['Heating', ['fixture.radiator']],
      ['Lighting', ['fixture.downlight']],
    ]);
    expect(sections[3]!.groups.map((g) => [g.name, g.types.map((t) => t.name)])).toEqual([
      ['Garden', ['Bird house', 'Wheelie bin']],
      ['Patio', ['Garden bench', 'Garden chair', 'Garden table', 'Lean-to pergola']],
      ['Plants', ['Hedge', 'Ornamental grass', 'Planter', 'Shrub', 'Tree']],
      [
        'Stone & wood',
        ['Brick pillar', 'Concrete kerb', 'Dry-stone pile', 'Log', 'Stepping stone'],
      ],
    ]);
  });

  it('searches names, descriptions, type ids and categories, in any case', () => {
    const ids = (q: string) =>
      catalogSections(catalog.types, q).flatMap((s) =>
        s.groups.flatMap((g) => g.types.map((t) => t.id)),
      );
    expect(ids('CASEMENT')).toEqual(['window.casement']);
    expect(ids('gate.swing')).toEqual(['gate.swing']);
    expect(ids('dining')).toEqual(['furniture.chair', 'furniture.table']);
    expect(ids('  ')).toHaveLength(catalog.types.length);
    expect(ids('nothing like this')).toEqual([]);
    const described = catalog.types.find((t) => t.id === 'furniture.desk')!;
    const word = described.description.split(' ').at(-1)!.replace(/\W/g, '');
    expect(ids(word.toUpperCase())).toContain('furniture.desk');
  });
});

describe('CatalogPage', () => {
  it('lists every type by kind with its uses, as links to its page', async () => {
    window.history.replaceState(null, '', '/catalog?home=mock-home&walk=first');
    fakeApi({ usage: { 'window.casement': 14, 'furniture.bed': 1 } });
    render(<CatalogPage />);

    expect(screen.getByRole('heading', { level: 1, name: 'Catalogue' })).toBeInTheDocument();
    expect(screen.getByRole('banner')).toContainElement(search());
    expect(screen.getByRole('main')).toBeInTheDocument();
    expect(document.title).toBe('Catalogue · my-home');
    // ← Home keeps ?home= and drops the viewer's own parameters.
    expect(screen.getByRole('link', { name: '← Home' })).toHaveAttribute(
      'href',
      '/?home=mock-home',
    );
    // Counts load: "…" until then.
    expect(section('Windows & doors').getAllByText('…').length).toBeGreaterThan(0);
    const casement = await screen.findByRole('link', { name: 'Casement window, 14 uses' });
    expect(casement).toHaveAttribute('href', '/catalog/openings/window.casement?home=mock-home');
    expect(casement).toHaveAccessibleDescription(catalog.get('window.casement')!.description);
    expect(section('Furniture').getByRole('link', { name: 'Bed, 1 use' })).toHaveAttribute(
      'href',
      '/catalog/furniture/furniture.bed?home=mock-home',
    );
    expect(screen.getByRole('link', { name: 'Desk, 0 uses' })).toBeInTheDocument();
    expect(section('Windows & doors').getAllByRole('link')).toHaveLength(
      catalog.types.filter((t) => t.kind === 'openings').length,
    );
    expect(
      section('Furniture')
        .getAllByRole('heading', { level: 3 })
        .map((h) => h.textContent),
    ).toEqual([
      'Bath room',
      'Bed room',
      'Corridor',
      'Dining',
      'Facade',
      'Kitchen',
      'Living room',
      'Work room',
    ]);
    // Fixtures are a section of their own.
    expect(section('Fixtures').getByRole('link', { name: 'Downlight, 0 uses' })).toHaveAttribute(
      'href',
      '/catalog/fixtures/fixture.downlight?home=mock-home',
    );
    expect(
      section('Fixtures')
        .getAllByRole('heading', { level: 3 })
        .map((h) => h.textContent),
    ).toEqual(['Heating', 'Lighting']);
  });

  it('filters as you type', async () => {
    fakeApi();
    render(<CatalogPage />);
    fireEvent.change(search(), { target: { value: 'Bed' } });
    expect(screen.queryByRole('region', { name: 'Windows & doors' })).not.toBeInTheDocument();
    // The bed by name, the wardrobe by its category ("Bed room").
    expect(
      section('Furniture')
        .getAllByRole('link')
        .map((l) => l.dataset.typeId),
    ).toEqual(['furniture.bed', 'furniture.wardrobe']);
    fireEvent.change(search(), { target: { value: 'xyz' } });
    expect(screen.getByText('Nothing matches “xyz”.')).toBeInTheDocument();
    fireEvent.change(search(), { target: { value: '' } });
    expect(document.querySelectorAll('[data-type-id]')).toHaveLength(catalog.types.length);
  });

  it('hides the counts with a notice when the api fails, and still works', async () => {
    fakeApi({ usage: 'error' });
    render(<CatalogPage />);
    expect(await screen.findByText(/number of uses is not available/)).toBeInTheDocument();
    expect(screen.queryByText('…')).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Casement window' })).toBeInTheDocument();
  });

  it('shows the icon until the thumbnail is rendered, one renderer for every card', async () => {
    fakeApi();
    render(<CatalogPage />);
    const bed = screen.getByRole('link', { name: /^Bed/ });
    expect(bed.querySelector('img')).toBeNull();
    expect(bed.querySelector('.catalog-thumb')).toHaveTextContent(
      catalog.get('furniture.bed')!.icon,
    );
    await vi.waitFor(() => expect(bed.querySelector('img')).toHaveAttribute('src', 'blob:3'));
    expect(screen.getByRole('link', { name: /^Bed/ })).toHaveAccessibleName(/^Bed/);
    expect(document.querySelectorAll('canvas')).toHaveLength(0);
  });

  it('lists the finishes of the library with their source and licence', () => {
    fakeApi();
    render(<CatalogPage />);
    const cards = section('Finishes').getAllByRole('listitem');
    expect(cards.map((c) => c.dataset.finishId)).toEqual(finishes.finishes.map((f) => f.id));
    const lawn = within(cards.find((c) => c.dataset.finishId === 'grass.lawn')!);
    expect(lawn.getByText('Lawn')).toBeInTheDocument();
    expect(lawn.getByText('grass.lawn')).toBeInTheDocument();
    expect(lawn.getByText(/For the ground · one repeat covers 1.4 m/)).toBeInTheDocument();
    expect(lawn.getByRole('link', { name: 'ambientCG · Grass004' })).toHaveAttribute(
      'href',
      'https://ambientcg.com/a/Grass004',
    );
    expect(lawn.getByText(/licence CC0-1.0/)).toBeInTheDocument();
    const paint = within(cards.find((c) => c.dataset.finishId === 'paint.plain')!);
    expect(paint.getByText('A plain colour: no texture')).toBeInTheDocument();
    expect(paint.getByText(/For walls, ceilings and facades · can be tinted/)).toBeInTheDocument();
    // Every textured finish names where its texture comes from.
    for (const finish of finishListing.filter((f) => f.texture)) {
      const card = within(cards.find((c) => c.dataset.finishId === finish.id)!);
      expect(card.getByRole('link')).toHaveAttribute('href', finish.source!.url);
      expect(card.getByText(/licence CC0-1.0/)).toBeInTheDocument();
    }
  });

  it('shows a finish’s colour map in this device’s size, and a tint for a plain or relief-only one', () => {
    fakeApi();
    const { unmount } = render(<CatalogPage />);
    const swatch = (id: string) =>
      document.querySelector<HTMLElement>(`[data-finish-id="${id}"] .finish-swatch`)!;
    expect(swatch('wood.oak-laminate').querySelector('img')!.getAttribute('src')).toMatch(
      /wood-oak-laminate\/color-1024\.webp$/,
    );
    expect(swatch('wood.oak-laminate').querySelector('img')).toHaveAttribute('loading', 'lazy');
    expect(swatch('paint.plain').querySelector('img')).toBeNull();
    expect(swatch('paint.plain').style.background).toBe('rgb(242, 239, 232)');
    expect(swatch('render.facade').querySelector('img')).toBeNull();
    unmount();
    stubScreen('portrait');
    render(<CatalogPage />);
    const images = [...document.querySelectorAll('.finish-swatch img')].map((i) =>
      i.getAttribute('src'),
    );
    expect(images.length).toBeGreaterThan(5);
    expect(images.every((src) => /color-512\.webp$/.test(src!))).toBe(true);
  });

  it('searches the finishes too, and says what a finish is for', () => {
    fakeApi();
    render(<CatalogPage />);
    fireEvent.change(search(), { target: { value: 'clay' } });
    expect(
      section('Finishes')
        .getAllByRole('listitem')
        .map((c) => c.dataset.finishId),
    ).toEqual(['roof.clay-tile']);
    expect(screen.queryByText(/Nothing matches/)).not.toBeInTheDocument();
    fireEvent.change(search(), { target: { value: 'window' } });
    expect(screen.queryByRole('region', { name: 'Finishes' })).not.toBeInTheDocument();
    expect(listedFinishes('PAINT.').map((f) => f.id)).toEqual(['paint.plain']);
    expect(surfacesText(finishes.get('cut.dark')!)).toBe('Drawn by the viewer only');
    expect(surfacesText(finishes.get('grass.lawn')!)).toBe('For the ground');
    expect(surfacesText(finishes.get('tile.light-60')!)).toBe('For floors and walls');
  });

  it('is one column with the phone layout', () => {
    stubScreen('portrait');
    fakeApi();
    const { container } = render(<CatalogPage />);
    expect(container.firstElementChild).toHaveClass('catalog-page', 'mobile', 'portrait');
  });
});
