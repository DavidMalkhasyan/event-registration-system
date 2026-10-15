# Architecture Index

A map for finding code fast. Details live in the linked documents; read those only when needed.
Overview: [ARCHITECTURE.md](architecture/ARCHITECTURE.md), modules: [MODULES.md](architecture/MODULES.md),
API: [API_DESIGN.md](api/API_DESIGN.md) and [openapi.yaml](api/openapi.yaml), ADRs: [adr/README.md](adr/README.md).

## Layout

| Path | Contents |
|---|---|
| `apps/server` | Fastify API and worker (TypeScript, Kysely, PostgreSQL 18) |
| `apps/client` | React + Vite client, four HTML entry pages |
| `apps/e2e` | Playwright browser tests; `stack.ts` starts real web + worker on :3100 |
| `apps/server/migrations` | Forward-only SQL migrations `0001`–`0017` |
| `deploy/` | `Dockerfile`, `compose.yaml`, `Caddyfile`, `env.production.example`, `postgres-init.sh` |
| `scripts/` | `check-secrets.mjs`, `provision-local-db.sql` |
| `.github/workflows/ci.yml` | CI jobs `verify` (all gates) and `container` (production stack) |

## Server entrypoints and composition

- `apps/server/src/entrypoints/web.ts` — HTTP process; `worker.ts` — outbox and scheduled tasks;
  `migrate.ts`; `admin.ts` (`pnpm admin:create|totp|disable`); `seed-demo.ts` (`pnpm seed:demo`, local demo data); `media-sweep.ts`; `ops.ts` (backup, restore drill).
- `apps/server/src/composition/web-app.ts` — builds Fastify, registers every module's routes, `/healthz`, `/readyz`.
- `apps/server/src/composition/context.ts` — shared context; `dev-mailbox.ts` — `/dev/mailbox` (fake provider only).
- `apps/server/src/platform/` — `config.ts` (env validation), `http.ts` (headers, CSRF/Origin, error mapping),
  `tx.ts` (transactions, `withEventLock`, decision time), `db.ts`, `schema.ts` (Kysely types),
  `migrations.ts`, `ratelimit.ts`, `passwords.ts` (Argon2id), `totp.ts`, `crypto.ts`, `errors.ts`, `time.ts`.

## Domain modules (`apps/server/src/modules/`)

| Module | Files | Responsibility |
|---|---|---|
| `identity` | `routes.ts`, `accounts.ts`, `sign-in.ts`, `sessions.ts`, `staff-sessions.ts` | Organization registration, password and link sign-in, sessions, reauth, password reset, staff sessions |
| `organizations` | `routes.ts`, `access.ts`, `members.ts` | Memberships, roles (owner/admin/member), invitations, event ownership by organization |
| `platform-admin` | `routes.ts`, `admin.ts`, `bootstrap.ts` | Super Admin sign-in (TOTP), approve/reject/suspend organizations, CLI bootstrap |
| `event-core` | `routes.ts`, `events.ts`, `registrations.ts`, `lifecycle.ts`, `checkin.ts`, `location.ts`, `deletion.ts` | Events, registration and verification, tickets, FIFO promotion, cancellations, reschedule, capacity, check-in, participant list |
| `participant-portal` | `routes.ts`, `portal.ts` | Ticket resend, share links, link rotation |
| `staff` | `routes.ts`, `staff.ts` | Staff invitations, acceptance, revocation |
| `access-tokens` | `tokens.ts`, `link-guard.ts` | Hashed link tokens, link rate limiting |
| `messaging` | `outbox.ts`, `dispatcher.ts`, `providers.ts`, `fake-provider.ts`, `resend-provider.ts`, `webhooks.ts`, `webhook-routes.ts` | Transactional outbox, dispatch and retries, providers, Svix-verified Resend webhooks |
| `notifications` | `handlers.ts` | Email texts per message type |
| `jobs` | `tasks.ts` | Scheduled tasks (reminders, cutoff) |
| `reporting` | `live.ts` | Live check-in count over SSE (`LiveHub`, LISTEN/NOTIFY) |
| `media` | `routes.ts`, `images.ts`, `processing.ts`, `storage.ts`, `sweep.ts` | Image intake, re-encoding to WebP, storage, serving, orphan sweep |
| `maps` | `routes.ts`, `tiles.ts` | `/map-tiles/...` identified, bounded caching tile proxy (OSM) |
| `audit` | `audit.ts` | Audit records |
| `apps/server/src/ops` | `backup.ts` | `pnpm ops:backup`, `pnpm ops:restore-drill`, consistency rules |

