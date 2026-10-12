# Event Registration System

Organizers create events. Participants register with only their email address. When an event is full, a first-come waiting list fills free seats automatically. Confirmed participants receive a ticket with a unique code, which is checked in once at the entrance, and the organizer sees confirmed, waiting and checked-in counts live.

This is Task 9 of the AI-assisted software engineering assignment.

- [ASSIGNMENT_SCOPE.md](ASSIGNMENT_SCOPE.md) has the requirement → implementation → test → status matrix.
- [REQUIREMENTS.md](REQUIREMENTS.md) is the full product specification (v1.7, "Proposed — awaiting stakeholder review").

|              |                                                                                                           |
| ------------ | --------------------------------------------------------------------------------------------------------- |
| **Frontend** | React 19 and Vite 8, in `apps/client`                                                                     |
| **Backend**  | Node.js 24 and Fastify 5, in `apps/server`: a web process plus a separate email worker process            |
| **Database** | PostgreSQL 18, accessed through Kysely, with SQL migrations in `apps/server/migrations`                   |
| **Email**    | A fake provider: emails are written to `var/mailbox/` and shown at `/dev/mailbox`. No real email is sent. |
| **Tests**    | Vitest integration tests against real PostgreSQL; Playwright browser tests in `apps/e2e`                  |

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

A missing or invalid variable stops every process with its **name**; the value is never printed.

### 2.3 Apply migrations

```sh
pnpm migrate        # applies apps/server/migrations to ers_dev; prints "schema is up to date" when repeated
```

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

1. **Sign in.** Open the organizer area and enter any address, such as `organizer@example.test`. Open the mailbox, follow the sign-in link and press **Sign in**.
2. **Create an event.** Use capacity **1** and a start date three days ahead, in your time zone. Open the event.
3. **Register Anna.** Copy the **public registration link** into a private window (a separate participant browser). Register `anna@example.test`. In the mailbox, follow "Confirm your registration" and press **Confirm**. Anna gets a ticket with a QR code and a 12-character code, plus a ticket email.
4. **Register Ben.** Repeat with `ben@example.test`. The event is full, so Ben is on the waiting list at position 1.
5. **Try a duplicate.** Register `ANNA@example.test` again. The response is the same, no seat is taken, and Anna receives a "Your registration" access email instead.
6. **Cancel and promote.** Open the management link in Anna's ticket email and cancel. Ben is promoted at once and receives "A place became free" with his ticket. The dashboard now shows 1 confirmed and 0 waiting.
7. **Reschedule into the check-in window.** On the dashboard, reschedule the event to about **1 hour from now**. Every confirmed and waiting participant receives "Date changed". Check-in opens 2 hours before the start.
8. **Check in from a second device.** In another browser profile or private window, sign in as the same organizer. Open **entrance check-in screen** and type Ben's code.
   - The scanner shows **✔ Checked in**.
   - The first window's "Checked in (live)" count changes to 1 **without a reload**.
   - Typing the code again shows **✖ Already checked in**, with the first check-in time.

**Timing rules:**

- **Registration and promotion close** 2 hours before the start.
- **At the cutoff,** the worker expires registrations that were never confirmed, and each participant still on the waiting list gets one "Registration closed" email for that date. If a reschedule already moved the start inside the cutoff, its change email says so instead. Moving the event later reopens registration with waiting positions kept.
- **Check-in** is open from 2 hours before the start until 12 hours after it.
- **Reminders** go out 24 hours before the start, exactly once per confirmed participant, while the worker runs. A ticket, promotion or change email sent within those 24 hours counts as the reminder, so no second email follows. The automated tests prove the reminder with an injected test clock.

## 5. Tests and quality checks

