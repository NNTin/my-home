# my-home

A 3D viewer for a home: a React + three.js web app backed by a Fastify API and Postgres.

## Stack

| Area             | Choice                                                                |
| ---------------- | --------------------------------------------------------------------- |
| Language         | TypeScript (`strict`), Node 24 LTS (`.nvmrc`)                         |
| Package manager  | pnpm workspaces                                                       |
| Frontend         | Vite, React, `@react-three/fiber`, `@react-three/drei`                |
| Backend          | Fastify with `fastify-type-provider-zod`                              |
| Shared contracts | `packages/shared`: zod schemas and types                              |
| Database         | Postgres via Drizzle ORM and drizzle-kit migrations                   |
| Local / test DB  | PGlite when `DATABASE_URL` is unset, node-postgres when it is set     |
| Lint / format    | ESLint (flat config, typescript-eslint, react-hooks), Prettier        |
| Tests            | Vitest (web: jsdom + Testing Library; api: `fastify.inject` + PGlite) |
| Containers       | Multi-stage Dockerfiles, `docker-compose.yml`, images on GHCR         |

## Setup

Requirements: Node 24 (`nvm use`) and pnpm via Corepack (`corepack enable`). Docker is not needed.

```sh
pnpm install
cp .env.example .env   # optional; every variable has a default
pnpm dev
```

`pnpm dev` starts the api on <http://localhost:3000> and the web app on <http://localhost:5173>.
The Vite dev server proxies `/api` to the api (`API_URL`). On start-up the api applies migrations and,
outside production, seeds the home (`data/homes/home.json`). The page renders the home
loaded from the api (orbit with the mouse) with a panel for the per-level cutaway and visibility
toggles, and a **Furniture** panel to place, move and rotate the home's furniture, saved piece by piece to the
api. See [docs/home-model.md](docs/home-model.md) for the model and how to load other
homes, [docs/furniture.md](docs/furniture.md) for the furniture and its editor,
[docs/adding-piece-type.md](docs/adding-piece-type.md) to add a window, door or furniture type, and
[docs/walking.md](docs/walking.md) for walking a figure through the home and taking photos with it,
[docs/photos.md](docs/photos.md) for how those photos and photo requests are stored, and
[docs/mobile.md](docs/mobile.md) for the layout on a phone (top bar and sheet).

## Database

The api picks its driver from the environment:

- `DATABASE_URL` unset: [PGlite](https://pglite.dev), an in-process Postgres stored in
  `apps/api/.data/pglite` (`PGLITE_DIR`). Tests use `memory://`. PGlite allows one process per data
  directory, so stop `pnpm dev` before running `pnpm db:migrate` or `pnpm db:seed` against it.
- `DATABASE_URL` set: node-postgres against a real server (CI, Docker Compose).

Workflow for schema changes:

1. Edit `apps/api/src/db/schema.ts`.
2. `pnpm db:generate --name <change>` writes a SQL migration to `apps/api/drizzle/`; commit it.
3. `pnpm db:migrate` applies it (the server also migrates on start unless `MIGRATE_ON_START=false`).
4. `pnpm db:seed [file] [--replace]` loads a home file (default: `data/homes/home.json`); existing ids are
   kept unless `--replace` is given.

Photos are different: they live in the `media` schema with hand-written, expand-only migrations in
`apps/api/media-migrations/`, applied by the same `pnpm db:migrate`. Read
[docs/photos.md](docs/photos.md#migrations-expand-only) before changing it.

## Scripts

| Script                              | What it does                                   |
| ----------------------------------- | ---------------------------------------------- |
| `pnpm dev`                          | api and web dev servers in parallel            |
| `pnpm build`                        | bundle the api (esbuild) and build the web app |
| `pnpm lint`                         | ESLint over the whole repository               |
| `pnpm format` / `pnpm format:check` | Prettier write / check                         |
| `pnpm typecheck`                    | `tsc` in every package                         |
| `pnpm test`                         | Vitest in every package (api on PGlite)        |
| `pnpm db:generate`                  | generate a migration from the Drizzle schema   |
| `pnpm db:migrate` / `pnpm db:seed`  | apply migrations / load a home file            |
| `pnpm schema:generate`              | regenerate the home model JSON Schema          |

A pre-commit hook (husky + lint-staged) lints and formats staged files.

## Structure

```
apps/web/            Vite + React + R3F viewer
  src/builder/       pure home model -> render descriptors (no three.js)
  src/editor/        pure furniture logic: placement, snapping, collision, undo/redo
  src/catalog/       piece modules: how each window, door, gate and furniture type is drawn
  src/placements/    furniture persistence (per-item sync, offline queue), overrides, ?focus=
  src/scene/         R3F components drawing the descriptors and the furniture
  src/overlay/       HTML overlay (view controls, furniture panel; the phone's top bar and sheet)
  src/walk/          the virtual figure: walkable world, collision, controls, photo capture
  src/photos/        photo gallery, filters, trash, view cones and "view from here"
  nginx/             nginx config template for the container image
apps/api/            Fastify server
  src/routes/        route plugins (registered under /api)
  src/db/            Drizzle schema, driver switch, seed
  src/photos/        photo upload processing (metadata stripping, resizing)
  drizzle/           generated SQL migrations (committed)
  media-migrations/  hand-written, expand-only migrations of the media schema (photos)
  test/              Vitest + fastify.inject tests
packages/shared/     zod schemas and types used by web and api
  schema/            generated JSON Schema for home files
data/homes/          home model documents (`home.json`, the house)
docs/                project docs
docker-compose.yml   postgres + api + web
```

## Conventions

- TypeScript `strict` everywhere; shared compiler options in `tsconfig.base.json`.
- API contracts are zod schemas in `packages/shared`. The api uses them for request validation and
  response serialization; the web app parses responses with them.
- The folders of each package's `src` import each other in one direction; `pnpm lint` checks it
  ([`docs/architecture.md`](docs/architecture.md)).
- Routes live under `/api` so the web server can proxy one prefix.
- Configuration comes from environment variables validated with zod (`apps/api/src/core/config.ts`).
- Logs are structured JSON (pino); pretty-printed in an interactive dev terminal.
- api tests must pass on both PGlite and Postgres; web tests never need WebGL.
- Conventional commit messages. CI runs lint, format:check, typecheck, the tests, the build and the checks on
  staging on every push; agents run only the quick checks of their own change locally (`AGENTS.md` § Where tests
  run).

## Docker and CI

Docker is not used for local development. Images, Compose and the real-Postgres test run are
verified in GitHub Actions (`.github/workflows/ci.yml`):

- `check`: install, lint, format:check, typecheck, test (PGlite), build
- `test-postgres`: api tests against a `postgres` service container
- `docker`: build both images, `docker compose up`, smoke-test `/api/health`, `/`, the placements
  and the photos API (including a database reset that must keep the photos)
- `chart`: lint the Helm chart and check its deployment contract (`tools/check-chart.sh`)
- `publish`: push images to GHCR for `main`, `v*` tags, same-repo pull requests and manual dispatches
- `deploy`: publish the chart and wait until production (`main`) or staging (everything else) runs the commit

See [docs/container-images.md](docs/container-images.md) for image names and tags, and
[docs/deployment.md](docs/deployment.md) for the production and staging deployments.
