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
- `charts/my-home`: Helm chart deployed to Kubernetes by CI + Flux (`docs/deployment.md`); `tools/check-chart.sh`

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

## Environments

- staging `https://home-staging.nntin.xyz`: throwaway, reset to the mock home on every deploy (same-repo PR
  pushes, `v*` tags; latest wins). Use it for tests and experiments.
- production `https://home.nntin.xyz`: real data, deployed from every push to `main`. Change it only when asked.
- Both are behind authentik SSO: exchange the nntin-bot GitHub token for a site token with the
  `my-home-environments` skill (`.claude/skills/`), instruction sheet in #9. `GET /api/health/live` is public.
- Broken or no longer deploying (down, health failing, deployed commit not catching up with `main` or the latest
  PR/tag after CI is done; `env-status.sh`): raise an issue in NNTin/my-home, or comment on the open one
  (`raise-env-issue.sh`).

More: `README.md` (setup, conventions), `docs/container-images.md` (images, tags) and
`docs/deployment.md` (production/staging deploys, rollback). Production migrations must be forward-only and
backward-compatible with the previous api version.
