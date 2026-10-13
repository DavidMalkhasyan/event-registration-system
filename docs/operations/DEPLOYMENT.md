# Deployment Architecture and Procedures (K-720)

**Status (2026-10-13):** prepared, not deployed. The templates are run for real in CI (job `container`: the image is built, the whole stack starts with PostgreSQL 18, migration, web, worker and Caddy serving HTTPS on `localhost`, and health, headers, the bootstrap command, a backup with a restore drill and the media sweep are checked inside the containers). No public server, domain, certificate or paid service exists; deploying needs the stakeholder's authorization and a host. Decisions: [PD-101](../process/DECISION_LOG.md).

## Architecture

```
            Internet (HTTPS 443, HTTP 80 → redirect)
                          │
                    ┌─────▼─────┐   automatic certificates (Let's Encrypt), compression
                    │   Caddy   │   X-Forwarded-For → web (TRUST_PROXY_HOPS=1)
                    └─────┬─────┘
                          │ http :3000 (internal network only)
                    ┌─────▼─────┐   API, built client (one origin, ADR-013), security headers,
                    │    web    │   live counts (SSE), media and map tiles, /healthz, /readyz
                    └──┬────┬───┘
     media volume ◄────┘    │            ┌──────────┐
     tile-cache volume      ├──────────► │ postgres │ ◄── migrate (one-shot, forward-only, before web/worker)
                            │            │   18     │
                    ┌───────┴───┐        └────▲─────┘
                    │  worker   ├─────────────┘   outbox → Resend (HTTPS), reminders, cutoffs
                    └───────────┘
```

One host with Docker Compose is enough for this application (no Kubernetes, queue or cache server: PostgreSQL already provides the outbox, the locks and `LISTEN/NOTIFY`). The web process can be scaled horizontally later behind Caddy; the worker uses leases and fenced writes, so more than one worker is safe.

| Component | Image | State | Restart |
|---|---|---|---|
| Caddy | `caddy:2` | certificates in `caddy-data` | unless stopped |
| web | `eventflow:<version>` (`deploy/Dockerfile`) | none (files in `media`, `tile-cache`) | unless stopped; healthy only when `/readyz` passes |
| worker | same image | none | unless stopped |
| migrate | same image | none | runs once per start; web and worker wait for its success |
| PostgreSQL | `postgres:18` | `pgdata` | unless stopped |

**Resources:** web 1 GB memory and 1.5 CPU (image decoding is the peak, two at a time), worker 512 MB and 0.5 CPU, PostgreSQL by the host. **Logs:** every process logs JSON lines to stdout (credential headers redacted; link tokens never in URLs), rotated by Docker (5 × 20 MB per container).

## Health and readiness

- `GET /healthz` (liveness): the process answers and the database responds; reports the schema version.
- `GET /readyz` (readiness): 200 only when the database answers, its schema is exactly this build's, and the media directory is writable; 503 otherwise. It also reports `oldestDueEmailSeconds`: the age of the oldest email that should already have been sent (alert above 300 seconds: the worker is stopped or the provider refuses).
- The web container's health check uses `/readyz`; Caddy starts only when web is healthy.
- Web and worker refuse to start on a schema mismatch (they never run against a newer or older schema).

## First deployment

1. A host with Docker Engine and Compose v2, ports 80 and 443 open, a DNS record for the domain.
2. Copy the repository (or the release) to the host; `cp deploy/env.production.example deploy/.env.production`; fill in every value ([ENVIRONMENT.md](ENVIRONMENT.md)); `chmod 600 deploy/.env.production`.
3. `docker compose -f deploy/compose.yaml --env-file deploy/.env.production up -d --build`.
4. Wait until `https://<domain>/readyz` answers `"ready": true`.
5. Create the first Super Admin and its second factor (operator only):
   `docker compose … exec web node apps/server/dist/entrypoints/admin.js create --email … --name "…"` (password prompted), then `… admin.js totp --email …`.
6. Resend: verify the sending domain; add the webhook `https://<domain>/api/webhooks/resend` and set its secret as `RESEND_WEBHOOK_SECRET`; restart web.
7. Take a backup and run a restore drill ([BACKUP_RESTORE.md](BACKUP_RESTORE.md)) before inviting users.

## Upgrade (deployment of a new version)

1. Read the release notes for new migrations and variables.
2. **Back up** (`ops:backup`) and run the restore drill on that backup.
3. Set `EVENTFLOW_VERSION` to the new tag; `docker compose … build` (or pull a built image).
4. `docker compose … up -d`: the migrate service applies the new forward-only migrations (each in one transaction, with an advisory lock; a repeated run applies nothing); web and worker start only after it succeeds.
5. Check `/readyz`, sign in, open an event, check the worker (`oldestDueEmailSeconds`).

## Rollback

Migrations are forward-only (no down migrations: MIGRATIONS_STRATEGY.md), and the previous version refuses to run on a newer schema. Therefore:

- **No migration in the release:** set `EVENTFLOW_VERSION` back and `up -d`.
- **With migrations:** stop web and worker, restore the backup taken in step 2 of the upgrade (database and media, [BACKUP_RESTORE.md](BACKUP_RESTORE.md)), set the previous version, `up -d`. Data written after that backup is lost: keep the window short, or fix forward instead.

## Schema migrations

`apps/server/migrations/NNNN_name.sql`, applied in order by `migrate.js` with `MIGRATION_DATABASE_URL` (the owner role); each file runs in one transaction under an advisory lock and is recorded with its checksum (a changed file is refused). CI applies every migration to an empty database and checks that a second run applies nothing; upgrades from the released schema are verified on isolated databases.

## Media persistence

Images: the `media` volume (`/data/media`), owned by the image's unprivileged user; backed up with the database (the database holds only metadata). Map tiles: the `tile-cache` volume (may be lost; it refills within the OSM policy). `pnpm media:sweep` (in the container: `node apps/server/dist/entrypoints/media-sweep.js`) finds files left by crashes.

## Security configuration

- HTTPS only through Caddy; HSTS can be added in the Caddyfile once the domain is final.
- The web process sets CSP, `X-Frame-Options: DENY`, `Referrer-Policy: no-referrer`, `nosniff`, `Cache-Control: no-store` for HTML and API responses; Caddy removes its `Server` header.
- Secrets only in `deploy/.env.production` (ignored by Git, mode 600); the image contains none (`.dockerignore` excludes every `.env`).
- Processes run as the unprivileged `node` user; PostgreSQL is not published on the host; the application connects with the runtime role, which cannot change the schema.
- Production refuses to start with the fake email provider, without the Super Admins' second-factor key, or with http provider URLs.
