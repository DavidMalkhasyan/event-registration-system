-- 0001_core: tables for the first vertical slice
-- (organizer sign-in, events, registration, verification, tickets, check-in, outbox).
-- Source: docs/database/DATABASE_DESIGN.md and CONSTRAINTS_AND_INDEXES.md (IDs in comments).
-- Tables for later slices (staff, rotation, reminders, webhooks, ...) come in later migrations.

-- ---------------------------------------------------------------- identity
CREATE TABLE app.accounts (
  id               uuid PRIMARY KEY DEFAULT uuidv7(),                       -- PK-01
  email            text NOT NULL,
  created_at       timestamptz NOT NULL,
  email_changed_at timestamptz,
  CONSTRAINT accounts_u01 UNIQUE (email),
  CONSTRAINT accounts_ck01 CHECK (email = btrim(email) AND email !~ '[A-Z]' AND char_length(email) BETWEEN 3 AND 254)
);

CREATE TABLE app.sign_in_requests (
  id                uuid PRIMARY KEY DEFAULT uuidv7(),                      -- PK-02
  email             text NOT NULL,
  account_id        uuid REFERENCES app.accounts (id),                      -- FK-19
  purpose           text NOT NULL,
  reauth_session_id uuid,                                                   -- FK-20 added below
  status            text NOT NULL DEFAULT 'active',
  created_at        timestamptz NOT NULL,
  expires_at        timestamptz NOT NULL,
  used_at           timestamptz,
  ended_at          timestamptz,
  CONSTRAINT sign_in_requests_ck02 CHECK (email = btrim(email) AND email !~ '[A-Z]' AND char_length(email) BETWEEN 3 AND 254),
  CONSTRAINT sign_in_requests_ck03 CHECK (purpose IN ('sign_in', 'reauth')),
  CONSTRAINT sign_in_requests_ck04 CHECK (status IN ('active', 'used', 'replaced', 'revoked')),
  CONSTRAINT sign_in_requests_ck05 CHECK ((purpose = 'reauth') = (reauth_session_id IS NOT NULL) AND (purpose <> 'reauth' OR account_id IS NOT NULL)),
  CONSTRAINT sign_in_requests_ck06 CHECK ((status = 'active') = (ended_at IS NULL) AND (status = 'used') = (used_at IS NOT NULL) AND expires_at > created_at)
);
CREATE UNIQUE INDEX sign_in_requests_u02 ON app.sign_in_requests (email) WHERE status = 'active';
CREATE INDEX sign_in_requests_ix02 ON app.sign_in_requests (account_id) WHERE account_id IS NOT NULL;
CREATE INDEX sign_in_requests_ix03 ON app.sign_in_requests (reauth_session_id) WHERE reauth_session_id IS NOT NULL;

CREATE TABLE app.organizer_sessions (
  id                      uuid PRIMARY KEY DEFAULT uuidv7(),                -- PK-04
  account_id              uuid NOT NULL REFERENCES app.accounts (id),       -- FK-22
  session_hash            bytea NOT NULL,
  hash_alg                smallint NOT NULL DEFAULT 1,
  created_from_request_id uuid NOT NULL REFERENCES app.sign_in_requests (id), -- FK-23
  created_at              timestamptz NOT NULL,
  authenticated_at        timestamptz NOT NULL,
  last_seen_at            timestamptz NOT NULL,
  absolute_expires_at     timestamptz NOT NULL,
  revoked_at              timestamptz,
  revoke_reason           text,
  CONSTRAINT organizer_sessions_u04 UNIQUE (session_hash),
  CONSTRAINT organizer_sessions_u05 UNIQUE (created_from_request_id),
  CONSTRAINT organizer_sessions_ck10 CHECK (hash_alg = 1 AND octet_length(session_hash) = 32),
  CONSTRAINT organizer_sessions_ck11 CHECK ((revoked_at IS NULL) = (revoke_reason IS NULL)
    AND (revoke_reason IS NULL OR revoke_reason IN ('sign_out', 'sign_out_everywhere', 'reauth_replaced', 'email_changed'))),
  CONSTRAINT organizer_sessions_ck12 CHECK (absolute_expires_at > created_at AND authenticated_at >= created_at)
);
CREATE INDEX organizer_sessions_ix05 ON app.organizer_sessions (account_id);
ALTER TABLE app.sign_in_requests
  ADD CONSTRAINT sign_in_requests_fk20 FOREIGN KEY (reauth_session_id) REFERENCES app.organizer_sessions (id);

