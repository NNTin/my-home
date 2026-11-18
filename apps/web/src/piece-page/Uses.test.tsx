import type { OpeningOverride } from '@my-home/shared';
import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { homeSummary } from '../test/fakeApi';
import { mockHome } from '../test/fixtures';
import { openPiece, rowOf, usesSection } from '../test/piecePage';
import { overrideSummary, whereUsed } from './uses';
import { catalog } from '@my-home/shared';

vi.mock('./Inspector', () => ({ Inspector: () => <div data-testid="inspector" /> }));
vi.mock('../catalog-page/renderThumbnail', () => ({
  renderThumbnail: () => Promise.reject(new Error('no WebGL in jsdom')),
  THUMBNAIL_SIZE: 256,
}));

const override = (useId: string, params: OpeningOverride['params'], typeId = 'window.casement') =>
  ({
    homeId: 'mock-home',
    useId,
    typeId,
    params,
    version: 1,
    updatedAt: '2026-01-01T00:00:00.000Z',
  }) satisfies OpeningOverride;

const twoHomes = {
  homes: [homeSummary('mock-home', 'Mock home'), homeSummary('other-home', 'Other home')],
  models: { 'other-home': { ...mockHome, id: 'other-home', name: 'Other home' } },
};

describe('where-used', () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    window.location.hash = '';
  });

  it('lists the uses of every home, grouped by home and level', async () => {
    openPiece('/catalog/openings/door.interior', twoHomes);
    expect(await screen.findByText('8 uses in this environment')).toBeInTheDocument();
    const homes = [...document.querySelectorAll('.uses-home')];
    expect(homes.map((h) => h.querySelector('h3')!.textContent)).toEqual([
      'Mock home',
      'Other home',
    ]);
    const first = within(homes[0] as HTMLElement);
    expect(first.getByRole('region', { name: 'Souterrain' })).toBeInTheDocument();
    // Sorted by room within the level.
    expect([...homes[0]!.querySelectorAll('.use-name')].map((n) => n.textContent)).toEqual([
      'Bathroom door',
      'Bedroom door',
      'Kitchen door',
      'Living room door',
    ]);
    expect(rowOf('other-home', 'souterrain-bedroom-door').getByText(/Souterrain · /)).toBeTruthy();
  });

  it('summarises overrides and links each use to the model', async () => {
    openPiece('/catalog/openings/window.casement?home=mock-home', {
      overrides: [override('souterrain-kitchen-window', { frameColor: '#383e42', sashes: 2 })],
    });
    await screen.findByText('15 uses in this environment');
    const row = rowOf('mock-home', 'souterrain-kitchen-window');
    expect(row.getByLabelText('Overrides')).toHaveTextContent('frame colour #383e422 sashes');
    expect(row.getByRole('link', { name: 'Show Kitchen · back window in model' })).toHaveAttribute(
      'href',
      '/?home=mock-home&focus=souterrain-kitchen-window',
    );
    expect(
      rowOf('mock-home', 'souterrain-bedroom-window').getByLabelText('Overrides'),
    ).toHaveTextContent('Type defaults');
  });

  it('lists what needs attention first, without deleting anything', async () => {
    const api = openPiece('/catalog/openings/window.casement', {
      overrides: [
        override('souterrain-kitchen-window', { bogus: 1 }),
        override('old-window', { frameColor: '#000000' }),
      ],
    });
    const attention = within(await screen.findByRole('region', { name: 'Needs attention' }));
    expect(attention.getAllByRole('heading', { level: 5 }).map((h) => h.textContent)).toEqual([
      'Kitchen · back window',
      'old-window',
    ]);
    expect(attention.getByText('ignored: bogus')).toBeInTheDocument();
    expect(attention.getByText('not in the home model any more')).toBeInTheDocument();
    // The orphan is not counted, has no model link or editor, and keeps its history.
    expect(usesSection().getByText('15 uses in this environment')).toBeInTheDocument();
    const orphan = rowOf('mock-home', 'old-window');
    expect(orphan.queryByRole('link', { name: /in model/ })).not.toBeInTheDocument();
    expect(orphan.queryByRole('button', { name: /^Edit/ })).not.toBeInTheDocument();
    expect(orphan.queryByRole('button', { name: /Remove/ })).not.toBeInTheDocument();
    fireEvent.click(orphan.getByRole('button', { name: 'Show history of old-window' }));
    expect(await orphan.findByRole('region', { name: 'History' })).toBeInTheDocument();
    // Listed once: not again under its level.
    expect(document.querySelectorAll('#use-mock-home-souterrain-kitchen-window')).toHaveLength(1);
    expect(api.calls('DELETE', /./)).toEqual([]);
  });

  it('opens and scrolls to the use of a #use= anchor, and follows a new one', async () => {
    const scroll = vi.fn();
    Element.prototype.scrollIntoView = scroll;
    openPiece('/catalog/openings/window.casement?home=mock-home#use=souterrain-bedroom-window');
    await waitFor(() => expect(scroll).toHaveBeenCalled());
    expect(scroll.mock.contexts[0]).toBe(
      document.getElementById('use-mock-home-souterrain-bedroom-window'),
    );
    const opened = rowOf('mock-home', 'souterrain-bedroom-window');
    expect(opened.getByRole('button', { name: 'Edit Bedroom · front window' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    expect(document.querySelector('.piece-showing')).toHaveTextContent(
      'Showing Bedroom · front window (Souterrain · Bedroom) in its real opening.',
    );
    window.location.hash = '#use=souterrain-kitchen-window';
    await waitFor(() =>
      expect(
        rowOf('mock-home', 'souterrain-kitchen-window').getByRole('button', {
          name: 'Edit Kitchen · back window',
        }),
      ).toHaveAttribute('aria-pressed', 'true'),
    );
    expect(scroll).toHaveBeenCalledTimes(2);
  });

  it('writes the anchor of the use it opens, and keeps it while the playground changes', async () => {
    openPiece('/catalog/openings/window.casement?home=mock-home');
    await screen.findByText('15 uses in this environment');
    fireEvent.click(
      rowOf('mock-home', 'souterrain-bedroom-window').getByRole('button', {
        name: 'History of Bedroom · front window',
      }),
    );
    expect(window.location.hash).toBe('#use=souterrain-bedroom-window');
    fireEvent.click(screen.getByRole('button', { name: 'More sashes' }));
    await waitFor(() => expect(window.location.search).toContain('p='));
    expect(window.location.hash).toBe('#use=souterrain-bedroom-window');
    fireEvent.click(
      rowOf('mock-home', 'souterrain-bedroom-window').getByRole('button', {
        name: 'History of Bedroom · front window',
      }),
    );
    expect(window.location.hash).toBe('');
  });
});

describe('whereUsed and overrideSummary', () => {
  it('counts git uses and placements but not orphans', () => {
    const type = catalog.get('window.casement')!;
    const use = (id: string, status: 'ok' | 'needs-attention' = 'ok') => ({
      id,
      homeId: 'mock-home',
      typeId: type.id,
      kind: 'openings' as const,
      source: 'git' as const,
      name: id,
      levelId: 'souterrain',
      roomIds: [],
      where: '',
      overrides: {},
      effective: {},
      version: 0,
      status,
      problems: [],
      updatedAt: null,
      removedAt: null,
    });
    const result = whereUsed(type, [
      {
        home: homeSummary('mock-home', 'Mock home'),
        model: mockHome,
        uses: [use('souterrain-kitchen-window'), use('gone', 'needs-attention')],
        placements: [],
        photos: [],
        requests: [],
      },
    ]);
    expect(result.count).toBe(1);
    expect(result.attention.map((r) => [r.use.id, r.orphan])).toEqual([['gone', true]]);
    expect(result.homes[0]!.levels.map((l) => l.name)).toEqual(['Souterrain']);
  });

  it('names one sash and two sashes, and lengths in cm', () => {
    expect(overrideSummary(catalog.get('window.casement')!, { sashes: 1 })[0]!.text).toBe('1 sash');
    expect(overrideSummary(catalog.get('furniture.bed')!, { width: 1.8 })[0]!.text).toBe(
      'width 180.0 cm',
    );
  });
});
