# Kanban Board

| | |
|---|---|
| **Columns** | Backlog → To Do → In Progress → Review → Done |
| **Work-in-progress limits** | In Progress ≤ 2, Review ≤ 3 |
| **Last updated** | 2026-10-11, session S-01 (exact time in [DEVELOPMENT_JOURNAL.md](DEVELOPMENT_JOURNAL.md)) |

## Rules

1. **Card ID:** `K-<milestone><nn>`, for example K-102 is milestone 1, card 02.
2. **Every card links** to its milestone's Definition of Done in [MILESTONES.md](MILESTONES.md), plus any card-specific criteria.
3. **Moves are recorded:** a card moves only during a journal session, and the journal entry records the move.
4. **"Review"** means the work is finished on our side and awaits verification by the stakeholder or by CI.
5. **"Done"** requires the Definition of Done to be satisfied, with evidence (commit hash, test output). A card is never marked Done on intent.
6. **Blocked cards** stay in their column, marked **BLOCKED** with the reason.

## Done

| Card | Milestone | Evidence |
|---|---|---|
| K-002 Initialize local Git on `main`; commit the documentation baseline unchanged | M0 | Commit `da80a85` (2026-10-11 13:35:25 +04:00); 18 files |
| K-003 Secret and personal-data scan of the baseline before the first commit | M0 | Journal S-01: no secret patterns; only the example addresses from REQUIREMENTS.md |

## Review

| Card | Milestone | Awaiting |
|---|---|---|
| K-001 Apply R60; synchronize the architecture, database and API documents and `openapi.yaml` | M0 | Stakeholder check of the R60 text against the clarifications. Commit `3fe9cb7`; checks pass (journal S-01). |
| K-004 Process documentation (`docs/process/*`) | M0 | Stakeholder review |

## In Progress

*(empty)*

## To Do

| Card | Milestone | Notes |
|---|---|---|
| K-005 Create the GitHub repository; add the remote; push `main` after a final secret scan | M0 | **BLOCKED**: needs the owner's GitHub account, repository name and visibility (PD-Q5). Steps in [SUBMISSION_CHECKLIST.md](SUBMISSION_CHECKLIST.md) §3. |
| K-101 Toolchain decisions: Node.js version, package manager, CI platform (OQ-14), migration tool (ADR-018), approval of ADR-019 and ADR-020 | M1 | Decisions PD-Q2 to PD-Q4 |
| K-102 **Project initialization** (first implementation task) | M1 | See "First implementation task" below |

## Backlog

| Card | Milestone |
|---|---|
| K-103 CI pipeline: format, lint, type-check, unit, build; AC-140 deliberate-failure check | M1 |
| K-104 Move the documentation checks (OpenAPI validation, requirement IDs, traceability) into the repository and CI | M1 |
| K-105 Dependency and secret scanning in CI (ENG-CI-4, ENG-DOC-3) | M1 |
| K-201 Migration runner (ADR-018): checksums, lock, version check | M2 |
| K-202 Migrations `0001` to `0010`, including D-17 | M2 |
| K-203 Testcontainers PostgreSQL 18 harness; T-M1 to T-M10 | M2 |
| K-204 Constraint and trigger violation tests (every CK, U, FK, TR) | M2 |
| K-205 `migrate budget-sync` subcommand (D-15) | M2 |
| K-206 Kysely type generation with a drift check | M2 |
| K-301 Platform: configuration, transaction runner, lock helpers, decision time, errors, logging, HTTP plugins | M3 |
| K-302 Identity: sign-in, sessions, anti-forgery, re-authentication, email change | M3 |
| K-303 Access tokens and the link-resolution API | M3 |
| K-304 Event lifecycle (create with idempotency, edit, capacity, reschedule, cancel, delete) | M3 |
| K-305 Registration, verification, waiting list, promotion, participant cancellation | M3 |
| K-306 Check-in and undo | M3 |
| K-307 M3 concurrency and rollback suites | M3 |
| K-401 Messaging: outbox claim, send pipeline, pre-claim counter, budget, pause | M4 |
| K-402 Webhooks, provider-event log, delivery facts | M4 |
| K-403 Notifications: 17 message types, rendering, link issuance | M4 |
| K-404 Jobs: reminder fan-out, cutoff | M4 |
| K-405 Participant portal: resend, share links, rotation | M4 |
| K-406 Staff invitations and sessions | M4 |
| K-407 Reporting: dashboard, participants, SSE | M4 |
| K-408 Fake provider; Resend adapter behind the gate | M4 |
| K-501 Client workspace: three entries, fragment bootstrap, security headers | M5 |
| K-502 Public and link pages | M5 |
| K-503 Organizer area | M5 |
| K-504 Staff scanner and live count | M5 |
| K-505 Playwright suites (ENG-TST-4, AC-173 to AC-178) | M5 |
| K-601 README: setup, run, deployment, limitations | M6 |
| K-602 AC-169 pipeline test; AC-135 (b) stress test | M6 |
| K-603 Final AI usage, journal, attribution, current state, incomplete work | M6 |
| K-604 Final secret scan; release tag; submission | M6 |

## First implementation task: K-102 Project initialization

**Scope:**
- The workspace layout from MODULES.md §10, with **placeholder module entry points only**. No business logic, no SQL, no endpoints.
- TypeScript strict configuration; formatter and linter configuration; Vitest with one smoke test per package.
- Configuration loading with fail-fast validation, and `.env.example` containing placeholders only.
- Repository hygiene files: `.gitattributes` (LF), `.gitignore`, `.editorconfig`.
- README skeleton listing the commands.
- Import-boundary rules configured, with one deliberately failing fixture to prove they work.

**Definition of Done:**
1. `install`, `format:check`, `lint`, `typecheck`, `test` and `build` run successfully from a clean clone, on the documented Node.js version.
2. The import-boundary check fails on the deliberate fixture and passes once it is removed. The result is recorded.
3. A missing required environment variable makes the process exit non-zero and name the variable, never its value (AC-143).
4. No secrets are committed: the secret scan passes and `.env.example` holds placeholders only.
5. Every command used appears in the README.
6. The work is committed in small Conventional Commits. A journal entry records the timestamps, tool and model, commands run with their results, and the commit hashes.
7. No database migration, business logic or endpoint is included. Those belong to M2 and M3.

**Depends on:** K-101 decisions.
