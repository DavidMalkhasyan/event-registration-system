# Entity-Relationship Diagrams

| | |
|---|---|
| **Status** | Database design — see [DATABASE_DESIGN.md](DATABASE_DESIGN.md) for the decision register |
| **Design target** | PostgreSQL 18 |
| **Requirements baseline** | [REQUIREMENTS.md](../../REQUIREMENTS.md) v1.7 |

**How this document is produced:** every diagram is generated from the column tables in [DATABASE_DESIGN.md §5](DATABASE_DESIGN.md#5-table-definitions) and the foreign-key table in [CONSTRAINTS_AND_INDEXES.md §3](CONSTRAINTS_AND_INDEXES.md#3-foreign-keys). Those two documents are authoritative. If a diagram disagrees with them, the diagram is wrong.

**Labels** (as in DATABASE_DESIGN.md):
- **[REQ]** binding requirement;
- **[ARCH]** approved decision;
- **[REC]** recommendation;
- **[OPEN]** / **[RISK]** open item or production risk.

The structure shown is **[REC]**, except where a constraint is marked REQ or ARCH in CONSTRAINTS_AND_INDEXES.md.

## 1. Reading the diagrams

- **Solid lines** are foreign keys. The label gives the FK ID, the child columns and the delete rule.
- **Dotted lines** are **soft references**: an ID column with no foreign key, kept so audit records, deletion markers, outbox rows and tasks survive event deletion. **[REQ: NFR-CON-6; ARCH: D-8]**
- **Cardinality:** `||--o|` means a parent has at most one child (a unique constraint on the child's foreign-key columns). `||--o{` means many children. `|o` on the parent side means the child's foreign-key column is nullable.
- **Rules a diagram can't express** (DATABASE_DESIGN.md and CONSTRAINTS_AND_INDEXES.md):
  - **[REQ]** "Exactly one ticket per `CONFIRMED` registration" (§2.2). U-11 enforces "at most one" in the database. "At least one" is enforced by the verify and promotion transactions and checked by reconciliation.
  - **[REQ]** At most one **active** check-in per ticket (U-13, a partial unique index).
  - **[ARCH: ADR-012]** Exactly one owner reference per access token, matching its type (CK-35).
  - **[ARCH: D-12]** Send-state invariants (CK-50 to CK-55, TR-08).

## 2. Overview: all tables and relationships

Solid lines are foreign keys (label = FK ID). Dotted lines are soft references with no foreign key (DATABASE_DESIGN §3).

```mermaid
erDiagram
  accounts ||--o{ events : "FK-01 owner_account_id (NO ACTION)"
  events ||--o{ registrations : "FK-02 event_id (CASCADE)"
  registrations ||--o| tickets : "FK-03 registration_id,event_id (CASCADE)"
  tickets ||--o{ check_ins : "FK-04 ticket_id,event_id (CASCADE)"
  events ||--o{ check_in_requests : "FK-05 event_id (CASCADE)"
  tickets |o--o{ check_in_requests : "FK-06 ticket_id,event_id (CASCADE)"
  registrations ||--o{ reminder_slots : "FK-07 registration_id,event_id (CASCADE)"
  outbox_messages ||--o| reminder_slots : "FK-08 outbox_message_id (NO ACTION)"
  registrations |o--o{ access_tokens : "FK-09 registration_id,event_id (CASCADE)"
  staff_invitations |o--o{ access_tokens : "FK-10 staff_invitation_id,event_id (CASCADE)"
  sign_in_requests |o--o{ access_tokens : "FK-11 sign_in_request_id (CASCADE)"
  email_change_requests |o--o{ access_tokens : "FK-12 email_change_request_id (CASCADE)"
  rotation_requests |o--o{ access_tokens : "FK-13 revoked_by_rotation_id (NO ACTION)"
  events ||--o{ staff_invitations : "FK-14 event_id (CASCADE)"
  staff_invitations ||--o| staff_sessions : "FK-15 invitation_id,event_id (CASCADE)"
  registrations ||--o{ rotation_requests : "FK-16 registration_id,event_id (CASCADE)"
  access_tokens ||--o{ rotation_requests : "FK-17 new_token_id (NO ACTION)"
  access_tokens ||--o{ rotation_requests : "FK-18 authorizing_token_id (NO ACTION)"
  accounts |o--o{ sign_in_requests : "FK-19 account_id (NO ACTION)"
  organizer_sessions |o--o{ sign_in_requests : "FK-20 reauth_session_id (NO ACTION)"
  accounts ||--o{ email_change_requests : "FK-21 account_id (NO ACTION)"
  accounts ||--o{ organizer_sessions : "FK-22 account_id (NO ACTION)"
  sign_in_requests ||--o| organizer_sessions : "FK-23 created_from_request_id (NO ACTION)"
  outbox_messages ||--o{ outbox_generations : "FK-24 outbox_id (CASCADE)"
  outbox_generations ||--o{ outbox_attempts : "FK-25 outbox_id,generation (CASCADE)"
  provider_events ||--o| provider_event_matches : "FK-26 provider_event_id (NO ACTION)"
  outbox_generations ||--o{ provider_event_matches : "FK-27 outbox_id,generation (NO ACTION)"
  events ||..o{ outbox_messages : "soft: event_id"
  registrations ||..o{ outbox_messages : "soft: registration_id"
  events ||..o{ scheduled_tasks : "soft: event_id"
  events ||..o{ audit_records : "soft: event_id"
  events ||..o| deletion_markers : "soft: event_id survives deletion"
  outbox_messages ||..o{ provider_events : "soft: tag_outbox_id"
  outbox_messages ||..o{ access_tokens : "soft: issuing message"
  accounts ||..o{ check_ins : "soft: actor_account_id"
  staff_sessions ||..o{ check_ins : "soft: actor_staff_session_id"
  send_budget {
    smallint id PK
  }
  sending_pause {
    smallint id PK
  }
  rate_limit_counters {
    text scope PK
    smallint key_id PK
    bytea key_hash PK
    timestamptz window_start PK
  }
  worker_heartbeats {
    text worker_id PK
  }
  schema_migrations {
    integer version PK
  }
```

## 3. Tables by owning module

Every column is listed. `PK`, `FK` and `UK` (single-column unique, no predicate) are marked; composite and partial unique constraints are in [CONSTRAINTS_AND_INDEXES.md §2](CONSTRAINTS_AND_INDEXES.md#2-unique-constraints-and-unique-indexes).

### 3.1 identity

```mermaid
erDiagram
  accounts {
    uuid id PK
    text email UK
    timestamptz created_at
    timestamptz email_changed_at "nullable"
  }
  sign_in_requests {
    uuid id PK
    text email
    uuid account_id FK "nullable"
    text purpose
    uuid reauth_session_id FK "nullable"
    text status
    timestamptz created_at
    timestamptz expires_at
    timestamptz used_at "nullable"
    timestamptz ended_at "nullable"
  }
  email_change_requests {
    uuid id PK
    uuid account_id FK
    text old_email
    text new_email
    text status
    timestamptz created_at
    timestamptz expires_at
    timestamptz used_at "nullable"
    timestamptz ended_at "nullable"
  }
  organizer_sessions {
    uuid id PK
    uuid account_id FK
    bytea session_hash UK
    smallint hash_alg
    uuid created_from_request_id FK, UK
    timestamptz created_at
    timestamptz authenticated_at
    timestamptz last_seen_at
    timestamptz absolute_expires_at
    timestamptz revoked_at "nullable"
    text revoke_reason "nullable"
  }
  accounts |o--o{ sign_in_requests : "FK-19"
  organizer_sessions |o--o{ sign_in_requests : "FK-20"
  accounts ||--o{ email_change_requests : "FK-21"
  accounts ||--o{ organizer_sessions : "FK-22"
  sign_in_requests ||--o| organizer_sessions : "FK-23"
```

Cross-module foreign keys: FK-01 `events` → `accounts`; FK-11 `access_tokens` → `sign_in_requests`; FK-12 `access_tokens` → `email_change_requests`.

### 3.2 event-core

```mermaid
erDiagram
  events {
    uuid id PK
    uuid owner_account_id FK
    uuid creation_request_id
    bytea creation_fingerprint
    text public_id UK
    text title
    text description "nullable"
    timestamptz starts_at
    text time_zone
    integer capacity
    integer confirmed_count
    text status
    integer schedule_version
    bigint next_waitlist_seq
    timestamptz created_at
    timestamptz updated_at
    timestamptz cancelled_at "nullable"
  }
  registrations {
    uuid id PK
    uuid event_id FK
    text email
    text state
    integer verification_generation
    bigint waitlist_seq "nullable"
    timestamptz created_at
    timestamptz verified_at "nullable"
    timestamptz waitlisted_at "nullable"
    timestamptz confirmed_at "nullable"
    timestamptz ended_at "nullable"
    text end_reason "nullable"
    timestamptz updated_at
  }
  tickets {
    uuid id PK
    uuid registration_id FK, UK
    uuid event_id FK
    text code UK
    timestamptz issued_at
  }
  check_ins {
    uuid id PK
    uuid ticket_id FK
    uuid event_id FK
    timestamptz checked_in_at
    text actor_kind
    uuid actor_account_id "nullable"
    uuid actor_staff_session_id "nullable"
    timestamptz undone_at "nullable"
    uuid undone_by_account_id "nullable"
    text undo_reason "nullable"
  }
  check_in_requests {
    uuid event_id PK, FK
    uuid request_id PK
    text principal_kind
    uuid principal_id
    uuid ticket_id FK "nullable"
    text outcome
    timestamptz first_checked_in_at "nullable"
    timestamptz created_at
  }
  reminder_slots {
    uuid registration_id PK, FK
    integer schedule_version PK
    uuid event_id FK
    uuid outbox_message_id FK, UK
    text filled_by
    timestamptz created_at
  }
  events ||--o{ registrations : "FK-02"
  registrations ||--o| tickets : "FK-03"
  tickets ||--o{ check_ins : "FK-04"
  events ||--o{ check_in_requests : "FK-05"
  tickets |o--o{ check_in_requests : "FK-06"
  registrations ||--o{ reminder_slots : "FK-07"
```

Cross-module foreign keys: FK-01 `events` → `accounts`; FK-08 `reminder_slots` → `outbox_messages`; FK-09 `access_tokens` → `registrations`; FK-14 `staff_invitations` → `events`; FK-16 `rotation_requests` → `registrations`.

### 3.3 access-tokens

```mermaid
erDiagram
  access_tokens {
    uuid id PK
    text token_type
    bytea token_hash UK
    smallint hash_alg
    uuid registration_id FK "nullable"
    uuid staff_invitation_id FK "nullable"
    uuid sign_in_request_id FK "nullable"
    uuid email_change_request_id FK "nullable"
    uuid event_id FK "nullable"
    timestamptz issued_at
    text issued_via
    uuid outbox_message_id "nullable"
    integer attempt_no "nullable"
    timestamptz expires_at "nullable"
    timestamptz revoked_at "nullable"
    text revoke_reason "nullable"
    uuid revoked_by_rotation_id FK "nullable"
  }
```

Cross-module foreign keys: FK-09 `access_tokens` → `registrations`; FK-10 `access_tokens` → `staff_invitations`; FK-11 `access_tokens` → `sign_in_requests`; FK-12 `access_tokens` → `email_change_requests`; FK-13 `access_tokens` → `rotation_requests`; FK-17 `rotation_requests` → `access_tokens`; FK-18 `rotation_requests` → `access_tokens`.

### 3.4 staff

```mermaid
erDiagram
  staff_invitations {
    uuid id PK
    uuid event_id FK
    text invited_email
    text status
    timestamptz created_at
    timestamptz expires_at
    timestamptz accepted_at "nullable"
    timestamptz ended_at "nullable"
  }
  staff_sessions {
    uuid id PK
    uuid event_id FK
    uuid invitation_id FK, UK
    bytea session_hash UK
    smallint hash_alg
    timestamptz created_at
    timestamptz last_seen_at
    timestamptz absolute_expires_at
    timestamptz revoked_at "nullable"
    text revoke_reason "nullable"
  }
  staff_invitations ||--o| staff_sessions : "FK-15"
```

Cross-module foreign keys: FK-10 `access_tokens` → `staff_invitations`; FK-14 `staff_invitations` → `events`.

### 3.5 participant-portal

```mermaid
erDiagram
  rotation_requests {
    uuid id PK
    uuid registration_id FK
    uuid event_id FK
    uuid request_id
    text link_type
    uuid authorizing_token_id FK
    uuid new_token_id FK
    timestamptz decided_at
    uuid outbox_message_id "nullable"
  }
```

Cross-module foreign keys: FK-13 `access_tokens` → `rotation_requests`; FK-16 `rotation_requests` → `registrations`; FK-17 `rotation_requests` → `access_tokens`; FK-18 `rotation_requests` → `access_tokens`.

### 3.6 messaging

```mermaid
erDiagram
  outbox_messages {
    uuid id PK
    text logical_key UK
    text message_type
    text lane
    text regen_class
    boolean is_required_notice
    uuid event_id "nullable"
    uuid registration_id "nullable"
    uuid account_id "nullable"
    uuid staff_invitation_id "nullable"
    uuid sign_in_request_id "nullable"
    uuid email_change_request_id "nullable"
    integer schedule_version "nullable"
    integer verification_generation "nullable"
    uuid request_ref "nullable"
    text recipient_email
    jsonb payload
    text status
    boolean possibly_accepted
    smallint current_generation
    integer attempt_no
    integer preclaim_failures
    timestamptz lease_expires_at "nullable"
    timestamptz next_attempt_at
    timestamptz horizon_at
    timestamptz awaiting_evidence_since "nullable"
    timestamptz created_at
    timestamptz settled_at "nullable"
    text settle_reason "nullable"
    text last_error_code "nullable"
    timestamptz evidence_anomaly_at "nullable"
    text correlation_id
  }
  outbox_generations {
    uuid outbox_id PK, FK
    smallint generation PK
    text provider_key UK
    timestamptz created_at
    text regen_reason "nullable"
    text provider_message_id "nullable"
    timestamptz accepted_at "nullable"
    timestamptz delivered_at "nullable"
    timestamptz bounced_at "nullable"
    timestamptz failed_at "nullable"
    timestamptz suppressed_at "nullable"
    timestamptz complained_at "nullable"
    timestamptz last_delayed_at "nullable"
    text failure_reason "nullable"
    timestamptz facts_updated_at "nullable"
  }
  outbox_attempts {
    uuid id PK
    uuid outbox_id FK
    smallint generation FK
    integer attempt_no
    text worker_id
    timestamptz claimed_at
    timestamptz lease_expires_at
    timestamptz send_started_at "nullable"
    timestamptz lease_expired_at "nullable"
    timestamptz result_at "nullable"
    text result_category "nullable"
    integer http_status "nullable"
    text provider_message_id "nullable"
    boolean possibly_accepted "nullable"
    boolean stale
    text error_code "nullable"
    integer latency_ms "nullable"
  }
  provider_events {
    uuid id PK
    text svix_id UK
    text event_type
    text provider_email_id "nullable"
    uuid tag_outbox_id "nullable"
    smallint tag_generation "nullable"
    timestamptz provider_created_at "nullable"
    timestamptz received_at
    text bounce_kind "nullable"
    text reason_masked "nullable"
    jsonb payload_masked
  }
  provider_event_matches {
    uuid provider_event_id PK, FK
    uuid outbox_id FK
    smallint generation FK
    text method
    timestamptz matched_at
  }
  send_budget {
    smallint id PK
    integer config_version
    bytea config_fingerprint "nullable"
    timestamptz config_synced_at "nullable"
    text config_synced_by "nullable"
    numeric rate_p "nullable"
    numeric burst_p "nullable"
    numeric rate_b "nullable"
    numeric burst_b "nullable"
    numeric rate_b_min "nullable"
    numeric rate_p_current "nullable"
    numeric rate_b_current "nullable"
    numeric tokens_p
    numeric tokens_b
    timestamptz retry_after_until "nullable"
    timestamptz last_429_at "nullable"
    timestamptz last_recovery_at "nullable"
    timestamptz updated_at
  }
  sending_pause {
    smallint id PK
    boolean paused
    text reason "nullable"
    timestamptz paused_at "nullable"
    timestamptz cleared_at "nullable"
    text cleared_by "nullable"
    boolean webhook_endpoint_disabled
  }
  outbox_messages ||--o{ outbox_generations : "FK-24"
  outbox_generations ||--o{ outbox_attempts : "FK-25"
  provider_events ||--o| provider_event_matches : "FK-26"
  outbox_generations ||--o{ provider_event_matches : "FK-27"
```

Cross-module foreign keys: FK-08 `reminder_slots` → `outbox_messages`.

### 3.7 jobs

```mermaid
erDiagram
  scheduled_tasks {
    uuid id PK
    text kind
    uuid event_id
    integer schedule_version
    timestamptz due_at
    text status
    integer attempt_no
    timestamptz lease_expires_at "nullable"
    uuid cursor_registration_id "nullable"
    jsonb params
    text last_error_code "nullable"
    timestamptz created_at
    timestamptz finished_at "nullable"
  }
```

### 3.8 audit

```mermaid
erDiagram
  audit_records {
    uuid id PK
    timestamptz occurred_at
    text action
    text actor_kind
    uuid actor_account_id "nullable"
    uuid actor_staff_session_id "nullable"
    uuid event_id "nullable"
    uuid registration_id "nullable"
    uuid ticket_id "nullable"
    uuid subject_id "nullable"
    text outcome
    jsonb details
  }
  deletion_markers {
    uuid event_id PK
    uuid owner_account_id
    timestamptz scheduled_start
    text time_zone
    timestamptz deleted_at
    uuid deleted_by_account_id
    integer registrations_deleted
    integer failed_required_notices
    integer unconfirmed_required_notices
  }
```

### 3.9 platform

```mermaid
erDiagram
  rate_limit_counters {
    text scope PK
    smallint key_id PK
    bytea key_hash PK
    timestamptz window_start PK
    integer count
    timestamptz expires_at
  }
  worker_heartbeats {
    text worker_id PK
    text process_kind
    timestamptz started_at
    timestamptz last_beat_at
    text build_version
    bytea config_fingerprint "nullable"
    integer slots_priority
    integer slots_bulk
  }
  schema_migrations {
    integer version PK
    text name
    bytea checksum
    timestamptz applied_at
    text applied_by
    integer duration_ms
  }
```

## 4. Lifecycle notes

| Relationship | Lifecycle rule | Label |
|---|---|---|
| `events` → event-owned rows | Deleting an eligible event cascades to registrations, tickets, check-ins, check-in requests, reminder slots, event-scoped tokens, staff invitations and sessions, and rotation requests (FR-EVT-10). Outbox rows, tasks, provider events, audit records and the deletion marker remain. | [REQ: FR-EVT-10, FR-EVT-14, NFR-CON-6]; [ARCH: D-8] |
| `registrations` → `tickets` | Created by verification or promotion; never deleted on cancellation, so a scan can return `TICKET_CANCELLED` | [REQ: BR-8, FR-CHK-4] |
| `tickets` → `check_ins` | Check-in inserts a row; undo closes it; a new check-in inserts a new row | [REC] (DATABASE_DESIGN §8) |
| `outbox_messages` → `outbox_generations` | Generation 1 is created at the message's first claim (TX-M01), so enqueue writes one row per message. Generation 2 is created only by a class B regeneration (TX-M08). | [REQ: NFR-REL-16] |
| `provider_events` → `provider_event_matches` | The event is inserted once (deduplicated by `svix-id`); the match is inserted when known, possibly later | [REQ: NFR-REL-15] |
| Accounts | Rows referencing accounts use `NO ACTION`. Account deletion is undecided. | [OPEN: OQ-17] |
| Retention | No purge relationships are designed yet | [OPEN: OQ-5] |
