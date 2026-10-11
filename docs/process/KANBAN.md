# Kanban Board

| | |
|---|---|
| **Columns** | Backlog → To Do → In Progress → Review → Done, plus **Deferred** for extended scope that was intentionally not built |
| **Work-in-progress limits** | In Progress ≤ 2, Review ≤ 3 |
| **Last updated** | 2026-10-11, session S-02 (exact times in [DEVELOPMENT_JOURNAL.md](DEVELOPMENT_JOURNAL.md)) |
| **Scope** | Re-planned in S-02 by the final delivery strategy (PD-15): P0 is mandatory, then P1, with P2 deferred. Requirement-level status is in [ASSIGNMENT_SCOPE.md](../../ASSIGNMENT_SCOPE.md). |

## Rules

1. **Card ID:** `K-<milestone><nn>`, for example K-102 is milestone 1, card 02.
2. **Every card links** to its milestone's Definition of Done in [MILESTONES.md](MILESTONES.md), plus any card-specific criteria.
3. **Moves are recorded:** a card moves only during a journal session, and the journal entry records the move.
4. **"Review"** means the work is finished on our side and awaits verification by the stakeholder or by CI.
5. **"Done"** requires the Definition of Done to be satisfied, with evidence (commit hash, test output). A card is never marked Done on intent. A card done with **reduced scope** says so and names what was left out.
6. **Blocked cards** stay in their column, marked **BLOCKED** with the reason.

## Done

| Card | Milestone | Evidence |
|---|---|---|
| K-002 Initialize local Git on `main`; commit the documentation baseline unchanged | M0 | Commit `da80a85` |
| K-003 Secret and personal-data scan of the baseline before the first commit | M0 | Journal S-01 |
| K-101 Toolchain decisions | M1 | PD-10 to PD-14 (S-02) |
| K-102 Project initialization | M1 | `e9545fa`, `9b40caf`. Strict TypeScript; ESLint and Prettier; the layering rule was proven with a temporary violating file; fail-fast configuration (AC-143 checked: the variable is named and the process exits 1); `.env.example` (`d6fec3a`). **Difference from the plan:** it was delivered together with M2 and M3 work, not as an isolated card. |
| K-201 Migration runner | M2 | `f458591`. Checksums, advisory lock, schema-version check. |
| K-202 Migrations, **reduced scope** | M2 | `f458591`, `2a4f722`: `0001_core` and `0002_reminders`, 16 tables. The other tables are deferred (ASSIGNMENT_SCOPE §4). |
| K-203 Database test harness, **with deviation** | M2 | `34c98ec`: real PostgreSQL 18.6 test database instead of Testcontainers (PD-12) |
| K-301 Platform layer | M3 | `2a4f722`. Configuration, transactions and event locks with retries, decision time, Problem Details errors, HTTP plumbing, rate limiting. |
| K-302 Identity, **reduced scope** | M3 | `2a4f722`: passwordless sign-in, sessions, CSRF, pre-session. Re-authentication and email change are deferred. |
| K-303 Access tokens and link resolution | M3 | `2a4f722`; test "byte-identical generic response" |
| K-305 Registration, verification, waiting list, promotion, participant cancellation | M3 | `2a4f722`, `34c98ec`: `registration` and `lifecycle` tests (P0 #2 to #6) |
| K-307 Concurrency suites | M3 | `34c98ec`: 12-way last-seat race, double confirm, two simultaneous cancellations, 10 parallel scans, parallel reminder runs |
| K-407 Reporting: dashboard, participants, SSE | M4 | `2a4f722`, `34c98ec`: `live` test with two SSE clients; dashboard test |
| K-501 Client workspace, **reduced scope** | M5 | `cc5bcbc`: two HTML entries (public and organizer; no staff entry), fragment bootstrap with 3 unit tests, security headers |
| K-502 Public and link pages | M5 | `cc5bcbc`; E2E `participant-flow` (`b7a164f`) |
| K-503 Organizer area, **reduced scope** | M5 | `cc5bcbc`: sign-in, events, creation, dashboard, reschedule. E2E `b7a164f`. |
| K-505 Playwright suites, **reduced scope** | M5 | `b7a164f`: 4 tests, including two simultaneous clients. 4/4 passed in 3 runs; a mutation check proved the live-count test fails when the feature breaks. |

## Review

| Card | Milestone | Awaiting |
|---|---|---|
| K-001 Apply R60; synchronize the documents | M0 | Stakeholder check (commit `3fe9cb7`) |
| K-004 Process documentation | M0 | Stakeholder review |
| K-103 CI pipeline | M1 | First run on GitHub; it can't run before the remote exists (K-005). Workflow commits `d6fec3a` and `b7a164f`; the same scripts pass locally. The AC-140 deliberate-failure check is not done. |
| K-601 README | M6 | Following the setup from a clean clone on another machine |

## In Progress

| Card | Milestone | State |
|---|---|---|
| K-603 Final AI usage, journal, attribution, current state, incomplete work | M6 | Updated in S-02; to be finalized at submission |

## To Do

| Card | Milestone | Notes |
|---|---|---|
| K-005 Create the GitHub repository; add the remote; push `main` after a final secret scan | M0 | **BLOCKED**: needs the owner's account, repository name and visibility (PD-Q5). Steps in [SUBMISSION_CHECKLIST.md](SUBMISSION_CHECKLIST.md) §3. |
| K-604 Final secret scan; release tag; submission | M6 | After K-005 |
| K-404b Registration cutoff job: expire pending registrations; "waiting list closed" email | M4 | Highest-priority P1 item. Reminder fan-out (K-404a) is done. |

## Partly done (remaining parts are in Backlog or Deferred)

| Card | Done | Remaining |
|---|---|---|
| K-304 Event lifecycle | Idempotent create; reschedule with notification (P0 #1, #14) | Edit, capacity change, cancel, delete |
| K-306 Check-in | Check-in with replay, window and outcomes (P0 #9, #10) | Undo |
| K-401 Messaging | Outbox claim, fenced send, reaper, sweeps, pre-claim counter | Budget, pause, render-time re-check |
| K-403 Notifications | 9 of 17 message types | The rest, with their features |
| K-404 Jobs | Reminder fan-out (P0 #13) | Cutoff job (K-404b) |
| K-408 Email providers | Fake provider | Resend adapter (P2) |
| K-504 Scanner and live count | Owner check-in screen with live count | Staff scanner (P1) |

## Backlog

| Card | Milestone |
|---|---|
| K-104 Version the documentation checks and run them in CI | M1 |
| K-105 Dependency and secret scanning in CI | M1 |
| K-204 Constraint and trigger violation tests (every CK, U, FK, TR) | M2 |
| K-206 Kysely type generation with a drift check | M2 |
| K-602 AC-169 pipeline test; AC-135 (b) stress test | M6 |

## Deferred (extended scope, not built)

| Card | Priority |
|---|---|
| K-205 `migrate budget-sync` | P2 |
| K-402 Webhooks, provider-event log, delivery facts | P2 |
| K-405 Participant portal: resend, rotation | P1 |
| K-406 Staff invitations and sessions | P1 |
