import { z } from 'zod';
import { Id, insideOutline, type Polygon } from './home-model';
import { Subject, SubjectQuery, SubjectRef, Subjects } from './subjects';

/**
 * Photos taken inside the model's context, and requests for new ones. Both live in the `media`
 * database schema, apart from the home model, and reference the building only by ids (soft
 * references): the pose in the plan frame is authoritative, and a photo stays meaningful when a
 * level or room is renamed or removed.
 *
 * Pose conventions (the home model's frame, metres and radians):
 * - `position`: `x` plan east, `y` up (the eye point), `z` plan south.
 * - `yaw`: rotation about +y, counter-clockwise seen from above; 0 looks along `-z` (plan north),
 *   `π/2` along `-x`. The same convention as a layout item's `rotationY` and a three.js camera.
 * - `pitch`: positive looks up, negative down; `±π/2` is straight up or down.
 * - `fovH`: the camera's horizontal field of view, when known.
 */

const Timestamp = z.iso.datetime({ offset: true });

export const PhotoPosition = z.strictObject({ x: z.number(), y: z.number(), z: z.number() });
export type PhotoPosition = z.infer<typeof PhotoPosition>;

export const PhotoPose = z.strictObject({
  position: PhotoPosition,
  yaw: z.number(),
  pitch: z
    .number()
    .min(-Math.PI / 2)
    .max(Math.PI / 2),
  fovH: z.number().positive().lt(Math.PI).optional(),
});
export type PhotoPose = z.infer<typeof PhotoPose>;

/** The unit view direction of a pose in the plan frame. */
export function poseDirection(pose: Pick<PhotoPose, 'yaw' | 'pitch'>): PhotoPosition {
  const horizontal = Math.cos(pose.pitch);
  return {
    x: -Math.sin(pose.yaw) * horizontal,
    y: Math.sin(pose.pitch),
    z: -Math.cos(pose.yaw) * horizontal,
  };
}

/**
 * What the phone's orientation sensors said when a photo was taken, so its viewing direction is
 * measured rather than guessed. Orientation only: no position of any kind is in here.
 *
 * `source` says whether the pose's **heading** came from the compass (`sensor`) or was set by
 * hand (`manual`); `tilt` says the same for the pitch. Angles are in degrees as the browser reports them, except `yaw`
 * and `pitch`, which are the resulting pose in radians. Later corrections of the pose do not
 * change the snapshot.
 *
 * Unknown keys are dropped rather than refused, so a build that does not know a newer field
 * still reads the rest.
 */
export const PhotoSensors = z.object({
  source: z.enum(['sensor', 'manual']),
  /** Raw `DeviceOrientationEvent` values; `absolute` is whether `alpha` is earth-referenced. */
  alpha: z.number().nullable().optional(),
  beta: z.number().nullable().optional(),
  gamma: z.number().nullable().optional(),
  absolute: z.boolean().optional(),
  /** iOS: `webkitCompassHeading` and `webkitCompassAccuracy` (±degrees; negative = unreliable). */
  compassHeading: z.number().optional(),
  compassAccuracy: z.number().optional(),
  /** `screen.orientation.angle`: 0 portrait, 90 or 270 landscape. */
  screenAngle: z.number().optional(),
  /** Whether the pitch came from the phone's tilt (independent of where the heading came from). */
  tilt: z.boolean().optional(),
  /** Magnetic bearing of the camera, after the screen orientation was accounted for. */
  magneticBearing: z.number().optional(),
  /** Declination (east positive) and the device's calibration offset that were applied. */
  declination: z.number().optional(),
  calibrationOffset: z.number().optional(),
  /** Smoothed true bearing of the camera: magnetic + declination + calibration offset. */
  trueBearing: z.number().optional(),
  /** The pose the sensors gave, in radians (plan yaw, pitch) and the camera's roll. */
  yaw: z.number().optional(),
  pitch: z.number().optional(),
  roll: z.number().optional(),
  capturedAt: Timestamp.optional(),
});
export type PhotoSensors = z.infer<typeof PhotoSensors>;

