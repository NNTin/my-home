import { randomUUID } from 'node:crypto';
import {
  Photo,
  PhotoPoseChange,
  PhotoRequest,
  PhotoSensors,
  Polygon,
  resolvePhotoRoom,
  roomAt,
  type CreatePhotoMeta,
  type CreatePhotoRequestBody,
  type ListPhotosQuery,
  type ModelRooms,
  type PhotoPose,
  type PhotoRequestStatus,
  type Subject,
  type SubjectRef,
  type UpdatePhotoBody,
} from '@my-home/shared';
import { and, asc, count, desc, eq, gte, inArray, isNotNull, isNull, lt, sql } from 'drizzle-orm';
import { z } from 'zod';
import type { ResolvedActor } from '../actor';
import { problem } from '../errors';
import type { ProcessedImage } from '../photos/image';
import type { Db } from './client';
import {
  photoBlobs,
  photoPoseChanges,
  photoRequests,
  photos,
  photoSubjects,
  photoThumbnails,
  type PhotoPoseChangeRow,
  type PhotoRequestRow,
  type PhotoRow,
} from './media-schema';
import { homes } from './schema';
import { subjectResolver } from './subjects';

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
/** Who a change is recorded for when the caller does not say (seeding, tests). */
const DEFAULT_ACTOR = { actor: 'owner', source: 'default', username: null } as const;
const iso = (date: Date | null) => (date ? date.toISOString() : null);

export type PurgeResult = 'purged' | 'not-in-trash' | 'not-found';
export type UndoPoseResult =
  | { status: 'undone'; change: PhotoPoseChange; photo: Photo }
  | { status: 'not-found' | 'already-undone' | 'changed-since' };

/** A photo row's pose, as the api returns it. */
const poseOfRow = (row: PhotoRow): PhotoPose => ({
  position: { x: row.x, y: row.y, z: row.z },
  yaw: row.yaw,
  pitch: row.pitch,
  ...(row.fovH !== null && { fovH: row.fovH }),
});

/** As stored: a pose without `fovH` has none (the column is set to null). */
const storedPose = (pose: PhotoPose): PhotoPose => ({
  position: { x: pose.position.x, y: pose.position.y, z: pose.position.z },
  yaw: pose.yaw,
  pitch: pose.pitch,
  ...(pose.fovH !== undefined && { fovH: pose.fovH }),
});

/** Equal up to rounding (jsonb keeps numbers as decimals). */
export function samePose(a: PhotoPose, b: PhotoPose): boolean {
  const close = (x: number, y: number) => Math.abs(x - y) <= 1e-9 * Math.max(1, Math.abs(x));
  return (
    close(a.position.x, b.position.x) &&
    close(a.position.y, b.position.y) &&
    close(a.position.z, b.position.z) &&
    close(a.yaw, b.yaw) &&
    close(a.pitch, b.pitch) &&
    (a.fovH === undefined ? b.fovH === undefined : b.fovH !== undefined && close(a.fovH, b.fovH))
  );
}

const toPoseChange = (
  row: PhotoPoseChangeRow,
  undoneById: string | null,
  current: PhotoPose,
): PhotoPoseChange =>
  PhotoPoseChange.parse({
    id: row.id,
    photoId: row.photoId,
    actor: row.actor,
    actorSource: row.actorSource,
    actorName: row.actorName,
    at: row.at.toISOString(),
    before: row.before,
    after: row.after,
    reason: row.reason,
    undoesId: row.undoesId,
    undoneById,
    canUndo: undoneById === null && samePose(current, row.after),
  });

