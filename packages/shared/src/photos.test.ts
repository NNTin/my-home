import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { HomeModel } from './home-model';
import {
  CreatePhotoMeta,
  CreatePhotoRequestBody,
  ListPhotosQuery,
  PhotoPose,
  poseDirection,
  resolvePhotoRoom,
  roomAt,
  UpdatePhotoBody,
} from './photos';

const mockHome = HomeModel.parse(
  JSON.parse(
    readFileSync(new URL('../../../data/homes/mock-home.json', import.meta.url), 'utf8'),
  ) as unknown,
);

describe('pose', () => {
  const direction = (yaw: number, pitch = 0) => {
    const d = poseDirection({ yaw, pitch });
    return [d.x, d.y, d.z].map((v) => Math.round(v * 1000) / 1000 + 0);
  };

  it('yaw 0 looks along -z and turns counter-clockwise seen from above', () => {
    expect(direction(0)).toEqual([0, 0, -1]);
    expect(direction(Math.PI / 2)).toEqual([-1, 0, 0]);
    expect(direction(Math.PI)).toEqual([0, 0, 1]);
    expect(direction(-Math.PI / 2)).toEqual([1, 0, 0]);
  });

  it('positive pitch looks up, and the direction stays a unit vector', () => {
    expect(direction(0, Math.PI / 2)).toEqual([0, 1, 0]);
    expect(direction(0, -Math.PI / 2)).toEqual([0, -1, 0]);
    expect(direction(0, Math.PI / 6)).toEqual([0, 0.5, -0.866]);
    const d = poseDirection({ yaw: 1.1, pitch: -0.4 });
    expect(Math.hypot(d.x, d.y, d.z)).toBeCloseTo(1);
  });

  it('limits the pitch to straight up or down and the field of view to under 180°', () => {
    const pose = { position: { x: 0, y: 1.6, z: 0 }, yaw: 7, pitch: 0 };
    expect(PhotoPose.safeParse(pose).success).toBe(true);
    expect(PhotoPose.safeParse({ ...pose, fovH: 1.2 }).success).toBe(true);
    for (const bad of [
      { pitch: 1.6 },
      { pitch: -1.6 },
      { fovH: 0 },
      { fovH: Math.PI },
      { yaw: NaN },
    ]) {
      expect(PhotoPose.safeParse({ ...pose, ...bad }).success).toBe(false);
    }
  });
});

describe('room resolution with soft references', () => {
  const bedroom = { id: 'souterrain-bedroom', name: 'Bedroom' };
  const photo = {
    levelId: 'souterrain',
    position: { x: -3, z: 2.5 },
    capturedRoomId: bedroom.id,
    capturedRoomName: bedroom.name,
  };

  it('finds the room at a plan point on a level', () => {
    expect(roomAt(mockHome, 'souterrain', { x: -3, z: 2.5 })).toEqual(bedroom);
    expect(roomAt(mockHome, 'souterrain', { x: 3, z: -2 })?.id).toBe('souterrain-kitchen');
    expect(roomAt(mockHome, 'souterrain', { x: 40, z: 40 })).toBeNull();
    expect(roomAt(mockHome, 'no-such-level', { x: -3, z: 2.5 })).toBeNull();
    expect(roomAt(mockHome, null, { x: -3, z: 2.5 })).toBeNull();
  });

  it('resolves a photo against the model it was taken in', () => {
    expect(resolvePhotoRoom(mockHome, photo)).toEqual({
      room: bedroom,
      capturedRoomStatus: 'current',
      levelInModel: true,
    });
  });

  it('reports a renamed room, and a removed one as missing, without failing', () => {
    const renamed = structuredClone(mockHome);
    renamed.rooms.find((r) => r.id === bedroom.id)!.name = 'Guest room';
    expect(resolvePhotoRoom(renamed, photo)).toMatchObject({
      room: { id: bedroom.id, name: 'Guest room' },
      capturedRoomStatus: 'renamed',
    });

    const removed = structuredClone(mockHome);
    removed.rooms = removed.rooms.filter((r) => r.id !== bedroom.id);
    expect(resolvePhotoRoom(removed, photo)).toEqual({
      room: null,
      capturedRoomStatus: 'missing',
      levelInModel: true,
    });
  });

  it('handles photos outdoors, on unknown levels and without a model', () => {
    const outdoors = { ...photo, levelId: null, capturedRoomId: null, capturedRoomName: null };
    expect(resolvePhotoRoom(mockHome, outdoors)).toEqual({
      room: null,
      capturedRoomStatus: 'none',
      levelInModel: false,
    });
    expect(resolvePhotoRoom(mockHome, { ...photo, levelId: 'cellar' })).toMatchObject({
      room: null,
      capturedRoomStatus: 'current',
      levelInModel: false,
    });
    expect(resolvePhotoRoom(undefined, photo)).toEqual({
      room: null,
      capturedRoomStatus: 'missing',
      levelInModel: false,
    });
  });
});

describe('photo request and query schemas', () => {
  it('normalises tags and fills defaults in upload metadata', () => {
    const meta = CreatePhotoMeta.parse({
      pose: { position: { x: 0, y: 0, z: 0 }, yaw: 0, pitch: 0 },
      tags: [' Wall ', 'wall', 'Window'],
    });
    expect(meta).toMatchObject({ note: '', tags: ['wall', 'window'] });
    expect(CreatePhotoMeta.safeParse({ ...meta, id: 'not-a-uuid' }).success).toBe(false);
    expect(UpdatePhotoBody.parse({})).toEqual({});
    expect(UpdatePhotoBody.safeParse({ id: 'x' }).success).toBe(false);
  });

  it('parses "near" as x,z,radius', () => {
    expect(ListPhotosQuery.parse({ near: '4.5,-6,2' })).toMatchObject({
      near: { x: 4.5, z: -6, radius: 2 },
      limit: 100,
      offset: 0,
    });
    for (const near of ['4.5,-6', '1,2,-3', 'a,b,c', '1, 2, 3']) {
      expect(ListPhotosQuery.safeParse({ near }).success).toBe(false);
    }
  });

  it('needs a room or a position for a request', () => {
    const base = { reason: 'Which side is the door on?', requester: 'agent' };
    expect(CreatePhotoRequestBody.safeParse(base).success).toBe(false);
    expect(CreatePhotoRequestBody.safeParse({ ...base, roomId: 'kitchen' }).success).toBe(true);
    expect(CreatePhotoRequestBody.safeParse({ ...base, position: { x: 1, z: 2 } }).success).toBe(
      true,
    );
  });
});
