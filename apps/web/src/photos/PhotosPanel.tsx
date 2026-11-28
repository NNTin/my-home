import type { Photo, PhotoPose, PhotoRequest } from '@my-home/shared';
import { useState } from 'react';
import { photosApi } from '../api';
import { PHOTO_TAGS } from '../walk/CaptureSheet';
import {
  filterOptions,
  filterPhotos,
  NO_FILTERS,
  OUTDOORS,
  roomLabel,
  type PhotoFilters,
} from './filters';
import { fovHOf, headingDegrees } from './frustum';
import { PoseEditor } from './PoseEditor';
import { openRequests } from './requests';
import type { Photos } from './usePhotos';
import { SkButton } from '../hud/SkButton';
import { SkCard } from '../hud/SkCard';
import { SkCheckbox } from '../hud/SkCheckbox';
import { SkField } from '../hud/SkField';
import { SkPanel } from '../hud/SkPanel';
import { SkSlider } from '../hud/SkSlider';
import { SkTabs } from '../hud/SkTabs';

export interface OverlaySettings {
  /** Whether the photo is laid over the 3D view while viewing from its pose. */
  on: boolean;
  opacity: number;
}

interface Props {
  photos: Photos;
  levels: { id: string; name: string }[];
  tab: PhotosTab;
  onTab(tab: PhotosTab): void;
  selectedId: string | undefined;
  onSelect(id: string | undefined): void;
  /** The filters also decide which camera markers the 3D view shows. */
  filters: PhotoFilters;
  onFilters(filters: PhotoFilters): void;
  /** Whether the 3D camera currently sits at the selected photo's pose. */
  viewing: boolean;
  onViewFromHere(on: boolean): void;
  overlay: OverlaySettings;
  onOverlay(overlay: OverlaySettings): void;
  /** A pose being corrected and not saved yet, for the 3D view; undefined for the stored one. */
  onDraftPose?(pose: PhotoPose | undefined): void;
  onClose(): void;
  /**
   * Inside the phone's sheet, whose own tabs switch between the photos and the requests: no
   * heading, no close button and no tab row, only a switch to the trash and back.
   */
  compact?: boolean;
}

export type PhotosTab = 'photos' | 'requests' | 'trash';

const when = (iso: string) =>
  new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
const degrees = (radians: number) => Math.round((radians * 180) / Math.PI);
const metres = (value: number) => value.toFixed(2);

function Thumbnail({
  photo,
  selected,
  onClick,
}: {
  photo: Photo;
  selected?: boolean;
  onClick?(): void;
}) {
  const room = roomLabel(photo);
  const image = (
    <img
      src={photosApi.thumbnailUrl(photo.id)}
      alt={`${room.name}, ${when(photo.takenAt)}`}
      loading="lazy"
    />
  );
  // A card holding the image (docs/design/hud.md §4.6): selected is its pink shadow.
  return onClick ? (
    <SkCard
      className="thumbnail"
      label={`${room.name} · ${when(photo.takenAt)}`}
      selected={selected ?? false}
      onClick={onClick}
    >
      {image}
    </SkCard>
  ) : (
    <span className="thumbnail">{image}</span>
  );
}

const signed = (value: number) => `${value > 0 ? '+' : ''}${Math.round(value * 10) / 10}°`;

/** Where the photo's heading came from, in a sentence. */
export function sensorSummary(photo: Pick<Photo, 'sensors'>): string {
  const s = photo.sensors;
  if (!s) return 'Heading: no sensor data (taken before it was recorded).';
  if (s.source === 'manual') return 'Heading set by hand (compass off).';
  const parts = [
    s.trueBearing === undefined ? undefined : `true bearing ${Math.round(s.trueBearing)}°`,
    s.compassAccuracy === undefined
      ? 'accuracy unknown'
      : s.compassAccuracy < 0
        ? 'compass unreliable'
        : `±${Math.round(s.compassAccuracy)}°`,
    `declination ${signed(s.declination ?? 0)}`,
    `calibration ${signed(s.calibrationOffset ?? 0)}`,
    s.screenAngle ? `screen turned ${s.screenAngle}°` : undefined,
  ];
  return `🧭 Heading measured by the phone: ${parts.filter(Boolean).join(' · ')}.`;
}