/** A unique-index violation (Postgres 23505), from node-postgres or PGlite, wrapped or not. */
const isUniqueViolation = (error: unknown): boolean => {
  for (let e = error as { code?: string; cause?: unknown } | undefined; e; e = e.cause as never) {
    if (e.code === '23505') return true;
  }
  return false;
};
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

  const toPhoto = (row: PhotoRow, model: ModelRooms | undefined, subjects: SubjectRef[]): Photo =>
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
      subjects,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
      deletedAt: iso(row.deletedAt),
      purgeAt: purgeAt(row.deletedAt),
    });

  /** The subjects linked to each photo, in the order they were linked (then by kind and id). */
  const subjectsByPhoto = async (photoIds: string[]) => {
    const byPhoto = new Map<string, Subject[]>();
    if (photoIds.length === 0) return byPhoto;
    const rows = await db
      .select()
      .from(photoSubjects)
      .where(inArray(photoSubjects.photoId, photoIds))
      .orderBy(
        asc(photoSubjects.createdAt),
        asc(photoSubjects.subjectKind),
        asc(photoSubjects.subjectId),
      );
    for (const row of rows) {
      const subject = { kind: row.subjectKind, id: row.subjectId } as Subject;
      byPhoto.set(row.photoId, [...(byPhoto.get(row.photoId) ?? []), subject]);
    }
    return byPhoto;
  };

  /** Photos with their subjects resolved against the current model and placements. */
  const toPhotos = async (rows: PhotoRow[], model: ModelRooms | undefined): Promise<Photo[]> => {
    const links = await subjectsByPhoto(rows.map((r) => r.id));
    const resolver = subjectResolver(db);
    return Promise.all(
      rows.map(async (row) =>
        toPhoto(row, model, await resolver.refs(row.homeId, links.get(row.id) ?? [])),
      ),
    );
  };
  const one = async (row: PhotoRow | undefined, model?: ModelRooms) =>
    row && (await toPhotos([row], model ?? (await modelRooms(row.homeId))))[0];

  /** Links subjects to a photo; ones it already has are kept as they are. */
  const link = async (tx: Pick<Db, 'insert'>, photoId: string, subjects: Subject[]) => {
    if (subjects.length === 0) return;
    await tx
      .insert(photoSubjects)
      .values(subjects.map((s) => ({ photoId, subjectKind: s.kind, subjectId: s.id })))
      .onConflictDoNothing();
  };

  /** A photo answering a request of its own home shows the request's subject too. */
  const linkRequestSubject = async (
    tx: Pick<Db, 'insert' | 'select'>,
    photoId: string,
    requestId: string,
    homeId: string,
  ) => {
    const [request] = await tx
      .select({ kind: photoRequests.subjectKind, id: photoRequests.subjectId })
      .from(photoRequests)
      .where(and(eq(photoRequests.id, requestId), eq(photoRequests.homeId, homeId)));
    if (request?.kind && request.id) {
      await link(tx, photoId, [{ kind: request.kind, id: request.id } as Subject]);
    }
  };

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
    const resolver = subjectResolver(db);
    const subjects = await Promise.all(
      rows.map(async (row) =>
        row.subjectKind && row.subjectId
          ? (
              await resolver.refs(row.homeId, [
                { kind: row.subjectKind, id: row.subjectId } as Subject,
              ])
            )[0]!
          : null,
      ),
    );
    return rows.map((row, i) =>
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
        subject: subjects[i],
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
        await link(tx, id, meta.subjects ?? []);
        if (inserted.requestId) {
          await linkRequestSubject(tx, id, inserted.requestId, homeId);
          await fulfilOpenRequest(tx, inserted.requestId, homeId);
        }
        return inserted;
      });
      return one(row, model);
    },

    /** Photos of a home that are not in the trash, newest first. */
    async list(homeId: string, query: ListQuery): Promise<{ items: Photo[]; total: number }> {
      const where = and(
        eq(photos.homeId, homeId),
        isNull(photos.deletedAt),
        query.levelId === undefined ? undefined : eq(photos.levelId, query.levelId),
        query.requestId === undefined ? undefined : eq(photos.requestId, query.requestId),
        query.subject === undefined
          ? undefined
          : inArray(
              photos.id,
              db
                .select({ id: photoSubjects.photoId })
                .from(photoSubjects)
                .where(
                  and(
                    eq(photoSubjects.subjectKind, query.subject.kind),
                    eq(photoSubjects.subjectId, query.subject.id),
                  ),
                ),
            ),
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
        const matches = (await ordered).filter((row) => {
          if (row.capturedRoomId === query.roomId) return true;
          return (model ? roomAt(model, row.levelId, row) : null)?.id === query.roomId;
        });
        return {
          items: await toPhotos(matches.slice(query.offset, query.offset + query.limit), model),
          total: matches.length,
        };
      }
      const [total] = await db.select({ value: count() }).from(photos).where(where);
      const rows = await ordered.limit(query.limit).offset(query.offset);
      return { items: await toPhotos(rows, model), total: total?.value ?? 0 };
    },

    /** One photo, also when it is in the trash. */
    async get(id: string): Promise<Photo | undefined> {
      const [row] = await db.select().from(photos).where(eq(photos.id, id));
      return one(row);
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

    /**
     * Partial update. A changed pose is recorded in the photo's pose history with `actor`
     * (`undoesId` when it undoes an earlier change); the sensor snapshot is left as it is.
     */
    async update(
      id: string,
      body: UpdateBody,
      actor: Pick<ResolvedActor, 'actor' | 'source' | 'username'> = DEFAULT_ACTOR,
      undoesId: string | null = null,
    ): Promise<Photo | undefined> {
      return (await this.updateWithChange(id, body, actor, undoesId))?.photo;
    },

    async updateWithChange(
      id: string,
      body: UpdateBody,
      actor: Pick<ResolvedActor, 'actor' | 'source' | 'username'> = DEFAULT_ACTOR,
      undoesId: string | null = null,
    ): Promise<{ photo: Photo; change: PhotoPoseChangeRow | undefined } | undefined> {
      const [current] = await db.select().from(photos).where(eq(photos.id, id));
      if (!current) return undefined;
      const before = poseOfRow(current);
      const after = body.pose && storedPose(body.pose);
      const poseChanged = after !== undefined && (undoesId !== null || !samePose(before, after));
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
        if (updated && body.subjects !== undefined) {
          await tx.delete(photoSubjects).where(eq(photoSubjects.photoId, id));
          await link(tx, id, body.subjects);
        }
        // Linking a photo to a request answers it, exactly as uploading it for the request does.
        if (updated && body.requestId) {
          await linkRequestSubject(tx, id, body.requestId, updated.homeId);
          await fulfilOpenRequest(tx, body.requestId, updated.homeId);
        }
        let change: PhotoPoseChangeRow | undefined;
        if (updated && poseChanged) {
          [change] = await tx
            .insert(photoPoseChanges)
            .values({
              id: randomUUID(),
              photoId: id,
              actor: actor.actor,
              actorSource: actor.source,
              actorName: actor.username,
              before,
              after,
              reason: body.poseReason ?? null,
              undoesId,
            })
            .returning();
        }
        return updated && { updated, change };
      });
      const photo = row && (await one(row.updated, model));
      return photo && { photo, change: row.change };
    },

    /** The photo's pose changes, newest first; undefined when there is no such photo. */
    async poseHistory(id: string): Promise<PhotoPoseChange[] | undefined> {
      const [current] = await db.select().from(photos).where(eq(photos.id, id));
      if (!current) return undefined;
      const rows = await db
        .select()
        .from(photoPoseChanges)
        .where(eq(photoPoseChanges.photoId, id))
        .orderBy(desc(photoPoseChanges.seq));
      const undoneBy = new Map(rows.filter((r) => r.undoesId).map((r) => [r.undoesId!, r.id]));
      const pose = poseOfRow(current);
      return rows.map((r) => toPoseChange(r, undoneBy.get(r.id) ?? null, pose));
    },

    /**
     * Puts the pose back to what it was before `changeId`, as a new change that undoes it.
     * Refused when it was undone already or the pose has changed since.
     */
    async undoPose(
      id: string,
      changeId: string,
      actor: Pick<ResolvedActor, 'actor' | 'source' | 'username'>,
    ): Promise<UndoPoseResult> {
      const [target] = await db
        .select()
        .from(photoPoseChanges)
        .where(and(eq(photoPoseChanges.id, changeId), eq(photoPoseChanges.photoId, id)));
      const [current] = await db.select().from(photos).where(eq(photos.id, id));
      if (!target || !current) return { status: 'not-found' };
      const [undone] = await db
        .select({ id: photoPoseChanges.id })
        .from(photoPoseChanges)
        .where(eq(photoPoseChanges.undoesId, changeId));
      if (undone) return { status: 'already-undone' };
      if (!samePose(poseOfRow(current), target.after)) return { status: 'changed-since' };
      try {
        const result = await this.updateWithChange(id, { pose: target.before }, actor, changeId);
        if (!result?.change) return { status: 'not-found' };
        return {
          status: 'undone',
          photo: result.photo,
          change: toPoseChange(result.change, null, result.photo.pose),
        };
      } catch (error) {
        if (isUniqueViolation(error)) return { status: 'already-undone' };
        throw error;
      }
    },

    /** Moves a photo to the trash (idempotent: the first deletion time is kept). */
    async softDelete(id: string): Promise<Photo | undefined> {
      const [row] = await db
        .update(photos)
        .set({ deletedAt: sql`coalesce(${photos.deletedAt}, now())` })
        .where(eq(photos.id, id))
        .returning();
      return one(row);
    },

    async restore(id: string): Promise<Photo | undefined> {
      const [row] = await db
        .update(photos)
        .set({ deletedAt: null })
        .where(eq(photos.id, id))
        .returning();
      return one(row);
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

    /** `actor` is the requester when the body does not declare one. */
    async createRequest(
      homeId: string,
      body: CreateRequest,
      actor: Pick<ResolvedActor, 'actor'>,
    ): Promise<PhotoRequest> {
      const model = await modelRooms(homeId);
      // Only a use subject: the request is in the use's first room (or just on its level).
      let use: { levelId: string | null; roomIds: string[] } | undefined;
      if (body.roomId == null && body.position == null && body.subject?.kind === 'use') {
        use = await subjectResolver(db).use(homeId, body.subject.id);
        if (!use) {
          throw problem(
            400,
            `Use "${body.subject.id}" is not in home "${homeId}": give a roomId or a position`,
          );
        }
      }
      const roomId =
        body.roomId ??
        (model && body.position ? roomAt(model, body.levelId, body.position)?.id : undefined) ??
        use?.roomIds[0] ??
        null;
      const room = model?.rooms.find((r) => r.id === roomId);
      const [row] = await db
        .insert(photoRequests)
        .values({
          id: randomUUID(),
          homeId,
          levelId: body.levelId ?? room?.levelId ?? use?.levelId ?? null,
          roomId,
          roomName: room?.name ?? null,
          x: body.position?.x ?? null,
          z: body.position?.z ?? null,
          yaw: body.yaw ?? null,
          pitch: body.pitch ?? null,
          reason: body.reason,
          requester: body.requester ?? actor.actor,
          subjectKind: body.subject?.kind ?? null,
          subjectId: body.subject?.id ?? null,
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
      const linked = await db.transaction(async (tx) => {
        const rows = await tx
          .update(photos)
          .set({ requestId: id, updatedAt: new Date() })
          .where(and(eq(photos.id, photoId), eq(photos.homeId, request.homeId)))
          .returning({ id: photos.id });
        if (rows.length > 0) await linkRequestSubject(tx, photoId, id, request.homeId);
        return rows;
      });
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
        photos: await toPhotos(photoRows, model),
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
