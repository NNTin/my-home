# AGENTS.md

my-home: a 3D viewer for a home. pnpm monorepo, TypeScript (strict), Node 24 (`.nvmrc`).

## Layout

- `apps/web`: Vite + React + `@react-three/fiber`/`drei` viewer; dev server proxies `/api`
- `apps/api`: Fastify + Drizzle (Postgres); schema in `src/db/schema.ts`, migrations in `drizzle/`
- `packages/shared`: zod schemas and types shared by web and api (ships TS source)
- `data/homes/`: home model documents (`home.json` is the only home, "Our home") and their seeds
  (`home.seed.json`: placements, opening overrides, notes; `docs/deployment.md` § The seed comes from git); the test fixture is `packages/shared/test-fixtures/`; model docs in
  `docs/home-model.md`
- `apps/web/src/catalog/<family>/<variant>/`: one piece module per catalogue type (windows, doors, gates,
  furniture, kitchen units, appliances, the bath room's pieces, the `fixtures` kind: lights, the radiator, and the `outdoor` kind: patio and
  garden pieces), auto-registered (`docs/adding-piece-type.md`); the furniture (one placement set per home) and its editor in `docs/furniture.md`;
  the phone layout (top bar, sheet) in `docs/mobile.md`
- `packages/shared/src/finishes/`: the finish library (surface materials: one definition per finish, its
  description and texture source apart in `definitions/*.about.ts`), and
  `apps/web/src/finishes/`: their texture files (CC0 only, `ASSETS.md`), loader and materials; a room or exterior
  surface names a finish in `home.json` (`docs/home-model.md` § Finishes)
