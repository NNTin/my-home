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

A use stores only the **basic** parameters it changes; the type's defaults fill in the rest
(`effectiveParams`). Design parameters cannot be overridden per use. Staging and production have separate
databases, so their placements and overrides are separate too. Opening overrides are keyed by the opening's
stable id from git (an opening, roof window, outbuilding opening or gate); the id never changes
(`docs/home-model.md` § Naming).

## Tables

All in the schema `userdata`, created by `apps/api/userdata-migrations/0000_create_userdata.sql`:

| Table               | Key                 | Holds                                                                                                   |
| ------------------- | ------------------- | ------------------------------------------------------------------------------------------------------- |
| `placements`        | `(home_id, id)`     | type, name, level, room, position (`x`, `z`), `rotation_y`, `params`, `version`, `removed_at`           |
| `opening_overrides` | `(home_id, use_id)` | the type the override was written for, `params`, `version`                                              |
| `history`           | `id` (uuid), `seq`  | use, kind (`placement`/`opening`), action, actor, actor source and name, `before`, `after`, `undoes_id` |
| `issued_ids`        | `(home_id, id)`     | every placement id handed out                                                                           |
| `schema_migrations` | `tag`               | the schema's migration journal                                                                          |

There are no foreign keys into `public` (a `drop schema public cascade` would silently drop them) and no CHECK
constraints: enum values (actions, actors) are validated by the api, so adding one needs no migration.

## Persistence

**User data survives every deploy of every branch**, like photos. The staging reset
([`apps/api/src/db/reset.ts`](../apps/api/src/db/reset.ts)) drops only `public` and `drizzle`; then
`database.migrate()` runs the `public`, `media` and `userdata` migrations, in that order, and the homes are seeded
again. Production only migrates. `apps/api/test/userdata-persistence.test.ts` covers the reset, and the CI docker
job runs the real `dist/reset.js` with a placement in place. Nothing deletes user data except the trash purge
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
version it read; a stale one is a `409` (`UseConflict`: `currentVersion`, `conflicts`). A patch that changes
nothing writes nothing.

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

## Trash and retention

Removing a placement moves it to the trash (`removed_at`); it can be restored or the removal undone. After
`USERDATA_TRASH_RETENTION_DAYS` (default 30) the hourly purge in `server.ts` deletes it **with its history**; its id
stays in `issued_ids`. Opening overrides are never purged, and all other history is kept forever.

## Agents and test data

Agents may edit uses on both environments, production only when asked (`uses.sh`, see the skill). Test data goes
only to `mock-home` and is cleaned up in the same task, by undo or remove.
