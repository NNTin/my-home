import type { Photo, PhotoRequest, Use } from '@my-home/shared';
import { useEffect, useRef, useState } from 'react';
import { photosApi } from '../api';
import { roomLabel } from '../photos/filters';
import { href, Link } from '../routing';
import { photosOfUse, requestsOfUse } from './uses';
import { SkButton } from '../hud/SkButton';
import { SkCard } from '../hud/SkCard';
import { SkCheckbox } from '../hud/SkCheckbox';
import { SkPanel } from '../hud/SkPanel';

const when = (iso: string) =>
  new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });

const photoName = (photo: Photo) => `${roomLabel(photo).name}, ${when(photo.takenAt)}`;

/** Thumbnails; a tap opens the photo. */
function PhotoStrip({
  photos,
  label,
  onOpen,
}: {
  photos: Photo[];
  label: string;
  onOpen(photo: Photo): void;
}) {
  return (
    <ul className="photo-strip" aria-label={label}>
      {photos.map((photo) => (
        <li key={photo.id}>
          <SkCard className="thumbnail" label={photoName(photo)} onClick={() => onOpen(photo)}>
            <img src={photosApi.thumbnailUrl(photo.id)} alt={photoName(photo)} loading="lazy" />
          </SkCard>
        </li>
      ))}
    </ul>
  );
}

/**
 * One photo, large, with where and when it was taken and what it shows. Read-only here: notes,
 * tags and deleting stay in the viewer's gallery, which "Open in the gallery" leads to.
 */