-- ---------------------------------------------------------------- event-core
CREATE TABLE app.events (
  id                   uuid PRIMARY KEY DEFAULT uuidv7(),                   -- PK-05
  owner_account_id     uuid NOT NULL REFERENCES app.accounts (id),          -- FK-01
  creation_request_id  uuid NOT NULL,                                       -- D-17
  creation_fingerprint bytea NOT NULL,                                      -- D-17
  public_id            text NOT NULL,
  title                text NOT NULL,
  description          text,
  starts_at            timestamptz NOT NULL,
  time_zone            text NOT NULL,
  capacity             integer NOT NULL,
  confirmed_count      integer NOT NULL DEFAULT 0,
  status               text NOT NULL DEFAULT 'SCHEDULED',
  schedule_version     integer NOT NULL DEFAULT 1,
  next_waitlist_seq    bigint NOT NULL DEFAULT 1,
  created_at           timestamptz NOT NULL,
  updated_at           timestamptz NOT NULL,
  cancelled_at         timestamptz,
  CONSTRAINT events_u06 UNIQUE (public_id),
  CONSTRAINT events_u27 UNIQUE (owner_account_id, creation_request_id),
  CONSTRAINT events_ck13 CHECK (char_length(title) BETWEEN 1 AND 200),
  CONSTRAINT events_ck14 CHECK (description IS NULL OR char_length(description) <= 5000),
  CONSTRAINT events_ck15 CHECK (capacity >= 1),
  CONSTRAINT events_ck16 CHECK (confirmed_count >= 0 AND confirmed_count <= capacity),
  CONSTRAINT events_ck17 CHECK (status IN ('SCHEDULED', 'CANCELLED')),
  CONSTRAINT events_ck18 CHECK ((status = 'CANCELLED') = (cancelled_at IS NOT NULL)),
  CONSTRAINT events_ck19 CHECK (schedule_version >= 1 AND next_waitlist_seq >= 1),
  CONSTRAINT events_ck20 CHECK (public_id ~ '^[A-Za-z0-9_-]{22,}$'),
  CONSTRAINT events_ck21 CHECK (char_length(time_zone) BETWEEN 1 AND 64),
  CONSTRAINT events_ck70 CHECK (octet_length(creation_fingerprint) = 32)
);
CREATE INDEX events_ix01 ON app.events (owner_account_id, starts_at);

CREATE TABLE app.registrations (
  id                      uuid PRIMARY KEY DEFAULT uuidv7(),                -- PK-06
  event_id                uuid NOT NULL REFERENCES app.events (id) ON DELETE CASCADE, -- FK-02
  email                   text NOT NULL,
  state                   text NOT NULL DEFAULT 'PENDING_VERIFICATION',
  verification_generation integer NOT NULL DEFAULT 1,
  waitlist_seq            bigint,
  created_at              timestamptz NOT NULL,
  verified_at             timestamptz,
  waitlisted_at           timestamptz,
  confirmed_at            timestamptz,
  ended_at                timestamptz,
  end_reason              text,
  updated_at              timestamptz NOT NULL,
  CONSTRAINT registrations_u07 UNIQUE (id, event_id),
  CONSTRAINT registrations_ck22 CHECK (email = btrim(email) AND email !~ '[A-Z]' AND char_length(email) BETWEEN 3 AND 254),
  CONSTRAINT registrations_ck23 CHECK (state IN ('PENDING_VERIFICATION', 'CONFIRMED', 'WAITLISTED', 'CANCELLED', 'EXPIRED')),
  CONSTRAINT registrations_ck24 CHECK (
    (state IN ('CANCELLED', 'EXPIRED')) = (ended_at IS NOT NULL AND end_reason IS NOT NULL)
    AND (state <> 'CANCELLED' OR end_reason IN ('participant_cancelled', 'removed_by_organizer', 'event_cancelled'))
    AND (state <> 'EXPIRED' OR end_reason IN ('cutoff', 'event_cancelled'))),
  CONSTRAINT registrations_ck25 CHECK (state <> 'WAITLISTED' OR (waitlist_seq IS NOT NULL AND waitlisted_at IS NOT NULL)),
  CONSTRAINT registrations_ck26 CHECK (state <> 'CONFIRMED' OR confirmed_at IS NOT NULL),
  CONSTRAINT registrations_ck27 CHECK (verification_generation >= 1)
);
CREATE UNIQUE INDEX registrations_u08 ON app.registrations (event_id, email)
  WHERE state IN ('PENDING_VERIFICATION', 'CONFIRMED', 'WAITLISTED');
