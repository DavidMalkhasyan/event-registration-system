# Database Design

| | |
|---|---|
| **Status** | **Approved baseline** (2026-10-11), updated for the final decisions of review round 16 (R59) |
| **Design target** | PostgreSQL 18 (development, testing, design). Production version conditional on hosting (OQ-2, partially open) |
| **Requirements baseline** | [REQUIREMENTS.md](../../REQUIREMENTS.md) v1.6 (R59 applied; authoritative) |
| **Companion documents** | [ERD.md](ERD.md) · [CONSTRAINTS_AND_INDEXES.md](CONSTRAINTS_AND_INDEXES.md) · [TRANSACTIONS_AND_LOCKING.md](TRANSACTIONS_AND_LOCKING.md) · [MIGRATIONS_STRATEGY.md](MIGRATIONS_STRATEGY.md) |
| **Architecture** | [ARCHITECTURE.md](../architecture/ARCHITECTURE.md) · [MODULES.md](../architecture/MODULES.md) · [ADR index](../adr/README.md) |

This is a design specification. No SQL migration, table or application code exists yet.

## How to read the labels

| Label | Meaning |
|---|---|
| **[REQ]** | Binding requirement in REQUIREMENTS.md v1.5. |
| **[ARCH]** | Approved architecture decision (ADR-002, 011, 012, 013, 021; the Phase 1 blueprint) or approved database decision (D-1 to D-12, as approved or corrected on 2026-10-11). |
| **[REC]** | Database design recommendation. Reviewable; not yet approved individually. |
| **[OPEN]** | Open question or pending stakeholder decision. Not resolved here. |
| **[RISK]** | Production risk that needs testing or monitoring. |

---

## 1. Decision register