export const MAX_PHOTO_NOTE_LENGTH = 2000;
export const MAX_PHOTO_TAGS = 20;

/** A short free-form label such as `wall`, `window` or `furniture`; stored trimmed, in lower case. */
export const PhotoTag = z.string().trim().toLowerCase().min(1).max(40);
const PhotoTags = z
  .array(PhotoTag)
  .max(MAX_PHOTO_TAGS)
  .transform((tags) => [...new Set(tags)]);
const PhotoNote = z.string().max(MAX_PHOTO_NOTE_LENGTH);

/** Stored image formats; uploads may also be PNG and are always re-encoded. */
export const PhotoImageInfo = z.object({
  contentType: z.string(),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  byteSize: z.number().int().positive(),
});
export type PhotoImageInfo = z.infer<typeof PhotoImageInfo>;

/**
 * How the room recorded at capture time relates to the model the server has now: `current` (same
 * id and name), `renamed` (the id exists under another name), `missing` (the id is not in this
 * model, shown as "room not in this model") or `none` (no room was recorded, e.g. outdoors).
 */
export const CapturedRoomStatus = z.enum(['current', 'renamed', 'missing', 'none']);
export type CapturedRoomStatus = z.infer<typeof CapturedRoomStatus>;

export const RoomRef = z.object({ id: Id, name: z.string() });
export type RoomRef = z.infer<typeof RoomRef>;

export const Photo = z.object({
  id: Id,
  homeId: Id,
  /** Soft reference; may name a level that is not in the current model. */
  levelId: Id.nullable(),
  pose: PhotoPose,
  /** The room at capture time, kept so the photo stays meaningful when rooms change. */
  capturedRoomId: Id.nullable(),
  capturedRoomName: z.string().nullable(),
  capturedRoomStatus: CapturedRoomStatus,
  /** The room that contains the pose in the current model, resolved on every read. */
  room: RoomRef.nullable(),
  /** Whether `levelId` exists in the current model (false when there is no level or no model). */
  levelInModel: z.boolean(),
  takenAt: Timestamp,
  note: PhotoNote,
  tags: z.array(z.string()),
  /** The photo request this photo answers, if any (soft reference). */
  requestId: Id.nullable(),
  image: PhotoImageInfo,
  thumbnail: PhotoImageInfo,
  /** The sensor snapshot taken with the photo; null for photos stored without one. */
  sensors: PhotoSensors.nullable().default(null),
  /**
   * The catalogue types and uses the photo shows, with their names and status resolved against
   * the current model and placements. Older photos (and older builds) have none.
   */
  subjects: z.array(SubjectRef).default([]),
  createdAt: Timestamp,
  updatedAt: Timestamp,
  /** Set while the photo is in the trash; `purgeAt` is when it is deleted for good. */
  deletedAt: Timestamp.nullable(),
  purgeAt: Timestamp.nullable(),
});
export type Photo = z.infer<typeof Photo>;

/**
 * The `meta` JSON part of `POST /api/homes/:homeId/photos` (multipart, next to the `image` file).
 * Without `capturedRoomId` the server derives the room from the pose and the current model.
 * `id` and `takenAt` let the copy tool keep a photo's identity across environments.
 */
export const CreatePhotoMeta = z.strictObject({
  id: z.uuid().optional(),
  levelId: Id.nullish(),
  pose: PhotoPose,
  takenAt: Timestamp.optional(),
  note: PhotoNote.default(''),
  tags: PhotoTags.default([]),
  requestId: Id.nullish(),
  capturedRoomId: Id.nullish(),
  capturedRoomName: z.string().max(200).nullish(),
  sensors: PhotoSensors.nullish(),
  /** Types and uses the photo shows (a request's subject is added when it answers one). */
  subjects: Subjects.optional(),
});
export type CreatePhotoMeta = z.input<typeof CreatePhotoMeta>;

