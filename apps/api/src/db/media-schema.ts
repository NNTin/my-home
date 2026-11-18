import type { PhotoSensors } from '@my-home/shared';
import {
  customType,
  doublePrecision,
  index,
  integer,
  jsonb,
  pgSchema,
  primaryKey,
  text,
  timestamp,
} from 'drizzle-orm/pg-core';

/**
 * The `media` schema: photos and photo requests. It is kept apart from `public` so the staging
 * reset (which drops `public` and `drizzle`) never touches it, and it has its own migrations in
 * `media-migrations/` (hand-written, expand-only; see docs/photos.md), not drizzle-kit's.
 *
 * Nothing here references `public` by foreign key: `drop schema public cascade` would silently
 * drop such a constraint. Homes, levels, rooms and requests are referenced by id only.
 */
export const MEDIA_SCHEMA = 'media';
export const media = pgSchema(MEDIA_SCHEMA);

/** node-postgres returns a Buffer, PGlite a Uint8Array. */
const bytea = customType<{ data: Buffer; driverData: Uint8Array }>({
  dataType: () => 'bytea',
  fromDriver: (value) => Buffer.from(value.buffer, value.byteOffset, value.byteLength),
});

const timestamptz = (name: string) => timestamp(name, { withTimezone: true });

/** Metadata and pose of a photo; the image bytes are in `photo_blobs` and `photo_thumbnails`. */
export const photos = media.table(
  'photos',
  {
    id: text('id').primaryKey(),
    homeId: text('home_id').notNull(),
    levelId: text('level_id'),
    x: doublePrecision('x').notNull(),
    y: doublePrecision('y').notNull(),
    z: doublePrecision('z').notNull(),
    yaw: doublePrecision('yaw').notNull(),
    pitch: doublePrecision('pitch').notNull(),
    fovH: doublePrecision('fov_h'),
    capturedRoomId: text('captured_room_id'),
    capturedRoomName: text('captured_room_name'),
    takenAt: timestamptz('taken_at').notNull(),
    note: text('note').notNull().default(''),
    tags: jsonb('tags').$type<string[]>().notNull().default([]),
    requestId: text('request_id'),
    contentType: text('content_type').notNull(),
    width: integer('width').notNull(),
    height: integer('height').notNull(),
    byteSize: integer('byte_size').notNull(),
    thumbnailContentType: text('thumbnail_content_type').notNull(),
    thumbnailWidth: integer('thumbnail_width').notNull(),
    thumbnailHeight: integer('thumbnail_height').notNull(),
    thumbnailByteSize: integer('thumbnail_byte_size').notNull(),
    sha256: text('sha256').notNull(),
    sensors: jsonb('sensors').$type<PhotoSensors>(),
    createdAt: timestamptz('created_at').notNull().defaultNow(),
    updatedAt: timestamptz('updated_at').notNull().defaultNow(),
    deletedAt: timestamptz('deleted_at'),
  },
  (t) => [
    index('photos_home_taken_at_idx').on(t.homeId, t.takenAt),
    index('photos_request_id_idx').on(t.requestId),
  ],
);
export type PhotoRow = typeof photos.$inferSelect;

export const photoBlobs = media.table('photo_blobs', {
  photoId: text('photo_id')
    .primaryKey()
    .references(() => photos.id, { onDelete: 'cascade' }),
  data: bytea('data').notNull(),
});

export const photoThumbnails = media.table('photo_thumbnails', {
  photoId: text('photo_id')
    .primaryKey()
    .references(() => photos.id, { onDelete: 'cascade' }),
  data: bytea('data').notNull(),
});

/** The types and uses a photo shows (soft references, resolved on read). */
export const photoSubjects = media.table(
  'photo_subjects',
  {
    photoId: text('photo_id')
      .notNull()
      .references(() => photos.id, { onDelete: 'cascade' }),
    subjectKind: text('subject_kind').notNull(),
    subjectId: text('subject_id').notNull(),
    createdAt: timestamptz('created_at').notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.photoId, t.subjectKind, t.subjectId] }),
    index('photo_subjects_subject_idx').on(t.subjectKind, t.subjectId),
  ],
);

export const photoRequests = media.table(
  'photo_requests',
  {
    id: text('id').primaryKey(),
    homeId: text('home_id').notNull(),
    levelId: text('level_id'),
    roomId: text('room_id'),
    roomName: text('room_name'),
    x: doublePrecision('x'),
    z: doublePrecision('z'),
    yaw: doublePrecision('yaw'),
    pitch: doublePrecision('pitch'),
    reason: text('reason').notNull(),
    requester: text('requester').notNull(),
    status: text('status').notNull().default('open'),
    subjectKind: text('subject_kind'),
    subjectId: text('subject_id'),
    createdAt: timestamptz('created_at').notNull().defaultNow(),
    updatedAt: timestamptz('updated_at').notNull().defaultNow(),
    closedAt: timestamptz('closed_at'),
    deletedAt: timestamptz('deleted_at'),
  },
  (t) => [index('photo_requests_home_idx').on(t.homeId, t.createdAt)],
);
export type PhotoRequestRow = typeof photoRequests.$inferSelect;