export function PhotoViewer({ photo, onClose }: { photo: Photo; onClose(): void }) {
  // The focus goes to Close: the button inside its element.
  const close = useRef<HTMLSpanElement>(null);
  // The latest `onClose`, so the effect below runs once per open photo, not on every render of
  // the parent (which passes a new function each time).
  const closeRef = useRef(onClose);
  useEffect(() => {
    closeRef.current = onClose;
  });
  useEffect(() => {
    close.current?.querySelector<HTMLElement>('sakuga-button, button')?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeRef.current();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [photo.id]);
  const room = roomLabel(photo);
  return (
    <SkPanel className="photo-viewer" kind="dialog" label={`Photo: ${photoName(photo)}`}>
      <a href={photosApi.imageUrl(photo.id)} target="_blank" rel="noreferrer">
        <img src={photosApi.imageUrl(photo.id)} alt={`Photo taken in ${room.name}`} />
      </a>
      <p>
        <strong>{room.name}</strong> · {when(photo.takenAt)}
      </p>
      {photo.note && <p className="piece-note">{photo.note}</p>}
      {photo.subjects.length > 0 && (
        <p className="piece-note">
          Shows:{' '}
          {photo.subjects
            .map((s) => `${s.name ?? s.id}${s.status === 'missing' ? ' (gone)' : ''}`)
            .join(', ')}
        </p>
      )}
      <div className="buttons">
        <SkButton
          size="compact"
          variant="secondary"
          href={href({ page: 'viewer' }, { home: photo.homeId, panel: 'photos' })}
        >
          Open in the gallery
        </SkButton>
        <span ref={close}>
          <SkButton size="compact" variant="secondary" onClick={onClose}>
            Close
          </SkButton>
        </span>
      </div>
    </SkPanel>
  );
}

/** Photos with a viewer for the one tapped. */
export function PhotoList({ photos, label }: { photos: Photo[]; label: string }) {
  const [open, setOpen] = useState<Photo>();
  if (photos.length === 0) return <p className="piece-note">No photos yet.</p>;
  return (
    <>
      <PhotoStrip photos={photos} label={label} onOpen={setOpen} />
      {open && <PhotoViewer photo={open} onClose={() => setOpen(undefined)} />}
    </>
  );
}

const asSubjects = (photo: Photo) => photo.subjects.map(({ kind, id }) => ({ kind, id }));

/**
 * The photos of one use, "Link a photo…" from the home's photos (newest first, those of the
 * use's room by default), and the open photo requests about it. Nothing here deletes a photo or a
 * request.
 */
export function UsePhotos({
  homeId,
  use,
  photos,
  requests,
  roomName,
  onChanged,
}: {
  homeId: string;
  use: Use;
  /** Every photo of the home, newest first. */
  photos: Photo[];
  requests: PhotoRequest[];
  roomName(id: string): string | undefined;
  /** After linking or unlinking: the home's photos are loaded again. */
  onChanged(): Promise<unknown>;
}) {
  const [picking, setPicking] = useState(false);
  const [onlyRoom, setOnlyRoom] = useState(use.roomIds.length > 0);
  const [error, setError] = useState<string>();
  const linked = photosOfUse(photos, use.id);
  const open = requestsOfUse(requests, use.id);
  const rooms = new Set(use.roomIds);
  const candidates = photos.filter(
    (p) =>
      !linked.includes(p) &&
      (!onlyRoom || rooms.has(p.room?.id ?? '') || rooms.has(p.capturedRoomId ?? '')),
  );

  const patch = async (photo: Photo, subjects: { kind: 'type' | 'use'; id: string }[]) => {
    try {
      await photosApi.update(photo.id, { subjects });
      setError(undefined);
      await onChanged();
    } catch (err) {
      setError((err as Error).message);
    }
  };
  const link = (photo: Photo) => patch(photo, [...asSubjects(photo), { kind: 'use', id: use.id }]);
  const unlink = (photo: Photo) =>
    patch(
      photo,
      asSubjects(photo).filter((s) => !(s.kind === 'use' && s.id === use.id)),
    );
  const [viewing, setViewing] = useState<Photo>();

  return (
    <div className="use-photos" role="group" aria-label="Photos">
      <h4>Photos</h4>
      {linked.length === 0 ? (
        <p className="piece-note">No photos linked yet.</p>
      ) : (
        <ul className="photo-strip" aria-label={`Photos of ${use.name}`}>
          {linked.map((photo) => (
            <li key={photo.id}>
              <SkCard
                className="thumbnail"
                label={photoName(photo)}
                onClick={() => setViewing(photo)}
              >
                <img src={photosApi.thumbnailUrl(photo.id)} alt={photoName(photo)} loading="lazy" />
              </SkCard>
              <SkButton
                size="compact"
                variant="secondary"
                className="link-button"
                aria-label={`Unlink ${photoName(photo)}`}
                onClick={() => void unlink(photo)}
              >
                Unlink
              </SkButton>
            </li>
          ))}
        </ul>
      )}
      {viewing && <PhotoViewer photo={viewing} onClose={() => setViewing(undefined)} />}
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <SkButton
        size="compact"
        variant="secondary"
        pressed={picking}
        onClick={() => setPicking((p) => !p)}
      >
        Link a photo…
      </SkButton>
      {picking && (
        <div className="photo-picker" role="group" aria-label="Link a photo">
          {use.roomIds.length > 0 && (
            <SkCheckbox
              className="piece-toggle"
              size="compact"
              checked={onlyRoom}
              onChange={setOnlyRoom}
            >
              Only photos in {use.roomIds.map((id) => roomName(id) ?? id).join(' or ')}
            </SkCheckbox>
          )}
          {candidates.length === 0 ? (
            <p className="piece-note">No other photos{onlyRoom ? ' in this room' : ''}.</p>
          ) : (
            <ul className="photo-strip" aria-label="Photos to link">
              {candidates.map((photo) => (
                <li key={photo.id}>
                  <SkCard
                    className="thumbnail"
                    label={`Link ${photoName(photo)}`}
                    onClick={() => void link(photo)}
                  >
                    <img src={photosApi.thumbnailUrl(photo.id)} alt="" loading="lazy" />
                  </SkCard>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
      {open.length > 0 && (
        <ul className="use-requests" aria-label="Photo requests">
          {open.map((r) => (
            <li key={r.id}>
              Requested by {r.requester === 'agent' ? 'agent' : 'you'}: <em>{r.reason}</em>{' '}
              <Link to={href({ page: 'viewer' }, { home: homeId, walk: 'first' })}>
                Open in walk mode
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