/**
 * Partial update. Changing `pose` or `levelId` re-derives the captured room from the current
 * model unless `capturedRoomId` is sent along.
 */
export const UpdatePhotoBody = z
  .strictObject({
    levelId: Id.nullable(),
    pose: PhotoPose,
    takenAt: Timestamp,
    note: PhotoNote,
    tags: PhotoTags,
    requestId: Id.nullable(),
    capturedRoomId: Id.nullable(),
    capturedRoomName: z.string().max(200).nullable(),
    sensors: PhotoSensors.nullable(),
    /** Replaces the whole list. */
    subjects: Subjects,
  })
  .partial();
export type UpdatePhotoBody = z.input<typeof UpdatePhotoBody>;

export const PhotoHomeParams = z.object({ homeId: Id });
export const PhotoParams = z.object({ id: Id });

/** `near` is `x,z,radius` in metres on the plan, e.g. `near=4.5,-6,2`. */
const Near = z
  .string()
  .regex(/^-?\d+(\.\d+)?,-?\d+(\.\d+)?,\d+(\.\d+)?$/, 'Use "x,z,radius" in metres')
  .transform((value) => {
    const [x, z, radius] = value.split(',').map(Number) as [number, number, number];
    return { x, z, radius };
  });

export const ListPhotosQuery = z.object({
  levelId: Id.optional(),
  /** Matches the captured room or the room resolved from the current model. */
  roomId: Id.optional(),
  tag: PhotoTag.optional(),
  requestId: Id.optional(),
  /** Photos linked to this type or use: `type:<typeId>` or `use:<useId>`. */
  subject: SubjectQuery.optional(),
  near: Near.optional(),
  /** Bounds on `takenAt`: `since` inclusive, `until` exclusive. */
  since: Timestamp.optional(),
  until: Timestamp.optional(),
  limit: z.coerce.number().int().min(1).max(500).default(100),
  offset: z.coerce.number().int().min(0).default(0),
});
export type ListPhotosQuery = z.input<typeof ListPhotosQuery>;

/** Newest first. `total` counts every match, before `limit` and `offset`. */
export const ListPhotosResponse = z.object({
  items: z.array(Photo),
  total: z.number().int().nonnegative(),
});
export type ListPhotosResponse = z.infer<typeof ListPhotosResponse>;

export const PhotoRequester = z.enum(['owner', 'agent']);
export type PhotoRequester = z.infer<typeof PhotoRequester>;

export const PhotoRequestStatus = z.enum(['open', 'fulfilled', 'cancelled']);
export type PhotoRequestStatus = z.infer<typeof PhotoRequestStatus>;

const PlanPoint = z.strictObject({ x: z.number(), z: z.number() });
const Reason = z.string().trim().min(1).max(MAX_PHOTO_NOTE_LENGTH);

/**
 * A request for a new photo: where to stand (`position`, on `levelId`, or just a room), which way
 * to look (`yaw`, `pitch`) and why. Taking a photo for it fulfils it.
 */
export const PhotoRequest = z.object({
  id: Id,
  homeId: Id,
  levelId: Id.nullable(),
  roomId: Id.nullable(),
  /** The room's name when the request was written. */
  roomName: z.string().nullable(),
  position: PlanPoint.nullable(),
  yaw: z.number().nullable(),
  pitch: z.number().nullable(),
  reason: z.string(),
  requester: PhotoRequester,
  /** The type or use the photo should show, resolved on read; a photo answering it is linked to it. */
  subject: SubjectRef.nullable().default(null),
  status: PhotoRequestStatus,
  /** Photos linked to the request that are not in the trash, oldest first. */
  photoIds: z.array(Id),
  createdAt: Timestamp,
  updatedAt: Timestamp,
  closedAt: Timestamp.nullable(),
  deletedAt: Timestamp.nullable(),
  purgeAt: Timestamp.nullable(),
});
export type PhotoRequest = z.infer<typeof PhotoRequest>;

