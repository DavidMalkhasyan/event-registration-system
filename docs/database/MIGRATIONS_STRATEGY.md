# Migrations Strategy

| | |
|---|---|
| **Status** | Database design — see [DATABASE_DESIGN.md](DATABASE_DESIGN.md) for the decision register |
| **Design target** | PostgreSQL 18 (development and test); production version conditional on hosting (OQ-2) |
| **Requirements baseline** | [REQUIREMENTS.md](../../REQUIREMENTS.md) v1.6 |

**Labels:**
- **[REQ]** binding requirement;
- **[ARCH]** approved decision;
- **[REC]** recommendation;
- **[OPEN]** pending decision;
- **[RISK]** production risk.

No migration file exists yet. This document defines how migrations will be written, applied and tested.

---

## 1. Binding rules

| Rule | Source |
|---|---|
| Migrations are versioned SQL files and can't change once released | [REQ: ENG-CI-5, R51] |
| Only the explicit `migrate` command applies migrations, in every environment, including local development | [REQ: ENG-CI-6, R51] |
| `web` and `worker` check the schema version at startup and refuse to start on a mismatch, applying nothing | [REQ: ENG-CI-6, AC-141] |
| CI applies migrations on the supported PostgreSQL version, both to an empty database and to the previous release's schema; re-running does nothing | [REQ: ENG-CI-5, AC-141] |
| The supported version for development, testing and design is **PostgreSQL 18** | [ARCH: PG18 directive, 2026-10-11] |
| An exact version match is required, so deployments are stop, migrate, start | [ARCH: D-9] |

## 2. Tooling **[OPEN: Proposed ADR-018]**

- **Recommendation:** a minimal in-repository runner on node-postgres, part of the `migrate` entrypoint. **[REC]** Reasons:
  - the requirements are specific: checksums, advisory locking, the exact-version check, non-transactional files and the budget synchronization subcommand (D-15);
  - a small runner keeps them explicit (ENG-CQ-1, ENG-CQ-5).
- **Alternatives** for Proposed ADR-018: `node-pg-migrate` in SQL mode, or `graphile-migrate`. Either is acceptable if it supports every rule in §3 and §4.
- **Kysely's TypeScript migrator is not used:** R51 requires SQL migrations.

## 3. Files **[REC]**

- **Name:** `migrations/NNNN_short_name.sql`, where `NNNN` is a zero-padded integer that increases without gaps. One logical change per file.
- **Header comments:**
  - `-- requires: NNNN` (the previous version);
  - `-- transaction: none` only for statements PostgreSQL forbids inside a transaction (`CREATE INDEX CONCURRENTLY`, `ALTER TYPE … ADD VALUE` (not used), `VACUUM`).
- **Released files are immutable.** The runner stores each file's SHA-256 checksum in `schema_migrations.checksum` and refuses to run if a stored checksum differs from the file on disk (ENG-CI-5).
- **Fixed constraint names:** every constraint, index and trigger has the explicit name pattern from CONSTRAINTS_AND_INDEXES.md (for example `registrations_u08`). Later migrations can then reference them reliably, and errors never expose generated names. Error responses never contain constraint names in any case (ENG-ERR-3).
- **No data seeding,** except the two singleton rows (`send_budget` with `config_version = 0`, and `sending_pause`).

## 4. Runner behavior **[REC]**

1. Connect as `app_owner`. Set `lock_timeout` and `statement_timeout` for the session.
2. Take a **session-level advisory lock** in the migration namespace, so concurrent runs serialize. Never wait indefinitely: fail after a timeout.
3. Create `schema_migrations` if it's missing (the runner's bootstrap).
4. Verify the checksums of every applied file.
5. **Refuse if the database is ahead:** a recorded version unknown to this build means the deployment is out of order.
6. Apply each pending file in its own transaction (or without one, if marked). Insert its `schema_migrations` row in the same transaction.
7. Log only file names, versions and durations, never SQL parameters or data (ENG-ERR-6).
8. Exit non-zero on any failure. Completed files stay applied; a failed file leaves nothing behind (transactional).

### 4.1 Protected `budget-sync` subcommand (D-15)

**[ARCH: D-10, D-15]**

