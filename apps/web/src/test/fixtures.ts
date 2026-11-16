import { HomeModel, type LayoutItem, type Photo, type PhotoRequest } from '@my-home/shared';
import mockHomeJson from '../../../../data/homes/mock-home.json';

export const mockHome = HomeModel.parse(mockHomeJson);

export const layoutItem = (overrides: Partial<LayoutItem> = {}): LayoutItem => ({
  id: 'item-1',
  typeId: 'bed',
  levelId: 'souterrain',
  position: { x: -3, z: 2.5 },
  rotationY: 0,
  props: {},
  ...overrides,
});

/** A stored photo in the mock home's hallway (souterrain), looking north. */
export const testPhoto = (overrides: Partial<Photo> = {}): Photo => ({
  id: 'photo-1',
  homeId: 'mock-home',
  levelId: 'souterrain',
  pose: { position: { x: 0.5, y: 0.4, z: 0 }, yaw: 0, pitch: 0, fovH: 1.2 },
  capturedRoomId: 'souterrain-hallway',
  capturedRoomName: 'Hallway',
  capturedRoomStatus: 'current',
  room: { id: 'souterrain-hallway', name: 'Hallway' },
  levelInModel: true,
  takenAt: '2026-03-01T10:00:00.000Z',
  note: '',
  tags: [],
  requestId: null,
  image: { contentType: 'image/webp', width: 1600, height: 1200, byteSize: 1000 },
  thumbnail: { contentType: 'image/webp', width: 480, height: 360, byteSize: 100 },
  createdAt: '2026-03-01T10:00:00.000Z',
  updatedAt: '2026-03-01T10:00:00.000Z',
  deletedAt: null,
  purgeAt: null,
  ...overrides,
});

/** An open request by an agent for a photo in the mock home's kitchen. */
export const testRequest = (overrides: Partial<PhotoRequest> = {}): PhotoRequest => ({
  id: 'request-1',
  homeId: 'mock-home',
  levelId: 'souterrain',
  roomId: 'souterrain-kitchen',
  roomName: 'Kitchen',
  position: { x: 3, z: -2 },
  yaw: 1.5,
  pitch: 0,
  reason: 'How wide is the window above the sink?',
  requester: 'agent',
  status: 'open',
  photoIds: [],
  createdAt: '2026-03-01T09:00:00.000Z',
  updatedAt: '2026-03-01T09:00:00.000Z',
  closedAt: null,
  deletedAt: null,
  purgeAt: null,
  ...overrides,
});
