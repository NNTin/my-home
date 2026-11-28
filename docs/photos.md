# Photos

The owner takes photos of the real home **inside the model's context**: each photo is stored with the pose it was
taken from (where, on which level, in which room, looking which way). The photos are evidence for refining walls,
rooms, openings and furniture, and an LLM agent that is unsure can [ask for a new one](#photo-requests). How the
figure is walked and a photo is taken is in [walking.md](walking.md).

Photos and their metadata live only in the database. They never go into the repository or onto GitHub.

## Data model

Everything is in the Postgres schema **`media`**, apart from the home model in `public`:

| Table                      | Content                                                                                                     |
| -------------------------- | ----------------------------------------------------------------------------------------------------------- |
| `media.photos`             | metadata: home, level, pose, captured room, time, note, tags, request, sizes, sensor snapshot, `deleted_at` |
| `media.photo_blobs`        | the image bytes (`bytea`), one row per photo, so metadata queries stay light                                |
| `media.photo_thumbnails`   | the thumbnail bytes                                                                                         |
| `media.photo_subjects`     | the types and uses a photo shows (`photo_id`, `subject_kind`, `subject_id`), § Subjects                     |
| `media.photo_pose_changes` | every change of a photo's pose: actor, before, after, reason, undo link (§ Correcting a pose)               |
| `media.photo_requests`     | requests for new photos: target, reason, requester, subject, status, `deleted_at`                           |
| `media.schema_migrations`  | the journal of this schema's own migrations                                                                 |

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

### Subjects: links to types and uses

A photo can be linked to catalogue **types** and **uses** (an opening of the home model, or a furniture placement),
so a piece page can show "photos of this window" and agents can ask for "the bed-room east window". A subject is
`{ kind: 'type' | 'use', id }` (`packages/shared/src/subjects.ts`), the same as for notes (`docs/userdata.md`).

- `Photo.subjects` lists them, each resolved on read: `name` (the type's or use's current name) and `status`
  (`current`, or `missing` when the catalogue, the home's model or its active placements no longer have the id; a
  placement in the trash is `missing` but keeps its name). Like rooms, they are soft references in the side table
  `media.photo_subjects`: nothing fails and no link is dropped when a branch loses the id.
- Upload with `subjects` in `meta`, or `PATCH` them: the update **replaces the whole list** (at most 10, duplicates
  dropped). They are sorted by when they were linked, then kind and id.
- `GET …/photos?subject=use:<useId>` or `?subject=type:<typeId>` lists the photos linked to exactly that subject
  (a type filter does not include the photos of its uses).
- A request may have a `subject`. A photo answering it (upload with `requestId`, `PATCH` of `requestId`, or
  `fulfil`) is linked to the request's subject as well.
- Purging a photo deletes its links (`on delete cascade`); a photo in the trash keeps them.

### Pose conventions

The home model's frame ([home-model.md](home-model.md#conventions)), metres and radians:

| Field      | Meaning                                                                             |
| ---------- | ----------------------------------------------------------------------------------- |
| `position` | `x` plan east, `y` up (the eye point, in model heights), `z` plan south             |
| `yaw`      | about `+y`, counter-clockwise seen from above; 0 looks along `-z`, `π/2` along `-x` |
| `pitch`    | positive looks up, negative down; `-π/2` to `π/2`                                   |
| `fovH`     | horizontal field of view of the picture, if known ([below](#field-of-view))         |

`yaw` is the same convention as a layout item's `rotationY` and a three.js camera's `rotation.y`.
`poseDirection()` in the shared package gives the view direction. A compass heading `h` (degrees clockwise from
`-z`) is `yaw = -h × π / 180`. Poses only use the model's local frame: no real-world position is stored anywhere.

### Sensor snapshot

`sensors` on a photo is what the phone's orientation sensors said when it was taken
([walking.md](walking.md#camera-modes-sensors-and-manual)). It is stored in the nullable column
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

### Field of view

`fovH` is the angle across the picture **as shown** (after its EXIF orientation), so an upright photo has the
narrower one. The app derives it at capture (`horizontalFov` in `apps/web/src/photos/fieldOfView.ts`) from the camera's
35 mm equivalent focal length `f` and the picture's width `w` and height `h`:

```
fovH = 2 · atan(18 mm · across / f),  across = 1 for a landscape picture, w / h for a portrait one
```

The equivalent focal length puts the 36 mm side of the film frame on the picture's **long** edge. A phone's
picture is 4:3, so its short edge spans 27 mm, not the 24 mm of the 3:2 film frame. Until #70 the app used
24 mm, and every upright photo stored a view about 10 % too narrow (0.962 instead of 1.061 rad at 23 mm). A
16:9 picture is the 4:3 sensor with the top and bottom cut off, so the same formula holds.

- **Camera app and gallery:** `f` is the EXIF `FocalLengthIn35mmFilm` (the only value read from the file); the
  size is the decoded picture's, or the JPEG header's (frame size turned by the EXIF orientation) when the
  browser cannot decode it.
- **Camera inside the page:** a full-resolution still (`ImageCapture`) has EXIF data of its own. A video frame
  has none: it uses the size of the stream's picture, the track's `zoom` setting, and the focal length kept in
  the browser from this phone's last photo taken here (inside the page or with the camera app, never a gallery
  pick) when it is a main camera's (20 to 30 mm), else a typical phone's 26 mm. So a telephoto, ultra-wide or
  another device's picture from the gallery never changes the view of later frames.
- Photos without `fovH` are shown with that typical camera and their stored size.

Checked against vanishing-point calibration (`measure.py`): the owner's phone (23 mm) gives 1.318 rad across
(stored 1.328) and 1.05 to 1.14 upright (now 1.061).

### Correcting a pose

Hand-set headings and pitches are often 10 to 20° off, and the position of an answered request is the request's
spot. A **correction** changes `pose` with `PATCH /photos/:id` and leaves the sensor snapshot as it was. Every
`PATCH` that changes the pose is recorded in `media.photo_pose_changes`: the actor (`docs/userdata.md`
§ Actor: the owner, or an agent by its token), the pose before and after, and an optional `poseReason` ("vanishing-point
calibration"). `GET /photos/:id/pose-history` lists the changes, newest first, with `canUndo` (not undone yet,
and the photo still has this change's pose). `POST /photos/:id/pose-history/:changeId/undo` puts the pose back
as it was before the change, as a new change that records the undo; it is a 409 when the change was undone
already or the pose has changed since (undo the later change first). Purging a photo deletes its history.

- **In the app:** while viewing from a photo's pose, the detail view has **Correct the pose**: heading, pitch
  and field of view, each with a slider, ±1° steps and a number field. Every change moves the 3D camera (and the
  photo laid over it) at once; **Save pose** stores it, **Reset** goes back to the stored pose. The history
  below lists who changed what, with **Undo**.
- **Agents:** `pose.sh` in the [photo-modelling skill](../.claude/skills/my-home-photo-modelling/SKILL.md)
  sets yaw, pitch and fovH from a `measure.py` calibration (or by hand), or moves the position on the plan
  (`--x`/`--z`, e.g. after the layout was refitted), with a required reason, lists the
  history and undoes a change. It never touches the sensor snapshot and never deletes.

The gallery's detail view says where each heading came from ("Heading measured by the phone: true bearing
84° · ±12° · declination +3° · calibration −7°", "set by hand", or "no sensor data"), and in the 3D view a
ring around a camera marks a measured heading. The ring faces the viewer and, like the camera, is drawn larger
from far away, so it reads from every angle and in an overview of the whole home; the view cone stays true to
scale. `photos.sh <env> sensors <photo-id>` prints it.

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
`database.migrate()` applies the `public` migrations and the `media` migrations, and the homes are synced from git
again (the release job, `dist/release.js`; production does the same without the reset). Tests cover the reset
(`apps/api/test/media-persistence.test.ts`, `release.test.ts`) and CI runs the real `dist/release.js` against
Postgres with a photo in place.

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
- **Migration files are immutable once applied**, even before merge: never edit or delete them. Add a new
  expand-only migration for corrections (`NNNN_what_it_adds.sql`).
- A stored value that code checks against a fixed list (a request's `status`, `requester`) cannot get new values
  without breaking older branches' reads. Add a new column instead.

The migrator applies every file whose name is not in `media.schema_migrations`, in name order, whatever was
applied before, and ignores journal entries it does not know. So two branches may each add a migration and deploy
in either order. Under its advisory lock, it verifies stored checksums for all known tags before running any
pending SQL. A mismatch fails with the schema and tag: restore the original migration file and put corrections
in a new expand-only migration. It never repairs the journal, replays changed SQL or resets the schema. A test
lints the migration files for these rules.

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

A copied photo keeps its id, pose, time, captured room, note, tags, sensor snapshot and subjects (the
destination resolves them against its own model). A photo with subjects cannot be copied to an environment
running a build from before subjects, since that build refuses the unknown `meta` field. Its image is re-encoded once more by the destination, like every upload. That is the price of never storing an uploaded file as it came: the copy is encoded at the same quality and is not scaled again (it is already within the size limit), so the loss of that one extra generation is small, but the bytes differ from the source. Photos already on the destination (also in
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
([`apps/web/src/photos/`](../apps/web/src/photos/)). [On a phone](mobile.md) the photos and the requests are
two tabs of the sheet, and the trash is behind **🗑 Trash** at the end of either.

- **Photos**: thumbnails, newest first, with filters for level (or outside), room, tag, request and date. A
  click opens the detail view: the photo, where and when it was taken, the pose (position, heading in degrees
  clockwise from plan north, pitch, field of view), the note and tags (both editable) and the request it
  answers. A photo whose room is gone shows its captured room name with "room not in this model". While viewing
  from its pose, **Correct the pose** adjusts heading, pitch and field of view against the model
  ([Correcting a pose](#correcting-a-pose)).
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

| Method and path                                      | Purpose                                                                                   |
| ---------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| `POST /homes/:homeId/photos`                         | upload: multipart with a `meta` JSON part and an `image` file part                        |
| `GET /homes/:homeId/photos`                          | list, newest first; filters below; the trash is excluded                                  |
| `GET /photos/:id`                                    | metadata (also for a photo in the trash)                                                  |
| `GET /photos/:id/image`, `GET /photos/:id/thumbnail` | the WebP bytes                                                                            |
| `PATCH /photos/:id`                                  | change pose, level, note, tags, time, request or subjects; a new pose re-derives the room |
| `GET /photos/:id/pose-history`                       | the pose changes with actor and reason, newest first ([above](#correcting-a-pose))        |
| `POST /photos/:id/pose-history/:changeId/undo`       | put the pose back as before that change; 409 if undone already or changed since           |
| `DELETE /photos/:id`, `POST /photos/:id/restore`     | to the trash and back                                                                     |
| `POST /photos/:id/purge`                             | delete for good; 409 unless the photo is in the trash                                     |
| `POST /homes/:homeId/photo-requests`                 | create a request                                                                          |
| `GET /homes/:homeId/photo-requests`                  | list, oldest first; `status=open` (default), `fulfilled`, `cancelled`, `all`              |
| `GET /photo-requests/:id`                            | one request with the ids of its photos                                                    |
| `POST /photo-requests/:id/fulfil`                    | link a photo (`{ "photoId": … }`) and close the request                                   |
| `POST /photo-requests/:id/cancel`, `…/reopen`        | close without a photo, or open again                                                      |
| `DELETE /photo-requests/:id`, `…/restore`, `…/purge` | the trash, as for photos                                                                  |
| `GET /homes/:homeId/trash`                           | deleted photos and requests, with `retentionDays`                                         |
| `POST /homes/:homeId/trash/empty`                    | purge everything in this home's trash                                                     |

List filters: `levelId`, `roomId`, `tag`, `requestId`, `subject=type:<id>|use:<id>`, `near=x,z,radius` (metres on the plan), `since` and `until`
(by `takenAt`), `limit` (100, at most 500) and `offset`. The response has `items` and the `total` of all matches.

```sh
curl -X POST "$BASE/api/homes/home/photos" \
  -F 'meta={"levelId":"souterrain","pose":{"position":{"x":4.5,"y":-1,"z":-6},"yaw":1.57,"pitch":0},"note":"North wall","tags":["wall"]}' \
  -F 'image=@photo.jpg'
```

The home does not have to exist in this environment: it is a soft reference like the rest.

## Photo requests

A request says where to stand (`position` on a level, a `roomId`, or both), which way to look (`yaw`, `pitch`), why
(`reason`) and who asks (`requester`: `owner` or `agent`). `requester` may be left out: the server then records the
request's actor (`docs/userdata.md` § Actor); a given one is kept, for older clients.

A request may name a **`subject`** (a type or a use, resolved on read like a photo's subjects). With only a use
subject and neither `roomId` nor `position`, the server puts the request in the use's first room (openings: the
first room the opening touches; placements: their room) and on its level. A use with no room (a roof window, a
gate) leaves both empty; an unknown use is a 400. A type alone is no place: give a room or a position with it. Uploading a photo with the request's id as `requestId`, or setting `requestId` on an existing photo with `PATCH`, fulfils an open request of the same home; `fulfil` does the same and also checks the photo. Only photos of the request's own home count as its answers. Unlinking a photo does not reopen the request. A request may have several photos; photos
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
$S/photo-requests.sh staging create --subject use:souterrain-kitchen-window --reason "Is it a tilt-turn window?"
$S/photos.sh staging list --subject use:souterrain-kitchen-window    # photos of that window
$S/photos.sh staging annotate <photo-id> --subject use:souterrain-kitchen-window   # link (--no-subject unlinks)
$S/photo-requests.sh staging list                                    # open requests
$S/photo-requests.sh staging close <request-id> [--photo <photo-id>] # cancel, or fulfil with a photo
```

- Download photos to a temporary directory or the session's artifact directory, **never into the repository**.
- Record what a photo showed in the model as a dimension's `source: "estimated-from-photo"` and a `note` naming
  the photo id.
- Agents may create requests, add notes, tags and subjects, and correct poses (`pose.sh`, recorded as agent
  edits). They never delete or purge.