- **Single writer:** `migrate budget-sync` is the **only** writer of the configured send budget. It lives in the `migrate` entrypoint, so R51's three entrypoints are unchanged.
- **Protection:**
  - It runs with `app_owner` credentials only; FN-05 is not executable by `app_runtime` (PRV-04).
  - It requires an explicit confirmation flag.
  - It is never run implicitly, and not as part of `migrate` itself.
- **Behavior:**
  1. Reads the authoritative budget configuration of the release.
  2. Validates it: positive values; `rate_b_min ≤ rate_b`; `rate_p + rate_b` equals the configured budget (NFR-REL-14 a).
  3. Calls FN-05 in one ROW transaction.
  4. Prints the old and new `config_version` and fingerprints. Never prints secrets.
- **Workers** only read the row and compare fingerprints (TRANSACTIONS_AND_LOCKING §7.3). They never call this command.

## 5. Schema-version check and deployment sequence (D-9)

**Startup check** **[ARCH: D-9]**:
- `web` and `worker` read `max(version)` from `schema_migrations` and compare it with the version compiled into the build.
- Any difference stops the process with a clear error, naming both versions and no secrets (AC-141, AC-143).

**Release sequence** **[REC]**:
1. Stop `worker`s, then `web`. In-flight sends recover by lease, and webhooks are redelivered by the provider (NFR-REL-15 f).
2. Take a backup or snapshot. How depends on hosting: **[OPEN: OQ-2]**, **[RISK-4]**.
3. Run `migrate`.
4. If the budget configuration changed, or on the very first release: run `migrate budget-sync` (§4.1).
5. Start the `worker`s, then `web`.
6. Check health: `web` `/healthz` (schema version, database), worker heartbeats, the `config_fingerprint` match, and that the outbox backlog is draining.

**Consequence:** a short downtime per release. Zero-downtime deployments would need a compatible version range instead of exact matching. That would be a new decision, not part of D-9.

## 6. Initial migration plan (logical; no SQL yet)

The table and constraint IDs refer to [DATABASE_DESIGN.md](DATABASE_DESIGN.md) and [CONSTRAINTS_AND_INDEXES.md](CONSTRAINTS_AND_INDEXES.md).

| File | Contents | Notes |
|---|---|---|
| `0001_schema_and_clock` | Schema `app`; FN-01 `app.decision_time()` | Database creation and collation happen in provisioning (§7), not here |
| `0002_identity` | `accounts`, `sign_in_requests`, `email_change_requests`, `organizer_sessions`; PK-01 to PK-04, U-01 to U-05, CK-01 to CK-12, IX-02 to IX-05; then FK-19 to FK-23 | Circular FK-20 and FK-23 are added after both tables exist |
| `0003_event_core` | `events`, `registrations`, `tickets`, `check_ins`, `check_in_requests`, `reminder_slots`; PK-05 to PK-10, U-06 to U-14, CK-13 to CK-32, IX-01, IX-06 to IX-10; FK-01 to FK-07; FN-06; TR-01 to TR-07, TR-16 | FK-08 is added in 0006, once `outbox_messages` exists |
| `0004_staff` | `staff_invitations`, `staff_sessions`; PK-12, PK-13, U-16 to U-19, CK-40 to CK-45, IX-16, IX-17; FK-14, FK-15 | |
| `0005_access_tokens_and_rotation` | `access_tokens`, `rotation_requests`; PK-11, PK-14, U-15, U-20, CK-33 to CK-39, CK-46, IX-11 to IX-15, IX-18, IX-19; FK-09 to FK-13, FK-16 to FK-18; TR-15 | Circular FK-13 with FK-17/FK-18: tables first, foreign keys after |
| `0006_messaging` | `outbox_messages`, `outbox_generations`, `outbox_attempts`, `provider_events`, `provider_event_matches`, `send_budget`, `sending_pause`; PK-15 to PK-21, U-21 to U-25, CK-47 to CK-63, CK-69, IX-20 to IX-29, IX-35; FK-24 to FK-27; **FK-08**; FN-02 to FN-05; TR-08 to TR-12; singleton rows | `fillfactor` and autovacuum settings for hot tables |
| `0007_jobs` | `scheduled_tasks`; PK-22, U-26, CK-64, IX-30, IX-31 | |
| `0008_audit` | `audit_records`, `deletion_markers`; PK-23, PK-24, CK-65, CK-66, IX-32, IX-33; TR-13, TR-14 | No foreign keys (NFR-CON-6) |
| `0009_platform` | `rate_limit_counters`, `worker_heartbeats`; PK-25, PK-26, CK-67, CK-68, IX-34 | |
| `0010_privileges` | PRV-02 to PRV-05 grants to `app_runtime`; revoke `TRUNCATE`, and `UPDATE`/`DELETE` on append-only tables | Roles exist beforehand (§7) |

