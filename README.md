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
outside production, seeds sample data. The page shows a spinning cube on a grid (orbit with the
mouse) and an overlay listing the homes returned by `GET /api/homes`.

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
4. `pnpm db:seed` inserts sample data if the table is empty.

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
| `pnpm db:migrate` / `pnpm db:seed`  | apply migrations / insert sample data          |

A pre-commit hook (husky + lint-staged) lints and formats staged files.

## Structure

```
apps/web/            Vite + React + R3F viewer
  src/scene/         three.js scene components
  src/overlay/       HTML overlay (API status)
  nginx/             nginx config template for the container image
apps/api/            Fastify server
  src/routes/        route plugins (registered under /api)
  src/db/            Drizzle schema, driver switch, seed
  drizzle/           generated SQL migrations (committed)
  test/              Vitest + fastify.inject tests
packages/shared/     zod schemas and types used by web and api
docs/                project docs
docker-compose.yml   postgres + api + web
```

## Conventions

- TypeScript `strict` everywhere; shared compiler options in `tsconfig.base.json`.
- API contracts are zod schemas in `packages/shared`. The api uses them for request validation and
  response serialization; the web app parses responses with them.
- Routes live under `/api` so the web server can proxy one prefix.
- Configuration comes from environment variables validated with zod (`apps/api/src/config.ts`).
- Logs are structured JSON (pino); pretty-printed in an interactive dev terminal.
- api tests must pass on both PGlite and Postgres; web tests never need WebGL.
- Conventional commit messages; run lint, format:check, typecheck and test before pushing.

## Docker and CI

Docker is not used for local development. Images, Compose and the real-Postgres test run are
verified in GitHub Actions (`.github/workflows/ci.yml`):

- `check`: install, lint, format:check, typecheck, test (PGlite), build
- `test-postgres`: api tests against a `postgres` service container
- `docker`: build both images, `docker compose up`, smoke-test `/api/health` and `/`
- `publish`: push images to GHCR on `main` and `v*` tags (never from pull requests)

See [docs/container-images.md](docs/container-images.md) for image names, tags and the deployment
model.
