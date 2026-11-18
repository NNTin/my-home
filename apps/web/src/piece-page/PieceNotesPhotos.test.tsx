import type { Photo } from '@my-home/shared';
import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { testPhoto, testRequest } from '../test/fixtures';
import { lastBody, openPiece, rowOf, writes } from '../test/piecePage';

vi.mock('./Inspector', () => ({ Inspector: () => <div data-testid="inspector" /> }));
vi.mock('../catalog-page/renderThumbnail', () => ({
  renderThumbnail: () => Promise.reject(new Error('no WebGL in jsdom')),
  THUMBNAIL_SIZE: 256,
}));

const kitchen = 'souterrain-kitchen-window';
const subject = (kind: 'type' | 'use', id: string) => ({
  kind,
  id,
  name: id,
  status: 'current' as const,
});
const kitchenRoom = { id: 'souterrain-kitchen', name: 'Kitchen' };

const photos: Photo[] = [
  testPhoto({ id: 'type-photo', subjects: [subject('type', 'window.casement')] }),
  testPhoto({ id: 'use-photo', room: kitchenRoom, subjects: [subject('use', kitchen)] }),
  testPhoto({ id: 'kitchen-photo', room: kitchenRoom, capturedRoomId: 'souterrain-kitchen' }),
  testPhoto({ id: 'hallway-photo' }),
  testPhoto({ id: 'door-photo', subjects: [subject('type', 'door.interior')] }),
];

const typeSection = () => within(screen.getByRole('region', { name: 'Photos & notes' }));

async function openRow() {
  await screen.findByText(/uses in this environment/);
  fireEvent.click(
    rowOf('mock-home', kitchen).getByRole('button', { name: 'History of Kitchen · back window' }),
  );
  return within(rowOf('mock-home', kitchen).getByRole('group', { name: 'Photos' }));
}

/** Every element that could delete a photo or a request. */
const deleteControls = () =>
  screen
    .queryAllByRole('button')
    .filter((b) => /delete|purge|trash|remove/i.test(b.textContent ?? ''))
    .filter((b) => !/note/i.test(b.textContent ?? ''));