- `apps/web/src/views/`: the named views (`?view=cutaway|section|eye`, the Views control, backdrops, the
  section's cut and caps, "Save image"), a lazy chunk (`docs/views.md`)
- `apps/web/src/render-mode/`: render mode, path-traced stills with WebGPU ("Render" in the Views control, on
  desktops), the lazy chunk `render-path`, and its measuring page `/?render=measure` (`docs/render-mode.md`)
- `apps/web/src/routing/` (no router library) and `apps/web/src/catalog-page/`: the pages `/catalog` and
  `/catalog/<kind>/<typeId>`, lazy chunks; thumbnails cached in the browser (`docs/catalog.md`)
- `docs/`: project docs (designs not built yet in `docs/design/`: the realistic render, `realistic-render.md`);
  `docker-compose.yml` runs postgres + api + web
- `charts/my-home`: Helm chart deployed to Kubernetes by CI + Flux (`docs/deployment.md`); `tools/check-chart.sh`

## Commands

- `pnpm install`, then `pnpm dev` (web on :5173, api on :3000)
- `pnpm lint`, `pnpm format`, `pnpm typecheck`, `pnpm test`, `pnpm build`
- `pnpm check:bundle` after `pnpm build`: the web bundle against `apps/web/bundle-budget.json` (CI runs it)
- `pnpm schema:generate` after editing the HomeModel zod schema (commit the JSON Schema)
- `pnpm finishes:fetch <finish id>` after adding a textured finish (downloads from the CC0 library, writes the WebP
  files and `ASSETS.md`; needs ImageMagick with WebP); `pnpm finishes:manifest` rewrites the manifest only
- `pnpm db:generate` after editing the Drizzle schema (commit the migration), `pnpm db:migrate`, `pnpm db:seed`
- One package: `pnpm --filter @my-home/api test`

## Rules

- **No Docker locally.** Without `DATABASE_URL` the api uses PGlite (`apps/api/.data/`, in-memory in tests).
  Dockerfiles, compose and real Postgres are verified only in CI (`.github/workflows/ci.yml`).
- **Tests run in CI, not on the agents' machine** (§ Where tests run). The machine is small and runs many agents
  at once.
- API request/response shapes live in `packages/shared`; validate with them on both sides.
- api tests use `fastify.inject` and must also pass against real Postgres (CI `test-postgres`).
- web tests run in jsdom: mock the R3F canvas, never require WebGL.
- A piece of another family may use a shared helper (`catalog/cabinet.ts`): changing one changes that family's
  goldens too. Look at `git diff --stat` of `__golden__` before a commit (the fridge used the kitchen's handles).
- Keep changes scoped; conventional commit messages.
- A hairline in a render is geometry, not light: an edge that ends in the middle of another one, or a face lying
  edge-on in a visible one (a wall's end or top under its neighbour). Look at a close-up, and at the closed house,
  before and after touching the shell (`docs/home-model.md` § Rendering).
- Never mention the house's address or location (coordinates, map links, tile IDs, place names) in the repo or on GitHub.
- Photos (`docs/photos.md`) live in the `media` schema, and placements, opening overrides and their history
  (`docs/userdata.md`) in `userdata`; no deploy resets either. Their migrations (`apps/api/media-migrations/`,
  `apps/api/userdata-migrations/`) are expand-only (add tables, columns, indexes; never drop, rename or tighten).
- Agents never delete or purge photos or photo requests, and never commit photos. Unsure about a wall, room, opening
  or furniture? Look at the photos, then ask for one (`photo-requests.sh`) instead of guessing.
- Refining the model from photos (measuring, view from here, German windows): the `my-home-photo-modelling` skill.

## Where tests run

The agents share one small machine and many tasks run on it at the same time. A full test suite, a build or a
browser run here slows every other agent down, and takes far longer than on a CI runner. So **CI is where things
are verified**, and the machine is for writing the change.

- **Locally, only what is quick and about your change:** the commit hook (eslint and prettier on the staged
  files), `tsc` for the package you touched, and the test files you touched or wrote
  (`pnpm --filter @my-home/web exec vitest run src/views`). One heavy command at a time, through the shared
  queue.
- **Updating goldens:** `pnpm --filter @my-home/web exec vitest run src/catalog/golden.test.ts
src/catalog/shapes.test.ts -u`, the flag **last**. `-u` takes the word after it: `vitest run -u <file>` runs
  other files, updates nothing in that one and still says "passed" (#117).
- **Run prettier from the repository root** (`node_modules/.bin/prettier --write apps/web/src/...`). From
  `apps/web` it does not see the root's ignore file and reformats the goldens in `__golden__/`, which then fail.
- **A local look at one view** (a shell change you must see before a push): the api on PGlite and Vite, started
  directly, and one `screenshot.mjs` at a time. Vite listens on `localhost` only: `SITE_BASE=http://localhost:<port>`,
  not `127.0.0.1` (connection refused, #145). `?view=eye&room=<id>&look=<deg>` stands back in the room.
- **`overlay-shots.sh` takes about 6 minutes a photo here** (SwiftShader) and holds the heavy slot all along:
  a batch of 20 blocks every install and test for two hours (#148). Shoot only the poses that settle a question,
  in batches of a few; a night photo or a pose far off measures nothing.
- **Not locally:** the whole `pnpm test`, `pnpm build` with `pnpm check:bundle`, real Postgres, Docker, and
  anything with a browser (the smokes, `visual-diff`, screenshots in bulk). CI runs all of them on every push:
  `check`, `test-postgres`, `docker`, `chart`, then `publish`, `deploy` and, on staging, `staging-checks`
  (`walk`, `mobile`, `catalog`, `visual-diff`; `docs/deployment.md` § Checks on staging).
- **Read CI instead of repeating it:** `gh pr checks <n>`, `gh run view <run-id>` (the summary has each staging
  check's result), `gh run view --job <job-id> --log-failed`, `gh run download <run-id> -n visual-diff-<sha>`.
  Put what CI found in the pull request; do not run the same thing again here to "confirm".
- **A push is not free either.** Every push to a pull request deploys staging and cancels the run before it.
  Collect your commits and push once, when the quick local checks pass. Do not push to see whether it compiles.
- **When a CI job fails, find the cause in its log before changing anything.** Reproduce locally only if the
  log cannot tell you, and then only the one failing test.
- **If a check you need does not exist in CI, add it to CI** (with an offline test of any script it uses), rather
  than running it by hand each time.

What reading CI has taught us:

- **Green can mean skipped.** A job that finishes in seconds did nothing: read its warning (the staging checks
  skip without the secret `NNTIN_BOT_TOKEN`; tell the owner).
- **A job's log is only available once the whole run is complete,** and GitHub re-runs one job per attempt:
  re-running jobs one by one, or while someone else does, hides the logs for a long time. Wait for the run.
- **`gh run rerun <run> --failed` hides every job's log again** until the re-run is complete: read the logs you
  need (check counts, draw calls) before you re-run a flaky job.
- **`walk`'s "a tap on the enlarged map puts the figure at the stair" is no flake any more:** it read the figure
  before the app had moved it (#150 to #162) and now waits for the map to close and the figure to arrive (#172).
  If it fails, look for the cause in your change instead of re-running.
- **What the page gets on a CI runner is not what it gets here:** Cloudflare adds its analytics beacon
  (`POST /cdn-cgi/rum`) there. The browser scripts answer `/cdn-cgi/*` themselves
  (`scripts/infrastructure.mjs`); a new script must use the same filter.
- **The main chunk is one file** since #119 (`codeSplitting` in `apps/web/vite.config.ts`): what a lazy chunk
  imports no longer cuts it in pieces that compress worse (1.4 kB in #116). Piece modules are in it (the builder
  needs them for the first frame): a rebuilt type costs about 0.1 kB (#117). Read `pnpm check:bundle` in the
  `check` job.
- **What only a lazy page reads must not be exported by `@my-home/shared`'s index:** the index is in the main
  chunk, and a bundler keeps a module where its first importer is. Texts and tables for the catalogue page go
  in a module of their own behind an entry of the package (`@my-home/shared/finish-listing`: 1.2 kB, #118).
- **Headless Chromium has WebGPU, drawn by the processor** (a fallback adapter, SwiftShader): seen on the
  agents' machine, expected on a runner. The path tracer does not run on it: its kernels never finish
  compiling, or the GPU process dies and takes the page's WebGL context along. The app treats such a browser as
  one without WebGPU; a traced image is the owner's check (#119).
- **A smoke's screenshots are not artifacts:** a page can show the owner's photos. Only `visual-diff` uploads
  (canvas shots of the model).
- **Staging is shared:** a check counts only for the commit staging ran before and after it, and the owner may
  be editing there. A difference in a screenshot can be data, not rendering: look at `seed.sh staging diff`.

- **The catalogue smoke pins the "Fixtures" section to its two types** (Heating, Lighting:
  `catalog-smoke.mjs`). A new built-in piece is kind `furniture` (the bath room's are, #146), or the check
  changes with the owner's leave.
- **The worktree has no `node_modules`:** `pnpm install --frozen-lockfile --prefer-offline` takes seconds (the
  store is on the machine). The binaries are in the root's `node_modules/.bin` only: `pnpm --filter
@my-home/web exec vitest run <files>`.

## Keeping this file useful

This file is for the next agent. When a task teaches you something that would have saved you time (a rule the
owner states, a trap in CI or in the tooling, a check that moved), **write it here in the same pull request**:
one or two lines, in the section it belongs to, with the reason. Change a line that turned out wrong, and
remove one that no longer holds. Details go into `docs/` or a skill; this file says that they exist and when to
read them. Do not turn it into a log of what you did.

## House model

- **The exterior is fixed**: footprint, exterior walls (position, thickness, height) and roof come from surveyed
  geodata. Never move, resize or re-angle them.
- **The floor plan and room plan are fixed too**: room outlines and sizes, interior wall positions and thicknesses,
  exterior wall thickness. They are refined; never move, resize or re-angle them. If a change seems needed, ask the
  owner in an issue.
- **Still approximate, improve when photos allow**: window positions and sizes (along their walls), doors, stairs,
  ceilings, floor levels, and the furniture and fixtures (catalogue types and placements).
- **A stair is its walking line and its width** (`docs/home-model.md` § Stairs): the builder
  (`apps/web/src/builder/stair.ts`) makes the steps, the flights, the landing and the railing from them. Count the
  risers in the photos first: fourteen equal ones are the model's 2.6 m (#145; the upper flight's count is asked
  in a photo request).
- **Finishes are appearance, and may be refined from photos**: the finish of a souterrain room's floor, walls and
  ceiling, of the facade, the roof, outdoor areas, outbuildings and stairs is a value in `home.json` with its
  provenance and photo ids (`docs/home-model.md` § Finishes). Choosing one never moves, resizes or re-angles
  anything: the geometry rules above are unchanged. A missing finish is its own PR, from a CC0 library.
  **No texture is ever made from a photo.**
- **Only the souterrain apartment is modelled inside.** The ground-floor and attic interiors are out of scope: keep
  their geometry (floors and windows as seen from outside) and never request photos inside them; photos of their
  windows only from the owner's garden, patio or the street.
- **New furniture and fixtures are catalogue types in git** (reviewed by PR). **Placements with their basic params
  (colour, sizes), the window and door overrides and the notes are the seed in git** (`data/homes/home.seed.json`,
  never in `home.json`). Every deploy makes each environment match it; an edit in the app or by an agent is a
  draft until it is exported into a PR, and a deploy overwrites unexported edits. Workflow: place on staging →
  `seed.sh staging export > data/homes/home.seed.json` → PR → merge → production follows on its deploy.
- **Extending the catalogue is recurring:** identify the objects in the owner's photos, reuse a type or add one (its
  own PR: definition, piece module, tests, docs), then place the uses through the seed (another PR). Patio and
  garden pieces are kind `outdoor` and stand on the ground. How: `my-home-photo-modelling`,
  `references/catalogue-from-photos.md`.
- **Refinement photos stay in the photo store**: reference them by photo id in issues and PRs; never upload them to GitHub
  or commit them.

## Environments

- staging `https://home-staging.nntin.xyz`: `home.json` (the only home) and its seed synced from git on every deploy
  (same-repo PR pushes, `v*` tags; latest wins: the deployed branch's seed replaces unexported placements, overrides
  and notes); photos (the owner's) and history persist. Use it for tests, experiments and drafts to export.
- production `https://home.nntin.xyz`: real data, deployed from every push to `main`; homes and seeds synced from git
  on every deploy. Change it only when asked.
- **Changing the house or its furniture = a PR to `data/homes`** (`PUT /api/homes`, home import and seed import are
  replaced on the next deploy; `docs/deployment.md` § Homes come from git, § The seed comes from git). Check drift
  with `seed.sh <env> diff`.
- Both are behind authentik SSO: exchange the nntin-bot GitHub token for a site token with the
  `my-home-environments` skill (`.claude/skills/`). `GET /api/health/live` is public.
- Raise an issue in NNTin/my-home (or comment on the open one) only if the deployed commit hasn't caught up 1 hour
  after its image was published, or the site stays down: `env-status.sh`, then `raise-env-issue.sh`.

More: `README.md` (setup, conventions), `docs/container-images.md` (images, tags) and
`docs/deployment.md` (production/staging deploys, rollback). Production migrations must be forward-only and
backward-compatible with the previous api version.
