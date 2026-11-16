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
