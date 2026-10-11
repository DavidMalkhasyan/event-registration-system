# Milestones

| | |
|---|---|
| **Method** | Kanban with milestones M0 to M6 and a **25% contingency** buffer ([KANBAN.md](KANBAN.md)) |
| **Requirements baseline** | [REQUIREMENTS.md](../../REQUIREMENTS.md) v1.7 (authoritative) |
| **Architecture constraints** | Modular monolith; PostgreSQL 18 is the only stateful dependency; **Redis stays deferred** until performance tests show a need (R51); no speculative infrastructure |
| **Created** | 2026-10-11 13:39 +04:00 (session S-01, [DEVELOPMENT_JOURNAL.md](DEVELOPMENT_JOURNAL.md)) |

**About the estimates:** they are in **focused working hours** for one developer working with an AI coding agent, and they are planning estimates, not commitments. No calendar dates are set yet, because the submission deadline hasn't been confirmed (open decision PD-Q1 in [DECISION_LOG.md](DECISION_LOG.md)). Actual hours are recorded per session in the journal.

## 1. Summary

**Update, 2026-10-11 (S-02):** the stakeholder's final delivery strategy (PD-15) replaced the full-scope plan with P0 / P1 / P2 priorities. The hour estimates below assumed the full design and human-paced work. The P0 scope was implemented and tested in one session that ran from 14:02 to about 16:45, including an interval of 1 h 53 min with no recorded tool activity (journal S-02), with a narrower scope than these milestones describe. The estimates are kept unchanged as the original plan; they are not a record of effort.

| Milestone | Base estimate | Depends on | Status |
|---|---:|---|---|
| M0 Documentation alignment, Git initialization, process tracking | 6 h | — | **Done** except the stakeholder review of K-001 and K-004; published in S-03 |
| M1 Project foundation and CI | 16 h | M0; decisions PD-Q2 to PD-Q5 | **Mostly done** (S-02); CI awaits its first GitHub run |
| M2 PostgreSQL migrations and database tests | 28 h | M1; container runtime; Proposed ADR-018 | **Done with reduced scope** (S-02): 2 migrations, 16 tables, local PostgreSQL instead of Testcontainers |
| M3 Core backend functionality | 56 h | M2; Proposed ADR-003, ADR-016 | **P0 parts done** (S-02); edit, cancel and delete event and check-in undo are deferred |
| M4 Remaining backend functionality and integrations | 48 h | M3; Proposed ADR-005 to ADR-009, ADR-014, ADR-015 | **P0 parts done** (reminders, live count, fake provider); the rest is P1/P2 |
| M5 Frontend and end-to-end integration | 44 h | M3, M4 (APIs); OQ-8 for user-facing text | **P0 parts done** (S-02); 4 E2E tests |
| M6 Testing, documentation and final submission | 20 h | M1 to M5 | **Done** (S-03): published, CI green, clean-clone verified; submission is the owner's action |
| **Base total** | **218 h** | | |
| **Contingency (25% of base)** | **55 h** | Not assigned to any milestone; drawn down only through a journal entry that names the cause | Unused |
| **Planned total** | **273 h** | | |

**Contingency rule:** when a milestone overruns its estimate, the overrun is booked against the contingency and recorded in the journal with its cause. If more than half the contingency is used before M5 starts, scope is re-planned with the stakeholder (§9). Scope is never cut silently.

## 2. M0: Documentation alignment, Git initialization and process tracking

| Item | Content |
|---|---|
| **Scope** | Apply R60; synchronize the design documents; initialize local Git with a baseline; process documentation; GitHub remote setup instructions |
| **Deliverables** | REQUIREMENTS.md v1.7; synchronized docs; commits `da80a85` (baseline) and `3fe9cb7` (R60); `docs/process/*` (six files); a pre-commit secret scan |
| **Dependencies** | None |
| **Estimate** | 6 h |
| **Risks** | Remote repository decisions (name, visibility, account) are outstanding; Windows line-ending warnings until `.gitattributes` is added in M1 |

**Definition of Done:**
- [x] R60 applied, version 1.7, status still "Proposed — awaiting stakeholder review".
- [x] Structural and traceability checks pass (journal S-01).
- [x] Local Git initialized on `main`, with the documentation committed unchanged as the baseline.
- [x] Process documents created.
- [ ] Stakeholder has reviewed the R60 text and the process documents.
- [ ] GitHub repository created by the owner, remote added, `main` pushed after a final secret scan (K-005).

## 3. M1: Project foundation and CI