const requestPlace = (
  request: PhotoRequest,
  levelName: (id: string | null) => string | undefined,
) =>
  [request.roomName ?? request.roomId, levelName(request.levelId)].filter(Boolean).join(' · ') ||
  'Anywhere';

function Detail({
  photo,
  request,
  levelName,
  photos,
  viewing,
  onViewFromHere,
  overlay,
  onOverlay,
  onDraftPose,
  onClose,
}: {
  photo: Photo;
  request: PhotoRequest | undefined;
  levelName(id: string | null): string | undefined;
  onDraftPose(pose: PhotoPose | undefined): void;
} & Pick<Props, 'photos' | 'viewing' | 'onViewFromHere' | 'overlay' | 'onOverlay'> & {
    onClose(): void;
  }) {
  const [note, setNote] = useState(photo.note);
  const [newTag, setNewTag] = useState('');
  const room = roomLabel(photo);
  const { position, yaw, pitch } = photo.pose;
  const savingTags = photos.savingTags.has(photo.id);
  const tags = [...new Set([...PHOTO_TAGS, ...photo.tags])];
  const setTags = (next: string[]) => void photos.update(photo.id, { tags: next });

  return (
    <div className="photo-detail" role="group" aria-label="Photo details">
      <a
        href={photosApi.imageUrl(photo.id)}
        target="_blank"
        rel="noreferrer"
        title="Open the photo"
      >
        <img src={photosApi.imageUrl(photo.id)} alt={`Photo taken in ${room.name}`} />
      </a>
      <p>
        <strong>{room.name}</strong>
        {room.missing && <span className="warning"> (room not in this model)</span>}
        {photo.capturedRoomStatus === 'renamed' && (
          <span className="note"> (was "{photo.capturedRoomName}" when taken)</span>
        )}
        <br />
        {photo.levelId
          ? (levelName(photo.levelId) ?? <span className="warning">level not in this model</span>)
          : 'Outside'}{' '}
        · {when(photo.takenAt)}
      </p>
      <p className="note">
        At x {metres(position.x)}, z {metres(position.z)}, eye height {metres(position.y)} m ·
        heading {headingDegrees(yaw)}° · pitch {degrees(pitch)}° · view {degrees(fovHOf(photo))}°
        {photo.pose.fovH === undefined && ' (assumed)'}
      </p>
      <p className="note" aria-label="Heading source">
        {sensorSummary(photo)}
      </p>
      {request && (
        <p>
          Answers the request: <em>{request.reason}</em>
        </p>
      )}
      <label className="field">
        Note
        <SkField size="compact">
          <textarea
            value={note}
            rows={2}
            maxLength={2000}
            onChange={(e) => setNote(e.target.value)}
          />
        </SkField>
      </label>
      {note !== photo.note && (
        <div className="buttons">
          <SkButton size="compact" onClick={() => void photos.update(photo.id, { note })}>
            Save note
          </SkButton>
        </div>
      )}
      <div className="chips" role="group" aria-label="Tags">
        {tags.map((tag) => (
          <SkCheckbox
            key={tag}
            className="chip"
            size="compact"
            checked={photo.tags.includes(tag)}
            disabled={savingTags}
            onChange={() =>
              setTags(
                photo.tags.includes(tag)
                  ? photo.tags.filter((t) => t !== tag)
                  : [...photo.tags, tag],
              )
            }
          >
            {tag}
          </SkCheckbox>
        ))}
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (savingTags) return;
            const tag = newTag.trim().toLowerCase();
            if (tag && !photo.tags.includes(tag)) setTags([...photo.tags, tag]);
            setNewTag('');
          }}
        >
          {/* A native field in the paper frame: Enter adds the tag (a form's submit). */}
          <SkField size="compact">
            <input
              type="text"
              className="new-tag"
              value={newTag}
              maxLength={40}
              placeholder="add tag"
              aria-label="New tag"
              disabled={savingTags}
              onChange={(e) => setNewTag(e.target.value)}
            />
          </SkField>
        </form>
      </div>
      {savingTags && <p role="status">Saving tags...</p>}
      <div className="buttons">
        <SkButton size="compact" pressed={viewing} onClick={() => onViewFromHere(!viewing)}>
          {viewing ? 'Leave this view' : 'View from here'}
        </SkButton>
        <SkButton size="compact" variant="secondary" onClick={onClose}>
          Close
        </SkButton>
        <SkButton
          size="compact"
          variant="secondary"
          onClick={() => {
            onViewFromHere(false);
            onClose();
            void photos.remove(photo.id);
          }}
        >
          Delete
        </SkButton>
      </div>
      {viewing && (
        <div className="overlay-settings">
          <SkCheckbox
            size="compact"
            checked={overlay.on}
            onChange={() => onOverlay({ ...overlay, on: !overlay.on })}
          >
            Lay the photo over the 3D view
          </SkCheckbox>
          {overlay.on && (
            // In percent, as it reads; the overlay keeps its fraction.
            <div className="field">
              <span aria-hidden="true">Opacity</span>
              <SkSlider
                label="Opacity"
                unit="%"
                min={10}
                max={100}
                step={5}
                value={Math.round(overlay.opacity * 100)}
                onInput={(v) => onOverlay({ ...overlay, opacity: v / 100 })}
              />
            </div>
          )}
          <PoseEditor photo={photo} photos={photos} onDraft={onDraftPose} />
        </div>
      )}
    </div>
  );
}

