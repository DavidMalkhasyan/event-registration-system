# Backup and Restore (K-721)

A backup is trusted only after a restore drill has restored it into a separate database and checked it. Decisions: [PD-101](../process/DECISION_LOG.md).

## What a backup contains

`pnpm ops:backup` (in the container: `node apps/server/dist/entrypoints/ops.js backup --out /data/backups/<name>`) writes a directory:

| File | Content |
|---|---|
| `database.dump` | `pg_dump` custom format of the application database: schema, data, grants (all tables, including audit records and outbox history) |
| `media/images/…` | A copy of the image files (the database holds only their metadata) |
| `manifest.json` | Time, schema version, row counts of the main tables, the consistency figures, and the size and SHA-256 of every media file |

**Also needed for a recovery, kept separately:** `deploy/.env.production` (the secrets: without `ADMIN_TOTP_KEY` the Super Admins' second factor cannot be read; without `CSRF_SECRET` and the others sessions and links are invalidated) and the Caddy certificate volume (optional: Caddy obtains a new certificate). Never put these in the same place as the backups, and never in Git.

**Sensitive:** backups contain participants' email addresses, tickets and audit history. Store them encrypted (for example `age` or `gpg` before upload, or encrypted object storage), with access limited to operators; never in the repository (`var/` and `deploy/.env.production` are ignored by Git).

## Restore drill (verification)

`RESTORE_ADMIN_URL=<a role that may create databases> pnpm ops:restore-drill --from <backup directory>`:

1. creates a new database `ers_restore_drill_<random>` on the same server and restores the dump into it (`pg_restore --exit-on-error`);
2. compares the schema version and the row counts of 15 tables with the manifest;
3. checks the consistency rules (each must be 0): active organizations without an owner; confirmed registrations without exactly one ticket; tickets or check-ins of another event; events whose confirmed count differs from their confirmed registrations; staff sessions of another event's invitation; memberships without an account;
4. copies the media to a temporary directory and checks every file's SHA-256, and that both files of every image row exist;
5. drops the drill database (unless `--keep`), and prints the report; exit code 1 when anything is wrong.

It never touches the source database or its media directory. Verified on 2026-10-13: the automated test (`backup-restore.test.ts`: a database with an organization, registrations, a ticket, a check-in, a staff invitation and an image; a damaged media file is caught), the development data (schema 17, all counts equal, every rule 0, the drill database dropped, the source unchanged), and CI (the `verify` job, and the `container` job inside the production stack).

## Restoring for real

1. Stop web and worker: `docker compose … stop web worker`.
2. Restore the database into a fresh database: `createdb -O app_owner eventflow_restored`, `pg_restore --exit-on-error -d eventflow_restored database.dump` (as a role that may create databases); then either rename it (`ALTER DATABASE eventflow RENAME TO eventflow_old; ALTER DATABASE eventflow_restored RENAME TO eventflow;`) or point the connection strings at it.
3. Restore the media: copy `media/images` into the `media` volume (`docker compose … cp`), as the image's user.
4. Start: `docker compose … up -d` (the migrate service applies nothing if the schema is current, or the newer migrations of the running version).
5. Check `/readyz`, sign in, open an event with images, run `media:sweep` (dry run) to confirm no file is missing.

**Restoring into a different PostgreSQL server:** create the roles `app_owner` and `app_runtime` first (`deploy/postgres-init.sh` does it), or restore with `--no-owner --role=app_owner` and re-grant the runtime role.

## Frequency and retention (recommendation)

| What | When | Keep |
|---|---|---|
| Full backup (`ops:backup`) | daily, and before every upgrade | 14 daily, 8 weekly, 6 monthly |
| Restore drill | weekly on the latest backup, and after every upgrade's backup | the reports |
| Offsite copy | daily, encrypted, to storage in another location | as above |

The application's own retention rules (registrations removed with deleted events, audit append-only) apply to the live database; backups keep deleted data until they expire, which the privacy notice should say.

**Storage:** the development database's dump is a few hundred kilobytes; expect roughly the database size (compressed by the custom format) plus the media volume (at most 2 × 2400 px WebP per image; about 0.2 to 1 MB per photograph with its thumbnail) per backup.

## Limitations

- Point-in-time recovery (continuous WAL archiving) is not set up: a restore returns to the time of the backup. For a busier service, add WAL archiving (for example with pgBackRest) or a managed database with point-in-time recovery.
- The media copy is taken after the database dump: an image added in between may be in the media copy without its row (harmless; the sweep removes it) or, if deleted in between, missing (the drill reports rows whose files are missing).
- The drill needs a role that may create databases on the same server.
