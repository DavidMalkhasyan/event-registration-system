# Kanban Board

| | |
|---|---|
| **Columns** | Backlog → To Do → In Progress → Review → Done, plus **Deferred** for extended scope that was intentionally not built |
| **Work-in-progress limits** | In Progress ≤ 2, Review ≤ 3 |
| **Last updated** | 2026-10-12, session S-11 (exact times in [DEVELOPMENT_JOURNAL.md](DEVELOPMENT_JOURNAL.md)) |
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
| K-302 Identity, **reduced scope** | M3 | `2a4f722`: passwordless sign-in, sessions, CSRF, pre-session. Re-authentication: K-302b. Email change (FR-ORG-6) stays deferred. |
| K-303 Access tokens and link resolution | M3 | `2a4f722`; test "byte-identical generic response" |
| K-305 Registration, verification, waiting list, promotion, participant cancellation | M3 | `2a4f722`, `34c98ec`: `registration` and `lifecycle` tests (P0 #2 to #6) |
| K-307 Concurrency suites | M3 | `34c98ec`: 12-way last-seat race, double confirm, two simultaneous cancellations, 10 parallel scans, parallel reminder runs |
| K-407 Reporting: dashboard, participants, SSE | M4 | `2a4f722`, `34c98ec`: `live` test with two SSE clients; dashboard test |
| K-501 Client workspace, **reduced scope** | M5 | `cc5bcbc`: two HTML entries (public and organizer; no staff entry), fragment bootstrap with 3 unit tests, security headers |
| K-502 Public and link pages | M5 | `cc5bcbc`; E2E `participant-flow` (`b7a164f`) |
| K-503 Organizer area, **reduced scope** | M5 | `cc5bcbc`: sign-in, events, creation, dashboard, reschedule. E2E `b7a164f`. |
| K-005 Create the GitHub repository; add the remote; push `main` after a final secret scan | M0 | S-03: full-history scan clean; pushed 17:03:42 to https://github.com/DavidMalkhasyan/event-registration-system (`c45ecaf`) |
| K-103 CI pipeline | M1 | S-03: GitHub Actions runs [38141682841](https://github.com/DavidMalkhasyan/event-registration-system/actions/runs/38141682841) and [38142263115](https://github.com/DavidMalkhasyan/event-registration-system/actions/runs/38142263115) passed. The AC-140 deliberate-failure check was not done; an equivalent mutation check exists for the E2E live-count test (S-02). |
| K-601 README | M6 | S-03: followed from a clean clone with a new PostgreSQL cluster; two gaps found and fixed (`67346ac`) |
| K-404b Registration cutoff job (F8, TX-J03, FR-WL-5, FR-NTF-4, D-3) | M4 | `d25d3dd`, `2d78ca5`; [PR #1](https://github.com/DavidMalkhasyan/event-registration-system/pull/1) into `dev`; CI [run 38144704826](https://github.com/DavidMalkhasyan/event-registration-system/actions/runs/38144704826) passed (3 migrations on a fresh database; 27/27, 3/3, 4/4); merged 2026-10-11 17:51:34 as `5818fb4`. Not in `main` (PD-29). |
| K-304a Capacity change (FR-EVT-7, FR-EVT-8, TX-E03, AC-13 to AC-15) | M3 | `f6024e3`, `c4f5733`, `3c73c23`; [PR #2](https://github.com/DavidMalkhasyan/event-registration-system/pull/2) into `dev`; CI runs [38145423055](https://github.com/DavidMalkhasyan/event-registration-system/actions/runs/38145423055) and [38145629926](https://github.com/DavidMalkhasyan/event-registration-system/actions/runs/38145629926) passed (35/35, 3/3, 5/5); merged 2026-10-11 18:27:23 as `0a811bb`. Not in `main`. |
| K-304b Title and description edit (FR-EVT-5, TX-E02, AC-105) | M3 | `19ff849`, `b8ffae1`, `c2280d1`; [PR #3](https://github.com/DavidMalkhasyan/event-registration-system/pull/3) into `dev`; CI runs [38147918146](https://github.com/DavidMalkhasyan/event-registration-system/actions/runs/38147918146) and [38148193367](https://github.com/DavidMalkhasyan/event-registration-system/actions/runs/38148193367) passed (41/41, 3/3, 6/6); merged 2026-10-11 18:43:42 as `a99c44d`. Not in `main`. |
| K-302b Re-authentication (FR-ORG-5, AC-149, ADR-010 §8) | M3 | `c866ae0`, `70eb8da`, `adde442`, `55943cc`; [PR #4](https://github.com/DavidMalkhasyan/event-registration-system/pull/4) into `dev`; CI runs [38153782544](https://github.com/DavidMalkhasyan/event-registration-system/actions/runs/38153782544) and [38154065724](https://github.com/DavidMalkhasyan/event-registration-system/actions/runs/38154065724) passed (53/53, 5/5, 7/7); merged 2026-10-11 20:08:54 as `88399fd`. Not in `main`. |
| K-304c Event cancellation (FR-EVT-9, BR-16, BR-23, TX-E05, AC-18, AC-19, AC-59; D1–D7) | M3 | `b3379f5`, `7575432`, `44b453e`, `754621c`; [PR #5](https://github.com/DavidMalkhasyan/event-registration-system/pull/5) into `dev`; CI runs [38162451724](https://github.com/DavidMalkhasyan/event-registration-system/actions/runs/38162451724) and [38162851806](https://github.com/DavidMalkhasyan/event-registration-system/actions/runs/38162851806) passed (73/73, 5/5, 9/9); merged 2026-10-11 22:15:17 as `fef8a81`. Not in `main`. |
| K-304d Event deletion (FR-EVT-10, 11, 13, 14; TX-E06; API #37, #38) | M3 | `13ba1eb`, `17d85f4`, `39f1159`, `e235112`; [PR #6](https://github.com/DavidMalkhasyan/event-registration-system/pull/6) into `dev`; CI runs [38164273828](https://github.com/DavidMalkhasyan/event-registration-system/actions/runs/38164273828) and [38164505147](https://github.com/DavidMalkhasyan/event-registration-system/actions/runs/38164505147) passed (4 migrations; 83/83, 5/5, 12/12); merged 2026-10-11 22:39:04 as `d90062e`. Not in `main`. |
| K-405 Participant self-service: ticket resend, share links, management and share rotation (FR-SELF-4, FR-SHR-1, FR-ROT-1 to FR-ROT-11; TX-P01 to TX-P03) | M4 | `c1ba465`, `da1ee09`, `704c241`, `8567170`; [PR #7](https://github.com/DavidMalkhasyan/event-registration-system/pull/7) into `dev`; CI runs [38174098814](https://github.com/DavidMalkhasyan/event-registration-system/actions/runs/38174098814) and [38174318350](https://github.com/DavidMalkhasyan/event-registration-system/actions/runs/38174318350) passed (5 migrations; 99/99, 6/6, 14/14); merged 2026-10-12 00:59:52 as `35d9213`. Not in `main`. |
| K-406 Staff invitations and sessions (FR-STAFF-1 to FR-STAFF-7; TX-S01 to TX-S03; API #14 to #16, #41, #42, #45 to #50), including the K-304c dependency | M4 | `bf73afd`, `c6437d6`, `465acbf`, `7ebecf6`; [PR #8](https://github.com/DavidMalkhasyan/event-registration-system/pull/8) into `dev`; CI runs [38176421220](https://github.com/DavidMalkhasyan/event-registration-system/actions/runs/38176421220) and [38176668486](https://github.com/DavidMalkhasyan/event-registration-system/actions/runs/38176668486) passed (6 migrations; 110/110, 6/6, 15/15); merged 2026-10-12 01:33:57 as `f547477`. Not in `main`. AC-186 (c) is not covered by an automated test. |
| K-306 Check-in undo (FR-CHK-8, BR-7, TX-C02, API #44; AC-26, AC-27, AC-54) | M4 | `710b9bd`, `f5d4b34`, `4a598ac`, `9e83ed1`; [PR #9](https://github.com/DavidMalkhasyan/event-registration-system/pull/9) into `dev`; CI run [38212459702](https://github.com/DavidMalkhasyan/event-registration-system/actions/runs/38212459702) passed (6 migrations; 119/119, 6/6, 16/16); merged 2026-10-12 10:29:00 as `2efd8f1`. Not in `main`. |
| K-305b Waiting-list removal by the owner (FR-WL-10 to FR-WL-14, FR-NTF-14, BR-23, BR-24, BR-27, TX-W01, API #43; AC-76 to AC-79, AC-90 to AC-92) | M3 | `9b59de4`, `a38a313`, `4e7ccc8`, `3065378`; [PR #10](https://github.com/DavidMalkhasyan/event-registration-system/pull/10) into `dev`; CI run [38215349977](https://github.com/DavidMalkhasyan/event-registration-system/actions/runs/38215349977) passed (7 migrations; 130/130, 6/6, 17/17); merged 2026-10-12 11:03:50 as `d219576`. Not in `main`. |
| K-506 UI implementation inventory before a redesign (no visual change) | M5 | `b457bfa`, `16a4800`; [PR #11](https://github.com/DavidMalkhasyan/event-registration-system/pull/11) into `dev`; CI run [38215945495](https://github.com/DavidMalkhasyan/event-registration-system/actions/runs/38215945495) passed (7 migrations; 130/130, 6/6, 17/17); merged 2026-10-12 11:10:21 as `dd23b93`. Documentation only. |
| K-505 Playwright suites, **reduced scope** | M5 | `b7a164f`: 4 tests, including two simultaneous clients. 4/4 passed in 3 runs; a mutation check proved the live-count test fails when the feature breaks. |

## Review

| Card | Milestone | Awaiting |
|---|---|---|
| K-001 Apply R60; synchronize the documents | M0 | Stakeholder check (commit `3fe9cb7`) |
| K-004 Process documentation | M0 | Stakeholder review |

## In Progress

| Card | Milestone | State |
|---|---|---|
| K-507 UI redesign to the approved v0 design ([eventflow-v0-design](https://github.com/DavidMalkhasyan/eventflow-v0-design)), with the K-504 remainder (dedicated staff entry) | M5 | S-13: design system, organizer area (global overview, All events, creation, event workspace), shared check-in and the dedicated staff entry done on `feature/ui-redesign` (first pull request); participant and link pages next. Decisions PD-65 to PD-71 |
| K-603 Final AI usage, journal, attribution, current state, incomplete work | M6 | Updated in S-07 |

## To Do

| Card | Milestone | Notes |
|---|---|---|
| K-604 Release tag and submission | M6 | The secret scan was done in S-03. Tagging and submitting are the owner's actions. |

## Partly done (remaining parts are in Backlog or Deferred)

| Card | Done | Remaining |
|---|---|---|
| K-304 Event lifecycle | Create, reschedule (P0); capacity (K-304a), details (K-304b), cancellation (K-304c), deletion (K-304d), all done in `dev` | — |
| K-401 Messaging | Outbox claim, fenced send, reaper, sweeps, pre-claim counter | Budget, pause, render-time re-check |
| K-403 Notifications | 15 of 17 message types (checked against `HANDLERS` in `notifications/handlers.ts` on 2026-10-12) | `email_change_confirmation` and `email_change_notice`, which belong to the deferred email change (FR-ORG-6) |
| K-404 Jobs | Reminder fan-out (P0 #13); cutoff job (K-404b, done in `dev`) | — |
| K-408 Email providers | Fake provider | Resend adapter (P2) |
| K-504 Scanner and live count | Owner check-in with live count; dedicated staff entry `staff.html` at `/staff` with the shared check-in panel (K-507, PD-69) | — (closed with the K-507 merge) |

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