const ignore = () => undefined;

/**
 * The photo gallery: thumbnails with filters and a detail view, the photo requests, and the
 * trash. Deleting moves an item to the trash; only the trash tab deletes for good.
 */
export function PhotosPanel({
  photos,
  levels,
  tab,
  onTab: setTab,
  selectedId,
  onSelect,
  filters,
  onFilters,
  viewing,
  onViewFromHere,
  overlay,
  onOverlay,
  onDraftPose = ignore,
  onClose,
  compact = false,
}: Props) {
  const levelName = (id: string | null) => levels.find((l) => l.id === id)?.name;
  const shown = filterPhotos(photos.photos, filters);
  const options = filterOptions(photos.photos);
  const selected = photos.photos.find((p) => p.id === selectedId);
  const open = openRequests(photos.requests);
  const trash = photos.trash;
  const trashCount = (trash?.photos.length ?? 0) + (trash?.requests.length ?? 0);
  const set = (patch: Partial<PhotoFilters>) => onFilters({ ...filters, ...patch });
  const filtered = Object.values(filters).some((v) => v !== '');
  const forGood = (what: string) =>
    window.confirm(`Delete ${what} for good? This cannot be undone.`);

  const trashSwitch = (
    <div className="buttons">
      <SkButton
        size="compact"
        variant="secondary"
        pressed={tab === 'trash'}
        onClick={() => setTab(tab === 'trash' ? 'photos' : 'trash')}
      >
        {tab === 'trash' ? '‹ Back to the photos' : `🗑 Trash (${trashCount})`}
      </SkButton>
    </div>
  );

  return (
    <SkPanel className="overlay panel panel-right photos-panel" label="Photos" arrive={!compact}>
      {compact ? (
        tab === 'trash' && trashSwitch
      ) : (
        <>
          <div className="panel-head">
            <h1>Photos</h1>
            <SkButton size="compact" variant="secondary" onClick={onClose}>
              Close
            </SkButton>
          </div>
          <SkTabs
            className="photos-tabs"
            label="Photos, requests and trash"
            tabs={[
              { value: 'photos', label: `Photos (${photos.photos.length})` },
              { value: 'requests', label: `Requests (${open.length})` },
              { value: 'trash', label: `Trash (${trashCount})` },
            ]}
            value={tab}
            onChange={(id) => setTab(id as PhotosTab)}
          />
        </>
      )}
      {photos.error && (
        <p className="error" role="alert">
          {photos.error}
        </p>
      )}

      {tab === 'photos' && (
        <>
          <fieldset>
            <legend>Filter</legend>
            <label className="field">
              Level{' '}
              <SkField size="compact">
                <select value={filters.level} onChange={(e) => set({ level: e.target.value })}>
                  <option value="">Any</option>
                  {levels.map((l) => (
                    <option key={l.id} value={l.id}>
                      {l.name}
                    </option>
                  ))}
                  <option value={OUTDOORS}>Outside</option>
                </select>
              </SkField>
            </label>
            <label className="field">
              Room{' '}
              <SkField size="compact">
                <select value={filters.room} onChange={(e) => set({ room: e.target.value })}>
                  <option value="">Any</option>
                  {options.rooms.map((r) => (
                    <option key={r.value} value={r.value}>
                      {r.label}
                    </option>
                  ))}
                </select>
              </SkField>
            </label>
            <label className="field">
              Tag{' '}
              <SkField size="compact">
                <select value={filters.tag} onChange={(e) => set({ tag: e.target.value })}>
                  <option value="">Any</option>
                  {options.tags.map((t) => (
                    <option key={t}>{t}</option>
                  ))}
                </select>
              </SkField>
            </label>
            <label className="field">
              Request{' '}
              <SkField size="compact">
                <select value={filters.request} onChange={(e) => set({ request: e.target.value })}>
                  <option value="">Any</option>
                  <option value="any">Answers a request</option>
                  {photos.requests
                    .filter((r) => r.photoIds.length > 0)
                    .map((r) => (
                      <option key={r.id} value={r.id}>
                        {r.reason.slice(0, 40)}
                      </option>
                    ))}
                </select>
              </SkField>
            </label>
            <label className="field">
              From{' '}
              <SkField size="compact">
                <input
                  type="date"
                  value={filters.from}
                  onChange={(e) => set({ from: e.target.value })}
                />
              </SkField>
            </label>
            <label className="field">
              To{' '}
              <SkField size="compact">
                <input
                  type="date"
                  value={filters.to}
                  onChange={(e) => set({ to: e.target.value })}
                />
              </SkField>
            </label>
            {filtered && (
              <SkButton size="compact" variant="secondary" onClick={() => onFilters(NO_FILTERS)}>
                Clear filters
              </SkButton>
            )}
          </fieldset>

          {selected && (
            <Detail
              key={selected.id}
              photo={selected}
              request={photos.requests.find((r) => r.id === selected.requestId)}
              levelName={levelName}
              photos={photos}
              viewing={viewing}
              onViewFromHere={onViewFromHere}
              overlay={overlay}
              onOverlay={onOverlay}
              onDraftPose={onDraftPose}
              onClose={() => {
                onViewFromHere(false);
                onSelect(undefined);
              }}
            />
          )}

          {photos.photos.some((p) => p.sensors?.source === 'sensor') && (
            <p className="note">In the 3D view, a ring around a camera marks a measured heading.</p>
          )}
          {shown.length === 0 ? (
            <p className="note">
              {photos.photos.length === 0
                ? 'No photos yet. Walk the figure to where you stand and take one.'
                : 'No photo matches the filters.'}
            </p>
          ) : (
            <div className="thumbnails">
              {shown.map((photo) => (
                <Thumbnail
                  key={photo.id}
                  photo={photo}
                  selected={photo.id === selectedId}
                  onClick={() => {
                    if (photo.id !== selectedId) onViewFromHere(false);
                    onSelect(photo.id === selectedId ? undefined : photo.id);
                  }}
                />
              ))}
            </div>
          )}
        </>
      )}

      {tab === 'requests' && (
        <>
          {photos.requests.length === 0 && <p className="note">No photo requests.</p>}
          <ul className="request-list">
            {photos.requests.map((request) => (
              <li key={request.id} className={request.status}>
                <p>
                  <strong>{request.reason}</strong>
                </p>
                <p className="note">
                  {requestPlace(request, levelName)} · asked by{' '}
                  {request.requester === 'agent' ? 'an agent' : 'you'} · {request.status}
                  {request.photoIds.length > 0 && ` · ${request.photoIds.length} photo(s)`}
                </p>
                <div className="buttons">
                  {request.photoIds.length > 0 && (
                    <SkButton
                      size="compact"
                      variant="secondary"
                      onClick={() => {
                        onFilters({ ...NO_FILTERS, request: request.id });
                        onSelect(request.photoIds[0]);
                        setTab('photos');
                      }}
                    >
                      Show photos
                    </SkButton>
                  )}
                  {request.status === 'open' ? (
                    <SkButton
                      size="compact"
                      variant="secondary"
                      onClick={() => void photos.cancelRequest(request.id)}
                    >
                      Cancel
                    </SkButton>
                  ) : (
                    <SkButton
                      size="compact"
                      variant="secondary"
                      onClick={() => void photos.reopenRequest(request.id)}
                    >
                      Reopen
                    </SkButton>
                  )}
                  <SkButton
                    size="compact"
                    variant="secondary"
                    onClick={() => void photos.removeRequest(request.id)}
                  >
                    Delete
                  </SkButton>
                </div>
              </li>
            ))}
          </ul>
          <p className="note">
            Open requests show on the phone as a target marker: walk the figure there and take the
            photo.
          </p>
        </>
      )}

      {tab === 'trash' && (
        <>
          <p className="note">
            Deleted photos and requests stay here for {trash?.retentionDays ?? 30} days and can be
            restored. After that they are deleted for good.
          </p>
          {trashCount === 0 && <p className="note">The trash is empty.</p>}
          <ul className="trash-list">
            {trash?.photos.map((photo) => (
              <li key={photo.id}>
                <Thumbnail photo={photo} />
                <div>
                  <p>
                    {roomLabel(photo).name} · {when(photo.takenAt)}
                  </p>
                  <p className="note">Deleted for good on {when(photo.purgeAt!)}</p>
                  <div className="buttons">
                    <SkButton
                      size="compact"
                      variant="secondary"
                      onClick={() => void photos.restore(photo.id)}
                    >
                      Restore
                    </SkButton>
                    <SkButton
                      size="compact"
                      variant="secondary"
                      onClick={() => forGood('this photo') && void photos.purge(photo.id)}
                    >
                      Delete for good
                    </SkButton>
                  </div>
                </div>
              </li>
            ))}
            {trash?.requests.map((request) => (
              <li key={request.id}>
                <div>
                  <p>Request: {request.reason}</p>
                  <p className="note">Deleted for good on {when(request.purgeAt!)}</p>
                  <div className="buttons">
                    <SkButton
                      size="compact"
                      variant="secondary"
                      onClick={() => void photos.restoreRequest(request.id)}
                    >
                      Restore
                    </SkButton>
                    <SkButton
                      size="compact"
                      variant="secondary"
                      onClick={() =>
                        forGood('this request') && void photos.purgeRequest(request.id)
                      }
                    >
                      Delete for good
                    </SkButton>
                  </div>
                </div>
              </li>
            ))}
          </ul>
          {trashCount > 0 && (
            <div className="buttons">
              <SkButton
                size="compact"
                variant="secondary"
                onClick={() => forGood('everything in the trash') && void photos.emptyTrash()}
              >
                Empty trash
              </SkButton>
            </div>
          )}
        </>
      )}
      {compact && tab !== 'trash' && trashSwitch}
    </SkPanel>
  );
}
