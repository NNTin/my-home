import { HomeModel, type Photo, type PhotoRequest, type Placement } from '@my-home/shared';
import mockHomeJson from '../../../../packages/shared/test-fixtures/mock-home.json';
import type { EditorItem } from '../editor/item';

export const mockHome = HomeModel.parse(mockHomeJson);

/** A bed in the mock home's bedroom, as the editor holds it. */
export const editorItem = (overrides: Partial<EditorItem> = {}): EditorItem => ({
  id: 'item-1',
  typeId: 'furniture.bed',
  name: 'Bedroom · Bed',
  levelId: 'souterrain',
  position: { x: -3, z: 2.5 },
  rotationY: 0,
  params: {},
  ...overrides,
});

/** A stored placement: the bed in the mock home's bedroom. */
export const testPlacement = (overrides: Partial<Placement> = {}): Placement => ({
  id: 'souterrain-bed-1',
  homeId: 'mock-home',
  typeId: 'furniture.bed',
  name: 'Bedroom · Bed',
  levelId: 'souterrain',
  roomId: 'souterrain-bedroom',
  position: { x: -3, z: 2.5 },
  rotationY: 0,
  mounting: 'floor',
  elevation: 0,
  params: {},
  version: 1,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  removedAt: null,
  purgeAt: null,
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
  sensors: null,
  subjects: [],
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
  subject: null,
  status: 'open',
  photoIds: [],
  createdAt: '2026-03-01T09:00:00.000Z',
  updatedAt: '2026-03-01T09:00:00.000Z',
  closedAt: null,
  deletedAt: null,
  purgeAt: null,
  ...overrides,
});
