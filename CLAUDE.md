# CLAUDE.md — EventFlow working rules

EventFlow is an event registration system: organizations create events, participants register by email
(no participant accounts), capacity is protected by a FIFO waiting list, tickets are checked in by staff.
Background and history: `docs/PROJECT_SUMMARY.md`. Code map: `docs/ARCHITECTURE_INDEX.md`.

## Stack

pnpm monorepo, Node.js 24, TypeScript. Server: Fastify 5, Kysely, PostgreSQL 18, zod, sharp
(`apps/server`). Client: React 19 + Vite, four entry pages (`apps/client`). Browser tests: Playwright
(`apps/e2e`). Unit/integration tests: Vitest against a real PostgreSQL test database.

## New session protocol

1. Read `.claude/SESSION_HANDOFF.md` if present (local only, not in Git).
2. Read `docs/PROJECT_SUMMARY.md` only when background is needed.
3. Read `docs/ARCHITECTURE_INDEX.md` to locate the files for the task.
4. Read only the source files relevant to the task; no repository-wide scans or audits unless asked.
5. Run `git status` and `git branch --show-current` before modifying code.
6. Ask only when a material decision is missing.

At the end of a substantial session: update `.claude/SESSION_HANDOFF.md` (last completed task, PR and
CI status, open blockers, exact next step). Update `PROJECT_SUMMARY.md` only for milestones or
architectural decisions, `ARCHITECTURE_INDEX.md` only when files or responsibilities change.

## Git workflow (stakeholder rules)

- Never modify `main`; never tag, deploy, submit or open a release PR without explicit authorization.
- Work on `feature/*` branches from the latest `dev`; PRs target `dev`.
- Before a PR: full local gates; after: real GitHub CI green (`verify` and `container` jobs), a reviewed
  diff, then `gh pr merge N --merge`. Do not create or merge PRs unless the user asked for that work.
- Commit code and records (docs/process) in separate commits. Never rewrite history.
- Commit trailer: `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Record sessions in `docs/process/DEVELOPMENT_JOURNAL.md` with real timestamps; decisions in
  `docs/process/DECISION_LOG.md` (PD-n); cards in `docs/process/KANBAN.md` (K-n).
- Never edit `REQUIREMENTS.md`; approved deviations go in `docs/process/REQUIREMENT_AMENDMENTS.md`.
- Never mark untested or blocked work Done; never invent results, timestamps or benchmarks.

## Security and architecture constraints

- Link tokens travel only in the URL fragment (`#t=`), are sent as `Authorization: Link …`, are stored
  hashed and never logged (ADR-011, ADR-012). Link pages: `Referrer-Policy: no-referrer`, `no-store`.
- Sessions are `__Host-` cookies; state-changing requests need the CSRF token and the exact Origin
  (except `/api/webhooks/`). Passwords: Argon2id. Super Admins need TOTP in production.
- Seat, waiting-list, check-in and cancellation decisions run under the event lock (`withEventLock`);
  emails are written to the transactional outbox, never sent inside a database transaction.
- Same origin for client, API, media and map tiles (ADR-013); participant pages make no third-party
  requests; no external map scripts; never geocode or send tokens/participant data to a provider.
- Migrations are forward-only SQL files; never change an applied file. Runtime role cannot alter schema.
- Never touch the development database destructively; use isolated `ers_rc_*`/drill databases.
- No credentials or personal data in Git, logs or docs; `check:secrets` must pass.
- Do not add Redis, Kafka or Kubernetes without a measured need.

## Commands

- Targeted tests first: `pnpm --filter @ers/server exec vitest run test/<name>.test.ts`;
  client: `pnpm --filter @ers/client exec vitest run src/<path>.test.ts`;
  one browser spec: `cd apps/e2e && PW_CHANNEL=msedge npx playwright test tests/<name>.spec.ts`.
- Server tests and browser tests both recreate the test database: never run them at the same time.
- Full gates at integration points only: `pnpm check:secrets`, `pnpm check:deps`, `pnpm format:check`,
  `pnpm lint`, `pnpm typecheck`, `pnpm migrate`, `pnpm test`, `pnpm build`, `pnpm e2e`.
- Operations: `pnpm ops:backup`, `pnpm ops:restore-drill`, `pnpm media:sweep`, `pnpm bench`,
  `pnpm admin:create|totp|disable`.

## Token efficiency

- Use targeted `Grep`/`Glob` and line ranges; do not print whole files or long logs (`tail`, `grep`).
- Do not re-read documentation already read in the session; do not re-summarize the project.
- Run relevant tests while developing; full gates only before a PR. Keep tool output and replies short.
- No subagents or large parallel plans unless asked. Never trade testing or security for tokens.