export const CreatePhotoRequestBody = z
  .strictObject({
    levelId: Id.nullish(),
    roomId: Id.nullish(),
    position: PlanPoint.nullish(),
    yaw: z.number().nullish(),
    pitch: PhotoPose.shape.pitch.nullish(),
    reason: Reason,
    /** Kept when given (older clients); otherwise the server records the request's actor. */
    requester: PhotoRequester.optional(),
    /** Without a room and a position, a use subject places the request in the use's first room. */
    subject: Subject.optional(),
  })
  .refine((body) => body.roomId != null || body.position != null || body.subject?.kind === 'use', {
    message: 'Give a roomId, a position, both, or a use subject',
    path: ['position'],
  });
export type CreatePhotoRequestBody = z.input<typeof CreatePhotoRequestBody>;

export const ListPhotoRequestsQuery = z.object({
  status: z.enum([...PhotoRequestStatus.options, 'all']).default('open'),
});
export type ListPhotoRequestsQuery = z.input<typeof ListPhotoRequestsQuery>;

/** Oldest first. */
export const ListPhotoRequestsResponse = z.object({ items: z.array(PhotoRequest) });
export type ListPhotoRequestsResponse = z.infer<typeof ListPhotoRequestsResponse>;

/** Links an existing photo and closes the request. Uploading with `requestId` does the same. */
export const FulfilPhotoRequestBody = z.strictObject({ photoId: Id });
export type FulfilPhotoRequestBody = z.infer<typeof FulfilPhotoRequestBody>;

/** Soft-deleted photos and requests of a home, most recently deleted first. */
export const TrashResponse = z.object({
  photos: z.array(Photo),
  requests: z.array(PhotoRequest),
  retentionDays: z.number().positive(),
});
export type TrashResponse = z.infer<typeof TrashResponse>;

export const EmptyTrashResponse = z.object({
  purgedPhotos: z.number().int().nonnegative(),
  purgedRequests: z.number().int().nonnegative(),
});
export type EmptyTrashResponse = z.infer<typeof EmptyTrashResponse>;

/** The parts of a home model that photos refer to; a `HomeModel` is one. */
export interface ModelRooms {
  levels: { id: string }[];
  rooms: { id: string; name: string; levelId: string; outline: Polygon }[];
}

/** The room of `levelId` whose outline contains the plan point, if any. */
export function roomAt(
  model: ModelRooms,
  levelId: string | null | undefined,
  point: { x: number; z: number },
): RoomRef | null {
  if (!levelId) return null;
  const room = model.rooms.find(
    (r) => r.levelId === levelId && insideOutline(point.x, point.z, r.outline),
  );
  return room ? { id: room.id, name: room.name } : null;
}

export interface ResolvedPhotoRoom {
  room: RoomRef | null;
  capturedRoomStatus: CapturedRoomStatus;
  levelInModel: boolean;
}

/**
 * Resolves a photo's soft references against the current model (or none, when its home is not
 * stored here): the room at its pose, what became of the captured room, and whether its level
 * still exists. Never fails: unknown ids resolve to `missing` and `null`.
 */
export function resolvePhotoRoom(
  model: ModelRooms | undefined,
  photo: {
    levelId: string | null;
    position: { x: number; z: number };
    capturedRoomId: string | null;
    capturedRoomName: string | null;
  },
): ResolvedPhotoRoom {
  const captured = model?.rooms.find((r) => r.id === photo.capturedRoomId);
  const capturedRoomStatus: CapturedRoomStatus =
    photo.capturedRoomId === null
      ? 'none'
      : !captured
        ? 'missing'
        : captured.name === photo.capturedRoomName
          ? 'current'
          : 'renamed';
  return {
    room: model ? roomAt(model, photo.levelId, photo.position) : null,
    capturedRoomStatus,
    levelInModel: !!model?.levels.some((l) => l.id === photo.levelId),
  };
}
