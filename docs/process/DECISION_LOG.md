# Decision Log

This file is the chronological index of every decision series, plus the **process decisions** (PD-n) that aren't recorded anywhere else. Product and design decisions keep their authoritative text in the documents listed below; this file doesn't repeat them.

## 1. Where decisions are recorded

| Series | Content | Authoritative record |
|---|---|---|
| Q1 to Q10 | Stakeholder answers to the initial clarification questions | [REQUIREMENTS.md §13](../../REQUIREMENTS.md#13-decision-log) |
| R1 to R60 | Review-round decisions (rounds 1 to 17) | [REQUIREMENTS.md §13](../../REQUIREMENTS.md#13-decision-log) |
| ADR-001 to ADR-021 | Architecture decisions (7 approved, 14 proposed) | [docs/adr/README.md](../adr/README.md) |
| D-1 to D-17 | Database-design decisions | [DATABASE_DESIGN.md §1](../database/DATABASE_DESIGN.md#1-decision-register) |
| API-D1 to API-D10 | API-design decisions | [API_DESIGN.md §1](../api/API_DESIGN.md#1-decisions) |
| PD-1 onward | Process decisions | This file, §3 |

## 2. Design phase (historical, before version control)

These decisions were made in one Claude Code session before Git existed. The only timestamp evidence is that session's local transcript, which runs from **2026-10-09 08:58:55 UTC to 2026-10-11 09:35 UTC** ([AI_USAGE.md](AI_USAGE.md) §4). Individual decisions are listed **in order, without timestamps**, because the order is supported by the documents but per-decision times are not recorded in them.

| Order | Phase | Decisions | Outcome |
|---|---|---|---|
| 1 | Requirements clarification | Q1 to Q10 | REQUIREMENTS.md created |
| 2 | Requirements review rounds 1 to 13 | R1 to R56 (including stack R51, locking R53, engineering standards R54, authentication R55, email provider R56) | Requirements v1.0 to v1.4 |
| 3 | Documentation cleanup and link transport | R57 (v1.4.1), R58 / ADR-011 (v1.5) | |
| 4 | Phase 1 architecture | ADR-002, 011, 012, 013, 021 approved; PostgreSQL 18 directive | docs/architecture, docs/adr |
| 5 | Database design | D-1 to D-16; R59 (v1.6) | docs/database |
| 6 | API design | API-D1 to API-D10; ADR-010, ADR-017 | docs/api |
| 7 | API alignment | R60 (v1.7); D-17 | Applied in session S-01, commit `3fe9cb7` |

The design documents first entered version control in commit `da80a85`, on 2026-10-11 at 13:35:25 +04:00.

## 3. Process decisions

| ID | Date and time (+04:00) | Decision | Decided by | Rationale |
|---|---|---|---|---|
| PD-1 | 2026-10-11 (S-01) | Kanban with milestones M0 to M6 and a 25% contingency buffer | Stakeholder | Assignment methodology |
| PD-2 | 2026-10-11 13:35:25 | Initialize Git locally on branch `main`; commit the existing documentation **unchanged** as the baseline before any further edit | Stakeholder instruction, executed in S-01 | Separates the pre-Git design output from new work |
| PD-3 | 2026-10-11 (S-01) | Conventional Commits; small, genuine commits; never backdate or split finished work artificially; AI-assisted commits carry a `Co-Authored-By` trailer naming the model | Stakeholder and agent | Transparency of AI assistance |
| PD-4 | 2026-10-11 13:35 | Use the developer's existing global Git identity (`David Malkhasyan`). The email address in it becomes public once pushed. | Existing configuration | No invented identity |
| PD-5 | 2026-10-11 13:35 | No `.gitattributes`, `.gitignore` or other configuration files yet. They're deferred to project initialization (K-102), because this task excluded configuration files. Consequence: Git line-ending warnings (the system Git configuration has `core.autocrlf=true`). | Agent, within instructions | Respect the task boundary |
| PD-6 | 2026-10-11 (S-01) | The documentation checks are ad-hoc Python scripts kept **outside** the repository, using `openapi-spec-validator` 0.7.1 and PyYAML 6.0.2 installed in a temporary folder. They will be versioned in M1 (K-104). | Agent | No code allowed in this task; the checks must still be reproducible later |
| PD-7 | 2026-10-11 (S-01) | The raw agent-session transcript is **not** published. The development journal, this decision log and the prompt summaries in AI_USAGE.md replace it. | Agent, per stakeholder rules | The transcript contains the whole private conversation and local environment details |
| PD-8 | Restated 2026-10-11 | PostgreSQL is the only stateful dependency. Redis is deferred until performance tests show a need. No speculative infrastructure. | Stakeholder (R51) | Simplicity for one developer |
| PD-9 | 2026-10-11 (S-01) | No GitHub repository is created by the agent. The owner creates it and the steps are documented (SUBMISSION_CHECKLIST §3). | Agent, per stakeholder rules | Account, name and visibility are the owner's decisions |
| PD-10 | 2026-10-11 14:02 (S-02) | Node.js 24.21.0 (Active LTS) and pnpm 12.11.2 workspaces, pinned in `package.json`. Resolves PD-Q2 and PD-Q3. | Stakeholder (approved stack); versions chosen by the agent | Matches the approved stack; pnpm suits the monorepo |
| PD-11 | 2026-10-11 14:05:57 | Pin TypeScript 6.0.3 instead of 7.0, and `@types/node` ^24 | Agent | `typescript-eslint` supports TypeScript below 6.1 only. The types match the runtime's major version. |
| PD-12 | 2026-10-11 14:03:57 | **Resolves PD-Q6.** No container runtime is available, so: portable PostgreSQL 18.6 binaries in the user profile; integration tests use a dedicated local `ers_test` database (schema recreated per run); CI uses a `postgres:18` service container. This deviates from ENG-TST-2 (Testcontainers). | Agent, within the stakeholder's "real PostgreSQL" requirement | Real PostgreSQL without admin rights or Docker; recorded in ASSIGNMENT_SCOPE §4 |
| PD-13 | 2026-10-11 14:11 | In-repository migration runner: ordered SQL files, checksums, advisory lock, schema-version check at start-up, owner and runtime roles. This implements ADR-018's recommendation; the ADR document's status is unchanged. | Agent | Smallest tool that meets MIGRATIONS_STRATEGY |
| PD-14 | 2026-10-11 16:31 | **Resolves PD-Q4.** CI on GitHub Actions: format, lint, typecheck, migrate, test, build and E2E against a `postgres:18` service. Dependency and secret scanning in CI are not configured yet (K-105). | Stakeholder (approved stack) | The repository will live on GitHub |
| PD-15 | 2026-10-11 (S-02) | **Final delivery strategy:** P0 is mandatory; P1 only after P0 passes; P2 is deferred. A focused schema (16 tables) and API (24 routes) instead of the full design. [ASSIGNMENT_SCOPE.md](../../ASSIGNMENT_SCOPE.md) is the delivery scope and traceability matrix; REQUIREMENTS.md stays unchanged and authoritative. | Stakeholder | Deadline of 5 calendar days with limited supervision |
| PD-16 | 2026-10-11 14:10:46 | Decision time comes from an application helper that reads `clock_timestamp()` after the lock, plus a test-only offset (refused unless `NODE_ENV=test`). It replaces the database function FN-01. Due-work queries use the same helper. | Agent | Same semantics as D-1, with fewer moving parts; the tests can move the clock deterministically |
| PD-17 | 2026-10-11 14:16:50 | English user interface and emails | Agent (assumption) | OQ-8 is still open; English is the language of the requirements. Recorded as an assumption, not a resolution. |
| PD-18 | 2026-10-11 (S-02) | Registration keeps email verification (confirm link) inside P0, although the delivery plan lists "email verification" under P1 | Agent, per REQUIREMENTS Q1 | REQUIREMENTS makes verification the registration mechanism; removing it would silently weaken an approved requirement |
| PD-19 | 2026-10-11 16:22:06 | The public link pages render without React StrictMode | Agent | StrictMode's doubled effects resolved a sign-in link twice and set two different pre-session cookies |
| PD-20 | 2026-10-11 16:33 | E2E tests run against real processes (built client served by the web process, separate worker) on the test database. Locally they use the installed Edge (`PW_CHANNEL=msedge`); CI installs Chromium. | Agent | Tests what is shipped; avoids a browser download on the development machine |
| PD-21 | 2026-10-11 16:15:58 | Work written from 14:04 to 16:15 was committed as three logical commits in one command, so they share the timestamp 16:15:59. They were not split further or backdated. | Agent | PD-3 forbids artificial splitting and backdating; the journal records when the work was actually done |
| PD-22 | 2026-10-11 17:03 (S-03) | Publish the unchanged history to the **public** repository `DavidMalkhasyan/event-registration-system`, chosen by the owner. The author email stays as committed (PD-4), and no history is rewritten. | Stakeholder (repository, instruction); agent (checks) | Genuine history is required; the email is the owner's own address and was noted in PD-4 |
| PD-23 | 2026-10-11 17:06 (S-03) | Clean-clone verification on the development machine, in a new directory, with a **new** PostgreSQL cluster on the README's default port, sharing nothing with the original working directory except the installed Node.js and PostgreSQL binaries and pnpm's package cache | Agent | No second machine is available; this still exercises every README step from a fresh checkout |
| PD-24 | 2026-10-11 17:14 (S-03) | Leave the GitHub Actions versions (v4) unchanged during verification despite the Node.js 20 deprecation warning; recorded as a known limitation | Agent | The warning isn't a failure. Changing CI during final verification adds risk without changing results. |
| PD-25 | 2026-10-11 17:37 (S-04) | P1 work happens on feature branches. `main` stays at the verified submission state until a branch passes CI on a pull request and the owner merges it. | Stakeholder ("protect the submission-ready main branch"); agent (procedure) | The submission must never be left broken by unfinished P1 work |
| PD-26 | 2026-10-11 17:37 (S-04) | At the cutoff, the verification tokens of expired registrations are **not** revoked. Their links are already rejected: the token window ends at the cutoff (FR-REG-3), and only `PENDING_VERIFICATION` can be confirmed. `access_tokens` has no revoke reason for this case, and a schema change would add nothing. | Agent | Same observable behavior (the generic invalid-link response is tested) with no schema change |
| PD-27 | 2026-10-11 17:38 (S-04) | The cutoff task sends no "waiting list closed" email if it runs after the event has started (for example, after a long worker outage), and the message's retry horizon is the Start. Pending registrations are still expired. | Agent | An email saying registration has closed is pointless after the start; it matches FR-NTF-5 for reminders. TX-J03 is silent on this case. |
| PD-28 | 2026-10-11 17:39 (S-04) | Migration `0003_cutoff_tasks` backfills cutoff tasks for existing `SCHEDULED` events, so events created before K-404b are processed too | Agent | Upgrading a running installation must not skip the cutoff for its existing events |
| PD-29 | 2026-10-11 17:49 (S-05) | **Branching strategy:** `main` holds stable, submission-ready releases only. `dev` is the integration branch, created from the verified `origin/main` (`8c1247d`). `feature/*` branches hold individual Kanban cards and `fix/*` branches hold isolated bug fixes. Every feature or fix reaches `dev` through a pull request whose GitHub Actions run must pass, merged with a merge commit (no squash, rebase or force-push). Feature branches keep no upstream to `dev`, so a plain push can't land on it. `dev` reaches `main` only by a separate decision of the stakeholder. Replaces PD-25's interim rule. | Stakeholder | Keeps the verified submission stable while P1 work continues; every integration is checked by CI |
| PD-30 | 2026-10-11 17:49 (S-05) | Database safety across branches: the development database follows `dev` (schema version 3 after K-404b). Code from an older branch is never run against it, and there are no downgrades. Verifying older code would use a separate database or work tree. | Stakeholder | The schema-version check refuses mismatched code by design; data must not be lost to switch branches |
| PD-31 | 2026-10-11 18:29 (S-06) | Editing an event description to an empty string stores no description (`null`), as the creation form already does. Unknown fields in `EventDetailsPatch` are rejected (`422`), so the details endpoint can never change the schedule, time zone or capacity. | Agent | Consistent with creation; the OpenAPI schema has `additionalProperties: false` |

## 4. Open decisions

Updated in S-02. Resolved items keep their row, with the resolving decision.

| ID | Question | Status |
|---|---|---|
| PD-Q1 | Submission deadline | **Resolved:** the stakeholder stated 5 calendar days remaining at the start of S-02 (2026-10-11). The exact date was not stated. |
| PD-Q2 | Node.js version | **Resolved:** PD-10 |
| PD-Q3 | Package manager | **Resolved:** PD-10 |
| PD-Q4 | CI platform | **Resolved:** PD-14. Scanning tools are still open (K-105). |
| PD-Q5 | GitHub repository name, account, visibility and licence | **Resolved** (S-03): the owner provided `DavidMalkhasyan/event-registration-system`, public (PD-22). No licence file has been added; that is the owner's decision. |
| PD-Q6 | Container runtime for Testcontainers | **Resolved:** PD-12 (no container runtime; local PostgreSQL) |
| ADR-018 | Migration tool | Implemented as recommended (PD-13); the ADR text was not edited |
| ADR-003, 016, 019, 020 | Typed transactions, time handling, test architecture, configuration | Still **Proposed**; the ADR documents were not edited. What was built: ADR-003, lock helpers with retries but no test-mode lock recorder. ADR-016, Luxon with an injected test clock offset. ADR-019, Vitest, Playwright and the fake provider, with local PostgreSQL instead of Testcontainers (PD-12). ADR-020, zod fail-fast configuration. |
| OQ-8 | Language of the UI and emails | **Open.** English is assumed (PD-17). |