| Item | Content |
|---|---|
| **Scope** | Repository skeleton matching MODULES.md §10 (`apps/server`, `apps/client`, `packages/contracts`, `migrations/`, `e2e/`), with **empty module boundaries only**; TypeScript strict; formatter and linter; Vitest; import-boundary rules (AC-144); configuration validation with a fail-fast `.env.example` (ENG-DOC-2); `.gitattributes`, `.gitignore`, `.editorconfig`; README skeleton; CI pipeline running format, lint, type-check, unit tests and build; documentation checks (OpenAPI validation, requirement-ID and traceability scripts) moved into the repository and run in CI; dependency and secret scanning |
| **Deliverables** | A buildable empty workspace; green CI; documented commands (ENG-CI-1) |
| **Dependencies** | M0; decisions PD-Q2 (Node version), PD-Q3 (package manager), PD-Q4 (CI platform = OQ-14), PD-Q5 (repository name and visibility); approval of Proposed ADR-019 and ADR-020 |
| **Estimate** | 16 h |
| **Risks** | OQ-14 still open; Windows/Linux differences; lint and import-boundary tooling setup time |

**Definition of Done:** ENG-CI-1 commands exist and pass locally and in CI; a deliberate failure in each required check fails the pipeline (AC-140); a missing required variable makes the process exit with its name only (AC-143); a secret scan runs in CI; the README lists every command and each command works (partial AC-142).

## 4. M2: PostgreSQL migrations and database tests

| Item | Content |
|---|---|
| **Scope** | Migration runner (ADR-018) with checksums, advisory lock and exact-version check; migrations `0001` to `0010` per MIGRATIONS_STRATEGY §6, including D-17; roles and privileges; Testcontainers with PostgreSQL 18; tests T-M1 to T-M10; a test for every CK, U and FK row and every trigger (TR-01 to TR-17), including AC-134's net-zero statement; the `migrate budget-sync` subcommand (D-15); Kysely type generation with a drift check |
| **Deliverables** | `migrations/*.sql`; migration and constraint test suites green in CI |
| **Dependencies** | M1; **a container runtime** (Docker is not installed on the current machine); approval of Proposed ADR-018 |
| **Estimate** | 28 h |
| **Risks** | No Docker locally (CI-only database tests would slow feedback); trigger and deferred-constraint subtleties; PostgreSQL 18 image availability in CI |

**Definition of Done:** AC-141 passes; T-M1 to T-M10 pass in CI; every constraint and trigger in CONSTRAINTS_AND_INDEXES.md has a passing violation test; regenerated types match the committed types; no migration is edited after it merges.

## 5. M3: Core backend functionality

| Item | Content |
|---|---|
| **Scope** | `platform` (configuration, transaction runner and lock helpers ADR-003, decision time, ADR-017 errors, redacting logger, HTTP plugins with ADR-010 anti-forgery and `Origin` checks, PostgreSQL rate limits); `identity` (sign-in, sessions, re-authentication, email change); `access-tokens`; `event-core` (create with idempotency, edit, capacity, reschedule, cancel, delete; registration, verification, waiting list, promotion, participant cancellation, check-in and undo); `audit`; the matching operations in `openapi.yaml`; outbox **enqueue only** |
| **Deliverables** | The web process serving the M3 operations; integration and concurrency suites |
| **Dependencies** | M2; approval of Proposed ADR-003 and ADR-016 |
| **Estimate** | 56 h |
| **Risks** | Size of the event-core rules; concurrency defects; time and DST handling |

**Definition of Done:** the M3 operations pass contract tests against `openapi.yaml`, and these [concurrency] criteria pass with forced orders:
- AC-4, AC-9, AC-14, AC-22, AC-65, AC-71, AC-72, AC-75, AC-78, AC-81, AC-88, AC-91;
- AC-133 (event paths), AC-134, AC-147, AC-150, AC-156, AC-157, AC-185.

In addition, ENG-TST-3 rollback tests exist for every multi-step transaction, and the AC-139 log-redaction suite passes.

## 6. M4: Remaining backend functionality and integrations

| Item | Content |
|---|---|
| **Scope** | `messaging` (outbox claim, send pipeline with `send_started_at` and the pre-claim counter, send budget, sending pause, webhooks, delivery facts, sweeps); `notifications` (17 message types, deterministic rendering, link issuance); `jobs` (reminder fan-out, cutoff); `participant-portal` (management view, resend, share links, rotation); `staff` (invitations, staff sessions); `reporting` (dashboard, participants, SSE); the worker process; the **fake provider**; the Resend adapter behind the §12.1a gate |
| **Deliverables** | The worker process; all 52 operations implemented |
| **Dependencies** | M3; approval of Proposed ADR-005 to ADR-009, ADR-014, ADR-015; OQ-8 for email texts |
| **Estimate** | 48 h |
| **Risks** | The complexity of the send state machine; a real Resend account needed for AC-164 (gated); email template wording waits on OQ-8 |

