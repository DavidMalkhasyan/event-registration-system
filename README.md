# Event Registration System

Organizers create events. Participants register with only their email address. When an event is full, a first-come waiting list fills free seats automatically. Confirmed participants receive a ticket with a unique code, which is checked in once at the entrance, and the organizer sees confirmed, waiting and checked-in counts live.

This is Task 9 of the AI-assisted software engineering assignment.

- [ASSIGNMENT_SCOPE.md](ASSIGNMENT_SCOPE.md) has the requirement → implementation → test → status matrix.
- [REQUIREMENTS.md](REQUIREMENTS.md) is the full product specification (v1.7, "Proposed — awaiting stakeholder review").

|              |                                                                                                                                                                              |
| ------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Frontend** | React 19 and Vite 8, in `apps/client`                                                                                                                                        |
| **Backend**  | Node.js 24 and Fastify 5, in `apps/server`: a web process plus a separate email worker process                                                                               |
| **Database** | PostgreSQL 18, accessed through Kysely, with SQL migrations in `apps/server/migrations`                                                                                      |
| **Email**    | A fake provider by default: emails are written to `var/mailbox/` and shown at `/dev/mailbox`. Resend for production (`EMAIL_PROVIDER=resend`, PD-97); not yet used for real. |
| **Tests**    | Vitest integration tests against real PostgreSQL; Playwright browser tests in `apps/e2e`                                                                                     |

## 1. Prerequisites

| Tool                                | Version | Notes                                                                                                  |
| ----------------------------------- | ------- | ------------------------------------------------------------------------------------------------------ |
| Node.js                             | 24.x    | Pinned in `package.json` `engines`                                                                     |
| pnpm                                | 12.11.2 | Run `corepack enable`; the version is pinned in `packageManager`                                       |
| PostgreSQL                          | 18      | A local install, portable binaries (see §2.1) or a container. `psql` is needed once, for provisioning. |
| A Chromium-based browser or Firefox | Current | The session cookies use the `__Host-` prefix, which these browsers accept on `http://localhost`        |

## 2. Install and set up

The commands are for a POSIX shell. On Windows, use Git Bash: `cp` and the inline `NAME=value command` form don't work in PowerShell.

```sh
git clone https://github.com/DavidMalkhasyan/event-registration-system.git
cd event-registration-system
corepack enable
pnpm install
```

### 2.1 Create the database roles and databases (once)

Run the provisioning script as a PostgreSQL superuser. It creates two roles and two databases:

- **`app_owner`:** used only by migrations.
- **`app_runtime`:** used by the web and worker processes.
- **`ers_dev`** and **`ers_test`:** the development and test databases.

Choose your own passwords. `psql` asks for the superuser password, or reads it from `PGPASSWORD`.

```sh
psql -h localhost -p 5432 -U postgres -v ON_ERROR_STOP=1 \
  -v owner_password='<owner-password>' -v runtime_password='<runtime-password>' \
  -f scripts/provision-local-db.sql
```

**Without an installed server:**

- **Container:** run `docker run -d --name ers-postgres -e POSTGRES_PASSWORD=<superuser-password> -p 5432:5432 postgres:18`. CI uses this same image. The developer machine has no container runtime, so this command has not been run locally.
- **Portable binaries:** the developer machine uses the EDB zip binaries, initialized like this:

  ```sh
  initdb -D <data-dir> -U postgres --pwfile=<file-with-superuser-password> -E UTF8 \
    --locale-provider=builtin --builtin-locale=C.UTF-8 --auth=scram-sha-256
  pg_ctl -D <data-dir> -l <log-file> -w start
  ```

### 2.2 Configure

```sh
cp .env.example .env
```

Then edit `.env`:

- **Connection strings:** put the two passwords and your port into the four `*DATABASE_URL` values.
- **Secrets:** replace the four secrets (`CSRF_SECRET`, `PRESESSION_SECRET`, `RATE_LIMIT_SECRET`, `PREVIEW_SECRET`) with random values of at least 32 characters, for example from `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`.