CREATE UNIQUE INDEX registrations_u09 ON app.registrations (event_id, waitlist_seq) WHERE waitlist_seq IS NOT NULL;
CREATE INDEX registrations_ix06 ON app.registrations (event_id, waitlist_seq) WHERE state = 'WAITLISTED';
CREATE INDEX registrations_ix07 ON app.registrations (event_id, state);

CREATE TABLE app.tickets (
  id              uuid PRIMARY KEY DEFAULT uuidv7(),                        -- PK-07
  registration_id uuid NOT NULL,
  event_id        uuid NOT NULL,
  code            text NOT NULL,
  issued_at       timestamptz NOT NULL,
  CONSTRAINT tickets_u10 UNIQUE (code),
  CONSTRAINT tickets_u11 UNIQUE (registration_id),
  CONSTRAINT tickets_u12 UNIQUE (id, event_id),
  CONSTRAINT tickets_fk03 FOREIGN KEY (registration_id, event_id)
    REFERENCES app.registrations (id, event_id) ON DELETE CASCADE,
  CONSTRAINT tickets_ck28 CHECK (code ~ '^[0-9A-HJKMNP-TV-Z]{12}$')
);

CREATE TABLE app.check_ins (
  id                     uuid PRIMARY KEY DEFAULT uuidv7(),                 -- PK-08
  ticket_id              uuid NOT NULL,
  event_id               uuid NOT NULL,
  checked_in_at          timestamptz NOT NULL,
  actor_kind             text NOT NULL,
  actor_account_id       uuid,
  actor_staff_session_id uuid,
  undone_at              timestamptz,
  undone_by_account_id   uuid,
  undo_reason            text,
  CONSTRAINT check_ins_fk04 FOREIGN KEY (ticket_id, event_id) REFERENCES app.tickets (id, event_id) ON DELETE CASCADE,
  CONSTRAINT check_ins_ck29 CHECK ((actor_kind = 'owner' AND actor_account_id IS NOT NULL AND actor_staff_session_id IS NULL)
    OR (actor_kind = 'staff' AND actor_staff_session_id IS NOT NULL AND actor_account_id IS NULL)),
  CONSTRAINT check_ins_ck30 CHECK ((undone_at IS NULL) = (undone_by_account_id IS NULL)
    AND (undo_reason IS NULL OR (undone_at IS NOT NULL AND char_length(undo_reason) <= 500)))
);
CREATE UNIQUE INDEX check_ins_u13 ON app.check_ins (ticket_id) WHERE undone_at IS NULL;
CREATE INDEX check_ins_ix08 ON app.check_ins (ticket_id);
CREATE INDEX check_ins_ix09 ON app.check_ins (event_id) WHERE undone_at IS NULL;

CREATE TABLE app.check_in_requests (
  event_id            uuid NOT NULL REFERENCES app.events (id) ON DELETE CASCADE, -- FK-05
  request_id          uuid NOT NULL,
  principal_kind      text NOT NULL,
  principal_id        uuid NOT NULL,
  ticket_id           uuid,
  outcome             text NOT NULL,
  first_checked_in_at timestamptz,
  created_at          timestamptz NOT NULL,
  PRIMARY KEY (event_id, request_id),                                      -- PK-09
  CONSTRAINT check_in_requests_fk06 FOREIGN KEY (ticket_id, event_id) REFERENCES app.tickets (id, event_id) ON DELETE CASCADE,
  CONSTRAINT check_in_requests_ck31 CHECK (principal_kind IN ('owner', 'staff') AND outcome IN
    ('CHECKED_IN', 'ALREADY_CHECKED_IN', 'INVALID_CODE', 'WRONG_EVENT', 'TICKET_CANCELLED', 'EVENT_CANCELLED', 'OUTSIDE_CHECK_IN_WINDOW'))
);
CREATE INDEX check_in_requests_ix10 ON app.check_in_requests (ticket_id) WHERE ticket_id IS NOT NULL;

