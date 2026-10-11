-- 0002_reminders: reminder slots and scheduled tasks (FR-NTF-1 to FR-NTF-3, NFR-CON-4 e).
-- Source: DATABASE_DESIGN.md §5.2 (reminder_slots) and §5.7 (scheduled_tasks).

CREATE TABLE app.reminder_slots (
  registration_id   uuid NOT NULL,
  schedule_version  integer NOT NULL,
  event_id          uuid NOT NULL,
  outbox_message_id uuid NOT NULL,
  filled_by         text NOT NULL,
  created_at        timestamptz NOT NULL,
  PRIMARY KEY (registration_id, schedule_version),                          -- PK-10: one slot per registration and version
  CONSTRAINT reminder_slots_u14 UNIQUE (outbox_message_id),
  CONSTRAINT reminder_slots_fk07 FOREIGN KEY (registration_id, event_id)
    REFERENCES app.registrations (id, event_id) ON DELETE CASCADE,
  -- FK-08: deferrable so the slot can be claimed before the message row exists (FR-NTF-2b).
  CONSTRAINT reminder_slots_fk08 FOREIGN KEY (outbox_message_id)
    REFERENCES app.outbox_messages (id) DEFERRABLE INITIALLY DEFERRED,
  CONSTRAINT reminder_slots_ck32 CHECK (filled_by IN ('reminder', 'ticket', 'promotion', 'event_change') AND schedule_version >= 1)
);

CREATE TABLE app.scheduled_tasks (
  id                     uuid PRIMARY KEY DEFAULT uuidv7(),                 -- PK-22
  kind                   text NOT NULL,
  event_id               uuid NOT NULL,                                     -- soft reference (D-8)
  schedule_version       integer NOT NULL,
  due_at                 timestamptz NOT NULL,
  status                 text NOT NULL DEFAULT 'PENDING',
  attempt_no             integer NOT NULL DEFAULT 0,
  lease_expires_at       timestamptz,
  cursor_registration_id uuid,
  params                 jsonb NOT NULL DEFAULT '{}',
  last_error_code        text,
  created_at             timestamptz NOT NULL,
  finished_at            timestamptz,
  CONSTRAINT scheduled_tasks_u26 UNIQUE (kind, event_id, schedule_version),
  CONSTRAINT scheduled_tasks_ck64 CHECK (kind IN ('reminder_fanout', 'cutoff_processing')
    AND status IN ('PENDING', 'RUNNING', 'DONE', 'SKIPPED', 'FAILED')
    AND (status <> 'RUNNING' OR lease_expires_at IS NOT NULL)
    AND jsonb_typeof(params) = 'object')
) WITH (fillfactor = 85);
CREATE INDEX scheduled_tasks_ix30 ON app.scheduled_tasks (due_at, id) WHERE status = 'PENDING';
CREATE INDEX scheduled_tasks_ix31 ON app.scheduled_tasks (lease_expires_at, id) WHERE status = 'RUNNING';