`schema_migrations` (PK-27) is created by the runner itself.

## 7. Provisioning outside migrations **[REC]** / **[OPEN: OQ-2]**

These steps usually need superuser or hosting-console rights, so they are not migrations. Each is documented as a provisioning step in the README (ENG-DOC-1):
- creating the database with `UTF8` encoding and the built-in locale provider (`C.UTF-8`);
- creating the `app_owner` and `app_runtime` roles, with passwords or IAM in the hosting secret store;
- setting `TimeZone = 'UTC'` for the application roles;
- `app.test_clock = on` **only** in test databases (FN-01);
- the `pgrowlocks` extension **only** in test images (AC-157).

## 8. Rules for later changes **[REC]**

| Change | Pattern |
|---|---|
| New column | Add as nullable, or with a constant default (no table rewrite). Backfill in batches. Add `NOT NULL` in a later release using `CHECK … NOT VALID` then `VALIDATE`. |
| New index on a large table | A separate file marked `-- transaction: none`, using `CREATE INDEX CONCURRENTLY` |
| New status value or `hash_alg` | Widen the `CHECK` (for example CK-10, CK-34, CK-43) in the same release as the code that writes it. Old code never encounters the new value because of D-9. |
| Rename or removal | Expand, then contract: add the new column and write both; switch reads; drop the old column in a later release |
| Data correction | A reviewed SQL migration. It never bypasses triggers: no `session_replication_role = replica` and no `DISABLE TRIGGER` on `registrations` (NFR-CON-5). |
| Retention purges (OQ-5) | Run as scheduled tasks or privileged functions designed with the policy, never as migrations |

## 9. Migration and schema tests **[REQ: ENG-TST-2, AC-141]** / **[REC]**

| ID | Test |
|---|---|
| T-M1 | Apply all migrations to an empty PostgreSQL 18 database (Testcontainers, pinned image digest) |
| T-M2 | Apply the current release's migrations to the previous release's schema |
| T-M3 | Running `migrate` again changes nothing |
| T-M4 | A tampered released file (checksum mismatch) makes `migrate` fail without changes |
| T-M5 | `web` and `worker` refuse to start when the schema is behind or ahead (AC-141) |
| T-M6 | Constraint behavior: every CK, U and FK row in CONSTRAINTS_AND_INDEXES.md has a test that violates it and expects rejection. This includes the circular `NO ACTION` foreign keys during event-deletion cascades. |
| T-M7 | Trigger behavior: TR-01 to TR-16, including AC-134's net-zero statement and the deletion cascade through TR-04 |
| T-M8 | Schema drift: regenerate Kysely types from the migrated schema and compare them with the committed types (CI fails on difference) |
| T-M9 | Privileges: `app_runtime` can't `UPDATE` or `DELETE` append-only tables, can't `TRUNCATE`, and can't call FN-05 |
| T-M10 | Every foreign key has a supporting index (catalog query over `pg_constraint` and `pg_index`) |

## 10. Rollback and recovery

- **Forward-only.** There are no down-migrations. A faulty migration is fixed by a new migration. **[REC]**
- **Recovering from a destructive mistake** means restoring the pre-migration backup or using point-in-time recovery. Both depend on the hosting decision. **[OPEN: OQ-2]**, **[RISK-4]**

## 11. Open items

| ID | Item | Label |
|---|---|---|
| Proposed ADR-018 | Migration tool choice | [OPEN] |
| D-15 | **Decided:** the budget synchronization command is the protected `migrate budget-sync` subcommand (§4.1) | [ARCH] |
| OQ-2 | Production PostgreSQL version; backups and point-in-time recovery; provisioning automation | [OPEN] |
| OQ-5 | Purge mechanics for append-only tables (TR-11 to TR-14) | [OPEN] |