-- ---------------------------------------------------------------- access tokens (ADR-012)
-- Owner columns for staff invitations and email changes are added with those tables in a later migration.
CREATE TABLE app.access_tokens (
  id                 uuid PRIMARY KEY DEFAULT uuidv7(),                     -- PK-11
  token_type         text NOT NULL,
  token_hash         bytea NOT NULL,
  hash_alg           smallint NOT NULL DEFAULT 1,
  registration_id    uuid,
  sign_in_request_id uuid REFERENCES app.sign_in_requests (id) ON DELETE CASCADE, -- FK-11
  event_id           uuid,
  issued_at          timestamptz NOT NULL,
  issued_via         text NOT NULL,
  outbox_message_id  uuid,
  attempt_no         integer,
  expires_at         timestamptz,
  revoked_at         timestamptz,
  revoke_reason      text,
  CONSTRAINT access_tokens_u15 UNIQUE (token_hash),
  CONSTRAINT access_tokens_fk09 FOREIGN KEY (registration_id, event_id)
    REFERENCES app.registrations (id, event_id) ON DELETE CASCADE,
  CONSTRAINT access_tokens_ck33 CHECK (token_type IN ('verification', 'management', 'share', 'staff_invitation', 'sign_in', 'email_change')),
  CONSTRAINT access_tokens_ck34 CHECK (hash_alg = 1 AND octet_length(token_hash) = 32),
  CONSTRAINT access_tokens_ck35 CHECK (num_nonnulls(registration_id, sign_in_request_id) = 1
    AND (token_type NOT IN ('verification', 'management', 'share') OR registration_id IS NOT NULL)
    AND (token_type <> 'sign_in' OR sign_in_request_id IS NOT NULL)),
  CONSTRAINT access_tokens_ck36 CHECK ((event_id IS NOT NULL) = (token_type IN ('verification', 'management', 'share', 'staff_invitation'))),
  CONSTRAINT access_tokens_ck37 CHECK (issued_via IN ('page', 'email')
    AND (issued_via <> 'page' OR token_type IN ('management', 'share'))
    AND ((issued_via = 'email') = (outbox_message_id IS NOT NULL AND attempt_no IS NOT NULL))),
  CONSTRAINT access_tokens_ck38 CHECK ((expires_at IS NOT NULL) = (token_type = 'verification')),
  CONSTRAINT access_tokens_ck39 CHECK ((revoked_at IS NULL) = (revoke_reason IS NULL)
    AND (revoke_reason IS NULL OR revoke_reason IN ('rotated', 'resubmitted', 'invitation_revoked', 'invitation_replaced', 'event_cancelled')))
);
CREATE INDEX access_tokens_ix11 ON app.access_tokens (registration_id, token_type);
CREATE INDEX access_tokens_ix13 ON app.access_tokens (sign_in_request_id) WHERE sign_in_request_id IS NOT NULL;