**Definition of Done:**
- These ACs pass with the fake provider: AC-17, AC-18, AC-28, AC-35, AC-98, AC-129, AC-135 (a), AC-136, AC-158 to AC-163, AC-165 to AC-168, AC-170, AC-171, AC-180 to AC-184, AC-186.
- CT-1 to CT-20 pass.
- AC-164 is either run with a real test account or recorded as "not run" with the reason.

## 7. M5: Frontend and end-to-end integration

| Item | Content |
|---|---|
| **Scope** | React and Vite with three entries (public, organizer, staff); the fragment-token bootstrap (ADR-011); link pages; registration; organizer sign-in, dashboard, events, participants, staff management; staff scanner (camera and manual entry); SSE client; CSP and security headers; basic accessibility |
| **Deliverables** | A working UI on the same origin; Playwright suites |
| **Dependencies** | M3 and M4 APIs; OQ-8 (UI language); choice of a QR-scanning library |
| **Estimate** | 44 h |
| **Risks** | Camera API differences on mobile; accessibility effort; time pressure |

**Definition of Done:** the ENG-TST-4 flows pass in CI; AC-24, AC-45, AC-51, AC-60 and AC-173 to AC-178 pass; an accessibility review against WCAG 2.2 AA is recorded with its findings (NFR-UX-1).

## 8. M6: Testing, documentation and final submission

| Item | Content |
|---|---|
| **Scope** | README (ENG-DOC-1), including setup, local run, deployment guidance and known limitations; the AC-169 pipeline test with the fake provider; AC-135 (b) stress test; final AI-usage, journal and decision-log updates; current state, incomplete work and next improvements; attribution; release tag; final secret scan |
| **Deliverables** | A repository ready for submission; a completed [SUBMISSION_CHECKLIST.md](SUBMISSION_CHECKLIST.md) |
| **Dependencies** | M1 to M5 |
| **Estimate** | 20 h |
| **Risks** | Documentation drifting from the code; work left over from earlier milestones |

**Definition of Done:** every mandatory item in SUBMISSION_CHECKLIST.md is "Done" with evidence; AC-142 passes in a clean CI job; the README's "current state" matches the code.

## 9. Mandatory functionality vs. optional improvements

| Category | Items |
|---|---|
| **Mandatory: assignment deliverables** | GitHub repository with the working project; AI model and tools with rationale; prompts and decision logs; real incremental commits and timestamped records; setup and deployment instructions; accurate current state; incomplete work and next improvements; attribution |
| **Mandatory: product scope** | The MVP defined by REQUIREMENTS.md v1.7 (§1.1, flows F1 to F13, and the acceptance criteria), demonstrated with the **fake email provider** |
| **Pre-production hardening** (needed before a real launch, not for a local demo) | AC-164 contract tests with a real Resend account; OQ-18 quota; the NFR-PERF-1 load test and PT-1 to PT-10 thresholds; AC-179 manual email-client check; hosting (OQ-2), backups, retention (OQ-5), limit values (OQ-9) |
| **Optional improvements** (outside the MVP) | Redis or caching (**deferred** until performance tests show a need); MFA (OQ-15); multi-device staff sessions (OQ-16); localization beyond the OQ-8 decision; SES or Postmark adapters; offline check-in (R30); ticket-transfer tracking (R20); event end time (OQ-1) |

**If the deadline can't cover the full MVP scope:** deciding which approved requirements to defer is a stakeholder decision. It will be raised with options, not made silently.

## 10. Overall risks

| Risk | Effect | Mitigation |
|---|---|---|
| Scope is large for one developer (full MVP plus strict concurrency testing) | Overrun | Contingency; early re-planning trigger (§1); prioritizing the core flows first |
| No container runtime locally | Slow database feedback in M2 to M4 | Install Docker Desktop or Podman, or run database tests in CI only (PD-Q6) |
| Open questions OQ-8 and OQ-14 | Block M1 and the UI or email texts | Decide before M1 (DECISION_LOG pending decisions) |
| Proposed ADRs not yet approved | Rework | Approve before each dependent milestone |
| AI-generated mistakes | Defects | Mechanical checks, tests first for invariants, human review of every merge |
