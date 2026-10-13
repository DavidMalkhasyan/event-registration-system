# Architecture Decision Index

Requirements baseline: [REQUIREMENTS.md](../../REQUIREMENTS.md) v1.7 (authoritative). Architecture: [ARCHITECTURE.md](../architecture/ARCHITECTURE.md), [MODULES.md](../architecture/MODULES.md).

**Status values:**
- **Approved** — decided by the stakeholder.
- **Approved in principle** — direction decided; details are still to be specified.
- **Proposed** — listed in the Phase 1 blueprint; the ADR is not yet written or approved.

Where a Proposed ADR would only *record* an already-approved requirement, the requirement itself stays binding. Only the ADR's additional design content is unapproved.

## 1. Architecture decision records

| ADR | Decision | Status | Requirement trace |
|---|---|---|---|
| 001 | Modular monolith; `web`, `worker` and `migrate` processes | Proposed (would record R51, which is approved) | R51, ENG-CI-6 |
| [002](ADR-002-event-core-consistency-boundary.md) | `event-core` is the single consistency boundary, organized into internal domains | **Approved** 2026-10-11 | NFR-CON-1 to NFR-CON-5, BR-1 to BR-18, BR-23 to BR-27, AC-133 to AC-135 |
| 003 | Locking protocol as typed transactions; retry wrapper; test-mode lock recorder | Proposed (protocol approved in NFR-CON-4, NFR-CON-6, NFR-CON-7; the type design is not) | NFR-CON-4, NFR-CON-6, NFR-CON-7, ENG-CQ-2, AC-144, AC-157 |
| 004 | Confirmed-count triggers and reconciliation | Proposed (would record NFR-CON-5, which is approved) | NFR-CON-5, AC-134 |
| 005 | Outbox, send state machine, key generations, regeneration classes; message-type handler port | Proposed (would record NFR-REL-13 and NFR-REL-16, which are approved) | NFR-REL-1 to NFR-REL-4, NFR-REL-9, NFR-REL-13, NFR-REL-16, AC-170 |
| 006 | Send budget and reserved concurrency in PostgreSQL | Proposed (would record NFR-REL-14, which is approved) | NFR-REL-12, NFR-REL-14, AC-153, AC-163 |
| 007 | Webhook intake, immutable event log, delivery facts | Proposed (would record NFR-REL-15 and NFR-REL-18, which are approved) | NFR-REL-15, NFR-REL-18, AC-160, AC-165, AC-166 |
| 008 | Email-provider port; Resend provisional; fallback adapters | Proposed (the provider choice is R56, gated by OQ-3) | R56, §12.1, §12.1a, OQ-3, OQ-19 |
| 009 | Scheduled-task engine in PostgreSQL | Proposed | NFR-CON-4 (e), NFR-REL-5, AC-28, AC-135 |
| [010](ADR-010-authentication-sessions-and-anti-forgery.md) | Passwordless authentication, sessions, re-authentication; session-bound HMAC anti-forgery tokens and a signed pre-session token | **Approved** 2026-10-11 (R55; API-D9) | R55, FR-ORG-1 to FR-ORG-8, FR-STAFF-2, NFR-SEC-8, AC-85, AC-147, AC-148 |
| [011](ADR-011-fragment-link-token-transport.md) | Fragment-based link-token transport | **Approved** 2026-10-11 (recorded as R58) | R58, FR-LNK-7 to FR-LNK-10, FR-ROT-5, FR-ROT-11, AC-173 to AC-179 |
| [012](ADR-012-single-access-tokens-table.md) | One `access_tokens` table; hash functions per D-6 | **Approved** 2026-10-11 (table approved in principle; specified by the approved database design; hash functions decided by D-6) | FR-LNK-1 to FR-LNK-7, NFR-SEC-1, BR-19, AC-61 |
| [013](ADR-013-same-origin-routing.md) | One public origin for the frontend entries and the API (routing, not deployment) | **Approved** 2026-10-11 | FR-ORG-4, FR-LNK-8, FR-LNK-10 (c), AC-177, OQ-2 |
| 014 | Live counts: SSE plus `LISTEN/NOTIFY`, re-fetch on reconnect | Proposed (would record R51 (5) and FR-DSH-3, which are approved) | R51, FR-DSH-2, FR-DSH-3, NFR-PERF-2, AC-25, AC-112 |
| 015 | Rate limiting in PostgreSQL | Proposed (limit values open: OQ-9) | NFR-SEC-3, FR-LNK-7, FR-ROT-8, FR-SELF-4, FR-CHK-9, OQ-9 |
| 016 | Time handling: UTC storage, IANA zones, injected clock, DST rules | Proposed (would record NFR-TIME, which is approved; library not chosen) | NFR-TIME-1 to NFR-TIME-3, FR-EVT-2, FR-EVT-3, ENG-TST-6 |
| [017](ADR-017-error-model-and-problem-details.md) | Error categories, RFC 9457 Problem Details with stable codes, generic link-error contract, log redaction | **Approved** 2026-10-11 (API-D1, API-D10; ENG-ERR binding) | ENG-ERR-1 to ENG-ERR-7, FR-LNK-7, AC-137, AC-139 |
| 018 | Migration tool; schema-version check at startup; no implicit migrations | Proposed (the rules are approved in ENG-CI-5 and ENG-CI-6; the tool is not chosen) | ENG-CI-5, ENG-CI-6, AC-141 |
| 019 | Test architecture: Testcontainers, forced-order harness, fake provider, contract tests, load test | Proposed (would record ENG-TST, which is approved) | ENG-TST-1 to ENG-TST-9, NFR-QA-1, AC-145, AC-164, AC-169 |
| 020 | Configuration and secrets; fail fast at startup | Proposed (would record ENG-DOC-2, which is approved) | ENG-DOC-2, ENG-DOC-3, AC-143 |
| [021](ADR-021-read-only-cross-module-reporting.md) | `reporting` may read across module tables; never writes | **Approved** 2026-10-11 | FR-DSH-1 to FR-DSH-6, NFR-CON-6, AC-155 |
| [022](ADR-022-organizations-and-organizer-accounts.md) | Organizations own events; membership of an active organization is the organizer authorization; Super Admin separate | **Approved** in principle 2026-10-13 (prompt 29, amendment A-3); data model implemented (K-708) | Amendment A-3, PD-88 |