- **Email (production):** the fake provider writes emails to `DEV_MAILBOX_DIR` and is the default. For real delivery set `EMAIL_PROVIDER=resend`, `RESEND_API_KEY`, `EMAIL_FROM` (an address on a domain verified in Resend, optionally `Name <address>`) and optionally `EMAIL_REPLY_TO`; for delivery facts, point a Resend webhook at `https://<your domain>/api/webhooks/resend` and set its signing secret as `RESEND_WEBHOOK_SECRET`. Never put the key or the secret in Git.
- **Map (optional):** set `MAP_TILE_CONTACT` to a contact URL or email address for the map's tile requests (OpenStreetMap requires a contactable User-Agent); `MAP_TILE_URL` and `TILE_CACHE_DIR` have defaults.
- **Media:** event images are stored under `MEDIA_DIR` (default `var/media`, ignored by Git); keep that directory with your backups.

A missing or invalid variable stops every process with its **name**; the value is never printed.

### 2.3 Apply migrations

```sh
pnpm migrate        # applies apps/server/migrations to ers_dev; prints "schema is up to date" when repeated
```

### 2.4 Create a Super Admin (operator only)

New organizations are approved by a Super Admin in the separate area at `/admin`. Super Admins are not organizer accounts and cannot be created over the web; the operator creates them on the server with the owner database connection (`MIGRATION_DATABASE_URL`):

```sh
pnpm admin:create --email admin@example.test --name "Your Name"   # asks for the password twice, without echo
pnpm admin:disable --email admin@example.test                  # disables it and ends its sessions
pnpm admin:totp --email admin@example.test                     # enrols a second factor (shows a secret once, asks for a code)
```

The password (at least 12 characters) is never accepted as an argument and never printed; for scripts it can be piped on standard input as one line. The command refuses an address that already is a Super Admin. **Second factor (PD-99):** set `ADMIN_TOTP_KEY` to 32 random bytes in base64 (for example `node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"`) and run `pnpm admin:totp` for each Super Admin, then sign in with the code from the authenticator app. In production it is required (the process does not start without `ADMIN_TOTP_KEY`); elsewhere it is optional. With a production build, run `node --env-file-if-exists=.env apps/server/dist/entrypoints/admin.js create --email … --name …`.

## 3. Run (development)

Start three processes, each in its own terminal:

```sh
pnpm dev:web        # API on http://127.0.0.1:3000
pnpm dev:worker     # sends queued email and runs the reminder job
pnpm dev:client     # Vite on http://localhost:5173 (proxies /api and /dev to :3000)
```

| Page                | Address                                                                  |
| ------------------- | ------------------------------------------------------------------------ |
| Organizer area      | **http://localhost:5173/organizer**                                      |
| Development mailbox | **http://localhost:5173/dev/mailbox** (it plays the recipients' inboxes) |

Use `localhost`, not `127.0.0.1`: state-changing requests must come from exactly `PUBLIC_ORIGIN`.

### Production-like run (single origin)

```sh
pnpm build
CLIENT_DIST_DIR=apps/client/dist PUBLIC_ORIGIN=http://localhost:3000 pnpm start:web   # serves the client and the API
PUBLIC_ORIGIN=http://localhost:3000 pnpm start:worker                                  # links in emails use this origin
```

Open http://localhost:3000/organizer. The worker needs the same `PUBLIC_ORIGIN` as the web process; otherwise emailed links point to the development port.

## 4. Demo walkthrough (about 10 minutes)

1. **Sign in.** Open the organizer area and choose **Register your organization**: enter an organization name, a contact person, an address such as `organizer@example.test` and a password. Open the mailbox, follow "Confirm your email address" and press **Confirm my email address**. The organization then waits for approval: in another browser profile open `/admin`, sign in as the Super Admin created in §2.4 and press **Approve** on the organization. The owner is emailed; sign in at the organizer area with the address and password.
2. **Create an event.** Choose **Create event**, use capacity **1** and a start date three days ahead, in your time zone. The new event's workspace opens; the **Overview** page lists all your events.
3. **Register Anna.** Copy the **public registration link** into a private window (a separate participant browser). Register `anna@example.test`. In the mailbox, follow "Confirm your registration" and press **Confirm**. Anna gets a ticket with a QR code and a 12-character code, plus a ticket email.
4. **Register Ben.** Repeat with `ben@example.test`. The event is full, so Ben is on the waiting list at position 1.
5. **Try a duplicate.** Register `ANNA@example.test` again. The response is the same, no seat is taken, and Anna receives a "Your registration" access email instead.
6. **Cancel and promote.** Open the management link in Anna's ticket email and cancel. Ben is promoted at once and receives "A place became free" with his ticket. The dashboard now shows 1 confirmed and 0 waiting.
7. **Reschedule into the check-in window.** In the event's **Settings**, the date field shows the current start; change it to about **1 hour from now**, save and confirm. Every confirmed and waiting participant receives "Date changed". Check-in opens 2 hours before the start.
8. **Check in from a second device.** In another browser profile or private window, sign in as the same organizer, open the event and its **Check-in** section, and type Ben's code. (Invited staff use the same screen at `/staff`.)
   - The result shows **Checked in**.
   - The first window's "Checked in (live)" count changes to 1 **without a reload**.
   - Typing the code again shows **Already checked in**, with the first check-in time.

