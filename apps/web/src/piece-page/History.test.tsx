import type { HistoryEntry } from '@my-home/shared';
import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { openPiece, rowOf } from '../test/piecePage';
import { relativeTime } from './History';

vi.mock('./Inspector', () => ({ Inspector: () => <div data-testid="inspector" /> }));
vi.mock('../catalog-page/renderThumbnail', () => ({
  renderThumbnail: () => Promise.reject(new Error('no WebGL in jsdom')),
  THUMBNAIL_SIZE: 256,
}));

const kitchen = 'souterrain-kitchen-window';
const url = `/api/homes/mock-home/opening-overrides/${kitchen}`;

/** Writes an override through the fake api, as an agent or another tab would. */
const put = (version: number, params: Record<string, string | number>) =>
  fetch(url, { method: 'PUT', body: JSON.stringify({ version, params }) });

/** An older change by the owner, signed on (identity). */
const ownerEntry: HistoryEntry = {
  id: '11111111-1111-4111-8111-111111111111',
  homeId: 'mock-home',
  useId: kitchen,
  useKind: 'opening',
  action: 'update',
  actor: 'owner',
  actorSource: 'identity',
  actorName: 'owner',
  at: '2025-12-31T00:00:00.000Z',
  before: { params: {} },
  after: { params: { sashes: 2 } },
  changes: [{ field: 'params.sashes', text: 'sashes 1 → 2' }],
  undoesId: null,
  undoneById: null,
  canUndo: false,
};

async function openHistory() {
  await screen.findByText(/uses? in this environment/);
  fireEvent.click(
    rowOf('mock-home', kitchen).getByRole('button', { name: 'History of Kitchen · back window' }),
  );
  const region = within(rowOf('mock-home', kitchen).getByRole('region', { name: 'History' }));
  await region.findByRole('list');
  return region;
}

const rows = () =>
  [...document.querySelectorAll('.history-list li')].map((li) =>
    li.textContent!.replace(/^[^·]*· /, ''),
  );

describe('the history of a use', () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    window.location.hash = '';
  });

  it('lists who, when and what, newest first', async () => {
    const api = openPiece('/catalog/openings/window.casement', {
      history: [ownerEntry],
      actor: 'agent',
    });
    await put(0, { frameColor: '#383e42' });
    await openHistory();
    expect(rows()).toEqual([
      'Agent (declared) · frame colour #f7f7f5 → #383e42Undo',
      'You · sashes 1 → 2',
    ]);
    const time = document.querySelector('.history-list time')!;
    expect(time.getAttribute('title')).toMatch(/2026/);
    expect(time.textContent).toMatch(/ago|now|in /);
    expect(screen.getByTitle('Declared by the client, not from the sign-on')).toBeInTheDocument();
    expect(api.history).toHaveLength(2);
  });

  it('undoes with one click, records it, and strikes the entry through', async () => {
    const api = openPiece('/catalog/openings/window.casement', { actor: 'agent' });
    await put(0, { frameColor: '#383e42' });
    const history = await openHistory();
    fireEvent.click(history.getByRole('button', { name: 'Undo: frame colour #f7f7f5 → #383e42' }));
    await waitFor(() => expect(rows()).toHaveLength(2));
    expect(api.calls('POST', /\/history\/[^/]+\/undo$/)).toHaveLength(1);
    expect(api.overrides.get(`mock-home/${kitchen}`)!.params).toEqual({});
    const [undo, undone] = [...document.querySelectorAll('.history-list li')];
    expect(undo).toHaveTextContent('frame colour #383e42 → #f7f7f5 (default) (undo)');
    expect(undone).toHaveClass('undone');
    expect(undone!.querySelector('s')).toHaveTextContent('frame colour #f7f7f5 → #383e42');
    expect(undone).toHaveTextContent(/undone by an agent at/);
    // The undo itself can be undone.
    expect(within(undo as HTMLElement).getByRole('button', { name: /^Undo/ })).toBeEnabled();
    expect(within(undone as HTMLElement).queryByRole('button')).not.toBeInTheDocument();
    // The row follows: no overrides any more.
    await waitFor(() =>
      expect(rowOf('mock-home', kitchen).getByLabelText('Overrides')).toHaveTextContent(
        'Type defaults',
      ),
    );
  });

  it('says to undo the later change first on a 409', async () => {
    openPiece('/catalog/openings/window.casement');
    await put(0, { frameColor: '#383e42' });
    const history = await openHistory();
    // Changed again while the list was open.
    await put(1, { frameColor: '#000000' });
    fireEvent.click(history.getByRole('button', { name: /^Undo/ }));
    expect(await history.findByRole('alert')).toHaveTextContent(
      'Changed again later: undo the later change first.',
    );
    await waitFor(() => expect(rows()).toHaveLength(2));
  });

  it('writes relative times', () => {
    const now = Date.parse('2026-01-02T00:00:00.000Z');
    expect(relativeTime('2026-01-01T23:55:00.000Z', now)).toBe('5 minutes ago');
    expect(relativeTime('2026-01-01T00:00:00.000Z', now)).toBe('yesterday');
    expect(relativeTime('2026-01-02T00:00:00.000Z', now)).toBe('now');
  });
});
