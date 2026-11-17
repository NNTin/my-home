# Photos

The owner takes photos of the real home **inside the model's context**: each photo is stored with the pose it was
taken from (where, on which level, in which room, looking which way). The photos are evidence for refining walls,
rooms, openings and furniture, and an LLM agent that is unsure can [ask for a new one](#photo-requests). How the
figure is walked and a photo is taken is in [walking.md](walking.md).

Photos and their metadata live only in the database. They never go into the repository or onto GitHub.

## Data model

Everything is in the Postgres schema **`media`**, apart from the home model and the layouts in `public`:

| Table                     | Content                                                                                                     |
| ------------------------- | ----------------------------------------------------------------------------------------------------------- |
| `media.photos`            | metadata: home, level, pose, captured room, time, note, tags, request, sizes, sensor snapshot, `deleted_at` |
| `media.photo_blobs`       | the image bytes (`bytea`), one row per photo, so metadata queries stay light                                |
| `media.photo_thumbnails`  | the thumbnail bytes                                                                                         |
| `media.photo_requests`    | requests for new photos: target, reason, requester, status, `deleted_at`                                    |
| `media.schema_migrations` | the journal of this schema's own migrations                                                                 |

Drizzle definitions: [`apps/api/src/db/media-schema.ts`](../apps/api/src/db/media-schema.ts). Request and response
shapes: [`packages/shared/src/photos.ts`](../packages/shared/src/photos.ts).

### Soft references

`media` has **no foreign key into `public`**: the staging reset runs `drop schema public cascade`, which would
silently drop such a constraint. A photo names its home, level, room and request by id only.

- The **pose in the plan frame is authoritative**. Ids are hints that may stop resolving.
- At capture the server records the room at the pose as `capturedRoomId` and `capturedRoomName`. They never change
  unless the pose is adjusted.
- On every read the server resolves the photo against the model it has now:
  - `room`: the room whose outline contains the pose today, or `null`;
  - `capturedRoomStatus`: `current`, `renamed` (same id, other name), `missing` (the id is not in this model: show
    "room not in this model" next to the captured name) or `none` (nothing was recorded, for example outdoors);
  - `levelInModel`: whether `levelId` still exists.
- Nothing fails when a branch renames or removes a room, a level or the whole home: the photo is still listed at
  its pose with its captured room name. The `roomId` list filter matches the captured **or** the resolved room.

### Pose conventions

The home model's frame ([home-model.md](home-model.md#conventions)), metres and radians:

| Field      | Meaning                                                                             |
| ---------- | ----------------------------------------------------------------------------------- |
| `position` | `x` plan east, `y` up (the eye point, in model heights), `z` plan south             |
| `yaw`      | about `+y`, counter-clockwise seen from above; 0 looks along `-z`, `π/2` along `-x` |
| `pitch`    | positive looks up, negative down; `-π/2` to `π/2`                                   |
| `fovH`     | horizontal field of view of the camera, if known                                    |

`yaw` is the same convention as a layout item's `rotationY` and a three.js camera's `rotation.y`.
`poseDirection()` in the shared package gives the view direction. A compass heading `h` (degrees clockwise from
`-z`) is `yaw = -h × π / 180`. Poses only use the model's local frame: no real-world position is stored anywhere.

### Sensor snapshot

`sensors` on a photo is what the phone's orientation sensors said when it was taken
([walking.md](walking.md#turning-and-tilting-with-the-phone)). It is stored in the nullable column
`media.photos.sensors` (JSON), so photos from before it, and from builds that do not know it, have `null`.

| Field                                | Meaning                                                                  |
| ------------------------------------ | ------------------------------------------------------------------------ |
| `source`                             | `sensor`: the heading was measured by the compass; `manual`: set by hand |
| `tilt`                               | whether the pitch came from the phone's tilt                             |
| `alpha`, `beta`, `gamma`, `absolute` | the raw `DeviceOrientationEvent` values                                  |
| `compassHeading`, `compassAccuracy`  | iOS: `webkitCompassHeading` and `webkitCompassAccuracy` (± degrees)      |
| `screenAngle`                        | `screen.orientation.angle` at the shot                                   |
| `magneticBearing`                    | bearing of the camera from magnetic north, degrees clockwise             |
| `declination`, `calibrationOffset`   | what was added to get the true bearing                                   |
| `trueBearing`                        | the smoothed true bearing the photo was saved with                       |
| `yaw`, `pitch`, `roll`               | the pose the sensors gave, in radians                                    |
| `capturedAt`                         | when the snapshot was taken                                              |

The snapshot is **orientation only**: it holds no position, and the app never uses the Geolocation API. It
is written once. Correcting a photo's pose afterwards changes `pose` and leaves the snapshot as it was, so
what was measured and what was corrected can be told apart. Unknown fields are dropped on upload, and a
stored snapshot a build cannot read counts as none.

The gallery's detail view says where each heading came from ("Heading measured by the phone: true bearing
84° · ±12° · declination +3° · calibration −7°", "set by hand", or "no sensor data"), and in the 3D view a
ring around a camera marks a measured heading. `photos.sh <env> sensors <photo-id>` prints it.

## Images and privacy

Uploads are processed by [`apps/api/src/photos/image.ts`](../apps/api/src/photos/image.ts) (sharp):

- JPEG, PNG and WebP are accepted, up to `PHOTO_MAX_UPLOAD_BYTES` (25 MB). Anything else is a 415, a larger file
  a 413. The format is detected from the bytes, not from the file name.
- The image is rotated as its EXIF orientation says, resized to at most **2560 px** on the long edge and
  re-encoded as WebP; a 480 px thumbnail is generated.
- **All metadata is removed**: EXIF (including the GPS location, camera and time), XMP, IPTC and colour profiles.
  This is a hard rule, see the privacy rule in `AGENTS.md`. The **original file is not kept**, because it carries
  that metadata.
- `takenAt` is the upload time unless the client sends one.
- **Every upload is re-encoded, without exception**, also a WebP this server wrote itself. A file can hide bytes
  where no container check finds them (for example behind the bitstream inside a pixel chunk), so nothing is
  ever stored as it was uploaded.
- A file that cannot be decoded is a 415; a failure after decoding is a 500.

Photos are processed one at a time; decoding a full-size phone photo needs a few hundred MB for a moment, which
is why the api's memory limit in the chart is 512Mi.

## Persistence

**Photos survive every deploy of every branch.** Staging is reset on each deploy, but the reset
([`apps/api/src/db/reset.ts`](../apps/api/src/db/reset.ts)) drops only the `public` and `drizzle` schemas. Then
`database.migrate()` applies the `public` migrations and the `media` migrations, and the homes are seeded again.
Production only migrates. Tests cover the reset (`apps/api/test/media-persistence.test.ts`) and CI runs the real
`dist/reset.js` against Postgres with a photo in place.

Deploys, resets, migrations, seeding and tests never delete photos. Only the owner's
[explicit actions](#deletion-and-the-trash) do.

### Migrations: expand-only

Pull requests deploy to the one staging database in any order, so an older branch must run against a schema a
newer branch has already extended. The `media` schema therefore has its own hand-written migrations in
[`apps/api/media-migrations/`](../apps/api/media-migrations/) and its own migrator
([`media-migrate.ts`](../apps/api/src/db/media-migrate.ts)), not drizzle-kit's:

- **Add only**: new tables, new columns, new indexes. Never drop or rename anything, never make a column
  stricter, never rewrite or delete rows.
- **Idempotent statements**: `create table if not exists media.…`, `alter table media.… add column if not exists …`,
  `create index if not exists … on media.…`, separated by `--> statement-breakpoint`.
- A **new column is nullable or has a default**, because older code does not write it.
- New code must also run **without** a column it added being filled by older code (treat `null` as "unknown").
- Never edit or delete a migration file that has been merged; add a new one (`NNNN_what_it_adds.sql`).
- A stored value that code checks against a fixed list (a request's `status`, `requester`) cannot get new values
  without breaking older branches' reads. Add a new column instead.

The migrator applies every file whose name is not in `media.schema_migrations`, in name order, whatever was
applied before, and ignores journal entries it does not know. So two branches may each add a migration and deploy
in either order. A test lints the migration files for these rules.

To add a column: write the migration, add the column to `media-schema.ts`, and extend the shared schema with an
optional field.

### Stores per environment and the copy tool

Staging and production each have their own database and so their own photos. The owner mostly works on staging.
To promote photos to production, an agent or the owner runs the copy tool **when asked**; nothing copies
automatically:

```sh
S=.claude/skills/my-home-environments/scripts
$S/photos-copy.sh staging production --dry-run            # what would be copied
$S/photos-copy.sh staging production --since 2026-11-01T00:00:00Z
```

A copied photo keeps its id, pose, time, captured room, note and tags. Its image is re-encoded once more by the destination, like every upload. That is the price of never storing an uploaded file as it came: the copy is encoded at the same quality and is not scaled again (it is already within the size limit), so the loss of that one extra generation is small, but the bytes differ from the source. Photos already on the destination (also in
its trash) are skipped, so the copy can be repeated. It only adds photos and never changes the source.

### Size and backups

A stored photo is about 0.3 to 1.2 MB plus a thumbnail of about 40 kB: budget **1 MB per photo**, so 1,000 photos
are about 1 GB of database. A `pg_dump` of them is about the same size, since WebP does not compress further (use
the custom format; a plain-text dump doubles it). Requirements for the databases are in
[deployment.md](deployment.md#databases-and-backups).

## Deletion and the trash

- `DELETE /api/photos/:id` (and the same for requests) is a **soft delete**: the item gets a `deletedAt`, leaves
  the lists and shows up in the trash (`GET /api/homes/:homeId/trash`) with a `purgeAt`.
- `POST …/restore` brings it back unchanged.
- Items are **purged** (deleted for good, with their image) by `POST …/purge` on an item in the trash, by
  `POST /api/homes/:homeId/trash/empty`, or automatically `PHOTO_TRASH_RETENTION_DAYS` (30) after deletion. The
  api checks hourly and whenever the trash is listed.
- Deleting, purging and emptying the trash are the **owner's** actions in the app. **Agents never delete or purge
  photos or requests** and the skill has no script for it. The only exception is test data an agent uploaded
  itself in the same task.

## Browsing photos

**📷 Photos** in the view controls opens the gallery in place of the furniture panel
([`apps/web/src/photos/`](../apps/web/src/photos/)).

- **Photos**: thumbnails, newest first, with filters for level (or outside), room, tag, request and date. A
  click opens the detail view: the photo, where and when it was taken, the pose (position, heading in degrees
  clockwise from plan north, pitch, field of view), the note and tags (both editable) and the request it
  answers. A photo whose room is gone shows its captured room name with "room not in this model".
- **Camera markers**: while the gallery is open, every listed photo on a visible level (the cutaway decides;
  outdoor photos always show) is drawn in 3D as a camera with its view cone. Clicking a marker opens the photo.
  The markers follow the gallery's filters. They also show in the walking overview.
- **View from here** puts the 3D camera at the photo's pose with a matching field of view. **Lay the photo over
  the 3D view** draws the photo semi-transparently on top (opacity slider) to compare model and reality: where
  walls, doors and windows do not line up, the model or the pose is off. The photo is scaled to fit the view and
  the camera's field of view is chosen to match (`matchingVerticalFov`), so it lines up at any window size.
- **Requests**: all photo requests with their state; cancel, reopen or delete them, or jump to the photos that
  answer one.
- **Trash**: deleted photos and requests with the date they will be gone for good; restore them, delete one for
  good or empty the trash (both ask first).

While [walking](walking.md), open requests with a position stand in the model as translucent "ghost" figures
facing the way the photo should look. **Requests (n)** lists them: **Go there** moves the figure onto the spot,
**Answer this** picks one regardless of where the figure stands. A photo taken at a request's spot (within 1.5 m
on the same level), or in the room a request names, is offered as its answer; saving it fulfils the request.

## API

All under `/api`; shapes in `packages/shared/src/photos.ts`.

| Method and path                                      | Purpose                                                                         |
| ---------------------------------------------------- | ------------------------------------------------------------------------------- |
| `POST /homes/:homeId/photos`                         | upload: multipart with a `meta` JSON part and an `image` file part              |
| `GET /homes/:homeId/photos`                          | list, newest first; filters below; the trash is excluded                        |
| `GET /photos/:id`                                    | metadata (also for a photo in the trash)                                        |
| `GET /photos/:id/image`, `GET /photos/:id/thumbnail` | the WebP bytes                                                                  |
| `PATCH /photos/:id`                                  | change pose, level, note, tags, time or request; a new pose re-derives the room |
| `DELETE /photos/:id`, `POST /photos/:id/restore`     | to the trash and back                                                           |
| `POST /photos/:id/purge`                             | delete for good; 409 unless the photo is in the trash                           |
| `POST /homes/:homeId/photo-requests`                 | create a request                                                                |
| `GET /homes/:homeId/photo-requests`                  | list, oldest first; `status=open` (default), `fulfilled`, `cancelled`, `all`    |
| `GET /photo-requests/:id`                            | one request with the ids of its photos                                          |
| `POST /photo-requests/:id/fulfil`                    | link a photo (`{ "photoId": … }`) and close the request                         |
| `POST /photo-requests/:id/cancel`, `…/reopen`        | close without a photo, or open again                                            |
| `DELETE /photo-requests/:id`, `…/restore`, `…/purge` | the trash, as for photos                                                        |
| `GET /homes/:homeId/trash`                           | deleted photos and requests, with `retentionDays`                               |
| `POST /homes/:homeId/trash/empty`                    | purge everything in this home's trash                                           |

List filters: `levelId`, `roomId`, `tag`, `requestId`, `near=x,z,radius` (metres on the plan), `since` and `until`
(by `takenAt`), `limit` (100, at most 500) and `offset`. The response has `items` and the `total` of all matches.

```sh
curl -X POST "$BASE/api/homes/home/photos" \
  -F 'meta={"levelId":"souterrain","pose":{"position":{"x":4.5,"y":-1,"z":-6},"yaw":1.57,"pitch":0},"note":"North wall","tags":["wall"]}' \
  -F 'image=@photo.jpg'
```

The home does not have to exist in this environment: it is a soft reference like the rest.

## Photo requests

A request says where to stand (`position` on a level, a `roomId`, or both), which way to look (`yaw`, `pitch`), why
(`reason`) and who asks (`requester`: `owner` or `agent`). Uploading a photo with the request's id as `requestId`, or setting `requestId` on an existing photo with `PATCH`, fulfils an open request of the same home; `fulfil` does the same and also checks the photo. Only photos of the request's own home count as its answers. Unlinking a photo does not reopen the request. A request may have several photos; photos
in the trash do not count.

## Agent workflow

When refining the model and unsure about a wall, a room, an opening or a piece of furniture, **look at the photos
first, and ask for a new one rather than guessing**. Scripts (see the
[skill](../.claude/skills/my-home-environments/SKILL.md)):

```sh
S=.claude/skills/my-home-environments/scripts
$S/photos.sh staging list --room souterrain-kitchen                  # metadata with poses
$S/photos.sh staging download --near 4.5,-6,2 --dir /tmp/photos      # <id>.webp + <id>.json, outside the repo
$S/photos.sh staging annotate <photo-id> --note "window is 1.2 m wide" --tag window
$S/photo-requests.sh staging create --room souterrain-kitchen --at 11,-9 --heading-deg 0 \
  --reason "How far is the window from the east wall?"
$S/photo-requests.sh staging list                                    # open requests
$S/photo-requests.sh staging close <request-id> [--photo <photo-id>] # cancel, or fulfil with a photo
```

- Download photos to a temporary directory or the session's artifact directory, **never into the repository**.
- Record what a photo showed in the model as a dimension's `source: "estimated-from-photo"` and a `note` naming
  the photo id.
- Agents may create requests and add notes and tags. They never delete or purge.