**Timing rules:**

- **Registration and promotion close** 2 hours before the start.
- **At the cutoff,** the worker expires registrations that were never confirmed, and each participant still on the waiting list gets one "Registration closed" email for that date. If a reschedule already moved the start inside the cutoff, its change email says so instead. Moving the event later reopens registration with waiting positions kept.
- **Check-in** is open from 2 hours before the start until 12 hours after it.
- **Reminders** go out 24 hours before the start, exactly once per confirmed participant, while the worker runs. A ticket, promotion or change email sent within those 24 hours counts as the reminder, so no second email follows. The automated tests prove the reminder with an injected test clock.

## 5. Tests and quality checks

| Command                                                             | What it runs                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      | Result (2026-10-12)                         |
| ------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------- |
| `pnpm test`                                                         | Server integration tests against the real `ers_test` database (its `app` schema is recreated per run), plus client unit tests                                                                                                                                                                                                                                                                                                                                                                                                                                                                     | 237/237 and 37/37 passed                    |
| `pnpm e2e`                                                          | Playwright: builds the client, recreates the test database, starts real web and worker processes on :3100, and drives browsers (participant flow, two simultaneous clients, capacity changes, details editing, re-authentication, cancellation, deletion, participant self-service, staff, check-in undo, waiting-list removal, the organizer workspace, link-page security and token bootstrap order on the production build, camera scanning, live public availability, event settings, organizer cancellation of a registration, organizer refresh, navigation without scroll jumps: 32 tests) | 43/43 passed (Edge locally; Chromium in CI) |
| `pnpm check:secrets` / `pnpm check:deps`                            | Secret scan of tracked files; dependency audit (high and critical)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                | Pass                                        |
| `pnpm lint` / `pnpm typecheck` / `pnpm format:check` / `pnpm build` | ESLint (including a layering rule), TypeScript strict, Prettier, production builds                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                | All pass                                    |

**Running the end-to-end tests:**

- **Browser:** first run `pnpm --filter @ers/e2e exec playwright install chromium`, or set `PW_CHANNEL=msedge` (or `chrome`) to use an installed browser.
- **Database conflict:** don't run `pnpm test` and `pnpm e2e` at the same time, because both recreate the test database.

