# Post-Release Schema Changes

The design documents in this folder describe the full designed system (27 tables). This file records the migrations added after the v1.0.0 release (schema 7) and what they change. Every migration is forward-only, runs in one transaction, and keeps existing rows valid.

| Migration | Card | Change |
|---|---|---|
| `0008_organizer_cancellation` | K-703 (PD-83, amendment A-1) | Widens `registrations_ck24` with the end reason `cancelled_by_organizer`, and `outbox_messages_ck48` with the required notice `organizer_cancellation` (class B, bulk lane). |
| `0009_organizations` | K-708 (PD-88, ADR-022, amendment A-3) | New tables `organizations` and `organization_memberships`; `events.organization_id` (not null) with a backfill of existing data. |
| `0010_organizer_accounts` | K-709 (PD-89, ADR-022, amendment A-3) | Password and verification columns on `accounts`; new sign-in request purposes and token types for verification and reset; password sessions; three new message types. |

## `organizations` (0009)

| Column | Type | Notes |
|---|---|---|
| `id` | uuid | Primary key (`uuidv7()`) |
| `name` | text | 1 to 200 characters after trimming |
| `description` | text, nullable | Up to 2 000 characters (a future public profile can show it) |
| `status` | text | `pending_verification`, `pending_approval`, `active`, `rejected`, `suspended`; `active`, `rejected` and `suspended` require `decided_at` |
| `created_at`, `updated_at` | timestamptz | |
| `email_verified_at`, `submitted_at`, `decided_at` | timestamptz, nullable | Registration and approval milestones (K-709, K-710) |
| `migrated_from_account_id` | uuid, nullable, unique | The account an organization was created for by the 0009 backfill (keeps the backfill idempotent) |

## `organization_memberships` (0009)

| Column | Type | Notes |
|---|---|---|
| `organization_id` | uuid | References `organizations` |
| `account_id` | uuid | References `accounts`; indexed for "my organizations" |
| `role` | text | `owner`, `admin`, `member` |
| `created_at` | timestamptz | |

Primary key `(organization_id, account_id)`.

## `events.organization_id` (0009)

Not null after the backfill; references `organizations`; indexed. `events.owner_account_id` keeps its meaning as the creating account, and the creation idempotency key `(owner_account_id, creation_request_id)` is unchanged.

**Backfill** (between the `BEGIN BACKFILL` and `END BACKFILL` markers, tested by `organizations.test.ts` on legacy rows):
1. One `active` organization per account that has no membership, named after the account's address, with `migrated_from_account_id` set.
2. An `owner` membership for each.
3. Each event's `organization_id` from its creator's organization.

Run on the development database on 2026-10-13: 7 accounts became the owners of 7 active organizations; all 34 events were attached; registrations (61), tickets (46), staff invitations (6), audit records (30) and outbox messages (167) were unchanged in number.

## `0010_organizer_accounts`

| Table | Change |
|---|---|
| `accounts` | New `display_name` (contact person, nullable), `password_hash` (nullable; checked to start with `$argon2id$`), `password_changed_at`, `email_verified_at`. Backfill: existing accounts get `email_verified_at = created_at` (their address was proven by emailed sign-in) and no password. |
| `sign_in_requests` | Purposes `verify_email` and `reset_password` beside `sign_in` and `reauth` (ck03, ck05). One active request per address still holds across purposes. |
| `access_tokens` | Token types `account_verification` and `password_reset`, which point to a sign-in request (ck33, ck35; ck35 keeps 0006's staff invitation rule). |
| `organizer_sessions` | `auth_method` (`email_link` or `password`, default `email_link`); `created_from_request_id` is null exactly for password sessions; revoke reason `password_reset`. |
| `outbox_messages` | Types `account_verification` and `password_reset` (class A, priority lane) and `account_exists_notice` (class A, bulk lane) (ck48). |

Run on the development database on 2026-10-13 (91 ms): schema 10; 7 accounts, all verified, none with a password; 7 organizations, 7 memberships, 34 events, 61 registrations, 7 sessions, 300 access tokens and 167 outbox messages. The migration adds columns and widens checks; it inserts and deletes no rows.
