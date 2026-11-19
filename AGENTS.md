# AGENTS.md

my-home: a 3D viewer for a home. pnpm monorepo, TypeScript (strict), Node 24 (`.nvmrc`).

## Layout

- `apps/web`: Vite + React + `@react-three/fiber`/`drei` viewer; dev server proxies `/api`
- `apps/api`: Fastify + Drizzle (Postgres); schema in `src/db/schema.ts`, migrations in `drizzle/`
- `packages/shared`: zod schemas and types shared by web and api (ships TS source)
- `data/homes/`: home model documents (`home.json` is the only home, "Our home"); the test fixture is `packages/shared/test-fixtures/`; model docs in
  `docs/home-model.md`
- `apps/web/src/catalog/<family>/<variant>/`: one piece module per catalogue type (windows, doors, gates,
  furniture, kitchen units, appliances, and the `fixtures` kind: lights, the radiator), auto-registered (`docs/adding-piece-type.md`); the furniture (one placement set per home) and its editor in `docs/furniture.md`;
  the phone layout (top bar, sheet) in `docs/mobile.md`
- `apps/web/src/routing/` (no router library) and `apps/web/src/catalog-page/`: the pages `/catalog` and
  `/catalog/<kind>/<typeId>`, lazy chunks; thumbnails cached in the browser (`docs/catalog.md`)
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
- Never mention the house's address or location (coordinates, map links, tile IDs, place names) in the repo or on GitHub.
- Photos (`docs/photos.md`) live in the `media` schema, and placements, opening overrides and their history
  (`docs/userdata.md`) in `userdata`; no deploy resets either. Their migrations (`apps/api/media-migrations/`,
  `apps/api/userdata-migrations/`) are expand-only (add tables, columns, indexes; never drop, rename or tighten).
- Agents never delete or purge photos or photo requests, and never commit photos. Unsure about a wall, room, opening
  or furniture? Look at the photos, then ask for one (`photo-requests.sh`) instead of guessing.
- Refining the model from photos (measuring, view from here, German windows): the `my-home-photo-modelling` skill.

## House model

- **The exterior is fixed**: footprint, exterior walls (position, thickness, height) and roof come from surveyed
  geodata. Never move, resize or re-angle them.
- **The floor plan and room plan are fixed too**: room outlines and sizes, interior wall positions and thicknesses,
  exterior wall thickness. They are refined; never move, resize or re-angle them. If a change seems needed, ask the
  owner in an issue.
- **Still approximate, improve when photos allow**: window positions and sizes (along their walls), doors, stairs,
  ceilings, floor levels, and the furniture and fixtures (catalogue types and placements).
- **Only the souterrain apartment is modelled inside.** The ground-floor and attic interiors are out of scope: keep
  their geometry (floors and windows as seen from outside) and never request photos inside them; photos of their
  windows only from the owner's garden, patio or the street.
- **New furniture and fixtures are catalogue types in git** (reviewed by PR). Placements and basic params
  (colour, sizes) are DB data per environment, set via the app or the uses/placements API, never in
  `data/homes/*.json`.
- **Refinement photos stay in the photo store**: reference them by photo id in issues and PRs; never upload them to GitHub
  or commit them.

## Environments

- staging `https://home-staging.nntin.xyz`: `home.json` (the only home) synced from git on every deploy (same-repo PR
  pushes, `v*` tags; latest wins); placements, colours, notes and photos (the owner's) persist. Use it for tests and
  experiments.
- production `https://home.nntin.xyz`: real data, deployed from every push to `main`; homes synced from git
  (`home.json`) on every deploy. Change it only when asked.
- **Changing the house = a PR to `data/homes`** (`PUT /api/homes` and import are replaced on the next deploy;
  `docs/deployment.md` § Homes come from git).
- Both are behind authentik SSO: exchange the nntin-bot GitHub token for a site token with the
  `my-home-environments` skill (`.claude/skills/`). `GET /api/health/live` is public.
- Raise an issue in NNTin/my-home (or comment on the open one) only if the deployed commit hasn't caught up 1 hour
  after its image was published, or the site stays down: `env-status.sh`, then `raise-env-issue.sh`.

More: `README.md` (setup, conventions), `docs/container-images.md` (images, tags) and
`docs/deployment.md` (production/staging deploys, rollback). Production migrations must be forward-only and
backward-compatible with the previous api version.
