import type { OpeningOverride } from '@my-home/shared';
import { act, cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { isEditMode } from '../editMode/editMode';
import { navigate } from '../routing';
import { testPlacement } from '../test/fixtures';
import { openPiece, rowOf, writes } from '../test/piecePage';

vi.mock('./Inspector', () => ({ Inspector: () => <div data-testid="inspector" /> }));
vi.mock('../scene/Scene', () => ({ Scene: () => <div data-testid="scene" /> }));
vi.mock('../catalog-page/renderThumbnail', () => ({
  renderThumbnail: () => Promise.reject(new Error('no WebGL in jsdom')),
  THUMBNAIL_SIZE: 256,
}));

const kitchen = 'souterrain-kitchen-window';
const override: OpeningOverride = {
  homeId: 'mock-home',
  useId: kitchen,
  typeId: 'window.casement',
  params: { sashes: 2 },
  version: 1,
  updatedAt: '2026-01-01T00:00:00.000Z',
};

const header = () => within(document.querySelector('.page-header') as HTMLElement);
const edit = () => header().getByRole('button', { name: 'Edit' });
const done = () => header().getByRole('button', { name: 'Done' });

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  window.location.hash = '';
});

describe('the piece page in view mode', () => {
  it('has no editor, Remove or Undo: a #use= link opens the history read-only', async () => {
    const api = openPiece(
      `/catalog/openings/window.casement#use=${kitchen}`,
      { overrides: [override] },
      { editing: false },
    );
    await screen.findByText(/uses? in this environment/);
    expect(isEditMode()).toBe(false);
    expect(edit()).toHaveAttribute('aria-pressed', 'false');
    expect(screen.queryByRole('status', { name: 'Edit mode' })).not.toBeInTheDocument();

    const row = rowOf('mock-home', kitchen);
    expect(await row.findByRole('region', { name: 'History' })).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: /^Edit / })).not.toBeInTheDocument();
    expect(row.queryByRole('button', { name: /^Edit / })).not.toBeInTheDocument();
    expect(row.queryByRole('button', { name: /^Undo/ })).not.toBeInTheDocument();
    expect(row.queryByRole('button', { name: /^Remove / })).not.toBeInTheDocument();
    expect(writes(api)).toEqual([]);
  });

  it('turns the editor and Undo on with "Edit" and off again with "Done"', async () => {
    const api = openPiece(
      `/catalog/openings/window.casement#use=${kitchen}`,
      { overrides: [override] },
      { editing: false },
    );
    await screen.findByText(/uses? in this environment/);
    fireEvent.click(edit());
    expect(isEditMode()).toBe(true);
    expect(screen.getByRole('status', { name: 'Edit mode' })).toBeInTheDocument();
    expect(await screen.findByRole('region', { name: /^Edit / })).toBeInTheDocument();
    expect(rowOf('mock-home', kitchen).getByRole('button', { name: /^Edit / })).toBeInTheDocument();

    fireEvent.click(done());
    expect(isEditMode()).toBe(false);
    await waitFor(() =>
      expect(screen.queryByRole('region', { name: /^Edit / })).not.toBeInTheDocument(),
    );
    expect(writes(api)).toEqual([]);
  });

  it('offers Place only in edit mode', async () => {
    openPiece('/catalog/furniture/furniture.bed', {}, { editing: false });
    await screen.findByText(/uses? in this environment/);
    expect(screen.queryByRole('button', { name: 'Place…' })).not.toBeInTheDocument();
    fireEvent.click(edit());
    expect(await screen.findByRole('button', { name: 'Place…' })).toBeInTheDocument();
    fireEvent.click(done());
    expect(screen.queryByRole('button', { name: 'Place…' })).not.toBeInTheDocument();
  });

  it('offers Remove (for a use that needs attention) and Restore only in edit mode', async () => {
    const orphan = testPlacement({ id: 'gone-1', typeId: 'furniture.bed', levelId: 'nowhere' });
    const trashed = testPlacement({
      id: 'trashed-1',
      name: 'Trashed bed',
      typeId: 'furniture.bed',
      removedAt: '2026-01-02T00:00:00.000Z',
      purgeAt: '2026-02-01T00:00:00.000Z',
    });
    openPiece(
      '/catalog/furniture/furniture.bed',
      { placements: [orphan, trashed] },
      { editing: false },
    );
    await screen.findByText(/In the trash/);
    const section = within(screen.getByRole('region', { name: 'Uses' }));
    expect(section.queryByRole('button', { name: /^(Remove|Restore) / })).not.toBeInTheDocument();
    fireEvent.click(edit());
    await waitFor(() =>
      expect(section.getAllByRole('button', { name: /^(Remove|Restore) / }).length).toBeGreaterThan(
        0,
      ),
    );
  });

  it('keeps the mode while moving inside the app, but starts over on a new visit', async () => {
    openPiece('/catalog/openings/window.casement', {}, { editing: false });
    await screen.findByText(/uses? in this environment/);
    fireEvent.click(edit());
    // To another piece, with no reload: still in edit mode.
    act(() => navigate('/catalog/furniture/furniture.bed'));
    await screen.findByRole('heading', { level: 1, name: /Bed/ });
    await screen.findByText(/uses? in this environment/);
    expect(isEditMode()).toBe(true);
    expect(done()).toBeInTheDocument();
  });
});