## 2. Other recorded decisions

| Decision | Status | Where recorded |
|---|---|---|
| Phase 1 Architecture Blueprint: components, modules, dependency graph, process layout | **Approved** 2026-10-11 | [ARCHITECTURE.md](../architecture/ARCHITECTURE.md), [MODULES.md](../architecture/MODULES.md) |
| **Database design baseline** (`docs/database/`), including decisions D-1 to D-16 | **Approved** 2026-10-11 | [DATABASE_DESIGN.md §1](../database/DATABASE_DESIGN.md#1-decision-register) |
| **API design** (`docs/api/`), decisions API-D1 to API-D10 | **Approved** 2026-10-11. AL-API-1 to AL-API-4 and DB-A1 applied as R60. | [API_DESIGN.md](../api/API_DESIGN.md) |
| **PostgreSQL 18** is the target major version for development, testing and database design. Production on 18 is conditional on hosting support; **OQ-2 stays partially open**. | **Approved** 2026-10-11 (stakeholder directive); recorded in REQUIREMENTS.md as R59 | [ARCHITECTURE.md §6.1](../architecture/ARCHITECTURE.md#61-version) |

## 3. Open questions that affect decisions

| Open question | Affects |
|---|---|
| OQ-2 (hosting; production PostgreSQL version) | ADR-013 implementation, ADR-018, backups, supervision |
| OQ-3, OQ-18 to OQ-21 (provider) | ADR-006 values, ADR-008 |
| OQ-5 (retention) | Purge tasks, ADR-009 task kinds, database design |
| OQ-8 (localization) | Templates (`notifications`), possible schema columns |
| OQ-9 (limits) | ADR-015 values |
| OQ-14 (CI, scanning) | Import-boundary enforcement, ADR-019 pipeline |
| OQ-15, OQ-16, OQ-17 | ADR-010 extension points, account lifecycle |
| OQ-1, C-28 | Event schema (end time), share view of a cancelled ticket |

## 4. Requirements alignment

Both items found during Phase 1 (§6 F11 step 3; OQ-2 PostgreSQL wording) were resolved by **R59** in REQUIREMENTS.md v1.6 (2026-10-11).
