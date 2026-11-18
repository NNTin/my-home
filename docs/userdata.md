# User data: placements, overrides and history

The piece catalogue (`packages/shared/src/catalog/`) defines **types**: a casement window, a bed. A **use** is one
piece in a home. This page is about the uses people change on a deployed environment, and how those changes are
stored, recorded and undone. The api is in `apps/api/src/routes/{catalog,uses,placements,opening-overrides}.ts`,
the shapes in `packages/shared/src/userdata.ts`, and the agents' script is `uses.sh` (skill
`my-home-environments`).

## What lives where

| What                                                         | Where                                  | Changed by                     |
| ------------------------------------------------------------ | -------------------------------------- | ------------------------------ |
| Piece designs (types, parameters, limits, geometry)          | git: `packages/shared`, `apps/web`     | pull requests                  |
| House structure, incl. every opening with its id, type, name | git: `data/homes/*.json`               | pull requests                  |
| Furniture placements (one set per home)                      | database: `userdata.placements`        | the owner and agents, per env. |
| Basic-parameter overrides of the openings (colour, sashes …) | database: `userdata.opening_overrides` | the owner and agents, per env. |
| The history of every change, with its actor                  | database: `userdata.history`           | written with every change      |
| Every furniture id ever issued                               | database: `userdata.issued_ids`        | written with every placement   |
| Notes on types and uses (§ Notes)                            | database: `userdata.notes`             | the owner and agents, per env. |
| Home settings: the magnetic declination (§ Home settings)    | database: `userdata.home_settings`     | the owner and agents, per env. |

A use stores only the **basic** parameters it changes; the type's defaults fill in the rest
(`effectiveParams`). Design parameters cannot be overridden per use. Staging and production have separate
databases, so their placements and overrides are separate too. Opening overrides are keyed by the opening's
stable id from git (an opening, roof window, outbuilding opening or gate); the id never changes
(`docs/home-model.md` § Naming).

## Tables

All in the schema `userdata`, created by `apps/api/userdata-migrations/0000_create_userdata.sql`,
`0001_create_notes.sql`, `0002_home_settings.sql` and `0003_imports.sql`:

| Table               | Key                 | Holds                                                                                                                               |
| ------------------- | ------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| `placements`        | `(home_id, id)`     | type, name, level, room, position (`x`, `z`), `rotation_y`, `params`, `version`, `removed_at`                                       |
| `opening_overrides` | `(home_id, use_id)` | the type the override was written for, `params`, `version`                                                                          |
| `history`           | `id` (uuid), `seq`  | use, kind (`placement`/`opening`/`home`), action, actor, actor source and name, `before`, `after`, `undoes_id`                      |
| `issued_ids`        | `(home_id, id)`     | every placement id handed out                                                                                                       |
| `notes`             | `id` (uuid)         | `home_id` (null for type notes), subject kind and id, `body`, created/updated by and at, `deleted_at`                               |
| `home_settings`     | `home_id`           | `magnetic_declination` (a Bearing; null = git's value), `version`, `updated_at`                                                     |
| `imports`           | `(home_id, source)` | one-time imports done (`layouts`: the named layouts → placements, [furniture.md](furniture.md#the-one-time-import)), `at`, `detail` |
| `schema_migrations` | `tag`               | the schema's migration journal                                                                                                      |

There are no foreign keys into `public` (a `drop schema public cascade` would silently drop them) and no CHECK
constraints: enum values (actions, actors) are validated by the api, so adding one needs no migration.

## Persistence

**User data survives every deploy of every branch**, like photos. Every deploy runs the release job
([`apps/api/src/db/release.ts`](../apps/api/src/db/release.ts), `dist/release.js`): on staging the reset
([`apps/api/src/db/reset.ts`](../apps/api/src/db/reset.ts)) drops only `public` and `drizzle`; then
`database.migrate()` runs the `public`, `media` and `userdata` migrations, in that order, and the homes are synced
from git (`docs/deployment.md` § Homes come from git). `apps/api/test/userdata-persistence.test.ts` and
`release.test.ts` cover the reset and the sync, and the CI docker job runs the real `dist/release.js` with a
placement and a declination in place. Nothing deletes user data except the trash purge
below.

### Migrations: expand-only

The same rules as for `media` ([photos.md](photos.md#migrations-expand-only)), because pull requests deploy to the
one staging database in any order:

- **Add only**: new tables, new columns, new indexes. Never drop or rename anything, never make a column
  stricter, never rewrite or delete rows.
- **Idempotent statements**: `create table if not exists userdata.…`,
  `alter table userdata.… add column if not exists …`, `create index if not exists … on userdata.…`, separated by
  `--> statement-breakpoint`.
- A **new column is nullable or has a default**, because older code does not write it.
- New code must also run **without** a column it added being filled by older code (treat `null` as "unknown").
- Never edit or delete a migration file that has been merged; add a new one (`NNNN_what_it_adds.sql`).
- No foreign keys into `public`, no CHECK constraints.

Both schemas use one migrator, `migrateSchema(db, { schema, folder, lockKey })`
([`schema-migrate.ts`](../apps/api/src/db/schema-migrate.ts)): it applies every file whose name is not in
`<schema>.schema_migrations`, in name order, and ignores journal entries it does not know. `userdata` uses the
advisory lock `7216002` (`media`: `7216001`). A test lints the migration files for the rules above.

### Backups

Production's daily dump includes every schema. Staging's dump covers `media` only until the infrastructure
follow-up of #39 adds `userdata` ([deployment.md](deployment.md#databases-and-backups)).

## Actor

Every change records **who** made it: `owner`, `agent` or `system` (the release job and imports), with the source
of that knowledge (`apps/api/src/actor.ts`):

1. `identity`: on the deployed hosts Traefik's forwardAuth sets `X-Authentik-Username` (and replaces any copy a
   client sent); nginx passes it on to the api. A username listed in `AGENT_USERNAMES` (comma-separated, default
   `nntin-bot`; chart value `api.agentUsernames`) is an `agent`, any other the `owner`.
2. `declared`: without an identity header, `X-My-Home-Actor: owner|agent` (local dev, tests, the CI smoke). The
   skill scripts always send `agent`; on the deployed hosts the identity wins.
3. `default`: neither header: the `owner`.

`GET /api/whoami` returns `{ username, actor, actorSource }`, so the mapping can be checked with the agent token
(`uses.sh staging whoami`) and in the owner's browser.

## Writes, versions and history

Every write runs in **one transaction** with its history row, and bumps the use's `version`. A write carries the
version it read; a stale one is a `409` (`UseConflict`: `currentVersion`, `conflicts`). A write that changes
nothing (the same params, name or position again) writes nothing: no new version, no history.

| Route                                              | Notes                                                                                 |
| -------------------------------------------------- | ------------------------------------------------------------------------------------- |
| `GET /api/catalog/types`, `GET /api/catalog/usage` | the catalogue; per type, the git uses of every stored home plus the active placements |
| `GET /api/homes/:homeId/uses[?typeId=&status=]`    | where-used: git uses with their overrides, active placements, orphans                 |
| `GET/POST /api/homes/:homeId/placements`           | `?include=removed` lists the trash too                                                |
| `PATCH/DELETE /api/homes/:homeId/placements/:id`   | `DELETE ?version=` moves it to the trash; `POST …/:id/restore` brings it back         |
| `GET /api/homes/:homeId/opening-overrides`         |                                                                                       |
| `PUT /api/homes/:homeId/opening-overrides/:useId`  | `{ version, params }`; `version: 0` creates; an empty `params` keeps the row          |
| `GET /api/homes/:homeId/uses/:useId/history`       | newest first, with `changes` texts, `undoneById` and `canUndo`                        |
| `POST …/uses/:useId/history/:entryId/undo`         | `{ entry, use }`                                                                      |

- **Placements**: the type must be a furniture type and the level must exist; params are validated with the
  type's limits (400 with path-based issues). The server derives the room from the position (`roomAt`) and
  assigns the id and the name. A size change that pushes a footprint that fitted its room out of it is a 422;
  pieces already reaching outside are not rejected.
- **Opening overrides**: the use must be in the current model (404). Params are validated against the use's
  **current** type, and counted parts (sashes, leaves) must fit its hole (422).

### Ids and names of new furniture

- **Id** `<apartment>-<type>-<n>`, e.g. `souterrain-bed-1`: the apartment of the room at the position without its
  `apt-` prefix (outside any apartment: the level id), the type id's variant, and 1 + the highest `n` of that
  prefix in `issued_ids`. Ids that clash with a home-model id are skipped; ids stay within 64 characters. The id
  never changes and is **never reused**, not after a purge nor after the piece moves to another apartment.
- **Name** `<Room> · <Type>` ("Bedroom · Bed"), outside any room `<Level> · <Type>`; when the name is taken in the
  home, the next free number is appended ("Bedroom · Bed 2"). Names can be changed at any time.

### Undo

An undo is a **field-level revert**: the fields an entry changed (each parameter is its own field) go back to the
entry's `before`, but only if they still have the entry's `after` value. Otherwise it is a `409` listing the
fields that changed again later; undo the later change first. The undo is itself a history row (`action: undo`,
`undoes_id`), so it can be undone (a redo). Undoing a creation moves the placement to the trash; undoing a
removal restores it. An entry can be undone once: a unique index on `undoes_id` turns a double click into a 409.

### Where-used and orphans

`GET …/uses` marks a use `needs-attention`, with `problems`, when:

- an override's use is no longer in the model (an orphan; never deleted);
- the opening's type changed in git since the override was written (`type changed from window.casement`), and
  overrides that do not fit the new type are listed as `ignored: …` (writing the override again adopts the new
  type);
- a placement's type, level or room is gone;
- the effective values do not fit (sashes for the hole, a footprint for its room).

## Home settings

Per-home settings stored on top of the home model from git, which every deploy replaces: today only the
**magnetic declination** that walk mode's compass calibration saves.

- `GET /api/homes/:homeId/settings` → `{ homeId, magneticDeclination: Bearing | null, version, updatedAt }`
  (`version: 0`, `null` when never set; 404 for an unknown home).
- `PUT /api/homes/:homeId/settings` `{ version, magneticDeclination: Bearing | null }`: `version: 0` creates them,
  a stale version is a 409 `UseConflict`, `null` goes back to git's value, and a PUT that changes nothing writes
  nothing.
- `GET /api/homes/:id` and its export return the **effective** model: `building.magneticDeclination` replaced by
  the setting when one is set.
- Each change is a history row with `use_kind = 'home'` and `use_id` = the home id, so
  `GET …/uses/<homeId>/history` lists it ("magnetic declination from the home model → 2.5°") and the undo endpoint
  undoes it; that undo answers `{ entry, settings }` instead of `{ entry, use }`.

## Trash and retention

Removing a placement moves it to the trash (`removed_at`); it can be restored or the removal undone. After
`USERDATA_TRASH_RETENTION_DAYS` (default 30) the hourly purge in `server.ts` deletes it **with its history**; its id
stays in `issued_ids`. Opening overrides are never purged, and all other history is kept forever.

## Notes

Free-text notes on a **type** ("all souterrain windows were replaced in 2019") or on a **use** ("the bed-room window
sticks"). Type notes are environment-wide (`homeId` null); use notes belong to one home. A subject is
`{ kind: 'type' | 'use', id }` (`packages/shared/src/subjects.ts`), the same as photo subjects (`docs/photos.md`).

| Method and path                                  | Body → response                                           |
| ------------------------------------------------ | --------------------------------------------------------- |
| `GET /api/notes?subject=type:<typeId>`           | → `{ items: Note[] }`, oldest first (environment-wide)    |
| `GET /api/notes?subject=use:<useId>&homeId=<id>` | → `{ items: Note[] }`, oldest first; 400 without `homeId` |
| `POST /api/notes`                                | `{ subject, homeId?, body }` → 201 `Note`                 |
| `PATCH /api/notes/:id`                           | `{ body }` → 200 `Note`                                   |
| `DELETE /api/notes/:id`                          | soft delete → 204                                         |

- `body` is trimmed, 1 to 4000 characters.
- `createdBy` and `updatedBy` are the actor (§ Actor); a delete also sets `updatedBy`.
- POST checks the subject: a type must be in the catalogue (400), a type note has no `homeId` (400), a use note
  needs one (400), and the use must be in that home's model or placements, trashed ones included (404). Listing
  never checks it, so the notes of a use that left the model can still be read.
- The owner and agents may edit and delete any note. Notes have **no history and no undo** (they are not part of
  the per-use history): an edit keeps only `updatedBy` and `updatedAt`. Deleted notes keep their row and are never
  listed, edited or deleted again (404); nothing purges them.

## Agents and test data

Agents may edit uses on both environments, production only when asked (`uses.sh`, see the skill). Test data goes
only to `mock-home` and is cleaned up in the same task, by undo or remove (notes: `note-delete`). Notes on the
real home are the owner's data.
