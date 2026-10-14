-- 0014_organization_invitations: several organizers per organization (K-716, amendment A-3, PD-94).
-- An owner or admin invites an email address with a role; the invitee accepts while signed in with a
-- verified account of that address (no link token: the verified address is the proof). Owners are not
-- invited; an owner can make a member an owner afterwards. One pending invitation per organization and
-- address; invitations expire after 14 days.

CREATE TABLE app.organization_invitations (
  id                    uuid PRIMARY KEY DEFAULT uuidv7(),
  organization_id       uuid NOT NULL REFERENCES app.organizations (id),
  email                 text NOT NULL,
  role                  text NOT NULL,
  invited_by_account_id uuid NOT NULL REFERENCES app.accounts (id),
  created_at            timestamptz NOT NULL,
  expires_at            timestamptz NOT NULL,
  status                text NOT NULL DEFAULT 'pending',
  decided_at            timestamptz,
  CONSTRAINT organization_invitations_ck_email CHECK (email = btrim(email) AND email !~ '[A-Z]' AND char_length(email) BETWEEN 3 AND 254),
  CONSTRAINT organization_invitations_ck_role CHECK (role IN ('admin', 'member')),
  CONSTRAINT organization_invitations_ck_status CHECK (status IN ('pending', 'accepted', 'declined', 'revoked')),
  CONSTRAINT organization_invitations_ck_decided CHECK ((status = 'pending') = (decided_at IS NULL)),
  CONSTRAINT organization_invitations_ck_expiry CHECK (expires_at > created_at)
);
CREATE UNIQUE INDEX organization_invitations_u_pending
  ON app.organization_invitations (organization_id, email) WHERE status = 'pending';
CREATE INDEX organization_invitations_ix_email ON app.organization_invitations (email) WHERE status = 'pending';

-- The invitee is told by email (class A: no link to issue).
ALTER TABLE app.outbox_messages DROP CONSTRAINT outbox_messages_ck48;
ALTER TABLE app.outbox_messages ADD CONSTRAINT outbox_messages_ck48 CHECK ((message_type, regen_class, lane, is_required_notice) IN (
  ('verification', 'A', 'bulk', false), ('existing_access', 'A', 'bulk', false), ('ticket_resend', 'A', 'bulk', false),
  ('management_link_replaced', 'A', 'bulk', false), ('staff_invitation', 'A', 'bulk', false),
  ('sign_in', 'A', 'priority', false), ('email_change_confirmation', 'A', 'priority', false),
  ('account_verification', 'A', 'priority', false), ('password_reset', 'A', 'priority', false),
  ('account_exists_notice', 'A', 'bulk', false), ('organization_decision', 'A', 'bulk', false),
  ('organization_invitation', 'A', 'bulk', false),
  ('ticket_confirmation', 'B', 'bulk', false), ('promotion', 'B', 'bulk', false), ('event_change', 'B', 'bulk', false), ('venue_change', 'B', 'bulk', false),
  ('event_cancellation', 'B', 'bulk', false), ('registration_cancelled', 'B', 'bulk', true), ('waitlist_removed', 'B', 'bulk', true),
  ('organizer_cancellation', 'B', 'bulk', true),
  ('email_change_notice', 'B', 'bulk', false), ('waitlist_confirmation', 'C', 'bulk', false), ('reminder', 'C', 'bulk', false),
  ('waitlist_closed', 'C', 'bulk', false)));
