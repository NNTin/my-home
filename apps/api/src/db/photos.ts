import { randomUUID } from 'node:crypto';
import {
  Photo,
  PhotoRequest,
  PhotoSensors,
  Polygon,
  resolvePhotoRoom,
  roomAt,
  type CreatePhotoMeta,
  type CreatePhotoRequestBody,
  type ListPhotosQuery,
  type ModelRooms,
  type PhotoRequestStatus,
  type UpdatePhotoBody,
} from '@my-home/shared';
import { and, asc, count, desc, eq, gte, inArray, isNotNull, isNull, lt, sql } from 'drizzle-orm';
import { z } from 'zod';
import type { ProcessedImage } from '../photos/image';
import type { Db } from './client';
import {
  photoBlobs,
  photoRequests,
  photos,
  photoThumbnails,
  type PhotoRequestRow,
  type PhotoRow,
} from './media-schema';
import { homes } from './schema';

type CreateMeta = z.output<typeof CreatePhotoMeta>;
type UpdateBody = z.output<typeof UpdatePhotoBody>;
type ListQuery = z.output<typeof ListPhotosQuery>;
type CreateRequest = z.output<typeof CreatePhotoRequestBody>;

/**
 * Just the parts of a stored home that photos refer to. Read leniently, so a home written by
 * another branch's schema (or no home at all) leaves rooms unresolved instead of failing.
 */
const StoredModelRooms = z.object({
  levels: z.array(z.looseObject({ id: z.string() })),
  rooms: z.array(
    z.looseObject({
      id: z.string(),
      name: z.string(),
      levelId: z.string(),
      outline: Polygon,
    }),
  ),
});

/** A stored snapshot as far as this build understands it; one it cannot read counts as none. */
const storedSensors = (value: unknown): PhotoSensors | null => {
  const parsed = PhotoSensors.nullable().safeParse(value ?? null);
  return parsed.success ? parsed.data : null;
};

const DAY_MS = 24 * 60 * 60 * 1000;
const iso = (date: Date | null) => (date ? date.toISOString() : null);

export type PurgeResult = 'purged' | 'not-in-trash' | 'not-found';
export type FulfilResult =
  { status: 'fulfilled'; request: PhotoRequest } | { status: 'not-found' | 'photo-not-found' };

/**
 * Data access for photos and photo requests (the `media` schema). Deleting is always a soft
 * delete into the trash; rows only disappear through `purge*`, which the owner triggers or the
 * retention period does.
 */