describe('photos and notes on the piece page', () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    window.location.hash = '';
  });

  it("shows the type's photos and its uses' photos, and opens one without a delete", async () => {
    openPiece('/catalog/openings/window.casement', { photos });
    await screen.findByText(/uses in this environment/);
    const strip = typeSection().getByRole('list', { name: 'Photos of Casement window' });
    expect(within(strip).getAllByRole('button')).toHaveLength(2);
    fireEvent.click(within(strip).getAllByRole('button')[1]!);
    const viewer = within(screen.getByRole('dialog'));
    expect(viewer.getByRole('img', { name: 'Photo taken in Kitchen' })).toBeInTheDocument();
    expect(viewer.getByRole('link', { name: 'Open in the gallery' })).toHaveAttribute(
      'href',
      '/?home=mock-home&panel=photos',
    );
    expect(deleteControls()).toEqual([]);
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(rowOf('mock-home', kitchen).getByText('📷 1 photo')).toBeInTheDocument();
  });

  it('keeps the focus where it is while the page behind the photo re-renders', async () => {
    openPiece('/catalog/openings/window.casement', { photos });
    await screen.findByText(/uses in this environment/);
    const strip = typeSection().getByRole('list', { name: 'Photos of Casement window' });
    fireEvent.click(within(strip).getAllByRole('button')[0]!);
    const viewer = within(screen.getByRole('dialog'));
    expect(viewer.getByRole('button', { name: 'Close' })).toHaveFocus();
    const gallery = viewer.getByRole('link', { name: 'Open in the gallery' });
    gallery.focus();
    // Opening a use re-renders the whole page, the viewer's parent included.
    window.location.hash = `#use=${kitchen}`;
    await waitFor(() =>
      expect(
        rowOf('mock-home', kitchen).getByRole('button', { name: 'Edit Kitchen · back window' }),
      ).toHaveAttribute('aria-pressed', 'true'),
    );
    expect(gallery).toHaveFocus();
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it("links a photo of the use's room to the use", async () => {
    const api = openPiece('/catalog/openings/window.casement', { photos });
    const group = await openRow();
    expect(group.getByRole('list', { name: 'Photos of Kitchen · back window' })).toBeTruthy();
    fireEvent.click(group.getByRole('button', { name: 'Link a photo…' }));
    const picker = within(group.getByRole('group', { name: 'Link a photo' }));
    // The kitchen's other photo only, until the room filter is off.
    expect(picker.getAllByRole('button')).toHaveLength(1);
    fireEvent.click(picker.getByRole('checkbox', { name: /Only photos in Kitchen/ }));
    expect(picker.getAllByRole('button')).toHaveLength(4);
    fireEvent.click(picker.getByRole('checkbox', { name: /Only photos in Kitchen/ }));
    fireEvent.click(picker.getAllByRole('button')[0]!);
    await waitFor(() =>
      expect(api.photos.get('kitchen-photo')!.subjects.map((s) => s.id)).toEqual([kitchen]),
    );
    expect(lastBody(api, 'PATCH', /\/api\/photos\/kitchen-photo$/)).toEqual({
      subjects: [{ kind: 'use', id: kitchen }],
    });
    await waitFor(() =>
      expect(rowOf('mock-home', kitchen).getByText('📷 2 photos')).toBeInTheDocument(),
    );
    // Unlinking keeps the photo and its other subjects.
    fireEvent.click(group.getAllByRole('button', { name: /^Unlink Kitchen/ })[0]!);
    await waitFor(() => expect(writes(api).filter((w) => w.startsWith('PATCH'))).toHaveLength(2));
    expect(writes(api).every((w) => w.startsWith('PATCH /api/photos/'))).toBe(true);
    expect(deleteControls()).toEqual([]);
  });

  it('lists the open photo requests of a use, with a way into walk mode', async () => {
    openPiece('/catalog/openings/window.casement', {
      requests: [
        testRequest({
          reason: 'photograph the kitchen window',
          subject: subject('use', kitchen),
        }),
        testRequest({ id: 'closed', status: 'fulfilled', subject: subject('use', kitchen) }),
      ],
    });
    const group = await openRow();
    const list = within(group.getByRole('list', { name: 'Photo requests' }));
    expect(list.getAllByRole('listitem')).toHaveLength(1);
    expect(list.getByRole('listitem')).toHaveTextContent(
      'Requested by agent: photograph the kitchen window',
    );
    expect(list.getByRole('link', { name: 'Open in walk mode' })).toHaveAttribute(
      'href',
      '/?home=mock-home&walk=first',
    );
    expect(rowOf('mock-home', kitchen).getByText('1 photo request')).toBeInTheDocument();
    expect(deleteControls()).toEqual([]);
  });

  it('adds, edits and deletes notes on the type and on a use', async () => {
    const api = openPiece('/catalog/openings/window.casement');
    await screen.findByText(/uses in this environment/);
    const typeNotes = within(typeSection().getByRole('group', { name: 'Notes' }));
    expect(await typeNotes.findByText('No notes yet.')).toBeInTheDocument();
    fireEvent.change(typeNotes.getByRole('textbox', { name: 'New note' }), {
      target: { value: '  Same frames everywhere  ' },
    });
    fireEvent.click(typeNotes.getByRole('button', { name: 'Add note' }));
    expect(
      await typeNotes.findByText('Same frames everywhere', { selector: 'p' }),
    ).toBeInTheDocument();
    expect(lastBody(api, 'POST', /\/api\/notes$/)).toEqual({
      subject: { kind: 'type', id: 'window.casement' },
      body: 'Same frames everywhere',
    });

    await openRow();
    const rowNotes = within(rowOf('mock-home', kitchen).getByRole('group', { name: 'Notes' }));
    fireEvent.change(rowNotes.getByRole('textbox', { name: 'New note' }), {
      target: { value: 'Sticks in winter' },
    });
    fireEvent.click(rowNotes.getByRole('button', { name: 'Add note' }));
    expect(await rowNotes.findByRole('button', { name: 'Edit note' })).toBeInTheDocument();
    expect(rowNotes.getByText('Sticks in winter', { selector: 'p' })).toBeInTheDocument();
    expect(lastBody(api, 'POST', /\/api\/notes$/)).toEqual({
      subject: { kind: 'use', id: kitchen },
      homeId: 'mock-home',
      body: 'Sticks in winter',
    });
    fireEvent.click(rowNotes.getByRole('button', { name: 'Edit note' }));
    fireEvent.change(rowNotes.getByRole('textbox', { name: 'Edit the note' }), {
      target: { value: 'Sticks in winter, oil the hinges' },
    });
    fireEvent.click(rowNotes.getByRole('button', { name: 'Save note' }));
    expect(
      await rowNotes.findByText('Sticks in winter, oil the hinges', { selector: 'p' }),
    ).toBeInTheDocument();
    fireEvent.click(rowNotes.getByRole('button', { name: 'Delete note' }));
    expect(await rowNotes.findByText('No notes yet.')).toBeInTheDocument();
    // The type's note is still there; deleting sent no JSON content type (an empty body).
    expect(typeNotes.getByText('Same frames everywhere')).toBeInTheDocument();
    const del = api.calls('DELETE', /\/api\/notes\//)[0]![1]!;
    expect(del.headers).toBeUndefined();
  });
});
