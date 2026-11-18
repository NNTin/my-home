import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { href, keptQuery, Link, navigate, parseRoute, useRoute, type Route } from '.';

afterEach(() => window.history.replaceState(null, '', '/'));

describe('parseRoute', () => {
  it.each<[string, Route]>([
    ['/', { page: 'viewer' }],
    ['', { page: 'viewer' }],
    ['/catalog', { page: 'catalog' }],
    ['/catalog/', { page: 'catalog' }],
    [
      '/catalog/furniture/furniture.bed',
      { page: 'piece', kind: 'furniture', typeId: 'furniture.bed' },
    ],
    [
      '/catalog/furniture/furniture.bed/',
      { page: 'piece', kind: 'furniture', typeId: 'furniture.bed' },
    ],
    [
      '/catalog/openings/window.tilt-turn',
      { page: 'piece', kind: 'openings', typeId: 'window.tilt-turn' },
    ],
    ['/catalog/openings/gate.swing', { page: 'piece', kind: 'openings', typeId: 'gate.swing' }],
    // Encoded ids are decoded first.
    [
      '/catalog/furniture/furniture%2Ebed',
      { page: 'piece', kind: 'furniture', typeId: 'furniture.bed' },
    ],
    [
      '/catalog/%66urniture/furniture.bed',
      { page: 'piece', kind: 'furniture', typeId: 'furniture.bed' },
    ],
  ])('%s', (path, route) => expect(parseRoute(path)).toEqual(route));

  it.each([
    '/catalogue',
    '/catalog//',
    '/catalog/furniture',
    '/catalog/furniture/',
    '/catalog/outdoor/furniture.bed', // unknown kind
    '/catalog/furniture/furniture.throne', // unknown type
    '/catalog/openings/furniture.bed', // a type of another kind
    '/catalog/furniture/Furniture.Bed', // not a type id
    '/catalog/furniture/furniture.bed/extra',
    '/catalog/furniture/%E0%A4%A', // broken encoding
    '/index.html',
    '//',
    '/api/homes',
  ])('%s is not found', (path) => expect(parseRoute(path)).toEqual({ page: 'not-found' }));
});

describe('href', () => {
  it('builds the paths, with the query', () => {
    expect(href({ page: 'viewer' })).toBe('/');
    expect(href({ page: 'catalog' }, { home: 'mock-home' })).toBe('/catalog?home=mock-home');
    expect(href({ page: 'piece', kind: 'openings', typeId: 'window.casement' }, { home: '' })).toBe(
      '/catalog/openings/window.casement',
    );
    expect(href({ page: 'not-found' })).toBe('/');
  });

  it('keeps ?home= and drops the viewer’s own parameters', () => {
    expect(keptQuery('?home=a%20b&walk=first&panel=view&sheet=full&hints=off')).toEqual({
      home: 'a b',
    });
    expect(keptQuery('?walk=third')).toEqual({});
    expect(href({ page: 'viewer' }, keptQuery('?home=tiny&walk=first'))).toBe('/?home=tiny');
  });

  it('round-trips through parseRoute', () => {
    const route: Route = { page: 'piece', kind: 'furniture', typeId: 'furniture.wardrobe' };
    expect(parseRoute(new URL(href(route, { home: 'x' }), 'http://h').pathname)).toEqual(route);
  });
});

function Where() {
  const route = useRoute();
  return <p data-testid="where">{JSON.stringify(route)}</p>;
}
const where = () => JSON.parse(screen.getByTestId('where').textContent!) as Route;

describe('navigation', () => {
  it('navigate pushes or replaces history entries and updates useRoute', () => {
    render(<Where />);
    const length = window.history.length;
    act(() => navigate('/catalog?home=mock-home'));
    expect(where()).toEqual({ page: 'catalog' });
    expect(window.location.search).toBe('?home=mock-home');
    expect(window.history.length).toBe(length + 1);

    act(() => navigate('/catalog/furniture/furniture.bed', { replace: true }));
    expect(where()).toMatchObject({ page: 'piece', typeId: 'furniture.bed' });
    expect(window.history.length).toBe(length + 1);

    // The same address again adds nothing.
    act(() => navigate('/catalog/furniture/furniture.bed'));
    expect(window.history.length).toBe(length + 1);
  });

  it('follows the back and forward buttons (popstate)', () => {
    render(<Where />);
    act(() => {
      window.history.pushState(null, '', '/catalog');
      window.dispatchEvent(new PopStateEvent('popstate'));
    });
    expect(where()).toEqual({ page: 'catalog' });
    act(() => {
      window.history.replaceState(null, '', '/nowhere');
      window.dispatchEvent(new PopStateEvent('popstate'));
    });
    expect(where()).toEqual({ page: 'not-found' });
  });
});

describe('Link', () => {
  const link = () => screen.getByRole('link', { name: 'Catalogue' });
  // jsdom cannot load another document: whether the app took the click is recorded, and then
  // the browser's own navigation is stopped.
  let leftToBrowser: boolean[] = [];
  const record = (e: Event) => {
    leftToBrowser.push(!e.defaultPrevented);
    e.preventDefault();
  };
  beforeEach(() => {
    leftToBrowser = [];
    document.addEventListener('click', record);
  });
  afterEach(() => document.removeEventListener('click', record));

  it('is a real link', () => {
    render(<Link to="/catalog?home=x">Catalogue</Link>);
    expect(link()).toHaveAttribute('href', '/catalog?home=x');
  });

  it('navigates without a reload on a plain left click', () => {
    const onClick = vi.fn();
    render(
      <>
        <Link to="/catalog?home=x" onClick={onClick}>
          Catalogue
        </Link>
        <Where />
      </>,
    );
    act(() => void fireEvent.click(link()));
    expect(leftToBrowser).toEqual([false]);
    expect(onClick).toHaveBeenCalledOnce();
    expect(where()).toEqual({ page: 'catalog' });
    expect(window.location.search).toBe('?home=x');
  });

  it.each([
    ['ctrl', { ctrlKey: true }],
    ['meta', { metaKey: true }],
    ['shift', { shiftKey: true }],
    ['alt', { altKey: true }],
    ['middle button', { button: 1 }],
  ])('leaves a %s click to the browser', (_name, init) => {
    render(<Link to="/catalog">Catalogue</Link>);
    link().dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, ...init }));
    expect(leftToBrowser).toEqual([true]);
    expect(window.location.pathname).toBe('/');
  });

  it('leaves target=_blank, other origins and handled clicks to the browser', () => {
    render(
      <>
        <Link to="/catalog" target="_blank">
          Catalogue
        </Link>
        <Link to="https://example.org/catalog">Elsewhere</Link>
        <Link to="/catalog" onClick={(e) => e.preventDefault()}>
          Handled
        </Link>
      </>,
    );
    fireEvent.click(link());
    fireEvent.click(screen.getByRole('link', { name: 'Elsewhere' }));
    fireEvent.click(screen.getByRole('link', { name: 'Handled' }));
    expect(leftToBrowser).toEqual([true, true, false]);
    expect(window.location.pathname).toBe('/');
  });
});