**CI:** [.github/workflows/ci.yml](.github/workflows/ci.yml) runs every command above on GitHub Actions against a `postgres:18` service. [Results on GitHub Actions](https://github.com/DavidMalkhasyan/event-registration-system/actions).

**Clean-clone verification:** first on 2026-10-11 (S-03, the P0 release): the published repository was cloned into a new directory and these instructions were followed against a newly initialized PostgreSQL 18.6 cluster. Install, migrations, the three development processes, the full §4 walkthrough in a browser, all commands in the table above, and the production-like run all succeeded. **Repeated on 2026-10-12 (S-14)** on the current code: a fresh clone and a new PostgreSQL 18 cluster; install, provisioning, 7 migrations and a repeat run ("schema is up to date"), the secret scan, format, lint, typecheck, 135/135 and 11/11 tests, the build, the production-like run with its security headers checked, and 22/22 browser tests (Microsoft Edge). Details are in [DEVELOPMENT_JOURNAL.md](docs/process/DEVELOPMENT_JOURNAL.md) S-03 and S-14.

## 6. Architecture in brief

**Processes:** one web process (HTTP API, live updates) and one worker (email delivery, scheduled jobs). They share only PostgreSQL.

**Concurrency:** every seat, waiting-list, promotion and check-in decision runs in a transaction that first locks the event row (`SELECT … FOR UPDATE`). Database constraints back this up: one active registration per address, one ticket per registration, one check-in per ticket, unique waiting positions. Trigger-maintained counters are checked for drift in the tests.

**Email:** a transactional outbox. A message is written in the same transaction as the state change. The worker claims it, renders it, sends it with an idempotency key, and records the result. Reminders use one slot per registration per schedule version, so a participant can never receive two reminders for the same start time.

**Live count:** a database trigger sends `NOTIFY`. The web process listens and pushes the committed count to dashboards over server-sent events, re-checking authorization before each push.

**Links:** participant links carry their token in the URL fragment. The fragment is never sent to the server or written to logs; the page reads it and sends it in an `Authorization: Link …` header. Unknown, expired and malformed links all get a byte-identical response.

**Organizers:** password sign-in (Argon2id, PD-89) after the address is confirmed by an emailed link; resets by an expiring single-use emailed link end every session of the account. Organizers from before K-709 keep the emailed sign-in link until they set a password. The session cookie is `__Host-`, HttpOnly and Secure. State-changing requests need a CSRF token and an exact `Origin` check.

**Further reading:** the design documents are in `docs/` (architecture, ADRs, database, API). They describe the full designed system; the implemented subset is listed in [ASSIGNMENT_SCOPE.md](ASSIGNMENT_SCOPE.md) §4.

```
apps/server   web + worker (src/platform: infrastructure; src/modules: features), migrations, integration tests
apps/client   React pages: public.html (event and link pages), organizer.html (organizer area), staff.html (staff check-in)
apps/e2e      Playwright tests and the launcher that starts the real stack
scripts/      database provisioning
docs/         requirements-phase design, process records (Kanban, journal, decision log, AI usage)
```

## 7. HTTP API (implemented subset)

| Area                                                  | Routes                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| ----------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Public**                                            | `GET /api/public/events/:publicId` (with aggregate availability: capacity, confirmed and waiting counts, estimated free seats, registration mode) · `POST /api/public/events/:publicId/registrations`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| **Participant links** (`Authorization: Link <token>`) | `GET /api/links/verify` · `POST /api/links/verify/confirm` · `GET /api/links/manage` · `POST /api/links/manage/cancel` · `POST /api/links/manage/resend` · `POST /api/links/manage/share-links` · `POST /api/links/manage/rotations` · `GET /api/links/invite` · `POST /api/links/invite/accept` · `GET /api/links/ticket`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| **Organizer sign-in**                                 | `POST /api/organizations/registrations` · `GET` / `POST /api/links/account-verification[/confirm]` · `POST /api/auth/password-sessions` · `POST /api/auth/password-reset-requests` · `GET` / `POST /api/links/password-reset[/confirm]` · `POST /api/auth/password-reauthentication` · `POST /api/auth/sign-in-requests` · `GET /api/links/sign-in` · `POST /api/links/sign-in/confirm` · `GET /api/auth/session` · `POST /api/auth/sign-out` · `POST /api/auth/reauthentication`                                                                                                                                                                                                                                                                                                                                                                              |
| **Organizer events**                                  | `GET` / `POST /api/events` · `GET /api/events/:id` · `GET /api/events/:id/dashboard` · `GET /api/events/:id/participants` · `PATCH /api/events/:id` · `PUT /api/events/:id/capacity` · `PUT /api/events/:id/location` · `POST /api/events/:id/cancellation` · `GET /api/events/:id/deletion-preview` · `POST /api/events/:id/deletion` · `POST /api/events/:id/reschedule` · `POST /api/events/:id/check-ins` · `POST /api/events/:id/check-ins/:checkInId/undo` · `POST /api/events/:id/registrations/:registrationId/waitlist-removal` · `POST /api/events/:id/registrations/:registrationId/organizer-cancellation` · `GET /api/events/:id/check-in-count` · `GET /api/events/:id/live` (SSE) · `GET /api/events/:id/staff` · `POST /api/events/:id/staff-invitations` · `POST …/staff-invitations/:id/revocation` · `POST …/staff-sessions/:id/revocation` |
| **Organization members**                              | `GET /api/organizations/:id/members` · `POST /api/organizations/:id/invitations` · `DELETE /api/organizations/:id/invitations/:invitationId` · `PATCH` / `DELETE /api/organizations/:id/members/:accountId` · `POST /api/invitations/:id/accept` · `POST /api/invitations/:id/decline` · `POST /api/accounts/registrations` (an account without an organization, for invitees)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| **Super Admin** (`/admin`)                            | `POST /api/admin/sessions` · `GET /api/admin/session` · `POST /api/admin/sign-out` · `GET /api/admin/organizations[?status=]` · `GET /api/admin/organizations/:id/audit` · `POST /api/admin/organizations/:id/decisions` (approve, reject, suspend, reinstate). No route creates a Super Admin                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| **Event images**                                      | `GET /api/events/:id/images` · `POST /api/events/:id/images?role=cover` (or `gallery`; the image as the body) · `PUT /api/events/:id/images/:imageId/file` · `PATCH /api/events/:id/images/:imageId` (alternative text) · `DELETE /api/events/:id/images/:imageId` · `PUT /api/events/:id/images/order` · `POST /api/events/:id/images/:imageId/cover` · `GET /media/images/<name>.webp`                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| **Staff device**                                      | `GET /api/staff/session` · `POST /api/staff/sign-out` (ends this device's access); check-in, count and live stream of its own event (above)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| **Operations**                                        | `GET /healthz` · `GET /dev/mailbox` (development with the fake provider only)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |

Errors use RFC 9457 Problem Details (`application/problem+json`) with a stable `code`.

## 8. Known limitations

- **Organizations** (post-release, PD-88): events belong to organizations; organizers act through a membership of an active organization. Existing organizers each own one organization. Organizations register with a contact person and a password, confirm the address by email and wait for approval (PD-89). A Super Admin (created only by the operator command, §2.4) approves, rejects, suspends and reinstates organizations at `/admin`, with audit records and emails to the owners (PD-90). Owners and admins invite further organizers by email from the **Organization** page; the invitee accepts after signing in with that verified address (an account can be created at `/organizer/join`). Roles: owner, admin, member; an organization always keeps an owner (PD-94). Super Admins have a TOTP second factor (required in production); organizers do not (a stakeholder decision, [SECURITY_AUDIT.md](docs/security/SECURITY_AUDIT.md)).
- **Event location** (post-release, PD-91): an optional venue with address, arrival instructions and coordinates (only as entered; nothing is geocoded). The public, management and ticket pages show it with **Get directions** (Google Maps) and **OpenStreetMap** links that open on those sites; our pages load nothing from them. A venue change emails confirmed and waiting participants. Confirmed participants also see the venue on an OpenStreetMap map (PD-96): its tiles come through our own server, which identifies itself to OpenStreetMap, caches by its headers and serves only the area around events with coordinates; participant pages make no third-party request. The map is off until `MAP_TILE_CONTACT` is set; OpenStreetMap's tile service suits development and demonstrations, not production traffic.
- **Event photographs** (post-release, PD-92): the server accepts one cover and up to eight gallery images per event, checks them by content (JPEG, PNG or WebP; no SVG), re-encodes them as WebP without metadata and stores them under `MEDIA_DIR`, not in the database. Organizers manage them in the event's **Photos** section; the public page shows the cover and a gallery with a keyboard-friendly viewer (PD-93).
- **Organizer features:** rescheduling, capacity increases (capacity can't be lowered, amendment A-2), title and description editing, event cancellation and event deletion (both behind a recent sign-in) are implemented. The owner can undo a check-in (audited; staff cannot) and remove a waiting-list entry (audited, emailed, never promotes). The owner can also cancel one confirmed registration that is not checked in (audited, emailed, promotes the first waiting person before the cutoff; PD-83, a proposed requirement amendment). Staff are invited per event by email; each accepted invitation is one device session with check-in access only.
- **Email:** Resend is integrated behind the provider interface (PD-97) and tested against a stand-in for its API; real delivery has not been tested yet (no account, domain or key). Delivery webhooks (`POST /api/webhooks/resend`, Svix-verified, PD-98) record delivered, bounced and complained events once enabled with `RESEND_WEBHOOK_SECRET`; not yet tested with real Resend webhooks.
- **Organizer refresh** (post-release, PD-84): the overview, All events, the event dashboard, participants, waiting list and staff sections have a Refresh button and update themselves every 15 seconds while visible, without reloading the page or losing the current tab, search, filters or unsaved edits.
- **Live public availability** (post-release, PD-81): the public event page shows free seats, the waiting list or the closed state, and refreshes them every 15 seconds while the tab is visible (at once when it is shown again). The figure is an estimate: the place is decided when the visitor confirms their email.
- **Participant self-service:** view, cancel, ticket resend, share links and link rotation are implemented; changing the registration's email address is not.
- **Language:** English only.
- **Camera scanning** (accepted as a documented limitation for this release): QR scanning uses the browser's `BarcodeDetector` where it exists (desktop Chromium on Windows and Linux has none), so the scan button appears only there; manual code entry always works. The browser test `camera-scan` covers scanning with **simulated** camera and `BarcodeDetector` APIs; everything after detection is real. It has **not been tried on a physical phone or camera**.
- **Test environment:** tests use a local PostgreSQL database instead of Testcontainers (no container runtime on the development machine).
- **Verified on one platform only:** the setup was verified from a clean clone on Windows (Git Bash) in S-03 and again in S-14, and in CI on Ubuntu; macOS and Linux desktops have not been tried.
- **CI warnings:** GitHub reports that the v4 actions target the deprecated Node.js 20 runtime (they run on Node.js 24). Updating the action versions is pending.
- **Upgrading an existing setup:** after pulling, run `pnpm migrate` (migrations `0003` to `0017`; `0009` gives each existing organizer its own organization, `0010` adds passwords and keeps existing organizers on the emailed sign-in link until they set one, `0011` adds the Super Admin tables, `0012` the optional event location, `0013` event image metadata, `0014` organization invitations, `0015` lets a staff device end its own access, `0016` stores delivery webhook events, `0017` the Super Admins' second factor; then create a Super Admin, §2.4) and add `PREVIEW_SECRET` to `.env`; the processes refuse to start with an outdated schema or a missing variable.
- **Development server headers:** the Vite development server does not send the production page headers (content security policy and others) and injects its own client script. The production-like run (§3) is the tested path.
- **Event artwork:** events have no uploaded image; each gets one of six original CSS posters (geometric shapes and type in the EventFlow palette, chosen per event from its public ID; no image files). The v0 design's three AI-generated photographs were removed before the release because their reuse rights were not established; they remain in earlier commits, since the history is not rewritten ([AI_USAGE.md](docs/process/AI_USAGE.md) §7).
- **Release state:** `main` holds the v1.0.0 release ([PR #17](https://github.com/DavidMalkhasyan/event-registration-system/pull/17), merged 2026-10-12; CI passed on the merge commit). No release tag has been created yet.
- **Not production-ready:** no deployment exists, and there is no deployment configuration, TLS termination, backups or load testing.

## 9. Future improvements

1. **Real email:** a Resend provider behind configuration, with delivery webhooks and a delivery-problem view.
2. **Test infrastructure:** Testcontainers once a container runtime is available, and a load test of the last-seat path.
3. **Camera check on real devices:** scan tickets with a phone and a laptop camera, and record which browsers offer `BarcodeDetector`.

## 10. How this was built

The project was developed with **Claude Code** (model Claude Opus 5.5, `claude-opus-5-5`) under the developer's direction. Records:

- **Tools, rationale and prompt summaries:** [docs/process/AI_USAGE.md](docs/process/AI_USAGE.md)
- **Sessions with real timestamps, commands and results:** [docs/process/DEVELOPMENT_JOURNAL.md](docs/process/DEVELOPMENT_JOURNAL.md)
- **Process decisions:** [docs/process/DECISION_LOG.md](docs/process/DECISION_LOG.md)
- **Work tracking:** [docs/process/KANBAN.md](docs/process/KANBAN.md)
- **Client inventory before a UI redesign:** [docs/frontend/UI_INVENTORY.md](docs/frontend/UI_INVENTORY.md). The redesign adapts the approved design made with Vercel v0 ([eventflow-v0-design](https://github.com/DavidMalkhasyan/eventflow-v0-design)): its visual components and styles were ported onto this project's own backend and security architecture; see PD-65 to PD-71 and [AI_USAGE.md](docs/process/AI_USAGE.md) §7.