-- ---------------------------------------------------------------- messaging (outbox)
CREATE TABLE app.outbox_messages (
  id                      uuid PRIMARY KEY DEFAULT uuidv7(),                -- PK-15
  logical_key             text NOT NULL,
  message_type            text NOT NULL,
  lane                    text NOT NULL,
  regen_class             text NOT NULL,
  is_required_notice      boolean NOT NULL,
  event_id                uuid,
  registration_id         uuid,
  account_id              uuid,
  sign_in_request_id      uuid,
  schedule_version        integer,
  verification_generation integer,
  request_ref             uuid,
  recipient_email         text NOT NULL,
  payload                 jsonb NOT NULL DEFAULT '{}',
  status                  text NOT NULL DEFAULT 'QUEUED',
  possibly_accepted       boolean NOT NULL DEFAULT false,
  current_generation      smallint NOT NULL DEFAULT 1,
  attempt_no              integer NOT NULL DEFAULT 0,
  preclaim_failures       integer NOT NULL DEFAULT 0,
  lease_expires_at        timestamptz,
  next_attempt_at         timestamptz NOT NULL,
  horizon_at              timestamptz NOT NULL,
  awaiting_evidence_since timestamptz,
  created_at              timestamptz NOT NULL,
  settled_at              timestamptz,
  settle_reason           text,
  last_error_code         text,
  evidence_anomaly_at     timestamptz,
  correlation_id          text NOT NULL,
  CONSTRAINT outbox_messages_u21 UNIQUE (logical_key),
  CONSTRAINT outbox_messages_ck47 CHECK (status IN ('QUEUED', 'SENDING', 'WAITING_RETRY', 'AWAITING_EVIDENCE', 'ACCEPTED', 'FAILED', 'UNCONFIRMED', 'DROPPED')),
  CONSTRAINT outbox_messages_ck48 CHECK ((message_type, regen_class, lane, is_required_notice) IN (
    ('verification', 'A', 'bulk', false), ('existing_access', 'A', 'bulk', false), ('ticket_resend', 'A', 'bulk', false),
    ('management_link_replaced', 'A', 'bulk', false), ('staff_invitation', 'A', 'bulk', false),
    ('sign_in', 'A', 'priority', false), ('email_change_confirmation', 'A', 'priority', false),
    ('ticket_confirmation', 'B', 'bulk', false), ('promotion', 'B', 'bulk', false), ('event_change', 'B', 'bulk', false),
    ('event_cancellation', 'B', 'bulk', false), ('registration_cancelled', 'B', 'bulk', true), ('waitlist_removed', 'B', 'bulk', true),
    ('email_change_notice', 'B', 'bulk', false), ('waitlist_confirmation', 'C', 'bulk', false), ('reminder', 'C', 'bulk', false),
    ('waitlist_closed', 'C', 'bulk', false))),
  CONSTRAINT outbox_messages_ck49 CHECK ((status IN ('QUEUED', 'SENDING', 'WAITING_RETRY', 'AWAITING_EVIDENCE')) = (settled_at IS NULL AND settle_reason IS NULL)),
  CONSTRAINT outbox_messages_ck50 CHECK (NOT (status = 'FAILED' AND possibly_accepted)),
  CONSTRAINT outbox_messages_ck51 CHECK (NOT (status = 'DROPPED' AND possibly_accepted)),
  CONSTRAINT outbox_messages_ck52 CHECK (status <> 'UNCONFIRMED' OR possibly_accepted),
  CONSTRAINT outbox_messages_ck54 CHECK (status <> 'SENDING' OR lease_expires_at IS NOT NULL),
  CONSTRAINT outbox_messages_ck55 CHECK (status <> 'AWAITING_EVIDENCE' OR (awaiting_evidence_since IS NOT NULL AND possibly_accepted)),
  CONSTRAINT outbox_messages_ck56 CHECK (current_generation IN (1, 2) AND (current_generation = 1 OR regen_class = 'B')),
  CONSTRAINT outbox_messages_ck57 CHECK (attempt_no >= 0 AND preclaim_failures >= 0),
  CONSTRAINT outbox_messages_ck58 CHECK (jsonb_typeof(payload) = 'object'
    AND recipient_email = btrim(recipient_email) AND recipient_email !~ '[A-Z]'),
  CONSTRAINT outbox_messages_ck69 CHECK (NOT (is_required_notice AND status = 'DROPPED'))
) WITH (fillfactor = 85);
CREATE INDEX outbox_messages_ix20 ON app.outbox_messages (lane, next_attempt_at, id) WHERE status IN ('QUEUED', 'WAITING_RETRY');
CREATE INDEX outbox_messages_ix21 ON app.outbox_messages (lease_expires_at, id) WHERE status = 'SENDING';
CREATE INDEX outbox_messages_ix23 ON app.outbox_messages (horizon_at, id) WHERE status IN ('QUEUED', 'SENDING', 'WAITING_RETRY', 'AWAITING_EVIDENCE');
CREATE INDEX outbox_messages_ix24 ON app.outbox_messages (event_id)
  WHERE is_required_notice AND status IN ('QUEUED', 'SENDING', 'WAITING_RETRY', 'AWAITING_EVIDENCE');
