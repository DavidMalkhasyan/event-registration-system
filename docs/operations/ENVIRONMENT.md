# Environment Variable Reference (K-720)

Every process reads its configuration from the environment (in development from `.env`, see `.env.example`; in production from `deploy/.env.production`, see `deploy/env.production.example`). A missing or invalid variable stops the process and names the variable; values are never printed. Secrets are marked **secret**: keep them out of Git, logs and tickets.

| Variable | Used by | Required | Default | Meaning |
|---|---|---|---|---|
| `NODE_ENV` | all | no | `development` | `production` enables the production rules below |
| `HOST`, `PORT` | web | no | `127.0.0.1`, `3000` | Listening address (`0.0.0.0` in the container) |
| `PUBLIC_ORIGIN` | web, worker | **yes** | | The site's origin, for example `https://events.example.org`; links in emails and the exact Origin check use it |
| `TRUST_PROXY_HOPS` | web | no | `0` | Reverse proxies allowed to set `X-Forwarded-For` (1 behind Caddy); per-IP rate limits depend on it |
| `DATABASE_URL` | web, worker | **yes** | | **secret**: connection of the runtime role (`app_runtime`) |
| `MIGRATION_DATABASE_URL` | migrate, operator commands | for those | | **secret**: connection of the owner role (`app_owner`) |
| `RESTORE_ADMIN_URL` | `ops:restore-drill` | for that | | **secret**: a role that may create and drop databases (the drill's throwaway database) |
| `PG_BIN` | `ops:*` | no | `PATH` | Directory of `pg_dump` / `pg_restore` (version 18 or newer) |
| `CSRF_SECRET`, `PRESESSION_SECRET`, `RATE_LIMIT_SECRET`, `PREVIEW_SECRET` | web | **yes** | | **secret**: at least 32 characters each (`openssl rand -hex 32`) |
| `ADMIN_TOTP_KEY` | web, `admin:totp` | **yes in production** | | **secret**: 32 random bytes in base64; seals Super Admins' second-factor secrets |
| `ADMIN_REQUIRE_TOTP` | web | no | on in production | `false` explicitly allows Super Admins without a second factor (not recommended) |
| `EMAIL_PROVIDER` | worker | no (fake refused in production) | `fake` | `resend` for real email |
| `RESEND_API_KEY` | worker | with `resend` | | **secret**: Resend API key (`re_…`) |
| `EMAIL_FROM` | worker | with `resend` | | Sender on a domain verified in Resend, `Name <address>` |
| `EMAIL_REPLY_TO` | worker | no | | Reply address |
| `RESEND_API_URL` | worker | no | `https://api.resend.com` | https in production |
| `RESEND_WEBHOOK_SECRET` | web | for delivery facts | | **secret**: the webhook endpoint's Svix signing secret (`whsec_…`); `/api/webhooks/resend` is off without it |
| `DEV_MAILBOX_DIR` | worker, web | no | `var/mailbox` | The fake provider's mailbox (development only) |
| `CLIENT_DIST_DIR` | web | in production | | The built client (`apps/client/dist`; `/app/apps/client/dist` in the image) |
| `MEDIA_DIR` | web, `media:sweep`, `ops:backup` | no | `var/media` | Event image files (persistent volume; back it up with the database) |
| `MAP_TILE_CONTACT` | web | for the map | | A contact URL or email for tile requests' User-Agent; the participant map is off without it |
| `MAP_TILE_URL` | web | no | OpenStreetMap | Tile source `…/{z}/{x}/{y}.png`; https in production |
| `TILE_CACHE_DIR` | web | no | `var/tile-cache` | Map tile cache (may be lost; it refills) |
| `EVENTFLOW_VERSION`, `EVENTFLOW_DOMAIN`, `POSTGRES_SUPERUSER_PASSWORD`, `APP_OWNER_PASSWORD`, `APP_RUNTIME_PASSWORD` | Compose only | for Compose | | Image tag, HTTPS domain and the database passwords Compose builds the connection strings from (**secret**) |
