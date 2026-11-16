import { describe, expect, it } from 'vitest';
import { testPhoto, testRequest } from '../test/fixtures';
import { filterOptions, filterPhotos, NO_FILTERS, roomLabel } from './filters';
import { activeRequest } from './requests';

const hallway = testPhoto({ id: 'a', tags: ['wall'], takenAt: '2026-03-01T10:00:00' });
const kitchen = testPhoto({
  id: 'b',
  capturedRoomId: 'souterrain-kitchen',
  capturedRoomName: 'Kitchen',
  room: { id: 'souterrain-kitchen', name: 'Kitchen' },
  tags: ['window', 'wall'],
  requestId: 'request-1',
  takenAt: '2026-03-02T10:00:00',
});
const garden = testPhoto({
  id: 'c',
  levelId: null,
  capturedRoomId: null,
  capturedRoomName: null,
  capturedRoomStatus: 'none',
  room: null,
  takenAt: '2026-03-03T23:30:00',
});
// Taken in a room that another branch's model renamed: the pose now lies in the "Study".
const moved = testPhoto({
  id: 'd',
  capturedRoomId: 'souterrain-bedroom',
  capturedRoomName: 'Bedroom',
  capturedRoomStatus: 'missing',
  room: { id: 'souterrain-study', name: 'Study' },
  takenAt: '2026-03-04T10:00:00',
});
const all = [hallway, kitchen, garden, moved];
const ids = (filters: Partial<typeof NO_FILTERS>) =>
  filterPhotos(all, { ...NO_FILTERS, ...filters }).map((p) => p.id);

describe('gallery filters', () => {
  it('shows everything without filters', () => {
    expect(ids({})).toEqual(['a', 'b', 'c', 'd']);
  });

  it('filters by level, with outdoor photos as their own group', () => {
    expect(ids({ level: 'souterrain' })).toEqual(['a', 'b', 'd']);
    expect(ids({ level: 'outdoors' })).toEqual(['c']);
    expect(ids({ level: 'ground-floor' })).toEqual([]);
  });

  it('filters by room, matching the captured room and the room the pose lies in now', () => {
    expect(ids({ room: 'souterrain-kitchen' })).toEqual(['b']);
    expect(ids({ room: 'souterrain-bedroom' })).toEqual(['d']);
    expect(ids({ room: 'souterrain-study' })).toEqual(['d']);
  });

  it('filters by tag, request and day', () => {
    expect(ids({ tag: 'wall' })).toEqual(['a', 'b']);
    expect(ids({ request: 'request-1' })).toEqual(['b']);
    expect(ids({ request: 'any' })).toEqual(['b']);
    expect(ids({ from: '2026-03-02' })).toEqual(['b', 'c', 'd']);
    expect(ids({ from: '2026-03-02', to: '2026-03-03' })).toEqual(['b', 'c']);
    expect(ids({ tag: 'wall', level: 'souterrain', to: '2026-03-01' })).toEqual(['a']);
  });

  it('offers the rooms and tags that occur, marking rooms that are gone', () => {
    expect(filterOptions(all)).toEqual({
      rooms: [
        { value: 'souterrain-bedroom', label: 'Bedroom (not in this model)' },
        { value: 'souterrain-hallway', label: 'Hallway' },
        { value: 'souterrain-kitchen', label: 'Kitchen' },
        { value: 'souterrain-study', label: 'Study' },
      ],
      tags: ['wall', 'window'],
    });
  });

  it('labels a photo with its room, keeping the captured name when the room is gone', () => {
    expect(roomLabel(hallway)).toEqual({ name: 'Hallway', missing: false });
    expect(roomLabel(moved)).toEqual({ name: 'Bedroom', missing: true });
    expect(roomLabel(garden)).toEqual({ name: 'Outside', missing: false });
    const renamed = testPhoto({
      capturedRoomStatus: 'renamed',
      room: { id: 'souterrain-hallway', name: 'Corridor' },
    });
    expect(roomLabel(renamed)).toEqual({ name: 'Corridor', missing: false });
    expect(
      roomLabel(testPhoto({ capturedRoomId: null, capturedRoomName: null, room: null })),
    ).toEqual({ name: 'No room', missing: false });
  });
});

describe('the request a photo answers', () => {
  const atSpot = testRequest({ id: 'spot', position: { x: 3, z: -2 } });
  const farSpot = testRequest({ id: 'far', position: { x: 3, z: 2 } });
  const roomOnly = testRequest({ id: 'room', position: null, roomId: 'souterrain-hallway' });
  const requests = [farSpot, atSpot, roomOnly];
  const standing = (x: number, z: number, roomId = 'souterrain-kitchen') => ({
    x,
    z,
    levelId: 'souterrain',
    roomId,
  });

  it('is the nearest open request whose spot the figure stands at', () => {
    expect(activeRequest(requests, standing(3.4, -2.3))?.id).toBe('spot');
    expect(activeRequest(requests, standing(3, 1.2))?.id).toBe('far');
    expect(activeRequest(requests, standing(3, 0))).toBeUndefined();
  });

  it('needs the same level', () => {
    expect(
      activeRequest(requests, { ...standing(3, -2), levelId: 'ground-floor' }),
    ).toBeUndefined();
    expect(activeRequest(requests, { x: 3, z: -2 })).toBeUndefined();
  });

  it('falls back to a request for the room the figure is in', () => {
    expect(activeRequest(requests, standing(0.5, 0, 'souterrain-hallway'))?.id).toBe('room');
  });

  it('prefers the request the owner picked, wherever the figure is', () => {
    expect(activeRequest(requests, standing(3, -2), 'room')?.id).toBe('room');
    expect(activeRequest(requests, standing(3, -2), 'gone')?.id).toBe('spot');
  });

  it('ignores closed and deleted requests', () => {
    const closed = [
      { ...atSpot, status: 'fulfilled' as const },
      { ...farSpot, position: { x: 3, z: -2 }, deletedAt: '2026-03-02T00:00:00.000Z' },
    ];
    expect(activeRequest(closed, standing(3, -2))).toBeUndefined();
    expect(activeRequest(closed, standing(3, -2), 'spot')).toBeUndefined();
  });
});
