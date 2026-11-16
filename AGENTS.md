# AGENTS.md

my-home: a 3D viewer for a home. pnpm monorepo, TypeScript (strict), Node 24 (`.nvmrc`).

## Layout

- `apps/web`: Vite + React + `@react-three/fiber`/`drei` viewer; dev server proxies `/api`
- `apps/api`: Fastify + Drizzle (Postgres); schema in `src/db/schema.ts`, migrations in `drizzle/`
- `packages/shared`: zod schemas and types shared by web and api (ships TS source)
- `data/homes/`: home model documents (`mock-home.json`); model docs in `docs/home-model.md`
- `apps/web/src/items/<type>/`: one furniture type per folder, auto-registered
  (`docs/adding-furniture-type.md`); layouts and the editor in `docs/layouts.md`
- `docs/`: project docs; `docker-compose.yml` runs postgres + api + web

## Commands

- `pnpm install`, then `pnpm dev` (web on :5173, api on :3000)
- `pnpm lint`, `pnpm format`, `pnpm typecheck`, `pnpm test`, `pnpm build`
- `pnpm schema:generate` after editing the HomeModel zod schema (commit the JSON Schema)
- `pnpm db:generate` after editing the Drizzle schema (commit the migration), `pnpm db:migrate`, `pnpm db:seed`
- One package: `pnpm --filter @my-home/api test`

## Rules

- **No Docker locally.** Without `DATABASE_URL` the api uses PGlite (`apps/api/.data/`, in-memory in tests).
  Dockerfiles, compose and real Postgres are verified only in CI (`.github/workflows/ci.yml`).
- Run `pnpm lint && pnpm format:check && pnpm typecheck && pnpm test` before pushing.
- API request/response shapes live in `packages/shared`; validate with them on both sides.
- api tests use `fastify.inject` and must also pass against real Postgres (CI `test-postgres`).
- web tests run in jsdom: mock the R3F canvas, never require WebGL.
- Keep changes scoped; conventional commit messages.

More: `README.md` (setup, conventions) and `docs/container-images.md` (images, tags, deployment).