## API route groups (where registered)

- Public and link pages: `/api/public/events/:publicId[/registrations]`, `/api/links/verify|manage|ticket` → `event-core/routes.ts`;
  `/api/links/manage/resend|share-links|rotations` → `participant-portal/routes.ts`;
  `/api/links/invite[/accept]`, `/api/staff/*` → `staff/routes.ts`.
- Organizer: `/api/auth/*`, `/api/organizations/registrations`, `/api/accounts/registrations`,
  `/api/links/sign-in|account-verification|password-reset` → `identity/routes.ts`;
  `/api/events[/:eventId/...]` → `event-core/routes.ts` (images: `media/routes.ts`; staff: `staff/routes.ts`);
  `/api/organizations/:id/members|invitations` → `organizations/routes.ts`.
- Super Admin: `/api/admin/*` → `platform-admin/routes.ts`.
- Other: `/api/events/:eventId/live` (SSE) → `reporting/live.ts`; `/media/images/:file` → `media/routes.ts`;
  `/map-tiles/...` → `maps/routes.ts`; `/api/webhooks/resend` → `messaging/webhook-routes.ts`.

## Client (`apps/client`)

- Entry pages: `public.html` → `src/public/main.tsx`; `organizer.html` → `src/organizer/main.tsx`;
  `admin.html` → `src/admin/main.tsx`; `staff.html` → `src/staff/main.tsx`. Config: `vite.config.ts`.
- Public: `EventPage.tsx`, `Availability.tsx` + `use-public-event.ts` (15 s poll), `LinkPages.tsx` (verify,
  invites, account links), `ManagePage.tsx` (ticket, cancel, share), `AccountPages.tsx`,
  `bootstrap-token.ts` + `boot.ts` (fragment token captured before any module runs).
- Organizer: `app.tsx`, `router.tsx`, `shell/AppShell.tsx`, `dashboard/Overview.tsx`, `events/*`
  (list, create), `event/EventWorkspace.tsx` (sections) with `ParticipantsTab.tsx`, `ParticipantActions.tsx`,
  `CheckInTab.tsx`, `StaffTab.tsx`, `PhotosTab.tsx`, `SettingsTab.tsx`, `use-event-data.ts`;
  `organization/*`, `auth/*`, `use-auto-refresh.ts`.
- Shared: `api.ts`, `ui.tsx`, `styles.css`, `location.tsx`, `ParticipantMap.tsx` (Leaflet, lazy), `images.tsx`, `artwork.tsx`.
- Check-in: `src/checkin/CheckInPanel.tsx` (manual code, camera via BarcodeDetector), `use-live-count.ts`.

## Data, transactions, migrations

- Schema design: [DATABASE_DESIGN.md](database/DATABASE_DESIGN.md), [ERD.md](database/ERD.md),
  [CONSTRAINTS_AND_INDEXES.md](database/CONSTRAINTS_AND_INDEXES.md); post-v1.0.0 migrations
  (0008–0017): [POST_RELEASE_SCHEMA.md](database/POST_RELEASE_SCHEMA.md).
- Locks and transaction boundaries (TX-* ids, decision time, event lock): [TRANSACTIONS_AND_LOCKING.md](database/TRANSACTIONS_AND_LOCKING.md);
  code in `apps/server/src/platform/tx.ts`. Migration rules: [MIGRATIONS_STRATEGY.md](database/MIGRATIONS_STRATEGY.md).

