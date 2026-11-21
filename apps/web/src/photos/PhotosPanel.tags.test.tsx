import type { Photo, UpdatePhotoBody } from '@my-home/shared';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import type { PhotosApi } from '../api';
import { testPhoto } from '../test/fixtures';
import { NO_FILTERS } from './filters';
import { PhotosPanel } from './PhotosPanel';
import { usePhotos } from './usePhotos';

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

async function gallery() {
  let stored = testPhoto({ tags: ['wall'] });
  const api = {
    list: vi.fn(async () => ({ items: [stored], total: 1 })),
    requests: vi.fn().mockResolvedValue({ items: [] }),
    trash: vi.fn().mockResolvedValue({ photos: [], requests: [], retentionDays: 30 }),
    update: vi.fn(async (_id: string, body: UpdatePhotoBody) => {
      stored = { ...stored, tags: body.tags ?? stored.tags };
      return stored;
    }),
  };
  function Gallery() {
    const photos = usePhotos('mock-home', api as unknown as PhotosApi);
    const [selectedId, onSelect] = useState<string | undefined>(stored.id);
    return (
      <PhotosPanel
        photos={photos}
        levels={[]}
        tab="photos"
        onTab={() => undefined}
        selectedId={selectedId}
        onSelect={onSelect}
        filters={NO_FILTERS}
        onFilters={() => undefined}
        viewing={false}
        onViewFromHere={() => undefined}
        overlay={{ on: false, opacity: 0.5 }}
        onOverlay={() => undefined}
        onClose={() => undefined}
      />
    );
  }
  render(<Gallery />);
  const detail = within(await screen.findByRole('group', { name: 'Photo details' }));
  return { api, detail, stored: () => stored };
}

describe('gallery tag saves', () => {
  it.each([
    { first: 'window', blocked: 'door', expected: ['wall', 'window'] },
    { first: 'wall', blocked: 'window', expected: [] },
    { first: 'window', blocked: 'wall', expected: ['wall', 'window'] },
  ])(
    'blocks rapid $first / $blocked changes through save and refresh',
    async ({ first, blocked, expected }) => {
      const { api, detail, stored } = await gallery();
      const save = deferred<void>();
      const refresh = deferred<{ items: Photo[]; total: number }>();
      const update = api.update.getMockImplementation()!;
      api.update.mockImplementationOnce(async (id, body) => {
        await save.promise;
        return update(id, body);
      });
      api.list.mockImplementationOnce(() => refresh.promise);

      fireEvent.click(detail.getByLabelText(first));
      expect(detail.getByRole('status')).toHaveTextContent('Saving tags...');
      for (const checkbox of detail.getAllByRole('checkbox')) expect(checkbox).toBeDisabled();
      expect(detail.getByLabelText('New tag')).toBeDisabled();
      fireEvent.click(detail.getByLabelText(blocked));
      fireEvent.click(detail.getByLabelText(first));
      expect(api.update).toHaveBeenCalledTimes(1);
      expect(stored().tags).toEqual(['wall']);

      await act(async () => save.resolve());
      expect(stored().tags).toEqual(expected);
      expect(detail.getByLabelText(first)).toBeDisabled();
      fireEvent.click(detail.getByLabelText(blocked));
      expect(api.update).toHaveBeenCalledTimes(1);

      await act(async () => refresh.resolve({ items: [stored()], total: 1 }));
      expect(detail.queryByRole('status')).not.toBeInTheDocument();
      expect(detail.getByLabelText(first)).toBeEnabled();
      fireEvent.click(detail.getByLabelText(blocked));
      await waitFor(() => expect(detail.getByLabelText(blocked)).toBeEnabled());
      expect(stored().tags).toEqual(
        expected.includes(blocked)
          ? expected.filter((tag) => tag !== blocked)
          : [...expected, blocked],
      );
    },
  );

  it('blocks custom submission while pending and retains the draft for later submission', async () => {
    const { api, detail, stored } = await gallery();
    const save = deferred<void>();
    const update = api.update.getMockImplementation()!;
    api.update.mockImplementationOnce(async (id, body) => {
      await save.promise;
      return update(id, body);
    });
    const input = detail.getByLabelText('New tag');
    fireEvent.change(input, { target: { value: ' Radiator ' } });
    fireEvent.click(detail.getByLabelText('window'));
    fireEvent.submit(input);
    expect(api.update).toHaveBeenCalledTimes(1);
    expect(input).toHaveValue(' Radiator ');

    await act(async () => save.resolve());
    expect(input).toBeEnabled();
    fireEvent.submit(input);
    await waitFor(() => expect(detail.getByLabelText('radiator')).toBeChecked());
    expect(stored().tags).toEqual(['wall', 'window', 'radiator']);
  });

  it('keeps a pending photo locked when its detail is closed and reopened', async () => {
    const { api, detail } = await gallery();
    const save = deferred<void>();
    const update = api.update.getMockImplementation()!;
    api.update.mockImplementationOnce(async (id, body) => {
      await save.promise;
      return update(id, body);
    });
    fireEvent.click(detail.getByLabelText('window'));
    fireEvent.click(detail.getByRole('button', { name: 'Close' }));
    fireEvent.click(screen.getByRole('img', { name: /^Hallway,/ }));
    const reopened = within(screen.getByRole('group', { name: 'Photo details' }));
    expect(reopened.getByLabelText('door')).toBeDisabled();
    expect(reopened.getByLabelText('New tag')).toBeDisabled();
    fireEvent.click(reopened.getByLabelText('door'));
    expect(api.update).toHaveBeenCalledTimes(1);
    await act(async () => save.resolve());
    expect(reopened.getByLabelText('window')).toBeChecked();
    expect(reopened.getByLabelText('door')).toBeEnabled();
  });

  it('shows a failed save with unchanged tags and allows retry', async () => {
    const { api, detail, stored } = await gallery();
    const save = deferred<Photo>();
    api.update.mockImplementationOnce(() => save.promise);
    fireEvent.click(detail.getByLabelText('window'));
    await act(async () => save.reject(new Error('Tag save failed')));

    expect(screen.getByRole('alert')).toHaveTextContent('Tag save failed');
    expect(detail.getByLabelText('window')).not.toBeChecked();
    expect(detail.getByLabelText('window')).toBeEnabled();
    expect(stored().tags).toEqual(['wall']);
    fireEvent.click(detail.getByLabelText('window'));
    await waitFor(() => expect(detail.getByLabelText('window')).toBeEnabled());
    expect(detail.getByLabelText('window')).toBeChecked();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(stored().tags).toEqual(['wall', 'window']);
  });

  it('retains confirmed tags after a failed refresh so the next edit does not overwrite them', async () => {
    const { api, detail, stored } = await gallery();
    const refresh = deferred<{ items: Photo[]; total: number }>();
    api.list.mockImplementationOnce(() => refresh.promise);
    fireEvent.click(detail.getByLabelText('window'));
    await waitFor(() => expect(detail.getByLabelText('window')).toBeChecked());
    expect(detail.getByLabelText('door')).toBeDisabled();
    await act(async () => refresh.reject(new Error('Refresh failed')));

    expect(screen.getByRole('alert')).toHaveTextContent('Refresh failed');
    expect(detail.getByLabelText('window')).toBeChecked();
    expect(detail.getByLabelText('door')).toBeEnabled();
    fireEvent.click(detail.getByLabelText('door'));
    await waitFor(() => expect(detail.getByLabelText('door')).toBeEnabled());
    expect(stored().tags).toEqual(['wall', 'window', 'door']);
  });
});
