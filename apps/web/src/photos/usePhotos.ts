import type { Photo, PhotoRequest, TrashResponse, UpdatePhotoBody } from '@my-home/shared';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
  /** Undoes one change of a photo's pose (its history is `api.poseHistory`). */
  undoPose(id: string, changeId: string): Promise<void>;
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

  // Reloads can overlap (two quick edits, a capture while a list is loading). Only the answer to
  // the latest one is shown, so an older, slower response never overwrites newer data.
  const latest = useRef(0);
  const reload = useCallback(async () => {
    const turn = ++latest.current;
    try {
      const [photos, requests, trash] = await Promise.all([
        api.list(homeId),
        api.requests(homeId),
        api.trash(homeId),
      ]);
      if (turn === latest.current)
        setState({ photos: photos.items, requests: requests.items, trash });
    } catch (err) {
      if (turn === latest.current) setState((s) => ({ ...s, error: (err as Error).message }));
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
      undoPose: (id, changeId) => run(() => api.undoPose(id, changeId))(),
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