export function photoStore(db: Db, options: { retentionDays: number }) {
  const retentionMs = options.retentionDays * DAY_MS;
  const purgeAt = (deletedAt: Date | null) =>
    deletedAt ? new Date(deletedAt.getTime() + retentionMs).toISOString() : null;

  const modelRooms = async (homeId: string): Promise<ModelRooms | undefined> => {
    const [row] = await db.select({ model: homes.model }).from(homes).where(eq(homes.id, homeId));
    const parsed = StoredModelRooms.safeParse(row?.model);
    return parsed.success ? parsed.data : undefined;
  };

  const toPhoto = (row: PhotoRow, model: ModelRooms | undefined): Photo =>
    Photo.parse({
      id: row.id,
      homeId: row.homeId,
      levelId: row.levelId,
      pose: {
        position: { x: row.x, y: row.y, z: row.z },
        yaw: row.yaw,
        pitch: row.pitch,
        ...(row.fovH !== null && { fovH: row.fovH }),
      },
      capturedRoomId: row.capturedRoomId,
      capturedRoomName: row.capturedRoomName,
      ...resolvePhotoRoom(model, { ...row, position: row }),
      takenAt: row.takenAt.toISOString(),
      note: row.note,
      tags: row.tags,
      requestId: row.requestId,
      image: {
        contentType: row.contentType,
        width: row.width,
        height: row.height,
        byteSize: row.byteSize,
      },
      thumbnail: {
        contentType: row.thumbnailContentType,
        width: row.thumbnailWidth,
        height: row.thumbnailHeight,
        byteSize: row.thumbnailByteSize,
      },
      sensors: storedSensors(row.sensors),
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
      deletedAt: iso(row.deletedAt),
      purgeAt: purgeAt(row.deletedAt),
    });

  /** The captured room for a pose: what the caller recorded, else the room at the pose now. */
  const capturedRoom = (
    model: ModelRooms | undefined,
    levelId: string | null,
    position: { x: number; z: number },
    given: { capturedRoomId?: string | null; capturedRoomName?: string | null },
  ) => {
    if (given.capturedRoomId !== undefined) {
      const known = model?.rooms.find((r) => r.id === given.capturedRoomId);
      return {
        capturedRoomId: given.capturedRoomId,
        capturedRoomName:
          given.capturedRoomId === null ? null : (given.capturedRoomName ?? known?.name ?? null),
      };
    }
    const room = model ? roomAt(model, levelId, position) : null;
    return { capturedRoomId: room?.id ?? null, capturedRoomName: room?.name ?? null };
  };

  /**
   * The photos that answer each request. A request id on a photo is a soft reference (the copy
   * tool keeps it), so only photos of the request's own home count as its answers.
   */
  const photoIdsByRequest = async (requests: Pick<PhotoRequestRow, 'id' | 'homeId'>[]) => {
    const byRequest = new Map<string, string[]>();
    if (requests.length === 0) return byRequest;
    const homeOf = new Map(requests.map((r) => [r.id, r.homeId]));
    const rows = await db
      .select({ id: photos.id, requestId: photos.requestId, homeId: photos.homeId })
      .from(photos)
      .where(and(inArray(photos.requestId, [...homeOf.keys()]), isNull(photos.deletedAt)))
      .orderBy(asc(photos.takenAt), asc(photos.id));
    for (const row of rows) {
      if (homeOf.get(row.requestId!) !== row.homeId) continue;
      byRequest.set(row.requestId!, [...(byRequest.get(row.requestId!) ?? []), row.id]);
    }
    return byRequest;
  };

  const toRequests = async (rows: PhotoRequestRow[]): Promise<PhotoRequest[]> => {
    const linked = await photoIdsByRequest(rows);
    return rows.map((row) =>
      PhotoRequest.parse({
        id: row.id,
        homeId: row.homeId,
        levelId: row.levelId,
        roomId: row.roomId,
        roomName: row.roomName,
        position: row.x !== null && row.z !== null ? { x: row.x, z: row.z } : null,
        yaw: row.yaw,
        pitch: row.pitch,
        reason: row.reason,
        requester: row.requester,
        status: row.status,
        photoIds: linked.get(row.id) ?? [],
        createdAt: row.createdAt.toISOString(),
        updatedAt: row.updatedAt.toISOString(),
        closedAt: iso(row.closedAt),
        deletedAt: iso(row.deletedAt),
        purgeAt: purgeAt(row.deletedAt),
      }),
    );
  };

  const setRequestStatus = async (id: string, status: PhotoRequestStatus) => {
    const now = new Date();
    const [row] = await db
      .update(photoRequests)
      .set({ status, closedAt: status === 'open' ? null : now, updatedAt: now })
      .where(eq(photoRequests.id, id))
      .returning();
    return row && (await toRequests([row]))[0];
  };

  /** A photo linked to an open request of its own home fulfils it; any other link is just kept. */
  const fulfilOpenRequest = (tx: Pick<Db, 'update'>, requestId: string, homeId: string) =>
    tx
      .update(photoRequests)
      .set({ status: 'fulfilled', closedAt: new Date(), updatedAt: new Date() })
      .where(
        and(
          eq(photoRequests.id, requestId),
          eq(photoRequests.homeId, homeId),
          eq(photoRequests.status, 'open'),
        ),
      );

  const store = {
    /** Stores a processed upload; undefined when `meta.id` is already taken. */
    async create(
      homeId: string,
      meta: CreateMeta,
      processed: ProcessedImage,
    ): Promise<Photo | undefined> {
      const model = await modelRooms(homeId);
      const levelId = meta.levelId ?? null;
      const { position } = meta.pose;
      const id = meta.id ?? randomUUID();
      const row = await db.transaction(async (tx) => {
        const [inserted] = await tx
          .insert(photos)
          .values({
            id,
            homeId,
            levelId,
            x: position.x,
            y: position.y,
            z: position.z,
            yaw: meta.pose.yaw,
            pitch: meta.pose.pitch,
            fovH: meta.pose.fovH ?? null,
            ...capturedRoom(model, levelId, position, meta),
            takenAt: meta.takenAt ? new Date(meta.takenAt) : new Date(),
            note: meta.note,
            tags: meta.tags,
            requestId: meta.requestId ?? null,
            contentType: processed.image.contentType,
            width: processed.image.width,
            height: processed.image.height,
            byteSize: processed.image.data.byteLength,
            thumbnailContentType: processed.thumbnail.contentType,
            thumbnailWidth: processed.thumbnail.width,
            thumbnailHeight: processed.thumbnail.height,
            thumbnailByteSize: processed.thumbnail.data.byteLength,
            sha256: processed.sha256,
            sensors: meta.sensors ?? null,
          })
          .onConflictDoNothing({ target: photos.id })
          .returning();
        if (!inserted) return undefined;
        await tx.insert(photoBlobs).values({ photoId: id, data: processed.image.data });
        await tx.insert(photoThumbnails).values({ photoId: id, data: processed.thumbnail.data });
        if (inserted.requestId) await fulfilOpenRequest(tx, inserted.requestId, homeId);
        return inserted;
      });
      return row && toPhoto(row, model);
    },

    /** Photos of a home that are not in the trash, newest first. */
    async list(homeId: string, query: ListQuery): Promise<{ items: Photo[]; total: number }> {
      const where = and(
        eq(photos.homeId, homeId),
        isNull(photos.deletedAt),
        query.levelId === undefined ? undefined : eq(photos.levelId, query.levelId),
        query.requestId === undefined ? undefined : eq(photos.requestId, query.requestId),
        query.tag === undefined
          ? undefined
          : sql`${photos.tags} @> ${JSON.stringify([query.tag])}::jsonb`,
        query.since === undefined ? undefined : gte(photos.takenAt, new Date(query.since)),
        query.until === undefined ? undefined : lt(photos.takenAt, new Date(query.until)),
        query.near === undefined
          ? undefined
          : sql`power(${photos.x} - ${query.near.x}, 2) + power(${photos.z} - ${query.near.z}, 2) <= ${query.near.radius ** 2}`,
      );
      const model = await modelRooms(homeId);
      const ordered = db
        .select()
        .from(photos)
        .where(where)
        .orderBy(desc(photos.takenAt), desc(photos.id));

      // The resolved room depends on the current model, so a room filter is applied here.
      if (query.roomId !== undefined) {
        const matches = (await ordered)
          .map((row) => toPhoto(row, model))
          .filter((p) => p.capturedRoomId === query.roomId || p.room?.id === query.roomId);
        return {
          items: matches.slice(query.offset, query.offset + query.limit),
          total: matches.length,
        };
      }
      const [total] = await db.select({ value: count() }).from(photos).where(where);
      const rows = await ordered.limit(query.limit).offset(query.offset);
      return { items: rows.map((row) => toPhoto(row, model)), total: total?.value ?? 0 };
    },

    /** One photo, also when it is in the trash. */
    async get(id: string): Promise<Photo | undefined> {
      const [row] = await db.select().from(photos).where(eq(photos.id, id));
      return row && toPhoto(row, await modelRooms(row.homeId));
    },

    async image(id: string, kind: 'image' | 'thumbnail') {
      const table = kind === 'image' ? photoBlobs : photoThumbnails;
      const [row] = await db
        .select({
          data: table.data,
          contentType: kind === 'image' ? photos.contentType : photos.thumbnailContentType,
          sha256: photos.sha256,
        })
        .from(table)
        .innerJoin(photos, eq(photos.id, table.photoId))
        .where(eq(table.photoId, id));
      return row;
    },

    async update(id: string, body: UpdateBody): Promise<Photo | undefined> {
      const [current] = await db.select().from(photos).where(eq(photos.id, id));
      if (!current) return undefined;
      const model = await modelRooms(current.homeId);
      const levelId = body.levelId === undefined ? current.levelId : body.levelId;
      const position = body.pose?.position ?? current;
      const moved = body.pose !== undefined || body.levelId !== undefined;
      // The photo and the request it answers change together or not at all, as on upload.
      const row = await db.transaction(async (tx) => {
        const [updated] = await tx
          .update(photos)
          .set({
            ...(body.levelId !== undefined && { levelId }),
            ...(body.pose && {
              x: body.pose.position.x,
              y: body.pose.position.y,
              z: body.pose.position.z,
              yaw: body.pose.yaw,
              pitch: body.pose.pitch,
              fovH: body.pose.fovH ?? null,
            }),
            ...((moved || body.capturedRoomId !== undefined) &&
              capturedRoom(model, levelId, position, body)),
            ...(body.capturedRoomId === undefined &&
              !moved &&
              body.capturedRoomName !== undefined && { capturedRoomName: body.capturedRoomName }),
            ...(body.takenAt !== undefined && { takenAt: new Date(body.takenAt) }),
            ...(body.note !== undefined && { note: body.note }),
            ...(body.tags !== undefined && { tags: body.tags }),
            ...(body.requestId !== undefined && { requestId: body.requestId }),
            ...(body.sensors !== undefined && { sensors: body.sensors }),
            updatedAt: new Date(),
          })
          .where(eq(photos.id, id))
          .returning();
        // Linking a photo to a request answers it, exactly as uploading it for the request does.
        if (updated && body.requestId) {
          await fulfilOpenRequest(tx, body.requestId, updated.homeId);
        }
        return updated;
      });
      return row && toPhoto(row, model);
    },

    /** Moves a photo to the trash (idempotent: the first deletion time is kept). */
    async softDelete(id: string): Promise<Photo | undefined> {
      const [row] = await db
        .update(photos)
        .set({ deletedAt: sql`coalesce(${photos.deletedAt}, now())` })
        .where(eq(photos.id, id))
        .returning();
      return row && toPhoto(row, await modelRooms(row.homeId));
    },

    async restore(id: string): Promise<Photo | undefined> {
      const [row] = await db
        .update(photos)
        .set({ deletedAt: null })
        .where(eq(photos.id, id))
        .returning();
      return row && toPhoto(row, await modelRooms(row.homeId));
    },

    /** Deletes a photo and its image for good, but only from the trash. */
    async purge(id: string): Promise<PurgeResult> {
      const rows = await db
        .delete(photos)
        .where(and(eq(photos.id, id), isNotNull(photos.deletedAt)))
        .returning({ id: photos.id });
      if (rows.length > 0) return 'purged';
      const [row] = await db.select({ id: photos.id }).from(photos).where(eq(photos.id, id));
      return row ? 'not-in-trash' : 'not-found';
    },

    async createRequest(homeId: string, body: CreateRequest): Promise<PhotoRequest> {
      const model = await modelRooms(homeId);
      const roomId =
        body.roomId ??
        (model && body.position ? roomAt(model, body.levelId, body.position)?.id : undefined) ??
        null;
      const room = model?.rooms.find((r) => r.id === roomId);
      const [row] = await db
        .insert(photoRequests)
        .values({
          id: randomUUID(),
          homeId,
          levelId: body.levelId ?? room?.levelId ?? null,
          roomId,
          roomName: room?.name ?? null,
          x: body.position?.x ?? null,
          z: body.position?.z ?? null,
          yaw: body.yaw ?? null,
          pitch: body.pitch ?? null,
          reason: body.reason,
          requester: body.requester,
        })
        .returning();
      return (await toRequests([row!]))[0]!;
    },

    /** Requests of a home that are not in the trash, oldest first. */
    async listRequests(homeId: string, status: PhotoRequestStatus | 'all') {
      const rows = await db
        .select()
        .from(photoRequests)
        .where(
          and(
            eq(photoRequests.homeId, homeId),
            isNull(photoRequests.deletedAt),
            status === 'all' ? undefined : eq(photoRequests.status, status),
          ),
        )
        .orderBy(asc(photoRequests.createdAt), asc(photoRequests.id));
      return toRequests(rows);
    },

    async getRequest(id: string): Promise<PhotoRequest | undefined> {
      const [row] = await db.select().from(photoRequests).where(eq(photoRequests.id, id));
      return row && (await toRequests([row]))[0];
    },

    /** Links a photo of the same home to the request and closes it as fulfilled. */
    async fulfilRequest(id: string, photoId: string): Promise<FulfilResult> {
      const [request] = await db.select().from(photoRequests).where(eq(photoRequests.id, id));
      if (!request) return { status: 'not-found' };
      const linked = await db
        .update(photos)
        .set({ requestId: id, updatedAt: new Date() })
        .where(and(eq(photos.id, photoId), eq(photos.homeId, request.homeId)))
        .returning({ id: photos.id });
      if (linked.length === 0) return { status: 'photo-not-found' };
      return { status: 'fulfilled', request: (await setRequestStatus(id, 'fulfilled'))! };
    },

    cancelRequest: (id: string) => setRequestStatus(id, 'cancelled'),
    reopenRequest: (id: string) => setRequestStatus(id, 'open'),

    async softDeleteRequest(id: string): Promise<PhotoRequest | undefined> {
      const [row] = await db
        .update(photoRequests)
        .set({ deletedAt: sql`coalesce(${photoRequests.deletedAt}, now())` })
        .where(eq(photoRequests.id, id))
        .returning();
      return row && (await toRequests([row]))[0];
    },

    async restoreRequest(id: string): Promise<PhotoRequest | undefined> {
      const [row] = await db
        .update(photoRequests)
        .set({ deletedAt: null })
        .where(eq(photoRequests.id, id))
        .returning();
      return row && (await toRequests([row]))[0];
    },

    async purgeRequest(id: string): Promise<PurgeResult> {
      const rows = await db
        .delete(photoRequests)
        .where(and(eq(photoRequests.id, id), isNotNull(photoRequests.deletedAt)))
        .returning({ id: photoRequests.id });
      if (rows.length > 0) return 'purged';
      const [row] = await db
        .select({ id: photoRequests.id })
        .from(photoRequests)
        .where(eq(photoRequests.id, id));
      return row ? 'not-in-trash' : 'not-found';
    },

    /** The trash of a home, most recently deleted first. */
    async trash(homeId: string) {
      const model = await modelRooms(homeId);
      const photoRows = await db
        .select()
        .from(photos)
        .where(and(eq(photos.homeId, homeId), isNotNull(photos.deletedAt)))
        .orderBy(desc(photos.deletedAt), desc(photos.id));
      const requestRows = await db
        .select()
        .from(photoRequests)
        .where(and(eq(photoRequests.homeId, homeId), isNotNull(photoRequests.deletedAt)))
        .orderBy(desc(photoRequests.deletedAt), desc(photoRequests.id));
      return {
        photos: photoRows.map((row) => toPhoto(row, model)),
        requests: await toRequests(requestRows),
        retentionDays: options.retentionDays,
      };
    },

    /** Purges everything in a home's trash. */
    async emptyTrash(homeId: string) {
      const purgedPhotos = await db
        .delete(photos)
        .where(and(eq(photos.homeId, homeId), isNotNull(photos.deletedAt)))
        .returning({ id: photos.id });
      const purgedRequests = await db
        .delete(photoRequests)
        .where(and(eq(photoRequests.homeId, homeId), isNotNull(photoRequests.deletedAt)))
        .returning({ id: photoRequests.id });
      return { purgedPhotos: purgedPhotos.length, purgedRequests: purgedRequests.length };
    },

    /** Purges what has been in the trash longer than the retention period, in every home. */
    async purgeExpired(now = new Date()) {
      const cutoff = new Date(now.getTime() - retentionMs);
      const purgedPhotos = await db
        .delete(photos)
        .where(lt(photos.deletedAt, cutoff))
        .returning({ id: photos.id });
      const purgedRequests = await db
        .delete(photoRequests)
        .where(lt(photoRequests.deletedAt, cutoff))
        .returning({ id: photoRequests.id });
      return { purgedPhotos: purgedPhotos.length, purgedRequests: purgedRequests.length };
    },
  };
  return store;
}
export type PhotoStore = ReturnType<typeof photoStore>;