CREATE INDEX outbox_messages_ix25 ON app.outbox_messages (event_id, registration_id);
CREATE INDEX outbox_messages_ix35 ON app.outbox_messages (preclaim_failures, id)
  WHERE preclaim_failures > 0 AND status IN ('QUEUED', 'WAITING_RETRY');

CREATE TABLE app.outbox_generations (
  outbox_id           uuid NOT NULL REFERENCES app.outbox_messages (id) ON DELETE CASCADE, -- FK-24
  generation          smallint NOT NULL,
  provider_key        text NOT NULL,
  created_at          timestamptz NOT NULL,
  regen_reason        text,
  provider_message_id text,
  accepted_at         timestamptz,
  delivered_at        timestamptz,
  bounced_at          timestamptz,
  failed_at           timestamptz,
  suppressed_at       timestamptz,
  complained_at       timestamptz,
  last_delayed_at     timestamptz,
  failure_reason      text,
  facts_updated_at    timestamptz,
  PRIMARY KEY (outbox_id, generation),                                     -- PK-16
  CONSTRAINT outbox_generations_u22 UNIQUE (provider_key),
  CONSTRAINT outbox_generations_ck59 CHECK (generation IN (1, 2))
);
CREATE UNIQUE INDEX outbox_generations_u23 ON app.outbox_generations (provider_message_id) WHERE provider_message_id IS NOT NULL;

CREATE TABLE app.outbox_attempts (
  id                  uuid PRIMARY KEY DEFAULT uuidv7(),                    -- PK-17
  outbox_id           uuid NOT NULL,
  generation          smallint NOT NULL,
  attempt_no          integer NOT NULL,
  worker_id           text NOT NULL,
  claimed_at          timestamptz NOT NULL,
  lease_expires_at    timestamptz NOT NULL,
  send_started_at     timestamptz,
  lease_expired_at    timestamptz,
  result_at           timestamptz,
  result_category     text,
  http_status         integer,
  provider_message_id text,
  possibly_accepted   boolean,
  stale               boolean NOT NULL DEFAULT false,
  error_code          text,
  latency_ms          integer,
  CONSTRAINT outbox_attempts_u24 UNIQUE (outbox_id, attempt_no),
  CONSTRAINT outbox_attempts_fk25 FOREIGN KEY (outbox_id, generation)
    REFERENCES app.outbox_generations (outbox_id, generation) ON DELETE CASCADE,
  CONSTRAINT outbox_attempts_ck60 CHECK ((result_at IS NULL) = (result_category IS NULL)
    AND (result_category IS NULL OR result_category IN ('accepted', 'replayed', 'idempotent_key_conflict', 'concurrent_conflict',
      'rate_limited', 'ambiguous', 'permanent', 'config_fault', 'aborted_before_send'))
    AND (send_started_at IS NULL OR send_started_at >= claimed_at))
);

-- ---------------------------------------------------------------- audit and platform
CREATE TABLE app.audit_records (
  id                     uuid PRIMARY KEY DEFAULT uuidv7(),                 -- PK-23
  occurred_at            timestamptz NOT NULL,
  action                 text NOT NULL,
  actor_kind             text NOT NULL,
  actor_account_id       uuid,
  actor_staff_session_id uuid,
  event_id               uuid,
  registration_id        uuid,
  ticket_id              uuid,
  subject_id             uuid,
  outcome                text NOT NULL,
  details                jsonb NOT NULL DEFAULT '{}',
  CONSTRAINT audit_records_ck65 CHECK (actor_kind IN ('owner', 'staff', 'participant_link', 'system', 'account')
    AND jsonb_typeof(details) = 'object')
);
CREATE INDEX audit_records_ix32 ON app.audit_records (event_id, occurred_at);
CREATE INDEX audit_records_ix33 ON app.audit_records (actor_account_id, occurred_at);

