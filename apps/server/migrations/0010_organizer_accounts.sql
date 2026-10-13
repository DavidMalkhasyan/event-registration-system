-- 0010_organizer_accounts: password accounts, email verification and password reset for organizers
-- (K-709, amendment A-3, PD-89). Backward compatible: existing accounts keep their sessions and are
-- marked verified (they confirmed emailed links before); they have no password until they set one.
-- The emailed links reuse the sign-in request and access-token machinery (hash-only tokens issued at
-- send time, single use, expiring with their request).

-- Accounts: contact name, Argon2id password hash (PHC string), verification time.
ALTER TABLE app.accounts
  ADD COLUMN display_name        text,
  ADD COLUMN password_hash       text,
  ADD COLUMN password_changed_at timestamptz,
  ADD COLUMN email_verified_at   timestamptz;
ALTER TABLE app.accounts
  ADD CONSTRAINT accounts_ck_display_name CHECK (display_name IS NULL OR char_length(btrim(display_name)) BETWEEN 1 AND 200),
  ADD CONSTRAINT accounts_ck_password CHECK ((password_hash IS NULL) = (password_changed_at IS NULL)
    AND (password_hash IS NULL OR password_hash LIKE '$argon2id$%'));
UPDATE app.accounts SET email_verified_at = created_at WHERE email_verified_at IS NULL;

-- Request purposes for the new emailed links.
ALTER TABLE app.sign_in_requests DROP CONSTRAINT sign_in_requests_ck03;
ALTER TABLE app.sign_in_requests ADD CONSTRAINT sign_in_requests_ck03
  CHECK (purpose IN ('sign_in', 'reauth', 'verify_email', 'reset_password'));
ALTER TABLE app.sign_in_requests DROP CONSTRAINT sign_in_requests_ck05;
ALTER TABLE app.sign_in_requests ADD CONSTRAINT sign_in_requests_ck05
  CHECK ((purpose = 'reauth') = (reauth_session_id IS NOT NULL)
    AND (purpose NOT IN ('reauth', 'verify_email', 'reset_password') OR account_id IS NOT NULL));

-- Token types for the new links; like sign-in tokens they belong to a request and have no event.
ALTER TABLE app.access_tokens DROP CONSTRAINT access_tokens_ck33;
ALTER TABLE app.access_tokens ADD CONSTRAINT access_tokens_ck33 CHECK (token_type IN
  ('verification', 'management', 'share', 'staff_invitation', 'sign_in', 'email_change', 'account_verification', 'password_reset'));
ALTER TABLE app.access_tokens DROP CONSTRAINT access_tokens_ck35;
-- Based on 0006's definition (staff invitation tokens are owned by their invitation).
ALTER TABLE app.access_tokens ADD CONSTRAINT access_tokens_ck35 CHECK (
  num_nonnulls(registration_id, sign_in_request_id, staff_invitation_id) = 1
  AND (token_type NOT IN ('verification', 'management', 'share') OR registration_id IS NOT NULL)
  AND (token_type NOT IN ('sign_in', 'account_verification', 'password_reset') OR sign_in_request_id IS NOT NULL)
  AND (token_type <> 'staff_invitation' OR staff_invitation_id IS NOT NULL));

-- Sessions: created by an emailed link (as before) or by a password.
ALTER TABLE app.organizer_sessions ALTER COLUMN created_from_request_id DROP NOT NULL;
ALTER TABLE app.organizer_sessions ADD COLUMN auth_method text NOT NULL DEFAULT 'email_link';
ALTER TABLE app.organizer_sessions ADD CONSTRAINT organizer_sessions_ck_auth_method
  CHECK (auth_method IN ('email_link', 'password') AND (auth_method = 'email_link') = (created_from_request_id IS NOT NULL));
ALTER TABLE app.organizer_sessions DROP CONSTRAINT organizer_sessions_ck11;
ALTER TABLE app.organizer_sessions ADD CONSTRAINT organizer_sessions_ck11 CHECK ((revoked_at IS NULL) = (revoke_reason IS NULL)
  AND (revoke_reason IS NULL OR revoke_reason IN ('sign_out', 'sign_out_everywhere', 'reauth_replaced', 'email_changed', 'password_reset')));

-- Message types for the new emails (priority lane like sign-in links; a notice for existing addresses).
ALTER TABLE app.outbox_messages DROP CONSTRAINT outbox_messages_ck48;
ALTER TABLE app.outbox_messages ADD CONSTRAINT outbox_messages_ck48 CHECK ((message_type, regen_class, lane, is_required_notice) IN (
  ('verification', 'A', 'bulk', false), ('existing_access', 'A', 'bulk', false), ('ticket_resend', 'A', 'bulk', false),
  ('management_link_replaced', 'A', 'bulk', false), ('staff_invitation', 'A', 'bulk', false),
  ('sign_in', 'A', 'priority', false), ('email_change_confirmation', 'A', 'priority', false),
  ('account_verification', 'A', 'priority', false), ('password_reset', 'A', 'priority', false),
  ('account_exists_notice', 'A', 'bulk', false),
  ('ticket_confirmation', 'B', 'bulk', false), ('promotion', 'B', 'bulk', false), ('event_change', 'B', 'bulk', false),
  ('event_cancellation', 'B', 'bulk', false), ('registration_cancelled', 'B', 'bulk', true), ('waitlist_removed', 'B', 'bulk', true),
  ('organizer_cancellation', 'B', 'bulk', true),
  ('email_change_notice', 'B', 'bulk', false), ('waitlist_confirmation', 'C', 'bulk', false), ('reminder', 'C', 'bulk', false),
  ('waitlist_closed', 'C', 'bulk', false)));