| ID | Decision | Status | Where specified |
|---|---|---|---|
| PG18 | PostgreSQL 18 is the design, development and test target; production on 18 conditional on hosting | **[ARCH]** approved 2026-10-11; OQ-2 partially open | §10, [MIGRATIONS_STRATEGY.md](MIGRATIONS_STRATEGY.md) |
| D-1 | **Decision time** semantics replace "commit time" for deadlines | **[ARCH]** approved; **[REQ]** since R59 (AL-3, classified as behavioral alignment): Glossary "Decision time", NFR-TIME-2. The decision time is **not** the commit timestamp. | [TRANSACTIONS_AND_LOCKING.md §2](TRANSACTIONS_AND_LOCKING.md#2-time-semantics-d-1) |
| D-2 | Render after the claim commits; `send_started_at` committed before any provider request | **[ARCH]** approved with safeguards | [TRANSACTIONS_AND_LOCKING.md §6](TRANSACTIONS_AND_LOCKING.md#6-send-pipeline-and-crash-safety-d-2) |
| D-3 | `PENDING_VERIFICATION` → `EXPIRED` by the cutoff task and event cancellation only | **[ARCH]** approved | §5.2 `registrations`, TX-J03, TX-E05 |
| D-4 | Staff sessions also follow FR-ORG-4 idle (7 days) and absolute (30 days) limits, plus the check-in window end | **[ARCH]** approved | §5.4 `staff_sessions` |
| D-5 | Check-in request IDs scoped to (event, request ID), storing the original principal | **[ARCH]** approved | §5.2 `check_in_requests` |
| D-6 | SHA-256 with domain separation for random tokens and session IDs; HMAC-SHA-256 with a managed secret for predictable rate-limit identifiers; algorithm identifiers preserved; key rotation documented | **[ARCH]** approved | §6 |
| D-7 | Recipient address snapshot in the outbox | **[ARCH]** approved; retention under OQ-5 | §5.6 `outbox_messages` |
| D-8 | Outbox, task and provider-event rows survive event deletion (no foreign key) | **[ARCH]** approved; purge under OQ-5 | §3 |
| D-9 | Exact schema-version match; deployments stop, migrate, start | **[ARCH]** approved | [MIGRATIONS_STRATEGY.md §5](MIGRATIONS_STRATEGY.md#5-schema-version-check-and-deployment-sequence-d-9) |
| D-10 | One authoritative budget configuration; explicit administrative synchronization; workers never overwrite the row | **[ARCH]** approved; the command is the protected `migrate budget-sync` subcommand (D-15) | §5.6 `send_budget`, TX-M13 |
| D-11 | Delivery facts folded into `outbox_generations` | **[ARCH]** approved | §5.6 |
| D-12 | `DROPPED` means **definitely not submitted**; a stale message settles `DROPPED` if `possibly_accepted` is false and `UNCONFIRMED` (reason `obsolete`) if it is true; late provider events are always recorded and correlated | **[ARCH]** approved; **[REQ]** since R59 (AL-4): NFR-REL-13 e, NFR-REL-16, AC-167, AC-180 | §5.6, [CONSTRAINTS_AND_INDEXES.md](CONSTRAINTS_AND_INDEXES.md) TR-08, TX-M01 |
| D-13 | Contradicting provider evidence for a `DROPPED` or `FAILED` message: persist and correlate it, keep the historical state, record an anomaly, alert, and show the evidence in reporting (was OPEN-3) | **[REQ]** R59: NFR-REL-13 g, NFR-REL-18, NFR-OPS-1, AC-181 | §5.6, TX-M10 |
| D-14 | Deletion-marker counts `failed_required_notices` and `unconfirmed_required_notices`, taken as a snapshot at deletion, each notice counted at most once (was OPEN-4) | **[REQ]** R59: FR-EVT-14, AC-184 | §5.8, TX-E06 |
| D-15 | Budget synchronization is a protected administrative subcommand of `migrate` and the only writer of the configured budget (was OPEN-5) | **[ARCH]** approved | §5.6 `send_budget`, [MIGRATIONS_STRATEGY.md §4.1](MIGRATIONS_STRATEGY.md#41-protected-budget-sync-subcommand-d-15) |
| D-16 | A durable, bounded pre-claim failure counter, written in its own short transaction that holds no event lock (was OPEN-6) | **[ARCH]** approved; **[REQ]** R59: NFR-REL-13 h, AC-183 | §5.6, TX-M14, TX-M15 |

---

## 2. Scope and sources

- **Entities and invariants:** REQUIREMENTS.md §2, §4, §5, §9.
- **Module ownership:** MODULES.md §1. Each table has exactly one owning module, which is its only writer **[ARCH]**. The exception is `reporting`, which reads only **[ARCH: ADR-021]**.
- **Locking protocols:** NFR-CON-4, NFR-CON-6, NFR-CON-7 **[REQ]**. Their database-level design is in [TRANSACTIONS_AND_LOCKING.md](TRANSACTIONS_AND_LOCKING.md).

## 3. Conventions

| Topic | Rule | Label |
|---|---|---|
| Schema | One schema, `app`. | [REC] |
| Primary keys | `uuid DEFAULT uuidv7()` (PostgreSQL 18 built-in). Ascending UUID order is the "ascending ID" lock order of NFR-CON-4 (d). | [REC] |
| Public identifiers | Never a primary key. Events get a separate random `public_id` (FR-EVT-12, AC-123). | [REQ] mechanism [REC] |
| Instants | `timestamptz`. Application sessions run with `TimeZone = 'UTC'`. | [REQ: NFR-TIME-1] / [REC] |
| Durations | Always expressed in **hours or minutes** (`interval '168 hours'`, never `'7 days'`), so arithmetic doesn't depend on the session time zone or DST. | [REC] |
| Derived times | Cutoff, check-in window, reminder time and token expiry that follows the schedule are **computed** from `events.starts_at`, never stored. `timestamptz ± interval` is only STABLE, so it can't be a generated column, and storing it would need updates on every reschedule. | [REC] |
| Decision time | Every deadline comparison uses the transaction's **decision time** (D-1), never `now()`. | [ARCH: D-1] |
| Status columns | `text` with a `CHECK` list. No enum types, because they're harder to migrate. | [REC] |
| Email addresses | Normalized by the application (trim, lower case; Q8). The database checks `email = btrim(email) AND email !~ '[A-Z]' AND char_length(email) BETWEEN 3 AND 254` as a backstop. | [REQ: Q8] / [REC] |
| Credential hashes | `bytea` plus `hash_alg smallint` (§6). | [ARCH: D-6] |
| Soft references | Outbox rows, scheduled tasks, provider events, audit records and deletion markers reference events, registrations and accounts **by ID only, with no foreign key**. They survive deletion. | [REQ: NFR-CON-6] for audit and markers; [ARCH: D-8] for the others |
| No identity foreign keys from event-scoped tables | Event-scoped tables never have foreign keys to identity tables (accounts, sessions). The one exception is `events.owner_account_id`, checked only when an event is created. This keeps event-locked transactions from taking key-share locks on account rows (NFR-CON-7 e). | [REC] |
| Database roles | `app_owner` owns objects and runs migrations. `app_runtime` gets DML; on append-only tables it gets only `INSERT` and `SELECT`; it never gets `TRUNCATE`. | [REC] |
| Collation | Database created with the built-in locale provider (`C.UTF-8`), so index order doesn't depend on the operating system's C library. | [REC] |

---

## 4. Table catalogue

27 tables: 26 application tables plus `schema_migrations`, which the migration tool owns.

| # | Table | Owner module | Purpose | Expected volume | Label |
|---|---|---|---|---|---|
| 1 | `accounts` | identity | Organizer accounts | Low | [REQ: FR-ORG-1] |
| 2 | `sign_in_requests` | identity | Sign-in and re-authentication requests | Medium; purge under OQ-5 | [REQ: FR-ORG-3, FR-ORG-5] |
| 3 | `email_change_requests` | identity | Email-change requests | Low | [REQ: FR-ORG-6] |
| 4 | `organizer_sessions` | identity | Organizer sessions (hash only) | Low–medium | [REQ: FR-ORG-4] |
| 5 | `events` | event-core | Events and the confirmed counter | Low | [REQ: FR-EVT] |
| 6 | `registrations` | event-core | Registrations and waiting-list order | High (up to 10,000 per event) | [REQ: FR-REG, FR-WL] |
| 7 | `tickets` | event-core | One ticket per confirmed registration | High | [REQ: FR-TKT] |
| 8 | `check_ins` | event-core | **Authoritative** check-in history and current state (§8) | High | [REQ: FR-CHK, BR-7] |
| 9 | `check_in_requests` | event-core | Check-in request-ID results | High | [REQ: FR-CHK-3; ARCH: D-5] |
| 10 | `reminder_slots` | event-core | One slot per (registration, schedule version) | High | [REQ: FR-NTF-1] |
| 11 | `access_tokens` | access-tokens | All six link-token types (hash only) | High | [ARCH: ADR-012] |
| 12 | `staff_invitations` | staff | Staff invitations | Low | [REQ: FR-STAFF-1, FR-STAFF-5] |
| 13 | `staff_sessions` | staff | Staff device sessions (hash only) | Low | [REQ: FR-STAFF-2; ARCH: D-4] |
| 14 | `rotation_requests` | participant-portal | Committed rotations, keyed by request ID | Medium | [REQ: FR-ROT-11, BR-28] |
| 15 | `outbox_messages` | messaging | Logical messages and send state | Very high | [REQ: NFR-REL-1, NFR-REL-13] |
| 16 | `outbox_generations` | messaging | Provider-key generations and derived delivery facts | Very high | [REQ: NFR-REL-16, NFR-REL-18; ARCH: D-11] |
| 17 | `outbox_attempts` | messaging | One row per claim (attempt log) | Very high | [REQ: NFR-REL-9; ARCH: D-2] |
| 18 | `provider_events` | messaging | Immutable provider-event log | Very high; retention OQ-5 | [REQ: NFR-REL-15] |
| 19 | `provider_event_matches` | messaging | Insert-only correlation of events to generations | Very high | [REQ: NFR-REL-15 d] |
| 20 | `send_budget` | messaging | Single row: two token buckets and synchronized configuration | 1 row | [REQ: NFR-REL-14; ARCH: D-10] |
| 21 | `sending_pause` | messaging | Single row: sending pause and webhook-endpoint state | 1 row | [REQ: NFR-REL-13 b, AC-159] |
| 22 | `scheduled_tasks` | jobs | Reminder fan-out and cutoff tasks | Medium | [REQ: NFR-CON-4 e, NFR-REL-5] |
| 23 | `audit_records` | audit | Append-only audit records | High; retention OQ-5 | [REQ: NFR-SEC-5] |
| 24 | `deletion_markers` | audit | Markers for deleted events | Low | [REQ: FR-EVT-14] |
| 25 | `rate_limit_counters` | platform | Fixed-window counters (HMAC keys) | Medium; short-lived | [REQ: NFR-SEC-3; ARCH: D-6] |
| 26 | `worker_heartbeats` | platform | Worker liveness and configuration fingerprint | Few rows | [REC] (see §12, alignment item 3) |
| 27 | `schema_migrations` | platform (written by the migration tool only) | Applied migrations and checksums | Few rows | [REQ: ENG-CI-5, ENG-CI-6] |

---

## 5. Table definitions

Constraint and index IDs (PK-, U-, FK-, CK-, IX-, TR-) refer to [CONSTRAINTS_AND_INDEXES.md](CONSTRAINTS_AND_INDEXES.md). "Null" means the column allows NULL.

### 5.1 identity

#### `accounts` — owner: identity

| Column | Type | Null | Default | Notes |
|---|---|---|---|---|
| `id` | uuid | no | `uuidv7()` | PK-01 |
| `email` | text | no | | Normalized; unique (U-01, FR-ORG-6) |
| `created_at` | timestamptz | no | | Decision time of the first confirmed sign-in (FR-ORG-1) |
| `email_changed_at` | timestamptz | yes | | Decision time of the last confirmed email change |

#### `sign_in_requests` — owner: identity

| Column | Type | Null | Default | Notes |
|---|---|---|---|---|
| `id` | uuid | no | `uuidv7()` | PK-02 |
| `email` | text | no | | Target address (normalized) |
| `account_id` | uuid | yes | | NULL for a first sign-in (FR-ORG-1) |
| `purpose` | text | no | | `sign_in` or `reauth` (FR-ORG-5) |
| `reauth_session_id` | uuid | yes | | Session revoked when a re-authentication is confirmed (FR-ORG-5) |
| `status` | text | no | `'active'` | `active`, `used`, `replaced`, `revoked` |
| `created_at` | timestamptz | no | | Decision time (D-1) |
| `expires_at` | timestamptz | no | | `created_at + interval '15 minutes'` (FR-ORG-3 c, R55) |
| `used_at` | timestamptz | yes | | Set on first confirmation |
| `ended_at` | timestamptz | yes | | Set when the status leaves `active` |

At most one `active` request per address (U-02, FR-ORG-3 b). An expired request keeps `status = 'active'` but is no longer valid: validity is `status = 'active' AND decision_time < expires_at`.

#### `email_change_requests` — owner: identity

| Column | Type | Null | Default | Notes |
|---|---|---|---|---|
| `id` | uuid | no | `uuidv7()` | PK-03 |
| `account_id` | uuid | no | | |
| `old_email` | text | no | | The account's email at request time; checked at confirmation (FR-ORG-6) |
| `new_email` | text | no | | |
| `status` | text | no | `'active'` | `active`, `used`, `replaced`, `revoked`, `failed` |
| `created_at` | timestamptz | no | | Decision time |
| `expires_at` | timestamptz | no | | `created_at + interval '15 minutes'` (FR-ORG-6) |
| `used_at` | timestamptz | yes | | |
| `ended_at` | timestamptz | yes | | |

#### `organizer_sessions` — owner: identity

| Column | Type | Null | Default | Notes |
|---|---|---|---|---|
| `id` | uuid | no | `uuidv7()` | PK-04. Internal ID, never the cookie value |
| `account_id` | uuid | no | | |
| `session_hash` | bytea | no | | SHA-256, domain `organizer_session` (§6); U-04 |
| `hash_alg` | smallint | no | `1` | §6.1 |
| `created_from_request_id` | uuid | no | | The confirmed sign-in request; unique (U-05: one session per used request, AC-147, AC-157 c) |
| `created_at` | timestamptz | no | | Decision time of the confirmation |
| `authenticated_at` | timestamptz | no | | Equals `created_at` in the MVP; kept separate for future step-up authentication (OQ-15) |
| `last_seen_at` | timestamptz | no | | Updated at most every 5 minutes (FR-ORG-4) |
| `absolute_expires_at` | timestamptz | no | | `created_at + interval '720 hours'` (30 days) |
| `revoked_at` | timestamptz | yes | | |
| `revoke_reason` | text | yes | | `sign_out`, `sign_out_everywhere`, `reauth_replaced`, `email_changed` |

Valid when `revoked_at IS NULL`, `decision_time < absolute_expires_at` and `decision_time < last_seen_at + interval '168 hours'`.

### 5.2 event-core

#### `events` — owner: event-core

| Column | Type | Null | Default | Notes |
|---|---|---|---|---|
| `id` | uuid | no | `uuidv7()` | PK-05 |
| `owner_account_id` | uuid | no | | FK-01 (checked only when the event is created) |
| `public_id` | text | no | | At least 128-bit random, base64url; U-06 (FR-EVT-12) |
| `title` | text | no | | 1–200 characters (FR-EVT-1) |
| `description` | text | yes | | At most 5,000 characters (FR-EVT-1) |
| `starts_at` | timestamptz | no | | Start, in UTC (FR-EVT-2) |
| `time_zone` | text | no | | IANA zone, validated by the application. The database never converts zones (NFR-TIME-1). |
| `capacity` | integer | no | | ≥ 1 (CK-15) |
| `confirmed_count` | integer | no | `0` | Maintained by triggers TR-02 to TR-04 only (NFR-CON-5) |
| `status` | text | no | `'SCHEDULED'` | `SCHEDULED`, `CANCELLED` |
| `schedule_version` | integer | no | `1` | Incremented on reschedule and on cancellation (Glossary) |
| `next_waitlist_seq` | bigint | no | `1` | Per-event FIFO counter (FR-WL-1) |
| `created_at` | timestamptz | no | | |
| `updated_at` | timestamptz | no | | |
| `cancelled_at` | timestamptz | yes | | Set exactly when `status = 'CANCELLED'` (CK-18) |

Computed, never stored: cutoff `starts_at - interval '2 hours'`; check-in window `[starts_at - interval '2 hours', starts_at + interval '12 hours']`; reminder time `starts_at - interval '24 hours'` **[REQ: Glossary]**.

#### `registrations` — owner: event-core

| Column | Type | Null | Default | Notes |
|---|---|---|---|---|
| `id` | uuid | no | `uuidv7()` | PK-06; also U-07 `(id, event_id)` for composite foreign keys |
| `event_id` | uuid | no | | FK-02. Immutable (TR-01, NFR-CON-5) |
| `email` | text | no | | Normalized participant address (FR-REG-1) |
| `state` | text | no | `'PENDING_VERIFICATION'` | The five states (§2.2) |
| `verification_generation` | integer | no | `1` | Incremented on resubmission (FR-REG-7); part of the verification email's logical key (§4.9) |
| `waitlist_seq` | bigint | yes | | Assigned from `events.next_waitlist_seq` when entering `WAITLISTED`, and kept afterwards as history |
| `created_at` | timestamptz | no | | |
| `verified_at` | timestamptz | yes | | Decision time of the successful confirmation submission |
| `waitlisted_at` | timestamptz | yes | | |
| `confirmed_at` | timestamptz | yes | | Decision time of confirmation or promotion. The FR-NTF-2 slot decision uses this value (D-1). |
| `ended_at` | timestamptz | yes | | |
| `end_reason` | text | yes | | `participant_cancelled`, `removed_by_organizer`, `event_cancelled`, `cutoff` |
| `updated_at` | timestamptz | no | | |

- **Waiting-list position** = 1 + the number of `WAITLISTED` rows of the event with a smaller `waitlist_seq` (FR-WL-7, FR-WL-11). It is always computed and never stored, so removal never renumbers rows (BR-24).
- **`EXPIRED` (D-3)** is set only by the cutoff task (TX-J03; `end_reason = 'cutoff'`) and by event cancellation (TX-E05; `end_reason = 'event_cancelled'`). The 24-hour verification-link expiry alone leaves the registration `PENDING_VERIFICATION`, so resubmission reuses the record (FR-REG-7).

#### `tickets` — owner: event-core

| Column | Type | Null | Default | Notes |
|---|---|---|---|---|
| `id` | uuid | no | `uuidv7()` | PK-07; U-12 `(id, event_id)` |
| `registration_id` | uuid | no | | U-11: at most one ticket per registration (FR-TKT-1) |
| `event_id` | uuid | no | | FK-03 (composite with `registration_id`) |
| `code` | text | no | | 12 Crockford Base32 characters (FR-TKT-1 example format, an assumption); U-10 |
| `issued_at` | timestamptz | no | | |

Validity is **derived**: registration `CONFIRMED` and event `SCHEDULED` (§2.2, BR-8). Check-in state is **not** stored here (§8).

#### `check_ins` — owner: event-core

| Column | Type | Null | Default | Notes |
|---|---|---|---|---|
| `id` | uuid | no | `uuidv7()` | PK-08 |
| `ticket_id` | uuid | no | | FK-04 (composite with `event_id`) |
| `event_id` | uuid | no | | |
| `checked_in_at` | timestamptz | no | | Decision time |
| `actor_kind` | text | no | | `owner` or `staff` |
| `actor_account_id` | uuid | yes | | Soft reference (owner) |
| `actor_staff_session_id` | uuid | yes | | Soft reference (staff) |
| `undone_at` | timestamptz | yes | | Set once, by the owner's undo (FR-CHK-8) |
| `undone_by_account_id` | uuid | yes | | Soft reference |
| `undo_reason` | text | yes | | Optional, at most 500 characters |

At most one row per ticket with `undone_at IS NULL` (U-13, BR-7).

#### `check_in_requests` — owner: event-core

| Column | Type | Null | Default | Notes |
|---|---|---|---|---|
| `event_id` | uuid | no | | PK-09 part; FK-05 |
| `request_id` | uuid | no | | PK-09 part (client-generated, FR-CHK-3) |
| `principal_kind` | text | no | | `owner` or `staff` (D-5) |
| `principal_id` | uuid | no | | Organizer session ID or staff session ID. A retry from a different principal is rejected without revealing the result (D-5). |
| `ticket_id` | uuid | yes | | Set only when the ticket belongs to this event; FK-06 |
| `outcome` | text | no | | One of the seven FR-CHK-4 outcomes |
| `first_checked_in_at` | timestamptz | yes | | For replaying `ALREADY_CHECKED_IN` |
| `created_at` | timestamptz | no | | |

#### `reminder_slots` — owner: event-core

| Column | Type | Null | Default | Notes |
|---|---|---|---|---|
| `registration_id` | uuid | no | | PK-10 part; FK-07 |
| `schedule_version` | integer | no | | PK-10 part |
| `event_id` | uuid | no | | |
| `outbox_message_id` | uuid | no | | The message filling the slot. U-14; FK-08 is deferrable, so the slot can be claimed before the message row exists |
| `filled_by` | text | no | | `reminder`, `ticket`, `promotion`, `event_change` |
| `created_at` | timestamptz | no | | |

### 5.3 access-tokens (ADR-012)

#### `access_tokens` — owner: access-tokens

| Column | Type | Null | Default | Notes |
|---|---|---|---|---|
| `id` | uuid | no | `uuidv7()` | PK-11 |
| `token_type` | text | no | | `verification`, `management`, `share`, `staff_invitation`, `sign_in`, `email_change` |
| `token_hash` | bytea | no | | SHA-256 with the token type as domain (§6); U-15 |
| `hash_alg` | smallint | no | `1` | §6.1 |
| `registration_id` | uuid | yes | | Owner, for verification, management and share tokens |
| `staff_invitation_id` | uuid | yes | | Owner, for staff-invitation tokens |
| `sign_in_request_id` | uuid | yes | | Owner, for sign-in tokens |
| `email_change_request_id` | uuid | yes | | Owner, for email-change tokens |
| `event_id` | uuid | yes | | Set exactly for event-scoped types; used for the plain lookup before the transaction (NFR-CON-4 b) |
| `issued_at` | timestamptz | no | | Decision time of the issuing transaction |
| `issued_via` | text | no | | `page` (management and share only) or `email` |
| `outbox_message_id` | uuid | yes | | The issuing message, for email tokens (FR-LNK-3). Soft reference. |
| `attempt_no` | integer | yes | | The issuing attempt, for email tokens |
| `expires_at` | timestamptz | yes | | Fixed expiry component. Verification tokens only: `issued_at + interval '24 hours'` (FR-REG-3, configurable). NULL for every other type. |
| `revoked_at` | timestamptz | yes | | Set once (TR-15) |
| `revoke_reason` | text | yes | | `rotated`, `resubmitted`, `invitation_revoked`, `invitation_replaced`, `event_cancelled` |
| `revoked_by_rotation_id` | uuid | yes | | The rotation that revoked this token (FR-ROT-11 a); FK-13 |

**Validity, consumption and revocation by type** **[ARCH: ADR-012]**. `T` is the decision time; "window end" is `starts_at + interval '12 hours'` of the **current** schedule.

| Type | Valid when | Consumption (single use) | Revocation |
|---|---|---|---|
| `verification` | Not revoked; `T < least(expires_at, cutoff)`; event `SCHEDULED`; registration `PENDING_VERIFICATION` | The registration leaving `PENDING_VERIFICATION` consumes every verification token of that registration. Afterwards "Already confirmed" is shown within the same window (FR-REG-11). | Explicit on resubmission (`resubmitted`, FR-REG-7). Removed by cascade when the event is deleted. |
| `management` | Not revoked; registration `CONFIRMED` or `WAITLISTED`; `T < window end` | — | Explicit on rotation (`rotated`). Derived when the registration ends (FR-LNK-6): no row update needed. |
| `share` | Not revoked; `T < window end`. The view state is derived (FR-SHR-4; C-28 open) | — | Explicit on rotation |
| `staff_invitation` | Not revoked; invitation `pending`; `T < invitation.expires_at`; event `SCHEDULED`; `T < window end` | The invitation becoming `accepted` | Explicit: `invitation_revoked`, `invitation_replaced`, `event_cancelled` (FR-STAFF-5) |
| `sign_in` | Request `active`; `T < request.expires_at` | The request becoming `used` consumes every token of that request (FR-ORG-3 e) | Derived from the request status |
| `email_change` | Request `active`; `T < request.expires_at`; `accounts.email = old_email` | The request becoming `used` | Derived from the request status |

**[REC]** Consumption is recorded on the **owner row**, never the token row. Each send attempt issues its own token (FR-LNK-3), so the first confirmation must consume all of them at once.

### 5.4 staff

#### `staff_invitations` — owner: staff

| Column | Type | Null | Default | Notes |
|---|---|---|---|---|
| `id` | uuid | no | `uuidv7()` | PK-12; U-16 `(id, event_id)` |
| `event_id` | uuid | no | | FK-14 |
| `invited_email` | text | no | | |
| `status` | text | no | `'pending'` | `pending`, `accepted`, `revoked`, `replaced`. "Expired" is derived (FR-STAFF-5). |
| `created_at` | timestamptz | no | | Decision time (issuance) |
| `expires_at` | timestamptz | no | | `created_at + interval '168 hours'` (FR-STAFF-5) |
| `accepted_at` | timestamptz | yes | | |
| `ended_at` | timestamptz | yes | | Set when the status leaves `pending` |

#### `staff_sessions` — owner: staff

| Column | Type | Null | Default | Notes |
|---|---|---|---|---|
| `id` | uuid | no | `uuidv7()` | PK-13 |
| `event_id` | uuid | no | | |
| `invitation_id` | uuid | no | | U-19: one session per acceptance (FR-STAFF-1, FR-STAFF-6); FK-15 |
| `session_hash` | bytea | no | | SHA-256, domain `staff_session`; U-18 |
| `hash_alg` | smallint | no | `1` | |
| `created_at` | timestamptz | no | | |
| `last_seen_at` | timestamptz | no | | Throttled to 5 minutes (D-4) |
| `absolute_expires_at` | timestamptz | no | | `created_at + interval '720 hours'` (D-4) |
| `revoked_at` | timestamptz | yes | | |
| `revoke_reason` | text | yes | | `owner_revoked` |

Valid when all of these hold (FR-STAFF-2, D-4):
- not revoked;
- `T < absolute_expires_at` and `T < last_seen_at + interval '168 hours'`;
- event `SCHEDULED`;
- `T < window end`.

### 5.5 participant-portal

#### `rotation_requests` — owner: participant-portal

| Column | Type | Null | Default | Notes |
|---|---|---|---|---|
| `id` | uuid | no | `uuidv7()` | PK-14 |
| `registration_id` | uuid | no | | FK-16 |
| `event_id` | uuid | no | | |
| `request_id` | uuid | no | | U-20 with `registration_id` (FR-ROT-11, BR-28) |
| `link_type` | text | no | | `management` or `share` |
| `authorizing_token_id` | uuid | no | | The token the request was submitted with; FK-18 |
| `new_token_id` | uuid | no | | FK-17 |
| `decided_at` | timestamptz | no | | Decision time of the rotation (D-1). The FR-ROT-11 (a) 15-minute window is measured from it. |
| `outbox_message_id` | uuid | yes | | Management rotations only (FR-ROT-5); soft reference |

Only committed rotations have a row, which implements FR-ROT-11 (d) directly.

### 5.6 messaging

#### `outbox_messages` — owner: messaging

| Column | Type | Null | Default | Notes |
|---|---|---|---|---|
| `id` | uuid | no | `uuidv7()` | PK-15. Also the provider tag value (NFR-REL-15 d) |
| `logical_key` | text | no | | §4.9 idempotency key; U-21 (NFR-REL-3) |
| `message_type` | text | no | | One of the 17 types (§5.6.1) |
| `lane` | text | no | | `priority` or `bulk` (NFR-REL-12, NFR-REL-14) |
| `regen_class` | text | no | | `A`, `B`, `C` (NFR-REL-16) |
| `is_required_notice` | boolean | no | | Glossary "Required notice" |
| `event_id` | uuid | yes | | Soft reference (D-8) |
| `registration_id` | uuid | yes | | Soft reference |
| `account_id` | uuid | yes | | Soft reference |
| `staff_invitation_id` | uuid | yes | | Soft reference |
| `sign_in_request_id` | uuid | yes | | Soft reference |
| `email_change_request_id` | uuid | yes | | Soft reference |
| `schedule_version` | integer | yes | | For freshness checks (§4.9) |
| `verification_generation` | integer | yes | | Verification emails only |
| `request_ref` | uuid | yes | | Request ID for resend, existing access and rotation keys |
| `recipient_email` | text | no | | Snapshot (D-7) |
| `payload` | jsonb | no | `'{}'` | Snapshots only, such as the waiting-list position (FR-WL-8) or the FR-NTF-4 closed flag. **Never tokens** (BR-19). |
| `status` | text | no | `'QUEUED'` | NFR-REL-13 states |
| `possibly_accepted` | boolean | no | `false` | Sticky (TR-08) |
| `current_generation` | smallint | no | `1` | 1 or 2 |
| `attempt_no` | integer | no | `0` | Fencing token for result writes (NFR-REL-9) |
| `preclaim_failures` | integer | no | `0` | Durable pre-claim counter (D-16, NFR-REL-13 h). Incremented by TX-M14 in its own transaction before each claim attempt; reset to 0 by a committed claim transaction. |
| `lease_expires_at` | timestamptz | yes | | Set while `SENDING` |
| `next_attempt_at` | timestamptz | no | | Due time (backoff) |
| `horizon_at` | timestamptz | no | | Retry horizon. For reminders, Start; for authentication messages, `request.expires_at - interval '2 minutes'` (NFR-REL-4, NFR-REL-12) |
| `awaiting_evidence_since` | timestamptz | yes | | |
| `created_at` | timestamptz | no | | |
| `settled_at` | timestamptz | yes | | |
| `settle_reason` | text | yes | | §5.6.2 |
| `last_error_code` | text | yes | | Masked |
| `evidence_anomaly_at` | timestamptz | yes | | Set when a verified provider event is matched to a `DROPPED` or `FAILED` message. The send state is kept (D-13, NFR-REL-13 g). |
| `correlation_id` | text | no | | NFR-OPS-2 |

##### 5.6.1 Message-type policy

Enforced by CK-48 **[REQ: §4.9, NFR-REL-12, NFR-REL-16; AC-170]**.

| `message_type` | Class | Lane | Required notice |
|---|---|---|---|
| `verification` | A | bulk | no |
| `existing_access` | A | bulk | no |
| `ticket_resend` | A | bulk | no |
| `management_link_replaced` | A | bulk | no |
| `staff_invitation` | A | bulk | no |
| `sign_in` (also used for re-authentication) | A | **priority** | no |
| `email_change_confirmation` | A | **priority** | no |
| `ticket_confirmation` | B | bulk | no |
| `promotion` | B | bulk | no |
| `event_change` | B | bulk | no |
| `event_cancellation` | B | bulk | no |
| `registration_cancelled` | B | bulk | **yes** |
| `waitlist_removed` | B | bulk | **yes** |
| `email_change_notice` | B | bulk | no |
| `waitlist_confirmation` | C | bulk | no |
| `reminder` | C | bulk | no |
| `waitlist_closed` | C | bulk | no |

##### 5.6.2 Settled states and reasons (D-12)

| Status | Meaning | Allowed `settle_reason` | `possibly_accepted` |
|---|---|---|---|
| `ACCEPTED` | Accepted, by evidence (NFR-REL-13 b, f) | `accepted` | either |
| `FAILED` | Definitely not accepted | `permanent_error`, `horizon_reached`, `start_reached`, `link_expiry`, `claim_failed` | **must be false** (CK-50) |
| `UNCONFIRMED` | An attempt may have been accepted; outcome unknown | `horizon_reached`, `start_reached`, `link_expiry`, `permanent_error`, **`obsolete`**, **`event_deleted`**, `claim_failed` | must be true (CK-52) |
| `DROPPED` | **Definitely not submitted** (D-12) | `obsolete`, `event_deleted`, `request_replaced`, `start_reached` | **must be false** (CK-51) |

`obsolete` covers every failed freshness check: stale version, cancelled event, registration no longer in the required state, or replaced request. On `UNCONFIRMED` it means "the message became obsolete after a possibly accepted attempt" (D-12). `claim_failed` means the pre-claim counter reached its bound (D-16). `ACCEPTED`, `FAILED` and `DROPPED` are final: contradicting provider evidence for `FAILED` or `DROPPED` sets `evidence_anomaly_at` and never changes the state (D-13).

#### `outbox_generations` — owner: messaging (D-11)

| Column | Type | Null | Default | Notes |
|---|---|---|---|---|
| `outbox_id` | uuid | no | | PK-16 part; FK-24 |
| `generation` | smallint | no | | PK-16 part; 1 or 2 |
| `provider_key` | text | no | | `logical_key || ':g' || generation`; U-22 (NFR-REL-16) |
| `created_at` | timestamptz | no | | |
| `regen_reason` | text | yes | | Generation 2 only |
| `provider_message_id` | text | yes | | U-23 |
| `accepted_at` | timestamptz | yes | | Derived fact (NFR-REL-18) |
| `delivered_at` | timestamptz | yes | | Derived fact |
| `bounced_at` | timestamptz | yes | | Derived fact |
| `failed_at` | timestamptz | yes | | Derived fact |
| `suppressed_at` | timestamptz | yes | | Derived fact |
| `complained_at` | timestamptz | yes | | Derived fact |
| `last_delayed_at` | timestamptz | yes | | Derived fact (informational only) |
| `failure_reason` | text | yes | | Masked |
| `facts_updated_at` | timestamptz | yes | | |

Generation 1 is inserted at the message's first claim (TX-M01), and generation 2 only by a class B regeneration (TX-M08). If a verified provider event matches a generation that has no row yet (for example a message dropped before any claim, D-13), TX-M10 inserts that generation row with its deterministic provider key, so the evidence can be stored. The fact columns are a **derived cache**. Each webhook transaction recomputes them from all matched events of the generation, so the result doesn't depend on arrival order (AC-166).

#### `outbox_attempts` — owner: messaging (D-2)

| Column | Type | Null | Default | Notes |
|---|---|---|---|---|
| `id` | uuid | no | `uuidv7()` | PK-17 |
| `outbox_id` | uuid | no | | FK-25 (composite with `generation`) |
| `generation` | smallint | no | | |
| `attempt_no` | integer | no | | U-24 with `outbox_id` |
| `worker_id` | text | no | | |
| `claimed_at` | timestamptz | no | | Decision time of the claim |
| `lease_expires_at` | timestamptz | no | | |
| `send_started_at` | timestamptz | yes | | **Committed before** the provider request (D-2). NULL means the attempt was definitely not submitted. |
| `lease_expired_at` | timestamptz | yes | | Set by the reaper |
| `result_at` | timestamptz | yes | | |
| `result_category` | text | yes | | `accepted`, `replayed`, `idempotent_key_conflict`, `concurrent_conflict`, `rate_limited`, `ambiguous`, `permanent`, `config_fault`, `aborted_before_send` |
| `http_status` | integer | yes | | |
| `provider_message_id` | text | yes | | |
| `possibly_accepted` | boolean | yes | | This attempt's own classification |
| `stale` | boolean | no | `false` | The result arrived after the lease was lost (NFR-REL-9) |
| `error_code` | text | yes | | Masked |
| `latency_ms` | integer | yes | | Commit-to-acceptance metric (AC-153 d) |

Each of `send_started_at`, `lease_expired_at` and the `result_*` group is written at most once (TR-10).

#### `provider_events` — owner: messaging (immutable)

| Column | Type | Null | Default | Notes |
|---|---|---|---|---|
| `id` | uuid | no | `uuidv7()` | PK-18 |
| `svix_id` | text | no | | U-25: the **only** uniqueness rule (NFR-REL-15 c) |
| `event_type` | text | no | | As received (for example `email.bounced`) |
| `provider_email_id` | text | yes | | |
| `tag_outbox_id` | uuid | yes | | Tag as received; not a foreign key |
| `tag_generation` | smallint | yes | | Tag as received |
| `provider_created_at` | timestamptz | yes | | |
| `received_at` | timestamptz | no | | |
| `bounce_kind` | text | yes | | |
| `reason_masked` | text | yes | | |
| `payload_masked` | jsonb | no | `'{}'` | Minimal masked fields; never tokens (NFR-REL-15 b) |

#### `provider_event_matches` — owner: messaging (insert-only)

| Column | Type | Null | Default | Notes |
|---|---|---|---|---|
| `provider_event_id` | uuid | no | | PK-19; FK-26 |
| `outbox_id` | uuid | no | | FK-27 (composite with `generation`) |
| `generation` | smallint | no | | |
| `method` | text | no | | `tag` or `provider_id` |
| `matched_at` | timestamptz | no | | |

#### `send_budget` — owner: messaging (single row; D-10)

| Column | Type | Null | Default | Notes |
|---|---|---|---|---|
| `id` | smallint | no | `1` | PK-20; `CHECK (id = 1)` |
| `config_version` | integer | no | `0` | `0` = never synchronized; workers don't send |
| `config_fingerprint` | bytea | yes | | SHA-256 of the canonical budget configuration |
| `config_synced_at` | timestamptz | yes | | |
| `config_synced_by` | text | yes | | Operator or release identifier |
| `rate_p` | numeric | yes | | Configured priority rate per second |
| `burst_p` | numeric | yes | | |
| `rate_b` | numeric | yes | | Configured bulk rate |
| `burst_b` | numeric | yes | | |
| `rate_b_min` | numeric | yes | | Floor after `429` back-off (R56: 1 per second) |
| `rate_p_current` | numeric | yes | | |
| `rate_b_current` | numeric | yes | | |
| `tokens_p` | numeric | no | `0` | |
| `tokens_b` | numeric | no | `0` | |
| `retry_after_until` | timestamptz | yes | | `Retry-After` pause for both classes |
| `last_429_at` | timestamptz | yes | | |
| `last_recovery_at` | timestamptz | yes | | |
| `updated_at` | timestamptz | no | | Never moves backwards (NFR-REL-14 c) |

#### `sending_pause` — owner: messaging (single row)

| Column | Type | Null | Default | Notes |
|---|---|---|---|---|
| `id` | smallint | no | `1` | PK-21 |
| `paused` | boolean | no | `false` | |
| `reason` | text | yes | | `config_fault` or `operator` |
| `paused_at` | timestamptz | yes | | |
| `cleared_at` | timestamptz | yes | | |
| `cleared_by` | text | yes | | |
| `webhook_endpoint_disabled` | boolean | no | `false` | Set by an operator or by an alert; one input to "webhook ingestion healthy" (NFR-REL-16 (2)) |

### 5.7 jobs

#### `scheduled_tasks` — owner: jobs

| Column | Type | Null | Default | Notes |
|---|---|---|---|---|
| `id` | uuid | no | `uuidv7()` | PK-22 |
| `kind` | text | no | | `reminder_fanout`, `cutoff_processing` |
| `event_id` | uuid | no | | Soft reference (D-8) |
| `schedule_version` | integer | no | | U-26 with `kind` and `event_id` |
| `due_at` | timestamptz | no | | |
| `status` | text | no | `'PENDING'` | `PENDING`, `RUNNING`, `DONE`, `SKIPPED`, `FAILED` |
| `attempt_no` | integer | no | `0` | |
| `lease_expires_at` | timestamptz | yes | | |
| `cursor_registration_id` | uuid | yes | | Batch progress for the fan-out |
| `params` | jsonb | no | `'{}'` | For example `{"waitlist_closed_by_change": true}` (FR-NTF-4) |
| `last_error_code` | text | yes | | |
| `created_at` | timestamptz | no | | |
| `finished_at` | timestamptz | yes | | |

### 5.8 audit

#### `audit_records` — owner: audit (append-only)

| Column | Type | Null | Default | Notes |
|---|---|---|---|---|
| `id` | uuid | no | `uuidv7()` | PK-23 |
| `occurred_at` | timestamptz | no | | |
| `action` | text | no | | For example `checkin_undo`, `capacity_change`, `reschedule`, `event_cancel`, `event_delete`, `registration_cancel`, `waitlist_remove`, `rotation`, `staff_invite`, `staff_revoke`, `staff_accept`, `signin_confirmed`, `signin_invalid_burst`, `sign_out_everywhere`, `session_revoked`, `email_change_requested`, `email_change_confirmed`, `email_change_failed` |
| `actor_kind` | text | no | | `owner`, `staff`, `participant_link`, `system`, `account` |
| `actor_account_id` | uuid | yes | | Opaque ID only (FR-ORG-8, NFR-SEC-5) |
| `actor_staff_session_id` | uuid | yes | | |
| `event_id` | uuid | yes | | Soft reference; survives deletion (FR-EVT-14) |
| `registration_id` | uuid | yes | | |
| `ticket_id` | uuid | yes | | |
| `subject_id` | uuid | yes | | Other subject (invitation, session, request) |
| `outcome` | text | no | | |
| `details` | jsonb | no | `'{}'` | IDs and enumerations only; never emails, tokens or hashes (AC-100, AC-154) |

#### `deletion_markers` — owner: audit

Exactly the FR-EVT-14 fields **[REQ: AC-128]**.

| Column | Type | Null | Default | Notes |
|---|---|---|---|---|
| `event_id` | uuid | no | | PK-24 |
| `owner_account_id` | uuid | no | | Soft reference |
| `scheduled_start` | timestamptz | no | | |
| `time_zone` | text | no | | |
| `deleted_at` | timestamptz | no | | |
| `deleted_by_account_id` | uuid | no | | The actor |
| `registrations_deleted` | integer | no | | |
| `failed_required_notices` | integer | no | | Definite failures (FR-EVT-14, D-14): `FAILED` without contradicting delivery evidence, or a permanent provider failure fact, including "Delivered, later bounced" |
| `unconfirmed_required_notices` | integer | no | | Required notices in `UNCONFIRMED` (FR-EVT-14, D-14) |

**Counting rule** **[REQ: FR-EVT-14, AC-184]**: both counts are computed inside the deletion transaction (TX-E06), which is a snapshot at deletion time. Every required notice of the event is already settled then (FR-EVT-10 c), and each falls into exactly one of three classes:

| Required notice at deletion | Class |
|---|---|
| `UNCONFIRMED` | `unconfirmed_required_notices` |
| `ACCEPTED` or `FAILED` with a permanent-failure fact on any generation (NFR-REL-18; includes "Delivered, later bounced") | `failed_required_notices` |
| `FAILED` with no provider facts | `failed_required_notices` |
| `ACCEPTED` without a permanent-failure fact; `FAILED` with delivery evidence only (an anomaly, D-13) | neither |

`UNCONFIRMED` messages never carry facts, because any matched event moves them to `ACCEPTED`. Required notices are never `DROPPED` (CK-69). The classes are therefore disjoint, and no notice is counted twice. Provider events after the deletion don't change the marker.

### 5.9 platform

#### `rate_limit_counters` — owner: platform

| Column | Type | Null | Default | Notes |
|---|---|---|---|---|
| `scope` | text | no | | For example `signin_email`, `signin_ip`, `token_lookup_ip`, `register_ip`, `register_email`, `resend_registration`, `rotation_registration`, `checkin_fail_staff_session` |
| `key_id` | smallint | no | | HMAC key version (§6.2) |
| `key_hash` | bytea | no | | HMAC-SHA-256 of the identifier (D-6) |
| `window_start` | timestamptz | no | | |
| `count` | integer | no | | |
| `expires_at` | timestamptz | no | | For purging |

PK-25 is `(scope, key_id, key_hash, window_start)`.

#### `worker_heartbeats` — owner: platform

| Column | Type | Null | Default | Notes |
|---|---|---|---|---|
| `worker_id` | text | no | | PK-26 |
| `process_kind` | text | no | | `worker` |
| `started_at` | timestamptz | no | | |
| `last_beat_at` | timestamptz | no | | |
| `build_version` | text | no | | |
| `config_fingerprint` | bytea | yes | | The worker's own budget-configuration fingerprint, for mismatch detection (D-10) |
| `slots_priority` | integer | no | | ≥ 1 (NFR-REL-12 a, NFR-REL-14 g) |
| `slots_bulk` | integer | no | | |

#### `schema_migrations` — owner: platform (migration tool)

| Column | Type | Null | Default | Notes |
|---|---|---|---|---|
| `version` | integer | no | | PK-27 |
| `name` | text | no | | |
| `checksum` | bytea | no | | SHA-256 of the file (ENG-CI-5) |
| `applied_at` | timestamptz | no | | |
| `applied_by` | text | no | | |
| `duration_ms` | integer | no | | |

---

## 6. Credential hashing and key management (D-6)

### 6.1 Random link tokens and session IDs **[ARCH: D-6]**

- **Generation:** 32 bytes (256 bits) from the operating system's secure generator, encoded as 43 base64url characters. This exceeds the ≥ 128-bit requirement **[REQ: FR-LNK-1, NFR-SEC-1]**.
- **Hash (`hash_alg = 1`):**

  ```
  SHA-256( "ers/v1/" || domain || 0x00 || raw_token_bytes )
  ```

  `domain` is one of `verification`, `management`, `share`, `staff_invitation`, `sign_in`, `email_change`, `organizer_session`, `staff_session`.
- **Domain separation:** the route determines the domain (FR-LNK-10 c). A token presented on the wrong route hashes to a value that matches no row, which yields the generic response (FR-SHR-3, AC-46).
- **No key, no salt:** inputs are uniformly random, so a plain cryptographic hash prevents recovery of the raw value. Lookup is an exact match on a unique index, which leaks no partial matches **[REQ: NFR-SEC-1b]**.
- **Algorithm change:** add a new `hash_alg` value and widen CK-10, CK-34 and CK-43 in a migration. New credentials use the new algorithm. Lookups try the current algorithm, then older ones, until every older credential has expired. Old rows are never rewritten.

### 6.2 Predictable identifiers (rate limiting) **[ARCH: D-6]**

- **Hash:** HMAC-SHA-256 over `scope || 0x00 || normalized identifier`. Identifiers are email addresses, IP addresses, registration IDs and staff session IDs.
- **Secret:** held outside the database in a secret store chosen with hosting (**[OPEN: OQ-2]**). Never in the database, logs or repository (ENG-DOC-3).
- **Key versions:** `key_id` in `rate_limit_counters` names the key version. Configuration holds one **current** key and optionally one **previous** key.
- **Rotation procedure:**
  1. Deploy the new key as current, and the old key as previous.
  2. Counting writes only under the current key. Limit checks **sum** the current and previous key's counters for the active window. This is valid because the counter key includes `key_id`.
  3. Once the longest rate-limit window has passed, remove the previous key. Its counters expire.
- **Rotate** at least yearly and on any suspected exposure. **[REC]**

### 6.3 What is never stored

- Raw tokens, raw session IDs and HMAC secrets are never stored **[REQ: BR-19, AC-61]**.
- Ticket codes are stored in clear text. They are short bearer codes, not tokens, and must be shown to the participant (FR-TKT-1, FR-TKT-4).
- `events.public_id` is public by design.

---

## 7. Derived values (never stored)

| Value | Derivation | Label |
|---|---|---|
| Cutoff, check-in window, reminder time | From `events.starts_at` (§5.2) | [REQ: Glossary] |
| Registration phase (open, closed, started) | Decision time vs. cutoff and start | [REQ: §2.3, FR-DSH-5] |
| Waiting-list position | Count over U-09 / IX-06 | [REQ: FR-WL-7] |
| Ticket validity | Registration `CONFIRMED` and event `SCHEDULED` | [REQ: §2.2] |
| Checked-in state and count | `check_ins` rows with `undone_at IS NULL` (§8) | [ARCH: §8 below] |
| Token validity | Table in §5.3 | [ARCH: ADR-012] |
| Email-failure flags and labels | Read from `outbox_messages` and `outbox_generations` by `reporting` | [REQ: NFR-CON-6, FR-DSH-4, FR-DSH-6, NFR-REL-11] |
| Staff "Expired" status | `expires_at`, window, event status | [REQ: FR-STAFF-5] |

## 8. Check-in representation (review item 6)

**`check_ins` is the single authoritative source.** `tickets` has no check-in columns. **[REC]**

- **Checked in:** a ticket is checked in exactly when it has a `check_ins` row with `undone_at IS NULL`. The partial unique index U-13 allows at most one such row (BR-7, NFR-CON-2).
- **Check-in:** `INSERT … ON CONFLICT DO NOTHING` against U-13, under the event lock (TX-C01). A conflict means `ALREADY_CHECKED_IN`, and the existing row supplies the first check-in time (FR-CHK-4).
- **Undo:** sets `undone_at`, `undone_by_account_id` and `undo_reason` once (TR-06), under the event lock (TX-C02). A later check-in inserts a **new** row, so history is preserved (EC-29).
- **Count:** `count(*) FROM check_ins WHERE event_id = $1 AND undone_at IS NULL`, served by IX-09.
- **Why no inconsistency is possible:** no second representation exists. Every change goes through the same row under the same lock, and TR-06 forbids changing `ticket_id`, `event_id` or `checked_in_at`.
- **Event consistency:** FK-04 references `tickets (id, event_id)`, so a check-in's event always matches its ticket's event.

## 9. Reporting access (ADR-021)

`reporting` runs only `READ ONLY` transactions (TX-X03). The main queries are:
- **Dashboard counts:** `events.confirmed_count`, the number of `WAITLISTED` registrations (IX-06), and active check-ins (IX-09).
- **Participant list:** registrations joined with their latest check-in and with failure flags from `outbox_messages` and `outbox_generations` (IX-25).
- **Deletion confirmation:** settled required notices with `FAILED` or `UNCONFIRMED` status or bounce facts (IX-24 and IX-25).
- **Owner-facing labels** (NFR-REL-11) follow §5.6.2. `UNCONFIRMED` with reason `obsolete` is labelled "Delivery outcome unknown (superseded)". A `DROPPED` or `FAILED` message with contradicting evidence shows its recorded state **and** the provider-reported outcome, for example "Recorded as not sent; provider reported: Delivered" (D-13). It is flagged on the participant list (FR-DSH-4).

## 10. PostgreSQL 18 features used, and portability

| Feature | Version | Use | Fallback if production must run an older version (OQ-2) |
|---|---|---|---|
| `uuidv7()` | 18 | Primary-key defaults | Generate UUIDv7 in the application; drop the defaults |
| Built-in locale provider `C.UTF-8` | 17+ | Database collation | libc `C` collation |
| Transition tables on statement triggers, partial unique indexes, `SKIP LOCKED`, `num_nonnulls`, deferrable foreign keys, advisory locks, `LISTEN/NOTIFY` | ≤ 13 | Core design | None needed |

No PostgreSQL extension is required in production. `pgrowlocks` is installed in test images only (AC-157). **[REC]**

---

## 11. Open questions and production risks

| ID | Item | Label |
|---|---|---|
| OPEN-1 | **Resolved:** AL-3 and AL-4 applied as R59 (REQUIREMENTS.md v1.6) | [REQ] |
| OPEN-2 | **Resolved:** AL-1 and AL-2 applied as R59 | [REQ] |
| OPEN-3 | **Resolved** as D-13 (NFR-REL-13 g) | [REQ] |
| OPEN-4 | **Resolved** as D-14 (FR-EVT-14) | [REQ] |
| OPEN-5 | **Resolved** as D-15 | [ARCH] |
| OPEN-6 | **Resolved** as D-16 (NFR-REL-13 h). Residual: a crash inside the pre-claim transaction (TX-M14) itself is not counted, but that transaction runs no message-specific code, so it can't be a per-message crash loop. | [REQ] / [RISK] |
| OQ-1, OQ-5, OQ-8, OQ-9, OQ-17, C-28 | End time; retention and purge; locale columns; limit values; account deletion (foreign keys to `accounts` are `NO ACTION` until decided); share view of a cancelled ticket | [OPEN] |
| RISK-1 | NFR-PERF-1 is unverified. The large event transactions are the main risk ([TRANSACTIONS_AND_LOCKING.md §8](TRANSACTIONS_AND_LOCKING.md#8-large-event-scoped-transactions-review-item-9)). | [RISK] |
| RISK-2 | Outbox, attempt and provider-event tables grow fast. Autovacuum tuning and retention (OQ-5) are needed. | [RISK] |
| RISK-3 | Decision time comes from the database server clock. A backward clock step can reorder deadlines. The database host needs slewing time synchronization (OQ-2). | [RISK] |
| RISK-4 | Backups and point-in-time recovery are undecided (OQ-2). Without them, forward-only migrations can't be rolled back. | [RISK] |
| RISK-5 | Raw tokens issued at claim time live in worker memory until the provider call returns; JavaScript can't wipe strings reliably ([TRANSACTIONS_AND_LOCKING.md §6.4](TRANSACTIONS_AND_LOCKING.md#64-tokens-issued-at-claim-time-arch-d-2-req-fr-lnk-1-fr-lnk-3-br-19)). | [RISK] |

## 12. Alignment with other documents

All four items found in the first database review were resolved on 2026-10-11 (review round 16):

1. **ADR-012** records the approved hash functions (D-6).
2. **ARCHITECTURE.md §7** and **MODULES.md §6** show rendering after the claim commit, and `send_started_at` committed before the provider call (D-2).
3. **MODULES.md §1** lists `worker_heartbeats` under `platform`.
4. **REQUIREMENTS.md v1.6** contains AL-1 to AL-4 and the OPEN-3, OPEN-4 and OPEN-6 decisions as **R59**.
