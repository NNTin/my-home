import type { Photo, PhotoRequest, TrashResponse, UpdatePhotoBody } from '@my-home/shared';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { photosApi, type PhotosApi } from '../api';

export interface PhotosState {
  photos: Photo[];
  requests: PhotoRequest[];
  trash: TrashResponse | undefined;
  /** The last thing that went wrong, for the panel to show. */
  error?: string | undefined;
}

export interface Photos extends PhotosState {
  reload(): Promise<void>;
  update(id: string, body: UpdatePhotoBody): Promise<void>;
  /** Moves a photo to the trash. */
  remove(id: string): Promise<void>;
  restore(id: string): Promise<void>;
  purge(id: string): Promise<void>;
  cancelRequest(id: string): Promise<void>;
  reopenRequest(id: string): Promise<void>;
  removeRequest(id: string): Promise<void>;
  restoreRequest(id: string): Promise<void>;
  purgeRequest(id: string): Promise<void>;
  emptyTrash(): Promise<void>;
}

/**
 * The photos, photo requests and trash of a home. The lists are small, so every change is
 * followed by a reload instead of being patched in locally.
 */
export function usePhotos(homeId: string, api: PhotosApi = photosApi): Photos {
  const [state, setState] = useState<PhotosState>({ photos: [], requests: [], trash: undefined });

  const reload = useCallback(async () => {
    try {
      const [photos, requests, trash] = await Promise.all([
        api.list(homeId),
        api.requests(homeId),
        api.trash(homeId),
      ]);
      setState({ photos: photos.items, requests: requests.items, trash });
    } catch (err) {
      setState((s) => ({ ...s, error: (err as Error).message }));
    }
  }, [api, homeId]);
  useEffect(() => {
    void reload();
  }, [reload]);

  return useMemo(() => {
    const run = (action: () => Promise<unknown>) => async () => {
      let error: string | undefined;
      try {
        await action();
      } catch (err) {
        error = (err as Error).message;
      }
      await reload();
      if (error !== undefined) setState((s) => ({ ...s, error }));
    };
    return {
      ...state,
      reload,
      update: (id, body) => run(() => api.update(id, body))(),
      remove: (id) => run(() => api.remove(id))(),
      restore: (id) => run(() => api.restore(id))(),
      purge: (id) => run(() => api.purge(id))(),
      cancelRequest: (id) => run(() => api.cancelRequest(id))(),
      reopenRequest: (id) => run(() => api.reopenRequest(id))(),
      removeRequest: (id) => run(() => api.removeRequest(id))(),
      restoreRequest: (id) => run(() => api.restoreRequest(id))(),
      purgeRequest: (id) => run(() => api.purgeRequest(id))(),
      emptyTrash: run(() => api.emptyTrash(homeId)),
    };
  }, [api, homeId, reload, state]);
}