## Operations and security

- [DEPLOYMENT.md](operations/DEPLOYMENT.md), [ENVIRONMENT.md](operations/ENVIRONMENT.md) (every variable),
  [BACKUP_RESTORE.md](operations/BACKUP_RESTORE.md), [RUNBOOK.md](operations/RUNBOOK.md), [PERFORMANCE.md](operations/PERFORMANCE.md)
  (`apps/server/bench/load.ts`, `pnpm bench`).
- [SECURITY_AUDIT.md](security/SECURITY_AUDIT.md), [MEDIA_SECURITY.md](security/MEDIA_SECURITY.md).

## Tests by feature

Server (`apps/server/test/`, helpers `harness.ts`, `global-setup.ts`) and browser (`apps/e2e/tests/`,
helpers `helpers.ts`, `db.ts`, `fixtures.ts`). Client unit tests sit next to sources (`*.test.ts`).

| Feature | Server tests | Browser specs |
|---|---|---|
| Registration, verification, FIFO | `registration`, `capacity`, `lifecycle`, `cutoff`, `reminders` | `participant-flow`, `two-clients`, `capacity` |
| Cancellation, waiting list | `cancellation`, `organizer-cancellation`, `waitlist-removal` | `cancellation`, `organizer-cancellation`, `waitlist-removal` |
| Participant list | `participant-list` | `organizer-workspace`, `organizer-refresh` |
| Check-in, staff, live | `staff`, `checkin-undo`, `live` | `staff`, `checkin-undo`, `camera-scan` |
| Accounts, organizations, admin | `accounts`, `organizations`, `members`, `platform-admin`, `reauth`, `auth-audit` | `accounts`, `members`, `admin`, `reauth` |
| Events, location, deletion | `event-edit`, `reschedule`, `location`, `deletion` | `event-edit`, `settings`, `location`, `deletion` |
| Participant portal, links | `portal` | `portal`, `link-pages`, `token-bootstrap` |
| Public availability | `public-availability` | `public-availability` |
| Media, map | `media`, `media-sweep`, `maps` | `gallery`, `map` |
| Email | `email-provider`, `webhooks` | — |
| Security headers, readiness, backups | `security-headers`, `readiness`, `backup-restore` | `audit` (scenario G) |
| Layout and full journeys | — | `responsive`, `navigation`, `audit`, `audit-devices` |

## Start here for common tasks

| Task | Inspect first |
|---|---|
| Registration/seat/waiting-list bug | `event-core/registrations.ts`, `event-core/lifecycle.ts` (`promoteFifo`), `platform/tx.ts`, `test/registration.test.ts` |
| Check-in or staff | `event-core/checkin.ts`, `staff/staff.ts`, `identity/staff-sessions.ts`, `client/src/checkin/CheckInPanel.tsx` |
| New or changed email | `notifications/handlers.ts`, `messaging/outbox.ts`, `messaging/dispatcher.ts`, `test/email-provider.test.ts` |
| Organizer auth/roles | `identity/sessions.ts`, `identity/sign-in.ts`, `organizations/access.ts`, `organizations/members.ts` |
| Organizer UI section | `client/src/organizer/event/EventWorkspace.tsx`, the section's `*Tab.tsx`, `use-event-data.ts`, `shared/styles.css` |
| Public/participant page | `client/src/public/EventPage.tsx` or `ManagePage.tsx`, `event-core/lifecycle.ts` (`managementView`) |
| Schema change | `apps/server/migrations/` (new file), `platform/schema.ts`, `docs/database/POST_RELEASE_SCHEMA.md` |
| Images or map | `media/images.ts`, `media/processing.ts`, `maps/tiles.ts`, `client/src/shared/ParticipantMap.tsx` |
| Config or deployment | `platform/config.ts`, `deploy/compose.yaml`, `docs/operations/ENVIRONMENT.md`, `.github/workflows/ci.yml` |