CREATE TABLE app.rate_limit_counters (
  scope        text NOT NULL,
  key_id       smallint NOT NULL,
  key_hash     bytea NOT NULL,
  window_start timestamptz NOT NULL,
  count        integer NOT NULL,
  expires_at   timestamptz NOT NULL,
  PRIMARY KEY (scope, key_id, key_hash, window_start),                     -- PK-25
  CONSTRAINT rate_limit_counters_ck67 CHECK (count >= 1 AND expires_at > window_start)
);
CREATE INDEX rate_limit_counters_ix34 ON app.rate_limit_counters (expires_at);

-- ---------------------------------------------------------------- triggers
-- TR-01: registrations.event_id is immutable (NFR-CON-5).
CREATE FUNCTION app.registrations_event_id_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.event_id IS DISTINCT FROM OLD.event_id THEN
    RAISE EXCEPTION 'registrations.event_id is immutable' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER registrations_tr01 BEFORE UPDATE OF event_id ON app.registrations
  FOR EACH ROW EXECUTE FUNCTION app.registrations_event_id_immutable();

-- TR-02 to TR-04 (FN-06): confirmed_count from the net change per statement (NFR-CON-5).
CREATE FUNCTION app.registrations_confirmed_delta_insert() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE r record;
BEGIN
  FOR r IN SELECT event_id, count(*)::integer AS delta FROM new_rows WHERE state = 'CONFIRMED' GROUP BY event_id ORDER BY event_id LOOP
    PERFORM 1 FROM app.events WHERE id = r.event_id FOR UPDATE;
    UPDATE app.events SET confirmed_count = confirmed_count + r.delta WHERE id = r.event_id;
  END LOOP;
  RETURN NULL;
END $$;

CREATE FUNCTION app.registrations_confirmed_delta_update() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT event_id, sum(d)::integer AS delta FROM (
      SELECT event_id, 1 AS d FROM new_rows WHERE state = 'CONFIRMED'
      UNION ALL
      SELECT event_id, -1 AS d FROM old_rows WHERE state = 'CONFIRMED'
    ) c GROUP BY event_id HAVING sum(d) <> 0 ORDER BY event_id
  LOOP
    PERFORM 1 FROM app.events WHERE id = r.event_id FOR UPDATE;
    UPDATE app.events SET confirmed_count = confirmed_count + r.delta WHERE id = r.event_id;
  END LOOP;
  RETURN NULL;
END $$;

CREATE FUNCTION app.registrations_confirmed_delta_delete() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE r record;
BEGIN
  FOR r IN SELECT event_id, count(*)::integer AS delta FROM old_rows WHERE state = 'CONFIRMED' GROUP BY event_id ORDER BY event_id LOOP
    -- An event row deleted in the same statement no longer exists; the update then matches nothing.
    UPDATE app.events SET confirmed_count = confirmed_count - r.delta WHERE id = r.event_id;
  END LOOP;
  RETURN NULL;
END $$;

CREATE TRIGGER registrations_tr02 AFTER INSERT ON app.registrations REFERENCING NEW TABLE AS new_rows
  FOR EACH STATEMENT EXECUTE FUNCTION app.registrations_confirmed_delta_insert();
CREATE TRIGGER registrations_tr03 AFTER UPDATE ON app.registrations REFERENCING OLD TABLE AS old_rows NEW TABLE AS new_rows
  FOR EACH STATEMENT EXECUTE FUNCTION app.registrations_confirmed_delta_update();
CREATE TRIGGER registrations_tr04 AFTER DELETE ON app.registrations REFERENCING OLD TABLE AS old_rows
  FOR EACH STATEMENT EXECUTE FUNCTION app.registrations_confirmed_delta_delete();

-- TR-05: a CANCELLED event is never deleted (BR-26).
CREATE FUNCTION app.events_no_delete_cancelled() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.status = 'CANCELLED' THEN
    RAISE EXCEPTION 'cancelled events cannot be deleted' USING ERRCODE = 'check_violation';
  END IF;
  RETURN OLD;
END $$;
CREATE TRIGGER events_tr05 BEFORE DELETE ON app.events FOR EACH ROW EXECUTE FUNCTION app.events_no_delete_cancelled();

