# Constraints, Indexes and Triggers

| | |
|---|---|
| **Status** | Database design — see [DATABASE_DESIGN.md](DATABASE_DESIGN.md) for the decision register |
| **Design target** | PostgreSQL 18 |
| **Requirements baseline** | [REQUIREMENTS.md](../../REQUIREMENTS.md) v1.7 |

**Labels:**
- **REQ:** the constraint itself is required. A requirement demands database enforcement, for example BR-2's partial unique index or NFR-CON-5's `CHECK`.
- **ARCH:** follows from an approved decision (ADR or D-n).
- **REC:** a design recommendation; it implements a requirement but its database form is my proposal.

Open questions and risks are collected in §9.

Column names refer to [DATABASE_DESIGN.md §5](DATABASE_DESIGN.md#5-table-definitions). Constraint names in migrations will follow the pattern `<table>_<id>`, for example `registrations_u08`. **[REC]**

---

## 1. Primary keys

| ID | Table | Columns | Trace | Label |
|---|---|---|---|---|
| PK-01 | `accounts` | `id` | FR-ORG-1 | REC |
| PK-02 | `sign_in_requests` | `id` | FR-ORG-3 | REC |
| PK-03 | `email_change_requests` | `id` | FR-ORG-6 | REC |
| PK-04 | `organizer_sessions` | `id` | FR-ORG-4 | REC |
| PK-05 | `events` | `id` | FR-EVT-1 | REC |
| PK-06 | `registrations` | `id` | FR-REG-2 | REC |
| PK-07 | `tickets` | `id` | FR-TKT-1 | REC |
| PK-08 | `check_ins` | `id` | FR-CHK-2, FR-CHK-8 | REC |
| PK-09 | `check_in_requests` | `event_id`, `request_id` | FR-CHK-3, D-5 | ARCH |
| PK-10 | `reminder_slots` | `registration_id`, `schedule_version` | FR-NTF-1 (atomic slot claim by uniqueness) | REQ |
| PK-11 | `access_tokens` | `id` | ADR-012 | REC |
| PK-12 | `staff_invitations` | `id` | FR-STAFF-1 | REC |
| PK-13 | `staff_sessions` | `id` | FR-STAFF-2 | REC |
| PK-14 | `rotation_requests` | `id` | FR-ROT-11 | REC |
| PK-15 | `outbox_messages` | `id` | NFR-REL-1 | REC |
| PK-16 | `outbox_generations` | `outbox_id`, `generation` | NFR-REL-16, D-11 | ARCH |
| PK-17 | `outbox_attempts` | `id` | NFR-REL-9, D-2 | REC |
| PK-18 | `provider_events` | `id` | NFR-REL-15 | REC |
| PK-19 | `provider_event_matches` | `provider_event_id` | NFR-REL-15 d | REC |
| PK-20 | `send_budget` | `id` | NFR-REL-14 | REC |
| PK-21 | `sending_pause` | `id` | NFR-REL-13 b | REC |
| PK-22 | `scheduled_tasks` | `id` | NFR-REL-5 | REC |
| PK-23 | `audit_records` | `id` | NFR-SEC-5 | REC |
| PK-24 | `deletion_markers` | `event_id` | FR-EVT-14 | REC |
| PK-25 | `rate_limit_counters` | `scope`, `key_id`, `key_hash`, `window_start` | NFR-SEC-3, D-6 | ARCH |
| PK-26 | `worker_heartbeats` | `worker_id` | NFR-OPS-1 | REC |
| PK-27 | `schema_migrations` | `version` | ENG-CI-5 | REC |

## 2. Unique constraints and unique indexes

| ID | Table | Columns | Predicate | Purpose | Trace | Label |
|---|---|---|---|---|---|---|
| U-01 | `accounts` | `email` | — | One account per address; safety net for email change and creation | FR-ORG-6, NFR-CON-7 c | REQ |
| U-02 | `sign_in_requests` | `email` | `status = 'active'` | At most one active request per address | FR-ORG-3 b | REQ |
| U-03 | `email_change_requests` | `account_id` | `status = 'active'` | At most one active change per account | FR-ORG-6 | REQ |
| U-04 | `organizer_sessions` | `session_hash` | — | Hash lookup | FR-ORG-4 | REC |
| U-05 | `organizer_sessions` | `created_from_request_id` | — | At most one session per used request | FR-ORG-3 e, AC-147, AC-157 c | REC |
| U-06 | `events` | `public_id` | — | Unguessable public URL | FR-EVT-12, AC-123 | REC |
| U-07 | `registrations` | `id`, `event_id` | — | Target of the composite foreign keys FK-03, FK-07, FK-09, FK-16 | NFR-CON-4 d | REC |
| U-08 | `registrations` | `event_id`, `email` | `state IN ('PENDING_VERIFICATION','CONFIRMED','WAITLISTED')` | One active registration per (event, normalized email) | BR-2, FR-REG-6, NFR-CON-2 | REQ |
| U-09 | `registrations` | `event_id`, `waitlist_seq` | `waitlist_seq IS NOT NULL` | Distinct FIFO positions | FR-WL-1, EC-1, AC-4 | REC |
| U-10 | `tickets` | `code` | — | Unique ticket codes | FR-TKT-2, BR-8, NFR-CON-2 | REQ |
| U-11 | `tickets` | `registration_id` | — | At most one ticket per registration | FR-TKT-1, §2.2 | REC |
| U-12 | `tickets` | `id`, `event_id` | — | Target of FK-04 and FK-06 | — | REC |
| U-13 | `check_ins` | `ticket_id` | `undone_at IS NULL` | Checked in at most once at any time | BR-7, FR-CHK-2, NFR-CON-2 | REQ |
| U-14 | `reminder_slots` | `outbox_message_id` | — | One message fills at most one slot | FR-NTF-2a | REC |
| U-15 | `access_tokens` | `token_hash` | — | Hash lookup | FR-LNK-1, ADR-012 | ARCH |
| U-16 | `staff_invitations` | `id`, `event_id` | — | Target of FK-10 and FK-15 | — | REC |
| U-17 | `staff_invitations` | `event_id`, `invited_email` | `status = 'pending'` | A re-invitation replaces the pending invitation | FR-STAFF-5 | REC |
| U-18 | `staff_sessions` | `session_hash` | — | Hash lookup | FR-STAFF-2 | REC |
| U-19 | `staff_sessions` | `invitation_id` | — | Accepting twice grants access once | FR-STAFF-1, FR-STAFF-6 | REC |
| U-20 | `rotation_requests` | `registration_id`, `request_id` | — | Request IDs are single-use forever | FR-ROT-11, BR-28 | REQ |
| U-21 | `outbox_messages` | `logical_key` | — | Exactly one logical message per key | NFR-REL-3, §4.9 | REQ |
| U-22 | `outbox_generations` | `provider_key` | — | One provider key per generation | NFR-REL-16 | ARCH |
| U-23 | `outbox_generations` | `provider_message_id` | `provider_message_id IS NOT NULL` | Webhook matching by provider ID | NFR-REL-15 d | REC |
| U-24 | `outbox_attempts` | `outbox_id`, `attempt_no` | — | One attempt row per claim | NFR-REL-9 | REC |
| U-25 | `provider_events` | `svix_id` | — | The **only** deduplication rule | NFR-REL-15 c, AC-160, AC-166 | REQ |
| U-26 | `scheduled_tasks` | `kind`, `event_id`, `schedule_version` | — | One task of each kind per version | AC-28, AC-32, FR-WL-5 | REC |
| U-27 | `events` | `owner_account_id`, `creation_request_id` | — | Idempotent event creation per organizer | FR-EVT-1, AC-185, D-17 | REQ |

**No other uniqueness exists on `provider_events`** **[REQ: NFR-REL-15 c]**: two legitimate events sharing provider ID, type and timestamp are both stored (AC-166).

## 3. Foreign keys

Every foreign key's child columns have a supporting index, so cascades and checks never scan a whole table.

| ID | Child table | Child columns | Parent table | Parent columns | On delete | Deferrable | Supporting index | Trace | Label |
|---|---|---|---|---|---|---|---|---|---|
| FK-01 | `events` | `owner_account_id` | `accounts` | `id` | NO ACTION | no | IX-01 | §3 ownership; OQ-17 decides account deletion | REC |
| FK-02 | `registrations` | `event_id` | `events` | `id` | CASCADE | no | IX-07 | FR-EVT-10 (pending and terminal registrations deleted with the event) | REQ |
| FK-03 | `tickets` | `registration_id`, `event_id` | `registrations` | `id`, `event_id` | CASCADE | no | U-11 | FR-TKT-1; event consistency | REC |
| FK-04 | `check_ins` | `ticket_id`, `event_id` | `tickets` | `id`, `event_id` | CASCADE | no | IX-08 | BR-7, §8 of DATABASE_DESIGN | REC |
| FK-05 | `check_in_requests` | `event_id` | `events` | `id` | CASCADE | no | PK-09 | FR-CHK-3 | REC |
| FK-06 | `check_in_requests` | `ticket_id`, `event_id` | `tickets` | `id`, `event_id` | CASCADE | no | IX-10 | FR-CHK-3 | REC |
| FK-07 | `reminder_slots` | `registration_id`, `event_id` | `registrations` | `id`, `event_id` | CASCADE | no | PK-10 | FR-NTF-1 | REC |
| FK-08 | `reminder_slots` | `outbox_message_id` | `outbox_messages` | `id` | NO ACTION | **INITIALLY DEFERRED** | U-14 | FR-NTF-2a, FR-NTF-2b (claim the slot first, then create the message) | REC |
| FK-09 | `access_tokens` | `registration_id`, `event_id` | `registrations` | `id`, `event_id` | CASCADE | no | IX-11 | FR-EVT-10 (tokens stop working), AC-102 | REC |
| FK-10 | `access_tokens` | `staff_invitation_id`, `event_id` | `staff_invitations` | `id`, `event_id` | CASCADE | no | IX-12 | FR-STAFF-5 | REC |
| FK-11 | `access_tokens` | `sign_in_request_id` | `sign_in_requests` | `id` | CASCADE | no | IX-13 | FR-ORG-3 | REC |
| FK-12 | `access_tokens` | `email_change_request_id` | `email_change_requests` | `id` | CASCADE | no | IX-14 | FR-ORG-6 | REC |
| FK-13 | `access_tokens` | `revoked_by_rotation_id` | `rotation_requests` | `id` | NO ACTION | no | IX-15 | FR-ROT-11 a | REC |
| FK-14 | `staff_invitations` | `event_id` | `events` | `id` | CASCADE | no | IX-16 | FR-STAFF-4, FR-STAFF-5 (deleted event) | REC |
| FK-15 | `staff_sessions` | `invitation_id`, `event_id` | `staff_invitations` | `id`, `event_id` | CASCADE | no | U-19 | FR-STAFF-2 (access ends when the event is deleted) | REC |
| FK-16 | `rotation_requests` | `registration_id`, `event_id` | `registrations` | `id`, `event_id` | CASCADE | no | U-20 | FR-ROT-11 | REC |
| FK-17 | `rotation_requests` | `new_token_id` | `access_tokens` | `id` | NO ACTION | no | IX-18 | FR-ROT-3 | REC |
| FK-18 | `rotation_requests` | `authorizing_token_id` | `access_tokens` | `id` | NO ACTION | no | IX-19 | FR-ROT-9, FR-ROT-11 | REC |
| FK-19 | `sign_in_requests` | `account_id` | `accounts` | `id` | NO ACTION | no | IX-02 | FR-ORG-3; OQ-17 | REC |
| FK-20 | `sign_in_requests` | `reauth_session_id` | `organizer_sessions` | `id` | NO ACTION | no | IX-03 | FR-ORG-5 | REC |
| FK-21 | `email_change_requests` | `account_id` | `accounts` | `id` | NO ACTION | no | IX-04 | FR-ORG-6; OQ-17 | REC |
| FK-22 | `organizer_sessions` | `account_id` | `accounts` | `id` | NO ACTION | no | IX-05 | FR-ORG-4; OQ-17 | REC |
| FK-23 | `organizer_sessions` | `created_from_request_id` | `sign_in_requests` | `id` | NO ACTION | no | U-05 | FR-ORG-3 e | REC |
| FK-24 | `outbox_generations` | `outbox_id` | `outbox_messages` | `id` | CASCADE | no | PK-16 | NFR-REL-16 | REC |
| FK-25 | `outbox_attempts` | `outbox_id`, `generation` | `outbox_generations` | `outbox_id`, `generation` | CASCADE | no | U-24 | NFR-REL-9 | REC |
| FK-26 | `provider_event_matches` | `provider_event_id` | `provider_events` | `id` | NO ACTION | no | PK-19 | NFR-REL-15 d | REC |
| FK-27 | `provider_event_matches` | `outbox_id`, `generation` | `outbox_generations` | `outbox_id`, `generation` | NO ACTION | no | IX-29 | NFR-REL-15 d | REC |

**Notes:**
- **Composite foreign keys** use `MATCH SIMPLE`, so FK-06, FK-09 and FK-10 aren't checked when their first column is NULL. This is how a single `access_tokens` table carries type-specific owner references (CK-35).
- **No foreign key on purpose** **[REQ: NFR-CON-6; ARCH: D-8]**: `audit_records`, `deletion_markers`, `scheduled_tasks.event_id`, every soft reference in `outbox_messages`, `provider_events.tag_*`, `access_tokens.outbox_message_id`, `rotation_requests.outbox_message_id`, and the actor columns of `check_ins` and `check_in_requests`.
- **Identity-lock rule.** Apart from FK-01, no table written in an event-locked transaction has a foreign key to `accounts` or `organizer_sessions`. Otherwise foreign-key checks would take key-share locks on account rows inside event-locked transactions, against NFR-CON-7 (e). FK-01 is checked only when an event is created, and that transaction holds no event lock ([TRANSACTIONS_AND_LOCKING.md §4.3](TRANSACTIONS_AND_LOCKING.md#43-foreign-key-induced-locks)). **[REC]**
- **Circular references** (FK-13 with FK-17 and FK-18; FK-20 with FK-23) use `NO ACTION`. It is checked at the end of the statement, so the cascades from a single event deletion pass. A migration test covers this (MIGRATIONS_STRATEGY.md T-M6).
- **FK-27 and contradicting evidence:** when a verified event matches a generation that has no row yet (a message dropped before any claim), TX-M10 inserts the generation row first (D-13).
- **`RESTRICT` is never used:** it can't be deferred, and `NO ACTION` gives the same protection.

## 4. Check constraints

| ID | Table | Columns | Rule | Trace | Label |
|---|---|---|---|---|---|
| CK-01 | `accounts` | `email` | Normalized email format (DATABASE_DESIGN §3) | Q8 | REC |
| CK-02 | `sign_in_requests` | `email` | Normalized email format | Q8 | REC |
| CK-03 | `sign_in_requests` | `purpose` | `purpose IN ('sign_in','reauth')` | FR-ORG-3, FR-ORG-5 | REC |
| CK-04 | `sign_in_requests` | `status` | `status IN ('active','used','replaced','revoked')` | FR-ORG-3 | REC |
| CK-05 | `sign_in_requests` | `purpose`, `account_id`, `reauth_session_id` | `(purpose = 'reauth') = (reauth_session_id IS NOT NULL)` and `(purpose <> 'reauth' OR account_id IS NOT NULL)` | FR-ORG-5 | REC |
| CK-06 | `sign_in_requests` | `status`, `ended_at`, `used_at`, `expires_at`, `created_at` | `(status = 'active') = (ended_at IS NULL)`; `(status = 'used') = (used_at IS NOT NULL)`; `expires_at > created_at` | FR-ORG-3 c, e | REC |
| CK-07 | `email_change_requests` | `old_email`, `new_email` | Both normalized; `new_email <> old_email` | FR-ORG-6 | REC |
| CK-08 | `email_change_requests` | `status` | `status IN ('active','used','replaced','revoked','failed')` | FR-ORG-6, FR-ORG-8 | REC |
| CK-09 | `email_change_requests` | `status`, `ended_at`, `used_at`, `expires_at`, `created_at` | Same lifecycle rule as CK-06 | FR-ORG-6 | REC |
| CK-10 | `organizer_sessions` | `hash_alg`, `session_hash` | `hash_alg = 1 AND octet_length(session_hash) = 32` (widened when an algorithm is added) | D-6, NFR-SEC-1 | ARCH |
| CK-11 | `organizer_sessions` | `revoked_at`, `revoke_reason` | Both NULL or both set; `revoke_reason IN ('sign_out','sign_out_everywhere','reauth_replaced','email_changed')` | FR-ORG-4, FR-ORG-5, FR-ORG-6 | REC |
| CK-12 | `organizer_sessions` | `absolute_expires_at`, `authenticated_at`, `created_at` | `absolute_expires_at > created_at AND authenticated_at >= created_at` | FR-ORG-4 | REC |
| CK-13 | `events` | `title` | `char_length(title) BETWEEN 1 AND 200` | FR-EVT-1 (limits are an assumption) | REC |
| CK-14 | `events` | `description` | `description IS NULL OR char_length(description) <= 5000` | FR-EVT-1 | REC |
| CK-15 | `events` | `capacity` | `capacity >= 1` | NFR-CON-5, FR-EVT-1 | REQ |
| CK-16 | `events` | `confirmed_count`, `capacity` | `confirmed_count >= 0 AND confirmed_count <= capacity`, **not deferrable** | NFR-CON-5, BR-1, BR-11 | REQ |
| CK-17 | `events` | `status` | `status IN ('SCHEDULED','CANCELLED')` | §2.3 | REC |
| CK-18 | `events` | `status`, `cancelled_at` | `(status = 'CANCELLED') = (cancelled_at IS NOT NULL)` | FR-EVT-9 | REC |
| CK-19 | `events` | `schedule_version`, `next_waitlist_seq` | Both `>= 1` | Glossary, FR-WL-1 | REC |
| CK-20 | `events` | `public_id` | `public_id ~ '^[A-Za-z0-9_-]{22,}$'` (at least 128 bits) | FR-EVT-12 | REC |
| CK-21 | `events` | `time_zone` | `char_length(time_zone) BETWEEN 1 AND 64` (validity is checked by the application) | FR-EVT-2, NFR-TIME-1 | REC |
| CK-22 | `registrations` | `email` | Normalized email format | Q8, EC-10, EC-11 | REC |
| CK-23 | `registrations` | `state` | The five states of §2.2 | §2.2 | REC |
| CK-24 | `registrations` | `state`, `ended_at`, `end_reason` | Terminal ⇔ `ended_at` and `end_reason` set. `CANCELLED` ⇒ `end_reason IN ('participant_cancelled','removed_by_organizer','event_cancelled')`. `EXPIRED` ⇒ `end_reason IN ('cutoff','event_cancelled')`. | §2.2, BR-16, D-3 | ARCH |
| CK-25 | `registrations` | `state`, `waitlist_seq`, `waitlisted_at` | `state = 'WAITLISTED'` ⇒ both set | FR-WL-1 | REC |
| CK-26 | `registrations` | `state`, `confirmed_at` | `state = 'CONFIRMED'` ⇒ `confirmed_at` set | FR-NTF-2 | REC |
| CK-27 | `registrations` | `verification_generation` | `>= 1` | FR-REG-7 | REC |
| CK-28 | `tickets` | `code` | `code ~ '^[0-9A-HJKMNP-TV-Z]{12}$'` (follows FR-TKT-1's example format, itself an assumption) | FR-TKT-1, AC-122 | REC |
| CK-29 | `check_ins` | `actor_kind`, `actor_account_id`, `actor_staff_session_id` | `owner` ⇒ account set and staff session NULL; `staff` ⇒ staff session set and account NULL | FR-CHK-8, §3 | REC |
| CK-30 | `check_ins` | `undone_at`, `undone_by_account_id`, `undo_reason` | `undone_at` and `undone_by_account_id` both NULL or both set; `undo_reason` only when undone, at most 500 characters | FR-CHK-8 | REC |
| CK-31 | `check_in_requests` | `outcome`, `principal_kind` | `outcome IN ('CHECKED_IN','ALREADY_CHECKED_IN','INVALID_CODE','WRONG_EVENT','TICKET_CANCELLED','EVENT_CANCELLED','OUTSIDE_CHECK_IN_WINDOW')`; `principal_kind IN ('owner','staff')` | FR-CHK-4, D-5 | REC |
| CK-32 | `reminder_slots` | `filled_by`, `schedule_version` | `filled_by IN ('reminder','ticket','promotion','event_change')`; `schedule_version >= 1` | FR-NTF-2, FR-NTF-3 | REC |
| CK-33 | `access_tokens` | `token_type` | The six types | ADR-012 | ARCH |
| CK-34 | `access_tokens` | `hash_alg`, `token_hash` | `hash_alg = 1 AND octet_length(token_hash) = 32` | D-6 | ARCH |
| CK-35 | `access_tokens` | `token_type`, `registration_id`, `staff_invitation_id`, `sign_in_request_id`, `email_change_request_id` | `num_nonnulls(<four owner columns>) = 1`, and the non-null owner matches the type | ADR-012 | ARCH |
| CK-36 | `access_tokens` | `token_type`, `event_id` | `(event_id IS NOT NULL) = (token_type IN ('verification','management','share','staff_invitation'))` | NFR-CON-4 b | REC |
| CK-37 | `access_tokens` | `issued_via`, `token_type`, `outbox_message_id`, `attempt_no` | `issued_via IN ('page','email')`; `page` ⇒ type is `management` or `share`; `email` ⇔ `outbox_message_id` and `attempt_no` set | FR-LNK-2, FR-LNK-3 | REC |
| CK-38 | `access_tokens` | `token_type`, `expires_at` | `(expires_at IS NOT NULL) = (token_type = 'verification')` | FR-REG-3; ADR-012 (fixed vs. derived expiry) | ARCH |
| CK-39 | `access_tokens` | `revoked_at`, `revoke_reason`, `revoked_by_rotation_id` | Both of the first two NULL or both set; reason in the list; `revoked_by_rotation_id` set ⇒ `revoke_reason = 'rotated'` | FR-ROT-3, FR-REG-7, FR-STAFF-5 | REC |
| CK-40 | `staff_invitations` | `invited_email` | Normalized email format | FR-STAFF-1 | REC |
| CK-41 | `staff_invitations` | `status`, `ended_at`, `accepted_at` | `status IN ('pending','accepted','revoked','replaced')`; `(status = 'pending') = (ended_at IS NULL)`; `(status = 'accepted') = (accepted_at IS NOT NULL)` | FR-STAFF-5 | REC |
| CK-42 | `staff_invitations` | `expires_at`, `created_at` | `expires_at > created_at` | FR-STAFF-5 | REC |
| CK-43 | `staff_sessions` | `hash_alg`, `session_hash` | `hash_alg = 1 AND octet_length(session_hash) = 32` | D-6 | ARCH |
| CK-44 | `staff_sessions` | `revoked_at`, `revoke_reason` | Both NULL or both set | FR-STAFF-3 | REC |
| CK-45 | `staff_sessions` | `absolute_expires_at`, `created_at` | `absolute_expires_at > created_at` | D-4 | ARCH |
| CK-46 | `rotation_requests` | `link_type`, `outbox_message_id` | `link_type IN ('management','share')`; `(outbox_message_id IS NOT NULL) = (link_type = 'management')` | FR-ROT-5 | REC |
| CK-47 | `outbox_messages` | `status` | The eight NFR-REL-13 states | NFR-REL-13 a | REQ |
| CK-48 | `outbox_messages` | `message_type`, `regen_class`, `lane`, `is_required_notice` | Exactly the 17 (type, class, lane, required) rows of DATABASE_DESIGN §5.6.1 | §4.9, NFR-REL-12, NFR-REL-16, AC-170 | REQ |
| CK-49 | `outbox_messages` | `status`, `settled_at`, `settle_reason` | Pending ⇔ `settled_at IS NULL AND settle_reason IS NULL` | NFR-REL-2 | REC |
| CK-50 | `outbox_messages` | `status`, `possibly_accepted` | `NOT (status = 'FAILED' AND possibly_accepted)` | NFR-REL-13 c, d | REQ |
| CK-51 | `outbox_messages` | `status`, `possibly_accepted` | `NOT (status = 'DROPPED' AND possibly_accepted)` | D-12 | ARCH |
| CK-52 | `outbox_messages` | `status`, `possibly_accepted` | `status = 'UNCONFIRMED'` ⇒ `possibly_accepted` | NFR-REL-13 d, D-12 | ARCH |
| CK-53 | `outbox_messages` | `status`, `settle_reason` | Allowed reasons per settled status (DATABASE_DESIGN §5.6.2) | D-12, NFR-REL-11 | ARCH |
| CK-54 | `outbox_messages` | `status`, `lease_expires_at` | `status = 'SENDING'` ⇒ `lease_expires_at` set | NFR-REL-9 | REC |
| CK-55 | `outbox_messages` | `status`, `awaiting_evidence_since`, `possibly_accepted` | `status = 'AWAITING_EVIDENCE'` ⇒ `awaiting_evidence_since` set and `possibly_accepted` | NFR-REL-13 b, Glossary "Possibly accepted" | REQ |
| CK-56 | `outbox_messages` | `current_generation`, `regen_class` | `current_generation IN (1,2)`; `current_generation = 2` ⇒ `regen_class = 'B'` | NFR-REL-16 | REQ |
| CK-57 | `outbox_messages` | `attempt_no`, `preclaim_failures` | `attempt_no >= 0 AND preclaim_failures >= 0` | NFR-REL-9, NFR-REL-13 h | REC |
| CK-58 | `outbox_messages` | `payload`, `recipient_email` | `jsonb_typeof(payload) = 'object'`; normalized email format | BR-19, D-7 | REC |
| CK-59 | `outbox_generations` | `generation` | `generation IN (1,2)` | NFR-REL-16 | REQ |
| CK-60 | `outbox_attempts` | `result_category`, `result_at`, `send_started_at`, `claimed_at` | Category in the list (DATABASE_DESIGN §5.6); `(result_at IS NULL) = (result_category IS NULL)`; `send_started_at IS NULL OR send_started_at >= claimed_at` | NFR-REL-13 b, D-2 | ARCH |
| CK-61 | `provider_event_matches` | `method` | `method IN ('tag','provider_id')` | NFR-REL-15 d | REC |
| CK-62 | `send_budget` | `id`, `config_version`, `rate_p`, `burst_p`, `rate_b`, `burst_b`, `rate_b_min`, `tokens_p`, `tokens_b` | `id = 1`. `config_version > 0` ⇒ all configured values set and positive, and `rate_b_min <= rate_b`. `0 <= tokens_p <= coalesce(burst_p, 0)`. `0 <= tokens_b <= coalesce(burst_b, 0)`. | NFR-REL-14, D-10 | ARCH |
| CK-63 | `sending_pause` | `id`, `paused`, `paused_at`, `reason` | `id = 1`; `paused` ⇒ `paused_at` and `reason` set | NFR-REL-13 b | REC |
| CK-64 | `scheduled_tasks` | `kind`, `status`, `lease_expires_at`, `params` | Kind and status in their lists; `RUNNING` ⇒ lease set; `params` is an object | NFR-REL-5 | REC |
| CK-65 | `audit_records` | `actor_kind`, `details` | `actor_kind` in its list; `details` is an object | NFR-SEC-5 | REC |
| CK-66 | `deletion_markers` | `registrations_deleted`, `failed_required_notices`, `unconfirmed_required_notices` | All `>= 0` | FR-EVT-14, D-14 | REC |
| CK-67 | `rate_limit_counters` | `count`, `expires_at`, `window_start` | `count >= 1 AND expires_at > window_start` | NFR-SEC-3 | REC |
| CK-68 | `worker_heartbeats` | `slots_priority`, `slots_bulk` | `slots_priority >= 1 AND slots_bulk >= 0` | NFR-REL-12 a, NFR-REL-14 g | REQ |
| CK-69 | `outbox_messages` | `is_required_notice`, `status` | `NOT (is_required_notice AND status = 'DROPPED')` | BR-23, BR-29, FR-EVT-10 | REQ |
| CK-70 | `events` | `creation_fingerprint` | `octet_length(creation_fingerprint) = 32` | FR-EVT-1, D-17 | REC |

## 5. Non-unique indexes

| ID | Table | Columns | Predicate | Purpose | Trace | Label |
|---|---|---|---|---|---|---|
| IX-01 | `events` | `owner_account_id`, `starts_at` | — | Owner's event list; FK-01 | FR-DSH | REC |
| IX-02 | `sign_in_requests` | `account_id` | `account_id IS NOT NULL` | FK-19; revoke an account's active requests | FR-ORG-6 | REC |
| IX-03 | `sign_in_requests` | `reauth_session_id` | `reauth_session_id IS NOT NULL` | FK-20 | FR-ORG-5 | REC |
| IX-04 | `email_change_requests` | `account_id` | — | FK-21 | FR-ORG-6 | REC |
| IX-05 | `organizer_sessions` | `account_id` | — | FK-22; sign out everywhere | FR-ORG-4 | REC |
| IX-06 | `registrations` | `event_id`, `waitlist_seq` | `state = 'WAITLISTED'` | Waiting-list head, positions, waiting count | FR-WL-2, FR-WL-7, FR-DSH-1 | REC |
| IX-07 | `registrations` | `event_id`, `state` | — | FK-02 cascade; per-state scans (cancellation, fan-out, cutoff) | FR-EVT-10, BR-16 | REC |
| IX-08 | `check_ins` | `ticket_id` | — | FK-04 cascade; history | FR-CHK-8 | REC |
| IX-09 | `check_ins` | `event_id` | `undone_at IS NULL` | Checked-in count | FR-DSH-1, FR-DSH-3, NFR-PERF-2 | REC |
| IX-10 | `check_in_requests` | `ticket_id` | `ticket_id IS NOT NULL` | FK-06 | — | REC |
| IX-11 | `access_tokens` | `registration_id`, `token_type` | — | FK-09; rotation revokes all tokens of one type | FR-ROT-3, FR-REG-7 | REC |
| IX-12 | `access_tokens` | `staff_invitation_id` | `staff_invitation_id IS NOT NULL` | FK-10; invitation revocation | FR-STAFF-5 | REC |
| IX-13 | `access_tokens` | `sign_in_request_id` | `sign_in_request_id IS NOT NULL` | FK-11 | FR-ORG-3 | REC |
| IX-14 | `access_tokens` | `email_change_request_id` | `email_change_request_id IS NOT NULL` | FK-12 | FR-ORG-6 | REC |
| IX-15 | `access_tokens` | `revoked_by_rotation_id` | `revoked_by_rotation_id IS NOT NULL` | FK-13 | FR-ROT-11 | REC |
| IX-16 | `staff_invitations` | `event_id` | — | FK-14; owner's staff list | FR-STAFF-5 | REC |
| IX-17 | `staff_sessions` | `event_id` | `revoked_at IS NULL` | Owner's list of active staff sessions | FR-STAFF-6 | REC |
| IX-18 | `rotation_requests` | `new_token_id` | — | FK-17 | — | REC |
| IX-19 | `rotation_requests` | `authorizing_token_id` | — | FK-18 | — | REC |
| IX-20 | `outbox_messages` | `lane`, `next_attempt_at`, `id` | `status IN ('QUEUED','WAITING_RETRY')` | Claim candidates, oldest-due first | NFR-REL-14 e, NFR-CON-4 e | REQ (fairness rule); index REC |
| IX-21 | `outbox_messages` | `lease_expires_at`, `id` | `status = 'SENDING'` | Lease reaper | NFR-REL-9 | REC |
| IX-22 | `outbox_messages` | `awaiting_evidence_since`, `id` | `status = 'AWAITING_EVIDENCE'` | Evidence-window timer | NFR-REL-16 | REC |
| IX-23 | `outbox_messages` | `horizon_at`, `id` | `status IN ('QUEUED','SENDING','WAITING_RETRY','AWAITING_EVIDENCE')` | Retry-horizon expiry | NFR-REL-4 | REC |
| IX-24 | `outbox_messages` | `event_id` | `is_required_notice AND status IN ('QUEUED','SENDING','WAITING_RETRY','AWAITING_EVIDENCE')` | Deletion check: pending required notices | FR-EVT-10 c, BR-29 | REC |
| IX-25 | `outbox_messages` | `event_id`, `registration_id` | — | Failure reporting; deletion settles pending messages | FR-DSH-4, FR-DSH-6, FR-EVT-10 | REC |
| IX-26 | `provider_events` | `provider_email_id` | — | Matching and re-matching by provider ID | NFR-REL-15 d | REC |
| IX-27 | `provider_events` | `tag_outbox_id`, `tag_generation` | — | Matching by tag | NFR-REL-15 d | REC |
| IX-28 | `provider_events` | `received_at` | — | Webhook-health check; retention | NFR-REL-16 (2), NFR-OPS-1 | REC |
| IX-29 | `provider_event_matches` | `outbox_id`, `generation` | — | FK-27; recomputing facts per generation | NFR-REL-18 | REC |
| IX-30 | `scheduled_tasks` | `due_at`, `id` | `status = 'PENDING'` | Task claim candidates | NFR-CON-4 e | REC |
| IX-31 | `scheduled_tasks` | `lease_expires_at`, `id` | `status = 'RUNNING'` | Task lease reaper | NFR-REL-5 | REC |
| IX-32 | `audit_records` | `event_id`, `occurred_at` | — | Per-event audit | NFR-SEC-5 | REC |
| IX-33 | `audit_records` | `actor_account_id`, `occurred_at` | — | Per-account audit | FR-ORG-8 | REC |
| IX-34 | `rate_limit_counters` | `expires_at` | — | Purging expired windows | NFR-SEC-3 | REC |
| IX-35 | `outbox_messages` | `preclaim_failures`, `id` | `preclaim_failures > 0 AND status IN ('QUEUED','WAITING_RETRY')` | Claiming such messages one at a time; settling them at the bound | NFR-REL-13 h, D-16 | REC |

**Storage settings** **[REC]**: `outbox_messages`, `outbox_attempts` and `scheduled_tasks` use `fillfactor = 85` and tighter per-table autovacuum thresholds, so their frequent status updates can be heap-only.

## 6. Triggers and functions

| ID | Table | Timing / level | Columns | Rule | Trace | Label |
|---|---|---|---|---|---|---|
| TR-01 | `registrations` | BEFORE UPDATE OF `event_id`, per row | `event_id` | Reject any change of `event_id` | NFR-CON-5, AC-134 | REQ |
| TR-02 | `registrations` | AFTER INSERT, per statement, `REFERENCING NEW TABLE` | `event_id`, `state` | Confirmed-count delta per event. Lock the affected `events` rows in ascending ID order, then `confirmed_count = confirmed_count + delta` where `delta <> 0` | NFR-CON-5 | REQ |
| TR-03 | `registrations` | AFTER UPDATE, per statement, `REFERENCING OLD TABLE … NEW TABLE` | `event_id`, `state` | Net change: confirmed in new minus confirmed in old, per event; same update rule | NFR-CON-5, AC-134 | REQ |
| TR-04 | `registrations` | AFTER DELETE, per statement, `REFERENCING OLD TABLE` | `event_id`, `state` | Negative delta. An event row deleted in the same statement simply isn't updated. | NFR-CON-5 | REQ |
| TR-05 | `events` | BEFORE DELETE, per row | `status` | Reject deleting a `CANCELLED` event | BR-26, FR-EVT-11 | REC |
| TR-06 | `check_ins` | BEFORE UPDATE, per row | `ticket_id`, `event_id`, `checked_in_at`, `undone_at` | Only the undo columns may change, each once, NULL → value | BR-7, FR-CHK-8 | REC |
| TR-07 | `check_ins` | AFTER INSERT and AFTER UPDATE (two statement triggers, one function) | `event_id` | `pg_notify('checkin_count', event_id)` once per distinct event; delivered at commit | FR-DSH-2, R51 (5) | REC |
| TR-08 | `outbox_messages` | BEFORE UPDATE, per row | `status`, `possibly_accepted`, `current_generation`, `attempt_no` | State guard (§7): `possibly_accepted` never goes true → false; generation and attempt number never decrease; only the transitions in §7 are allowed | NFR-REL-13 a, c, f; D-12 | REQ (rules); trigger REC |
| TR-09 | `outbox_messages` | AFTER INSERT, per statement, `REFERENCING NEW TABLE` | `lane` | `pg_notify('priority_wakeup')` if any new row has `lane = 'priority'` | NFR-REL-12 b | REC |
| TR-10 | `outbox_attempts` | BEFORE UPDATE, per row | `send_started_at`, `lease_expired_at`, `result_at`, `result_category` | Each group is written once; identity columns never change | NFR-REL-9, D-2 | ARCH |
| TR-11 | `provider_events` | BEFORE UPDATE OR DELETE, per row, plus BEFORE TRUNCATE | all | Reject | NFR-REL-15 b, AC-166 | REQ |
| TR-12 | `provider_event_matches` | BEFORE UPDATE OR DELETE, per row | all | Reject | NFR-REL-15 d | REC |
| TR-13 | `audit_records` | BEFORE UPDATE OR DELETE, per row | all | Reject | NFR-SEC-5 | REC |
| TR-14 | `deletion_markers` | BEFORE UPDATE OR DELETE, per row | all | Reject | FR-EVT-14 | REC |
| TR-15 | `access_tokens` | BEFORE UPDATE, per row | `revoked_at`, `revoke_reason`, `revoked_by_rotation_id`, `token_hash` | Only revocation columns may change, NULL → value once; the hash and owner columns are immutable | FR-LNK-1, BR-20 | REC |
| TR-16 | `events` | BEFORE UPDATE OF `confirmed_count`, per row | `confirmed_count` | Reject when `pg_trigger_depth() = 0`: only TR-02 to TR-04 may change the counter | NFR-CON-5 | REC |
| TR-17 | `events` | BEFORE UPDATE OF `creation_request_id`, `creation_fingerprint`, per row | `creation_request_id`, `creation_fingerprint` | Reject any change: the original request ID and fingerprint are preserved | FR-EVT-1, D-17 | REC |

**Purge and retention under OQ-5:** TR-11 to TR-14 will need a privileged, audited purge path, for example a `SECURITY DEFINER` function owned by `app_owner`. It is designed together with the retention policy. **[OPEN]**

| ID | Function | Purpose | Trace | Label |
|---|---|---|---|---|
| FN-01 | `app.decision_time()` | Returns `clock_timestamp()`. In test databases only (database-level setting `app.test_clock = on`), it adds a session offset, providing the injected clock. | D-1, ENG-TST-6 | ARCH (semantics) / REC (mechanism) |
| FN-02 | `app.take_send_permit(lane)` | Locks `send_budget`, reads `clock_timestamp()` **after** the lock, refills both buckets (priority overflow spills into bulk), applies `retry_after_until`, and returns granted, or the wait in milliseconds. Refuses to grant while `config_version = 0`. | NFR-REL-14 a–d, D-10 | REQ (behavior) |
| FN-03 | `app.return_send_permit(lane)` | Returns an unused permit, capped at the burst | NFR-REL-14 d | REQ |
| FN-04 | `app.note_provider_rate_limit(retry_after)` | `429` handling: halve `rate_b_current` (floor `rate_b_min`), reset bulk tokens, reduce priority only under persistent `429`s, set `retry_after_until` | NFR-REL-14 f | REQ |
| FN-05 | `app.sync_send_budget(…)` | **The only writer of configured values** (D-10). Run only by the protected `migrate budget-sync` subcommand (D-15). Writes the configured rates, `config_version + 1`, `config_fingerprint`, `config_synced_*`. Clamps current tokens to the new bursts. | D-10 | ARCH |
| FN-06 | `app.registrations_confirmed_delta()` | Shared body of TR-02 to TR-04 | NFR-CON-5 | REQ |

## 7. Outbox state transitions (TR-08)

| From | Allowed to | Condition |
|---|---|---|
| `QUEUED` | `SENDING` | Claim (TX-M01, TX-M02) |
| `QUEUED` | `DROPPED` | Freshness failed, the event was deleted, or Start passed before any attempt (FR-NTF-5). `possibly_accepted` is false by definition here. |
| `QUEUED` | `FAILED` | Link expiry or horizon reached before any attempt, for example an authentication message with less than 2 minutes of validity left (AC-153 b) |
| `SENDING` | `ACCEPTED` | `200`, an identical replay, or a matched provider event |
| `SENDING` | `WAITING_RETRY` | Definite non-acceptance (`429`, concurrent `409`), an ambiguous result (sets `possibly_accepted`), or lease expiry (sets `possibly_accepted` only if `send_started_at` was committed, D-2) |
| `SENDING` | `AWAITING_EVIDENCE` | `409 invalid_idempotent_request` (sets `possibly_accepted`) |
| `SENDING` | `FAILED` | Permanent error caused by the message, while `possibly_accepted` is false |
| `SENDING` | `UNCONFIRMED` | Permanent error while `possibly_accepted` is true |
| `SENDING` | `DROPPED` or `UNCONFIRMED` | Render-time recheck aborted the send before `send_started_at` (TRANSACTIONS_AND_LOCKING §6.3): `DROPPED` if `possibly_accepted` is false, otherwise `UNCONFIRMED (obsolete)` |
| `WAITING_RETRY` | `SENDING` | Next claim |
| `WAITING_RETRY` | `ACCEPTED` | A stale `200` or a matched provider event (NFR-REL-9, NFR-REL-18) |
| `WAITING_RETRY` | `DROPPED` | Obsolete at claim, or event deleted, while `possibly_accepted` is false (D-12) |
| `WAITING_RETRY` | `UNCONFIRMED` | Obsolete at claim, or event deleted, while `possibly_accepted` is true (D-12); or horizon, Start or link expiry reached while it is true |
| `WAITING_RETRY` | `FAILED` | Horizon, Start or link expiry reached while `possibly_accepted` is false |
| `QUEUED`, `WAITING_RETRY` | `FAILED` or `UNCONFIRMED` | The pre-claim counter reached its bound (TX-M15, D-16): `FAILED` if `possibly_accepted` is false, otherwise `UNCONFIRMED`; reason `claim_failed` |
| `AWAITING_EVIDENCE` | `ACCEPTED` | Matched provider event (NFR-REL-13 f) |
| `AWAITING_EVIDENCE` | `WAITING_RETRY` | Class B regeneration set up after W: generation becomes 2 (NFR-REL-16) |
| `AWAITING_EVIDENCE` | `UNCONFIRMED` | Horizon reached, or class A or C after W (NFR-REL-16) |
| `UNCONFIRMED` | `ACCEPTED` | Matched provider event (NFR-REL-13 f) |
| `ACCEPTED`, `FAILED`, `DROPPED` | — | Final. A verified provider event is still persisted, matched and used for facts. For `FAILED` or `DROPPED`, the state is **kept**, `evidence_anomaly_at` is set, an alert is raised, and reporting shows the evidence (D-13, NFR-REL-13 g). |

## 8. Privileges

| ID | Grant | Label |
|---|---|---|
| PRV-01 | `app_owner` owns the schema and every object; used only by `migrate` and the administrative command | REC |
| PRV-02 | `app_runtime`: `SELECT, INSERT, UPDATE, DELETE` on ordinary tables; **no** `TRUNCATE`; no DDL | REC |
| PRV-03 | `app_runtime`: only `SELECT, INSERT` on `provider_events`, `provider_event_matches`, `audit_records`, `deletion_markers` | REQ (immutability: NFR-REL-15, FR-EVT-14) / REC (mechanism) |
| PRV-04 | `app_runtime`: `UPDATE` on `send_budget` only through FN-02 to FN-04. FN-05 is executable only by `app_owner`, through `migrate budget-sync`. | ARCH (D-10, D-15) |
| PRV-05 | `reporting` queries run in `READ ONLY` transactions. A separate `app_reporting` role with `SELECT` only is optional if reporting gets its own pool. | ARCH (ADR-021) |

---

## 9. Review against REQUIREMENTS.md v1.6 (review item 10; R59 applied)

| Area | Finding | Result |
|---|---|---|
| BR-1, BR-11, NFR-CON-5 | CK-15, CK-16, TR-01 to TR-04, TR-16; the reconciliation query is in TRANSACTIONS_AND_LOCKING §9 | Consistent |
| BR-2, FR-REG-6 | U-08 covers exactly the three active states | Consistent |
| BR-7, FR-CHK-2 | U-13 on the single authoritative `check_ins` table (DATABASE_DESIGN §8). The earlier duplicate `tickets.checked_in_at` is removed. | **Corrected** (review item 6) |
| BR-8, FR-TKT-2, NFR-CON-2 | U-10, CK-28 | Consistent |
| FR-NTF-1, FR-NTF-2a/2b | PK-10 uniqueness and FK-08 (deferrable) allow claiming the slot first without check-then-insert | Consistent |
| FR-ROT-11, BR-28 | U-20; only committed rotations stored | Consistent |
| FR-ORG-3 b, FR-ORG-6 | U-02, U-03, U-01 | Consistent |
| FR-STAFF-1, FR-STAFF-5, FR-STAFF-6 | U-17 (replacement), U-19 (single acceptance); a re-invitation creates a new invitation and leaves existing sessions intact | Consistent |
| FR-EVT-10, FR-EVT-14, NFR-CON-6 | Cascades limited to event-owned rows; audit, markers, outbox and tasks have no foreign key | Consistent |
| NFR-REL-3, NFR-REL-15 c | U-21; U-25 is the only uniqueness on the event log | Consistent |
| NFR-REL-13 e, g, h (R59) | CK-50 to CK-53, CK-55, CK-57 and TR-08 make "possibly accepted ⇒ never `FAILED` or `DROPPED`" a database invariant; `claim_failed` settlement; state kept on contradicting evidence | Consistent |
| FR-EVT-1 (R60) | U-27, CK-70, TR-17; the uniqueness record ends with the event (EC-103) | Consistent |
| FR-EVT-14 (R59), BR-23, BR-29 | CK-66 (two counts), CK-69 (required notices never `DROPPED`) | Consistent |
| NFR-REL-16 | CK-48, CK-56, CK-59 | Consistent |
| FR-LNK-1, BR-19, AC-61 | Hash-only columns (CK-10, CK-34, CK-43); `payload` never contains tokens (enforced in code; CK-58 only checks the shape) | Consistent; the token-free payload is a **code-level** rule |
| NFR-CON-7 e | No identity foreign keys from event-scoped tables except FK-01 (§3 notes) | Consistent; FK-01 analyzed in TRANSACTIONS_AND_LOCKING §4.3 |
| Earlier proposal | `events.cancelled_at` was referenced by a constraint but missing from the column list | **Corrected** (review item 7) |
| Earlier proposal | `RESTRICT` with `DEFERRABLE` on the slot-to-outbox foreign key is invalid in PostgreSQL | **Corrected**: FK-08 uses `NO ACTION DEFERRABLE INITIALLY DEFERRED` |
| Earlier proposal | Partial indexes alone can't support `CASCADE` (they cover only some rows) | **Corrected**: IX-07, IX-04, IX-05, IX-16 are full indexes |
| C-28 | The share view of a cancelled ticket stays "no longer available" (R15) | Unchanged; **OPEN** |

## 10. Open items and risks

| ID | Item | Label |
|---|---|---|
| D-13 | Contradicting evidence: TR-08 keeps `FAILED`/`DROPPED` final and sets `evidence_anomaly_at` (NFR-REL-13 g, R59) | [REQ] |
| D-14 | Deletion-marker counts per FR-EVT-14 (R59): CK-66, CK-69 | [REQ] |
| OQ-5 | Purge path for the append-only tables protected by TR-11 to TR-14 and PRV-03 | [OPEN] |
| OQ-17 | Account deletion: FK-01, FK-19, FK-21 and FK-22 stay `NO ACTION` until decided | [OPEN] |
| C-28 | Share view of a cancelled ticket (no schema impact either way) | [OPEN] |
| RISK-2 | Index and table bloat on IX-20 to IX-25 and on `outbox_attempts` under high message volume. Mitigated by `fillfactor`, autovacuum tuning and retention; measured by PT-8. | [RISK] |
| RISK-6 | CK-58 checks only the shape of `payload`. "No tokens in the payload" (BR-19) is enforced in code and verified by AC-61's database-wide search. | [RISK] |
