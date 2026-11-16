# Container images

Two images are built from the Dockerfiles in this repository (build context: the repository root).

| Image                       | Dockerfile            | Contents                                                                     |
| --------------------------- | --------------------- | ---------------------------------------------------------------------------- |
| `ghcr.io/nntin/my-home-api` | `apps/api/Dockerfile` | Bundled Fastify server on `node:24-slim`, port 3000                          |
| `ghcr.io/nntin/my-home-web` | `apps/web/Dockerfile` | Static web build on unprivileged nginx, port 8080, proxies `/api` to the api |

## Triggers and tags

Images are built and pushed by the `publish` job in `.github/workflows/ci.yml`, after the `check`,
`test-postgres`, `docker` and `chart` jobs pass. Every published build is then deployed (see
[deployment.md](deployment.md)).

| Event                                   | Tags pushed                    | Deployed to |
| --------------------------------------- | ------------------------------ | ----------- |
| Push to `main`                          | `:main`, `:sha-<short>`        | production  |
| Pull request from a branch of this repo | `:pr-<number>`, `:sha-<short>` | staging     |
| Push of a `v*` tag                      | `:vX.Y.Z`                      | staging     |
| `v*` tag on a commit in `main`          | additionally `:latest`         |             |
| Manual dispatch (`workflow_dispatch`)   | `:sha-<short>`                 | staging     |
| Pull request from a fork                | nothing; built and tested only | nothing     |

- `:main` always points at the newest `main` build; `:sha-<short>` pins one specific commit
  (for pull requests, the PR's head commit).
- Pull requests never get `:main` or `:latest`. Old pull request images are deleted weekly by
  `.github/workflows/cleanup-packages.yml` (older than 14 days, the newest 10 are kept).
- Version tags follow semver (`v1.2.3`). A tag pushed from a branch other than `main` gets only
  `:vX.Y.Z`, never `:latest`.
- Deployments never use a tag: the chart that CI publishes pins both images by digest.
- The packages are private. The cluster pulls them with a read-only credential.

## Runtime configuration

api (environment variables, validated at start-up):

| Variable                     | Default              | Notes                                                                         |
| ---------------------------- | -------------------- | ----------------------------------------------------------------------------- |
| `DATABASE_URL`               | unset                | Postgres connection string; when unset PGlite is used                         |
| `PORT` / `HOST`              | `3000` / `0.0.0.0`   |                                                                               |
| `LOG_LEVEL`                  | `info`               | pino level                                                                    |
| `MIGRATE_ON_START`           | `true`               | apply Drizzle migrations before listening                                     |
| `APP_COMMIT`                 | unset                | release commit, reported by `GET /api/health/live`                            |
| `SEED_ON_START`              | `false` in the image | insert sample data when the table is empty                                    |
| `ALLOW_DATABASE_RESET`       | `false`              | lets `node dist/reset.js` drop homes and layouts, never photos (staging only) |
| `PHOTO_MAX_UPLOAD_BYTES`     | `26214400`           | largest accepted photo upload (25 MB)                                         |
| `PHOTO_TRASH_RETENTION_DAYS` | `30`                 | days a deleted photo stays in the trash before it is purged                   |

`docker-compose.yml` sets `SEED_ON_START=true` so the demo stack shows data. That is for demo and
smoke-test use only; leave it unset for real deployments.

Migrations can also run as a separate step, for example as a Kubernetes init container or job:

```sh
docker run --rm -e DATABASE_URL=... -e MIGRATE_ON_START=false ghcr.io/nntin/my-home-api:main node dist/migrate.js
```

web: `API_UPSTREAM` (default `http://api:3000`) is the address nginx proxies `/api/` to.

Both images define a `HEALTHCHECK` (`GET /api/health` for the api, `GET /` for web).

api health endpoints:

| Endpoint               | Checks database  | Use                                       |
| ---------------------- | ---------------- | ----------------------------------------- |
| `GET /api/health`      | yes (503 if not) | readiness: take the pod out of rotation   |
| `GET /api/health/live` | no               | liveness; reports `commit` of the release |

## Running with Compose

`docker-compose.yml` runs `postgres`, `api` and `web` with healthchecks and `depends_on`, and
publishes the web app on `http://localhost:${WEB_PORT:-8080}`.

```sh
# Published images (IMAGE_TAG defaults to main)
docker compose pull
docker compose up -d --no-build
IMAGE_TAG=v1.2.3 docker compose up -d --no-build

# Build from the working tree instead
docker compose up -d --build

curl http://localhost:8080/api/health
docker compose down -v   # stop and delete the database volume
```

If the GHCR packages are private, log in first: `echo $TOKEN | docker login ghcr.io -u <user> --password-stdin`.
