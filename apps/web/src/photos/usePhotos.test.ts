import { act, renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { PhotosApi } from '../api';
import { testPhoto } from '../test/fixtures';
import { usePhotos } from './usePhotos';

const trash = { photos: [], requests: [], retentionDays: 30 };

describe('usePhotos', () => {
  it('ignores the answer to an older reload that arrives after a newer one', async () => {
    const answers: ((ids: string[]) => void)[] = [];
    const api = {
      list: vi.fn(
        () =>
          new Promise((resolve) =>
            answers.push((ids) =>
              resolve({ items: ids.map((id) => testPhoto({ id })), total: ids.length }),
            ),
          ),
      ),
      requests: vi.fn().mockResolvedValue({ items: [] }),
      trash: vi.fn().mockResolvedValue(trash),
    } as unknown as PhotosApi;
    const { result } = renderHook(() => usePhotos('mock-home', api));
    await waitFor(() => expect(answers).toHaveLength(1));
    act(() => void result.current.reload());
    await waitFor(() => expect(answers).toHaveLength(2));

    // The newer reload answers first, the older one afterwards with outdated data.
    await act(async () => answers[1]!(['new-a', 'new-b']));
    await waitFor(() => expect(result.current.photos.map((p) => p.id)).toEqual(['new-a', 'new-b']));
    await act(async () => answers[0]!(['stale']));
    expect(result.current.photos.map((p) => p.id)).toEqual(['new-a', 'new-b']);
  });

  it('guards same-tick tag writes per photo, without blocking another photo', async () => {
    const saves: (() => void)[] = [];
    const api = {
      list: vi
        .fn()
        .mockResolvedValue({ items: [testPhoto({ id: 'a' }), testPhoto({ id: 'b' })], total: 2 }),
      requests: vi.fn().mockResolvedValue({ items: [] }),
      trash: vi.fn().mockResolvedValue(trash),
      update: vi.fn(
        (id: string, body: { tags: string[] }) =>
          new Promise((resolve) => {
            saves.push(() => resolve(testPhoto({ id, tags: body.tags })));
          }),
      ),
    } as unknown as PhotosApi;
    const { result } = renderHook(() => usePhotos('mock-home', api));
    await waitFor(() => expect(result.current.photos).toHaveLength(2));
    let writes: Promise<void>[];
    act(() => {
      writes = [
        result.current.update('a', { tags: ['wall', 'window'] }),
        result.current.update('a', { tags: ['wall', 'door'] }),
        result.current.update('b', { tags: ['door'] }),
      ];
    });
    expect(api.update).toHaveBeenCalledTimes(2);
    expect(result.current.savingTags).toEqual(new Set(['a', 'b']));
    await act(async () => {
      saves.forEach((save) => save());
      await Promise.all(writes);
    });
    expect(result.current.savingTags.size).toBe(0);
  });

  it('ignores a pre-save read even when the post-save refresh fails', async () => {
    const photo = testPhoto({ tags: ['wall'] });
    let answerOldRead!: () => void;
    let failRefresh!: () => void;
    const api = {
      list: vi.fn().mockResolvedValue({ items: [photo], total: 1 }),
      requests: vi.fn().mockResolvedValue({ items: [] }),
      trash: vi.fn().mockResolvedValue(trash),
      update: vi.fn().mockResolvedValue({ ...photo, tags: ['wall', 'window'] }),
    } as unknown as PhotosApi;
    const { result } = renderHook(() => usePhotos('mock-home', api));
    await waitFor(() => expect(result.current.photos).toHaveLength(1));
    vi.mocked(api.list).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          answerOldRead = () => resolve({ items: [photo], total: 1 });
        }),
    );
    let oldRead!: Promise<void>;
    act(() => {
      oldRead = result.current.reload();
    });
    vi.mocked(api.list).mockImplementationOnce(
      () =>
        new Promise((_resolve, reject) => {
          failRefresh = () => reject(new Error('Refresh failed'));
        }),
    );
    let save!: Promise<void>;
    act(() => {
      save = result.current.update(photo.id, { tags: ['wall', 'window'] });
    });
    await waitFor(() => expect(result.current.photos[0]!.tags).toEqual(['wall', 'window']));
    await act(async () => {
      answerOldRead();
      await oldRead;
    });
    expect(result.current.photos[0]!.tags).toEqual(['wall', 'window']);
    await act(async () => {
      failRefresh();
      await save;
    });
    expect(result.current.error).toBe('Refresh failed');
    expect(result.current.photos[0]!.tags).toEqual(['wall', 'window']);
    expect(result.current.savingTags.size).toBe(0);
  });

  it('keeps the lists and reports the error when a reload fails', async () => {
    const api = {
      list: vi.fn().mockResolvedValue({ items: [testPhoto()], total: 1 }),
      requests: vi.fn().mockResolvedValue({ items: [] }),
      trash: vi.fn().mockResolvedValue(trash),
    } as unknown as PhotosApi;
    const { result } = renderHook(() => usePhotos('mock-home', api));
    await waitFor(() => expect(result.current.photos).toHaveLength(1));
    vi.mocked(api.list).mockRejectedValueOnce(
      new Error('GET /api/homes/mock-home/photos failed: 500'),
    );
    await act(() => result.current.reload());
    expect(result.current.error).toMatch(/failed: 500/);
    expect(result.current.photos).toHaveLength(1);
  });
});
