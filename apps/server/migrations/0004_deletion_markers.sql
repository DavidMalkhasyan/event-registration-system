-- 0004_deletion_markers: markers for deleted events (FR-EVT-14, TX-E06, AC-100, AC-184).
-- Source: DATABASE_DESIGN.md §5.8 (deletion_markers). Exactly the FR-EVT-14 fields; soft
-- references only (the event row is gone); append-only like audit_records (TR-13).

CREATE TABLE app.deletion_markers (
  event_id                      uuid PRIMARY KEY,                           -- PK-24
  owner_account_id              uuid NOT NULL,                              -- soft reference
  scheduled_start               timestamptz NOT NULL,
  time_zone                     text NOT NULL,
  deleted_at                    timestamptz NOT NULL,
  deleted_by_account_id         uuid NOT NULL,
  registrations_deleted         integer NOT NULL,
  failed_required_notices       integer NOT NULL,
  unconfirmed_required_notices  integer NOT NULL,
  CONSTRAINT deletion_markers_ck71 CHECK (registrations_deleted >= 0 AND failed_required_notices >= 0
    AND unconfirmed_required_notices >= 0)
);
CREATE TRIGGER deletion_markers_tr18 BEFORE UPDATE OR DELETE ON app.deletion_markers
  FOR EACH ROW EXECUTE FUNCTION app.reject_change();
