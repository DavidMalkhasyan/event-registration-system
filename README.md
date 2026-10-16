# EventFlow — Event Registration System

**MadDevs Junior Agentic Developer · Case #9 (Event Registration).**

EventFlow lets organizers publish events, accept email-only registrations, issue tickets and manage attendance. When an event fills up, participants join a FIFO waiting list and are promoted automatically when a seat becomes free. Check-ins update live, including when two browser clients are open.

## Quick start

**Requirements:** Git and Docker Compose v2. Full instructions for **Windows, Linux and macOS**, including manual startup without Docker: **[QUICKSTART_RU.md](QUICKSTART_RU.md)**.

```bash
git clone https://github.com/DavidMalkhasyan/event-registration-system.git
cd event-registration-system
docker compose -f compose.demo.yaml up -d --build
```

The local Docker demo automatically prepares PostgreSQL, migrations, an approved organization, two accounts and six events.

| Role        | Email                         | Password             | URL                             |
| ----------- | ----------------------------- | -------------------- | ------------------------------- |
| Organizer   | `demo.organizer@example.test` | `DemoOrganizer2026!` | http://localhost:3000/organizer |
| Super Admin | `demo.admin@example.test`     | `DemoAdmin2026!`     | http://localhost:3000/admin     |

**Demo mailbox:** http://localhost:3000/dev/mailbox. These public demo credentials work only in isolated `DEMO_MODE`, which is refused in production. Standard production Super Admin authentication still requires TOTP.

## Features

- Event creation/editing, capacity, venue, photographs and organizer dashboard.
- Email verification and registration without participant accounts; cancellation and self-service links.
- Transactional FIFO waiting list and automatic seat promotion, including concurrent requests.
- Unique tickets (codes and QR), manual/camera check-in, live SSE counts and staff access.
- Organization membership and roles; Super Admin approval workflow.
- Email outbox, retries, reminders and local fake mailbox; real provider integration code exists.
- Security: hashed access tokens, cookie sessions, CSRF/Origin checks and production Super Admin TOTP.

## Stack

| Layer               | Technology                                                               |
| ------------------- | ------------------------------------------------------------------------ |
| Frontend            | React 19, TypeScript, Vite                                               |
| Backend             | Node.js 24, Fastify 5, TypeScript; separate web and worker processes     |
| Database            | PostgreSQL 18, Kysely, SQL migrations                                    |
| Tests               | Vitest (real PostgreSQL), Playwright (browser scenarios), GitHub Actions |
| Local demonstration | Docker Compose with seeded example data and a fake email provider        |

The project uses a modular monolith with PostgreSQL transactions and row locking for seat/check-in consistency, a transactional outbox for email and SSE for live updates.

## Documentation — where to start

| Question                                                 | Read                                                                                                              |
| -------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| **How do I launch and log in?**                          | **[QUICKSTART_RU.md](QUICKSTART_RU.md)**                                                                          |
| **What was implemented, tested and deferred?**           | [ASSIGNMENT_SCOPE.md](ASSIGNMENT_SCOPE.md)                                                                        |
| **What did we plan to build, and what would come next?** | **[PLANNED_WORK.md](PLANNED_WORK.md)**                                                                            |
| **What is the optional personal essay?**                 | [ESSAY_RU.md](ESSAY_RU.md)                                                                                        |
| **Which AI model/tools were used, and which prompts?**   | [AI_USAGE.md](docs/process/AI_USAGE.md)                                                                           |
| **How did the project evolve over time?**                | [DEVELOPMENT_JOURNAL.md](docs/process/DEVELOPMENT_JOURNAL.md) and [DECISION_LOG.md](docs/process/DECISION_LOG.md) |
| **Where is the architecture and database design?**       | [ARCHITECTURE_INDEX.md](docs/ARCHITECTURE_INDEX.md)                                                               |
| **What were the initial full requirements?**             | [REQUIREMENTS.md](REQUIREMENTS.md)                                                                                |

Additional technical references live under `docs/architecture`, `docs/database`, `docs/adr`, `docs/security`, `docs/api`, `docs/operations` and `docs/process`. Historical planning and journal entries retain their original timestamps.

## Verification and limitations

The existing GitHub CI covers server integration tests, frontend tests, browser E2E and container checks. A separate `demo` job verifies first boot, generated demo data, both role logins, authorization checks and persistence across container restarts. See the latest [GitHub Actions runs](https://github.com/DavidMalkhasyan/event-registration-system/actions).

**Honest limitations:** the local Docker demo is tested on Ubuntu (CI and isolated Docker), not independently on Windows/macOS; no public production deployment; real Resend email delivery has not been exercised; physical-device QR-camera testing is outstanding. Local demo mode bypasses Super Admin TOTP only for disposable demo accounts and is prohibited in production.

## Attribution

Development was AI-assisted; model, tool, prompts and decision records are documented in [AI_USAGE.md](docs/process/AI_USAGE.md). The UI used an approved Vercel v0 design as reference; implementation and deviations are documented in the project records. Demo event artwork uses CSS-generated posters rather than unlicensed third-party photographs.
