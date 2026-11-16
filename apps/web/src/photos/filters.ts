import type { Photo } from '@my-home/shared';

/** What the gallery narrows the photos by; an empty string means "any". */
export interface PhotoFilters {
  /** A level id, or `outdoors` for photos without a level. */
  level: string;
  /** A room id: matches the captured room or the room the pose lies in now. */
  room: string;
  tag: string;
  /** A request id, or `any` for photos that answer some request. */
  request: string;
  /** Days as `YYYY-MM-DD` in local time, both inclusive. */
  from: string;
  to: string;
}

export const NO_FILTERS: PhotoFilters = {
  level: '',
  room: '',
  tag: '',
  request: '',
  from: '',
  to: '',
};
export const OUTDOORS = 'outdoors';

const localDay = (iso: string) => {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};

export function filterPhotos(photos: Photo[], f: PhotoFilters): Photo[] {
  return photos.filter((p) => {
    if (f.level && (f.level === OUTDOORS ? p.levelId !== null : p.levelId !== f.level))
      return false;
    if (f.room && p.capturedRoomId !== f.room && p.room?.id !== f.room) return false;
    if (f.tag && !p.tags.includes(f.tag)) return false;
    if (f.request && (f.request === 'any' ? p.requestId === null : p.requestId !== f.request))
      return false;
    const day = localDay(p.takenAt);
    return !(f.from && day < f.from) && !(f.to && day > f.to);
  });
}

/** The name to show for a photo's room, and whether that room is gone from the current model. */
export function roomLabel(photo: Photo): { name: string; missing: boolean } {
  if (photo.capturedRoomStatus === 'missing') {
    return {
      name: photo.capturedRoomName ?? photo.capturedRoomId ?? 'Unknown room',
      missing: true,
    };
  }
  const name = photo.room?.name ?? photo.capturedRoomName;
  return { name: name ?? (photo.levelId ? 'No room' : 'Outside'), missing: false };
}

export interface Option {
  value: string;
  label: string;
}

/** The rooms and tags that occur in the photos, for the filter menus. */
export function filterOptions(photos: Photo[]): { rooms: Option[]; tags: string[] } {
  const rooms = new Map<string, string>();
  const tags = new Set<string>();
  for (const p of photos) {
    if (p.room) rooms.set(p.room.id, p.room.name);
    if (p.capturedRoomId && !rooms.has(p.capturedRoomId)) {
      const gone = p.capturedRoomStatus === 'missing' ? ' (not in this model)' : '';
      rooms.set(p.capturedRoomId, `${p.capturedRoomName ?? p.capturedRoomId}${gone}`);
    }
    for (const tag of p.tags) tags.add(tag);
  }
  return {
    rooms: [...rooms]
      .map(([value, label]) => ({ value, label }))
      .sort((a, b) => a.label.localeCompare(b.label)),
    tags: [...tags].sort(),
  };
}
