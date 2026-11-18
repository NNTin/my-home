import { roomAt } from '@my-home/shared';
import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { homeSummary } from '../test/fakeApi';
import { mockHome, testPlacement } from '../test/fixtures';
import { lastBody, openPiece } from '../test/piecePage';
import { encodeOverrides } from './playground';

vi.mock('./Inspector', () => ({ Inspector: () => <div data-testid="inspector" /> }));
vi.mock('../scene/Scene', () => ({ Scene: () => <div data-testid="scene" /> }));
vi.mock('../catalog-page/renderThumbnail', () => ({
  renderThumbnail: () => Promise.reject(new Error('no WebGL in jsdom')),
  THUMBNAIL_SIZE: 256,
}));

const place = () => within(screen.getByRole('form', { name: 'Place' }));
const selected = (name: string) =>
  (place().getByRole('combobox', { name }) as HTMLSelectElement).selectedOptions[0]!.textContent;

describe('Place', () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it('is offered for furniture only', async () => {
    openPiece('/catalog/openings/window.casement');
    await screen.findByText(/uses in this environment/);
    expect(screen.queryByRole('button', { name: 'Place…' })).not.toBeInTheDocument();
  });

  it('picks a home, a level and a room, with sensible defaults', async () => {
    openPiece('/catalog/furniture/furniture.bed?home=other-home', {
      homes: [homeSummary('mock-home', 'Mock home'), homeSummary('other-home', 'Other home')],
      models: { 'other-home': { ...mockHome, id: 'other-home', name: 'Other home' } },
    });
    fireEvent.click(await screen.findByRole('button', { name: 'Place…' }));
    expect(selected('Home')).toBe('Other home');
    expect(selected('Level')).toBe('Souterrain');
    expect(selected('Room')).toBe('Hallway');
    // Only levels with rooms are offered; the rooms are those of the level.
    expect(
      within(place().getByRole('combobox', { name: 'Level' }))
        .getAllByRole('option')
        .map((o) => o.textContent),
    ).toEqual(
      mockHome.levels
        .filter((l) => mockHome.rooms.some((r) => r.levelId === l.id))
        .map((l) => l.name),
    );
    fireEvent.change(place().getByRole('combobox', { name: 'Room' }), {
      target: { value: 'souterrain-kitchen' },
    });
    expect(selected('Room')).toBe('Kitchen');
    fireEvent.change(place().getByRole('combobox', { name: 'Home' }), {
      target: { value: 'mock-home' },
    });
    expect(selected('Level')).toBe('Souterrain');
  });

  it('places with the playground values on a free spot, then opens the viewer on it', async () => {
    const api = openPiece(
      `/catalog/furniture/furniture.bed?home=mock-home&p=${encodeOverrides({ width: 1.8 })}`,
      { placements: [testPlacement({ typeId: 'furniture.chair', id: 'souterrain-chair-1' })] },
    );
    fireEvent.click(await screen.findByRole('button', { name: 'Place…' }));
    fireEvent.change(place().getByRole('combobox', { name: 'Room' }), {
      target: { value: 'souterrain-bedroom' },
    });
    fireEvent.click(place().getByRole('button', { name: 'Place and open in the viewer' }));
    await waitFor(() => expect(api.calls('POST', /\/placements$/)).toHaveLength(1));
    const body = lastBody(api, 'POST', /\/placements$/) as {
      typeId: string;
      levelId: string;
      position: { x: number; z: number };
      rotationY: number;
      params: object;
    };
    expect(body).toMatchObject({
      typeId: 'furniture.bed',
      levelId: 'souterrain',
      params: { width: 1.8 },
    });
    expect(typeof body.rotationY).toBe('number');
    // In the bedroom, clear of the chair already there.
    expect(roomAt(mockHome, 'souterrain', body.position)?.id).toBe('souterrain-bedroom');
    expect(body.position).not.toEqual(testPlacement().position);
    await waitFor(() => expect(window.location.pathname).toBe('/'));
    expect(Object.fromEntries(new URLSearchParams(window.location.search))).toEqual({
      home: 'mock-home',
      focus: 'souterrain-bed-1',
      panel: 'furniture',
    });
    expect(await screen.findByTestId('scene')).toBeInTheDocument();
  });

  it('shows why a placement was refused', async () => {
    const api = openPiece('/catalog/furniture/furniture.bed');
    fireEvent.click(await screen.findByRole('button', { name: 'Place…' }));
    api.fetch.mockImplementationOnce(() =>
      Promise.resolve(
        new Response(
          JSON.stringify({ statusCode: 404, error: 'Not Found', message: 'Level not found' }),
          { status: 404 },
        ),
      ),
    );
    fireEvent.click(place().getByRole('button', { name: 'Place and open in the viewer' }));
    expect(await place().findByRole('alert')).toHaveTextContent('Level not found');
    expect(window.location.pathname).toBe('/catalog/furniture/furniture.bed');
  });
});