| Command                                                             | What it runs                                                                                                                                                                                                                                                                                                        | Result (2026-10-11)                         |
| ------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------- |
| `pnpm test`                                                         | Server integration tests against the real `ers_test` database (its `app` schema is recreated per run), plus client unit tests                                                                                                                                                                                       | 119/119 and 6/6 passed                      |
| `pnpm e2e`                                                          | Playwright: builds the client, recreates the test database, starts real web and worker processes on :3100, and drives browsers (participant flow, two simultaneous clients, capacity changes, details editing, re-authentication, cancellation, deletion, participant self-service, staff, check-in undo: 16 tests) | 16/16 passed (Edge locally; Chromium in CI) |
| `pnpm lint` / `pnpm typecheck` / `pnpm format:check` / `pnpm build` | ESLint (including a layering rule), TypeScript strict, Prettier, production builds                                                                                                                                                                                                                                  | All pass                                    |

**Running the end-to-end tests:**

- **Browser:** first run `pnpm --filter @ers/e2e exec playwright install chromium`, or set `PW_CHANNEL=msedge` (or `chrome`) to use an installed browser.
- **Database conflict:** don't run `pnpm test` and `pnpm e2e` at the same time, because both recreate the test database.

**CI:** [.github/workflows/ci.yml](.github/workflows/ci.yml) runs every command above on GitHub Actions against a `postgres:18` service. [Results on GitHub Actions](https://github.com/DavidMalkhasyan/event-registration-system/actions).

**Clean-clone verification (2026-10-11):** the published repository was cloned into a new directory and these instructions were followed against a newly initialized PostgreSQL 18.6 cluster. Install, migrations, the three development processes, the full §4 walkthrough in a browser, all commands in the table above, and the production-like run all succeeded. Details are in [DEVELOPMENT_JOURNAL.md](docs/process/DEVELOPMENT_JOURNAL.md) S-03.

## 6. Architecture in brief

**Processes:** one web process (HTTP API, live updates) and one worker (email delivery, scheduled jobs). They share only PostgreSQL.

**Concurrency:** every seat, waiting-list, promotion and check-in decision runs in a transaction that first locks the event row (`SELECT … FOR UPDATE`). Database constraints back this up: one active registration per address, one ticket per registration, one check-in per ticket, unique waiting positions. Trigger-maintained counters are checked for drift in the tests.

**Email:** a transactional outbox. A message is written in the same transaction as the state change. The worker claims it, renders it, sends it with an idempotency key, and records the result. Reminders use one slot per registration per schedule version, so a participant can never receive two reminders for the same start time.

**Live count:** a database trigger sends `NOTIFY`. The web process listens and pushes the committed count to dashboards over server-sent events, re-checking authorization before each push.

**Links:** participant links carry their token in the URL fragment. The fragment is never sent to the server or written to logs; the page reads it and sends it in an `Authorization: Link …` header. Unknown, expired and malformed links all get a byte-identical response.

**Organizers:** passwordless sign-in by emailed link. The session cookie is `__Host-`, HttpOnly and Secure. State-changing requests need a CSRF token and an exact `Origin` check.

**Further reading:** the design documents are in `docs/` (architecture, ADRs, database, API). They describe the full designed system; the implemented subset is listed in [ASSIGNMENT_SCOPE.md](ASSIGNMENT_SCOPE.md) §4.

```
apps/server   web + worker (src/platform: infrastructure; src/modules: features), migrations, integration tests
apps/client   React pages: public.html (event and link pages), organizer.html (organizer area)
apps/e2e      Playwright tests and the launcher that starts the real stack
scripts/      database provisioning
docs/         requirements-phase design, process records (Kanban, journal, decision log, AI usage)
```

## 7. HTTP API (implemented subset)

| Area                                                  | Routes                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| ----------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Public**                                            | `GET /api/public/events/:publicId` · `POST /api/public/events/:publicId/registrations`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| **Participant links** (`Authorization: Link <token>`) | `GET /api/links/verify` · `POST /api/links/verify/confirm` · `GET /api/links/manage` · `POST /api/links/manage/cancel` · `POST /api/links/manage/resend` · `POST /api/links/manage/share-links` · `POST /api/links/manage/rotations` · `GET /api/links/invite` · `POST /api/links/invite/accept` · `GET /api/links/ticket`                                                                                                                                                                                                                                                                                                                                              |
| **Organizer sign-in**                                 | `POST /api/auth/sign-in-requests` · `GET /api/links/sign-in` · `POST /api/links/sign-in/confirm` · `GET /api/auth/session` · `POST /api/auth/sign-out` · `POST /api/auth/reauthentication`                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| **Organizer events**                                  | `GET` / `POST /api/events` · `GET /api/events/:id` · `GET /api/events/:id/dashboard` · `GET /api/events/:id/participants` · `PATCH /api/events/:id` · `PUT /api/events/:id/capacity` · `POST /api/events/:id/cancellation` · `GET /api/events/:id/deletion-preview` · `POST /api/events/:id/deletion` · `POST /api/events/:id/reschedule` · `POST /api/events/:id/check-ins` · `POST /api/events/:id/check-ins/:checkInId/undo` · `GET /api/events/:id/check-in-count` · `GET /api/events/:id/live` (SSE) · `GET /api/events/:id/staff` · `POST /api/events/:id/staff-invitations` · `POST …/staff-invitations/:id/revocation` · `POST …/staff-sessions/:id/revocation` |
| **Staff device**                                      | `GET /api/staff/session`; check-in, count and live stream of its own event (above)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| **Operations**                                        | `GET /healthz` · `GET /dev/mailbox` (development with the fake provider only)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |

Errors use RFC 9457 Problem Details (`application/problem+json`) with a stable `code`.

## 8. Known limitations

- **Organizer features:** rescheduling, capacity changes, title and description editing, event cancellation and event deletion (both behind a recent sign-in) are implemented. The owner can undo a check-in (audited; staff cannot). Staff are invited per event by email; each accepted invitation is one device session with check-in access only.
- **Email:** the fake provider is the only one. There is no Resend integration, no delivery webhooks and no bounce handling.
- **Participant self-service:** view, cancel, ticket resend, share links and link rotation are implemented; changing the registration's email address is not.
- **Language:** English only.
- **Camera scanning:** QR scanning uses the browser's `BarcodeDetector` where it exists. It is not covered by automated tests; manual code entry is.
- **Test environment:** tests use a local PostgreSQL database instead of Testcontainers (no container runtime on the development machine).
- **Verified on one platform only:** the setup was verified from a clean clone on Windows (Git Bash) and in CI on Ubuntu; macOS has not been tried.
- **CI warnings:** GitHub reports that the v4 actions target the deprecated Node.js 20 runtime (they run on Node.js 24). Updating the action versions is pending.
- **Upgrading an existing setup:** after pulling, run `pnpm migrate` (migrations `0003` to `0006`) and add `PREVIEW_SECRET` to `.env`; the processes refuse to start with an outdated schema or a missing variable.
- **Not production-ready:** no deployment configuration, TLS termination, backups or load testing.

## 9. Future improvements

1. **Real email:** a Resend provider behind configuration, with delivery webhooks and a delivery-problem view.
2. **Test infrastructure:** Testcontainers once a container runtime is available, and a load test of the last-seat path.

## 10. How this was built

The project was developed with **Claude Code** (model Claude Opus 5.5, `claude-opus-5-5`) under the developer's direction. Records:

- **Tools, rationale and prompt summaries:** [docs/process/AI_USAGE.md](docs/process/AI_USAGE.md)
- **Sessions with real timestamps, commands and results:** [docs/process/DEVELOPMENT_JOURNAL.md](docs/process/DEVELOPMENT_JOURNAL.md)
- **Process decisions:** [docs/process/DECISION_LOG.md](docs/process/DECISION_LOG.md)
- **Work tracking:** [docs/process/KANBAN.md](docs/process/KANBAN.md)
