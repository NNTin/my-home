import { catalog } from '@my-home/shared';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeApi } from '../test/fakeApi';
import { stubScreen } from '../test/screen';
import CatalogPage from './CatalogPage';
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
  it('groups by kind, openings in catalogue order, furniture and fixtures by category, then name', () => {
    const sections = catalogSections(catalog.types);
    expect(sections.map((s) => s.title)).toEqual(['Windows & doors', 'Furniture', 'Fixtures']);
    expect(sections[0]!.groups.map((g) => g.types.map((t) => t.id))).toEqual([
      catalog.types.filter((t) => t.kind === 'openings').map((t) => t.id),
    ]);
    expect(sections[1]!.groups.map((g) => [g.name, g.types.map((t) => t.name)])).toEqual([
      ['Bed room', ['Bed', 'Wardrobe']],
      ['Corridor', ['Shoe cabinet']],
      ['Dining', ['Chair', 'Round table']],
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
    ).toEqual(['Bed room', 'Corridor', 'Dining', 'Kitchen', 'Living room', 'Work room']);
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

  it('is one column with the phone layout', () => {
    stubScreen('portrait');
    fakeApi();
    const { container } = render(<CatalogPage />);
    expect(container.firstElementChild).toHaveClass('catalog-page', 'mobile', 'portrait');
  });
});
