-- 0011_platform_admins: the Super Admin area (K-710, amendment A-3, ADR-022, PD-90). Super Admins are
-- separate from organizer accounts: their own table, sessions and cookie; no organizer account gains
-- or can be given platform privileges here. The first Super Admin is created by an operator command
-- (`pnpm admin:create`, apps/server/src/entrypoints/admin.ts) on the server, never through the API.

CREATE TABLE app.platform_admins (
  id                  uuid PRIMARY KEY DEFAULT uuidv7(),
  email               text NOT NULL,
  display_name        text NOT NULL,
  password_hash       text NOT NULL,
  created_at          timestamptz NOT NULL,
  password_changed_at timestamptz NOT NULL,
  disabled_at         timestamptz,
  CONSTRAINT platform_admins_u_email UNIQUE (email),
  CONSTRAINT platform_admins_ck_email CHECK (email = btrim(email) AND email !~ '[A-Z]' AND char_length(email) BETWEEN 3 AND 254),
  CONSTRAINT platform_admins_ck_name CHECK (char_length(btrim(display_name)) BETWEEN 1 AND 200),
  CONSTRAINT platform_admins_ck_password CHECK (password_hash LIKE '$argon2id$%')
);

CREATE TABLE app.platform_admin_sessions (
  id                  uuid PRIMARY KEY DEFAULT uuidv7(),
  admin_id            uuid NOT NULL REFERENCES app.platform_admins (id),
  session_hash        bytea NOT NULL,
  created_at          timestamptz NOT NULL,
  last_seen_at        timestamptz NOT NULL,
  absolute_expires_at timestamptz NOT NULL,
  revoked_at          timestamptz,
  revoke_reason       text,
  CONSTRAINT platform_admin_sessions_u_hash UNIQUE (session_hash),
  CONSTRAINT platform_admin_sessions_ck_hash CHECK (octet_length(session_hash) = 32),
  CONSTRAINT platform_admin_sessions_ck_revoked CHECK ((revoked_at IS NULL) = (revoke_reason IS NULL)
    AND (revoke_reason IS NULL OR revoke_reason IN ('sign_out', 'admin_disabled'))),
  CONSTRAINT platform_admin_sessions_ck_times CHECK (absolute_expires_at > created_at AND last_seen_at >= created_at)
);
CREATE INDEX platform_admin_sessions_ix_admin ON app.platform_admin_sessions (admin_id);

-- Who decided, and why (shown to the Super Admins; the reason is also in the owner's email).
ALTER TABLE app.organizations
  ADD COLUMN decided_by_admin_id uuid REFERENCES app.platform_admins (id),
  ADD COLUMN decision_reason text,
  ADD CONSTRAINT organizations_ck_reason CHECK (decision_reason IS NULL OR char_length(decision_reason) <= 1000);
CREATE INDEX organizations_ix_status ON app.organizations (status, submitted_at);

-- Audit: a Super Admin is an actor of its own kind, recorded by its ID (NFR-SEC-5: IDs only).
ALTER TABLE app.audit_records ADD COLUMN actor_admin_id uuid;
ALTER TABLE app.audit_records DROP CONSTRAINT audit_records_ck65;
ALTER TABLE app.audit_records ADD CONSTRAINT audit_records_ck65 CHECK (
  actor_kind IN ('owner', 'staff', 'participant_link', 'system', 'account', 'platform_admin')
  AND (actor_kind <> 'platform_admin' OR actor_admin_id IS NOT NULL)
  AND jsonb_typeof(details) = 'object');
CREATE INDEX audit_records_ix_subject ON app.audit_records (subject_id, occurred_at);

-- Owners hear about decisions on their organization (class A: nothing to regenerate; no link).
ALTER TABLE app.outbox_messages DROP CONSTRAINT outbox_messages_ck48;
ALTER TABLE app.outbox_messages ADD CONSTRAINT outbox_messages_ck48 CHECK ((message_type, regen_class, lane, is_required_notice) IN (
  ('verification', 'A', 'bulk', false), ('existing_access', 'A', 'bulk', false), ('ticket_resend', 'A', 'bulk', false),
  ('management_link_replaced', 'A', 'bulk', false), ('staff_invitation', 'A', 'bulk', false),
  ('sign_in', 'A', 'priority', false), ('email_change_confirmation', 'A', 'priority', false),
  ('account_verification', 'A', 'priority', false), ('password_reset', 'A', 'priority', false),
  ('account_exists_notice', 'A', 'bulk', false), ('organization_decision', 'A', 'bulk', false),
  ('ticket_confirmation', 'B', 'bulk', false), ('promotion', 'B', 'bulk', false), ('event_change', 'B', 'bulk', false),
  ('event_cancellation', 'B', 'bulk', false), ('registration_cancelled', 'B', 'bulk', true), ('waitlist_removed', 'B', 'bulk', true),
  ('organizer_cancellation', 'B', 'bulk', true),
  ('email_change_notice', 'B', 'bulk', false), ('waitlist_confirmation', 'C', 'bulk', false), ('reminder', 'C', 'bulk', false),
  ('waitlist_closed', 'C', 'bulk', false)));
