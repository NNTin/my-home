# Container images

Two images are built from the Dockerfiles in this repository (build context: the repository root).

| Image                       | Dockerfile            | Contents                                                      |
| --------------------------- | --------------------- | ------------------------------------------------------------- |
| `ghcr.io/nntin/my-home-api` | `apps/api/Dockerfile` | Bundled Fastify server on `node:24-slim`, port 3000           |
| `ghcr.io/nntin/my-home-web` | `apps/web/Dockerfile` | Static web build on nginx, port 80, proxies `/api` to the api |

## Triggers and tags

Images are built and pushed by the `publish` job in `.github/workflows/ci.yml`, after the `check`,
`test-postgres` and `docker` jobs pass.

| Event                          | Tags pushed                                     |
| ------------------------------ | ----------------------------------------------- |
| Push to `main`                 | `:main`, `:sha-<short-sha>`                     |
| Push of a `v*` tag             | `:vX.Y.Z`                                       |
| `v*` tag on a commit in `main` | additionally `:latest`                          |
| Pull request                   | nothing; images are only built and smoke-tested |

- `:main` always points at the newest `main` build; `:sha-<short>` pins one specific commit.
- Version tags follow semver (`v1.2.3`). A tag pushed from a branch other than `main` gets only
  `:vX.Y.Z`, never `:latest`.

## Runtime configuration

api (environment variables, validated at start-up):

| Variable           | Default              | Notes                                                 |
| ------------------ | -------------------- | ----------------------------------------------------- |
| `DATABASE_URL`     | unset                | Postgres connection string; when unset PGlite is used |
| `PORT` / `HOST`    | `3000` / `0.0.0.0`   |                                                       |
| `LOG_LEVEL`        | `info`               | pino level                                            |
| `MIGRATE_ON_START` | `true`               | apply Drizzle migrations before listening             |
| `SEED_ON_START`    | `false` in the image | insert sample data when the table is empty            |

`docker-compose.yml` sets `SEED_ON_START=true` so the demo stack shows data. That is for demo and
smoke-test use only; leave it unset for real deployments.

Migrations can also run as a separate step, for example as a Kubernetes init container or job:

```sh
docker run --rm -e DATABASE_URL=... -e MIGRATE_ON_START=false ghcr.io/nntin/my-home-api:main node dist/migrate.js
```

web: `API_UPSTREAM` (default `http://api:3000`) is the address nginx proxies `/api/` to.

Both images define a `HEALTHCHECK` (`GET /api/health` for the api, `GET /` for web).

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

## Future deployment model

Deployment is out of scope for now; this is the intended model so that tags and triggers already
fit it.

- **Production** runs on Kubernetes and tracks every update of `main`: each push to `main`
  publishes `:main` and `:sha-<short>`, and production rolls out the new immutable `:sha-<short>`
  tag (for example via an image updater or a GitOps commit), so the running version is always
  traceable to a commit.
- **Staging** deploys version tags. Pushing a `v*` tag, from `main` or from any feature branch,
  publishes `:vX.Y.Z`, and staging is updated to that version. This lets a branch be tried on
  staging without merging it.
- `:latest` is only moved by version tags on `main` and is meant for manual use, never as a
  deployment target.
- Database migrations run before the new api version receives traffic, using
  `node dist/migrate.js` as an init container or a pre-deploy job (with `MIGRATE_ON_START=false`).