-- TR-16: only the confirmed-count triggers may change confirmed_count.
-- TR-17: the creation request ID and fingerprint are immutable (D-17).
CREATE FUNCTION app.events_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.confirmed_count IS DISTINCT FROM OLD.confirmed_count AND pg_trigger_depth() < 2 THEN
    RAISE EXCEPTION 'confirmed_count is maintained by triggers only' USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.creation_request_id IS DISTINCT FROM OLD.creation_request_id
     OR NEW.creation_fingerprint IS DISTINCT FROM OLD.creation_fingerprint THEN
    RAISE EXCEPTION 'event creation request is immutable' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER events_tr16 BEFORE UPDATE ON app.events FOR EACH ROW EXECUTE FUNCTION app.events_guard();

-- TR-06: only the undo columns of a check-in change, once.
CREATE FUNCTION app.check_ins_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.ticket_id IS DISTINCT FROM OLD.ticket_id OR NEW.event_id IS DISTINCT FROM OLD.event_id
     OR NEW.checked_in_at IS DISTINCT FROM OLD.checked_in_at OR OLD.undone_at IS NOT NULL THEN
    RAISE EXCEPTION 'check-in rows are immutable except for a single undo' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER check_ins_tr06 BEFORE UPDATE ON app.check_ins FOR EACH ROW EXECUTE FUNCTION app.check_ins_guard();

-- TR-07: notify the live check-in count once per event per statement.
CREATE FUNCTION app.check_ins_notify() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  PERFORM pg_notify('checkin_count', e.event_id::text) FROM (SELECT DISTINCT event_id FROM new_rows) e;
  RETURN NULL;
END $$;
CREATE TRIGGER check_ins_tr07_ins AFTER INSERT ON app.check_ins REFERENCING NEW TABLE AS new_rows
  FOR EACH STATEMENT EXECUTE FUNCTION app.check_ins_notify();
CREATE TRIGGER check_ins_tr07_upd AFTER UPDATE ON app.check_ins REFERENCING NEW TABLE AS new_rows
  FOR EACH STATEMENT EXECUTE FUNCTION app.check_ins_notify();

-- TR-09: wake workers for priority messages.
CREATE FUNCTION app.outbox_priority_notify() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM new_rows WHERE lane = 'priority') THEN
    PERFORM pg_notify('priority_wakeup', '');
  END IF;
  RETURN NULL;
END $$;
CREATE TRIGGER outbox_messages_tr09 AFTER INSERT ON app.outbox_messages REFERENCING NEW TABLE AS new_rows
  FOR EACH STATEMENT EXECUTE FUNCTION app.outbox_priority_notify();

-- TR-13: audit records are append-only.
CREATE FUNCTION app.reject_change() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION '% is append-only', TG_TABLE_NAME USING ERRCODE = 'insufficient_privilege';
END $$;
CREATE TRIGGER audit_records_tr13 BEFORE UPDATE OR DELETE ON app.audit_records FOR EACH ROW EXECUTE FUNCTION app.reject_change();

-- TR-15: access tokens: only revocation columns change, once.
CREATE FUNCTION app.access_tokens_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.token_hash IS DISTINCT FROM OLD.token_hash OR NEW.token_type IS DISTINCT FROM OLD.token_type
     OR NEW.registration_id IS DISTINCT FROM OLD.registration_id OR NEW.sign_in_request_id IS DISTINCT FROM OLD.sign_in_request_id
     OR NEW.event_id IS DISTINCT FROM OLD.event_id OR NEW.issued_at IS DISTINCT FROM OLD.issued_at
     OR (OLD.revoked_at IS NOT NULL AND NEW.revoked_at IS DISTINCT FROM OLD.revoked_at) THEN
    RAISE EXCEPTION 'access tokens are immutable except for a single revocation' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER access_tokens_tr15 BEFORE UPDATE ON app.access_tokens FOR EACH ROW EXECUTE FUNCTION app.access_tokens_guard();

-- ---------------------------------------------------------------- privileges (PRV-02, PRV-03)
GRANT USAGE ON SCHEMA app TO app_runtime;
ALTER DEFAULT PRIVILEGES IN SCHEMA app GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO app_runtime;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA app TO app_runtime;
REVOKE UPDATE, DELETE ON app.audit_records FROM app_runtime;
REVOKE SELECT, INSERT, UPDATE, DELETE ON app.schema_migrations FROM app_runtime;
GRANT SELECT ON app.schema_migrations TO app_runtime;
