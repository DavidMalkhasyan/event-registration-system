-- 0006_staff: staff invitations and device sessions (FR-STAFF-1 to FR-STAFF-7, TX-S01 to TX-S03).
-- Source: DATABASE_DESIGN.md §5.4 and CONSTRAINTS_AND_INDEXES (U-16 to U-19, FK-10, FK-14, FK-15, CK-35).

CREATE TABLE app.staff_invitations (
  id             uuid PRIMARY KEY DEFAULT uuidv7(),                         -- PK-12
  event_id       uuid NOT NULL REFERENCES app.events (id) ON DELETE CASCADE, -- FK-14
  invited_email  text NOT NULL,
  status         text NOT NULL DEFAULT 'pending',
  created_at     timestamptz NOT NULL,
  expires_at     timestamptz NOT NULL,
  accepted_at    timestamptz,
  ended_at       timestamptz,
  CONSTRAINT staff_invitations_u16 UNIQUE (id, event_id),
  CONSTRAINT staff_invitations_ck73 CHECK (
    invited_email = btrim(invited_email) AND invited_email !~ '[A-Z]' AND char_length(invited_email) BETWEEN 3 AND 254
    AND status IN ('pending', 'accepted', 'revoked', 'replaced')
    AND (status = 'pending') = (ended_at IS NULL)
    AND (status = 'accepted') = (accepted_at IS NOT NULL)
    AND expires_at > created_at)
);
-- U-17: a re-invitation replaces the pending invitation for the same address (FR-STAFF-5).
CREATE UNIQUE INDEX staff_invitations_u17 ON app.staff_invitations (event_id, invited_email) WHERE status = 'pending';

CREATE TABLE app.staff_sessions (
  id                   uuid PRIMARY KEY DEFAULT uuidv7(),                   -- PK-13
  event_id             uuid NOT NULL,
  invitation_id        uuid NOT NULL,
  session_hash         bytea NOT NULL,
  hash_alg             smallint NOT NULL DEFAULT 1,
  created_at           timestamptz NOT NULL,
  last_seen_at         timestamptz NOT NULL,
  absolute_expires_at  timestamptz NOT NULL,
  revoked_at           timestamptz,
  revoke_reason        text,
  CONSTRAINT staff_sessions_u18 UNIQUE (session_hash),
  CONSTRAINT staff_sessions_u19 UNIQUE (invitation_id),                     -- one session per acceptance
  CONSTRAINT staff_sessions_fk15 FOREIGN KEY (invitation_id, event_id)
    REFERENCES app.staff_invitations (id, event_id) ON DELETE CASCADE,
  CONSTRAINT staff_sessions_ck74 CHECK (hash_alg = 1 AND octet_length(session_hash) = 32
    AND absolute_expires_at > created_at
    AND (revoked_at IS NULL) = (revoke_reason IS NULL)
    AND (revoke_reason IS NULL OR revoke_reason = 'owner_revoked'))
);

-- FK-10 and CK-35 (ADR-012): staff invitation tokens are owned by their invitation.
ALTER TABLE app.access_tokens ADD COLUMN staff_invitation_id uuid;
ALTER TABLE app.access_tokens ADD CONSTRAINT access_tokens_fk10 FOREIGN KEY (staff_invitation_id, event_id)
  REFERENCES app.staff_invitations (id, event_id) ON DELETE CASCADE;
CREATE INDEX access_tokens_ix12 ON app.access_tokens (staff_invitation_id) WHERE staff_invitation_id IS NOT NULL;
ALTER TABLE app.access_tokens DROP CONSTRAINT access_tokens_ck35;
ALTER TABLE app.access_tokens ADD CONSTRAINT access_tokens_ck35 CHECK (
  num_nonnulls(registration_id, sign_in_request_id, staff_invitation_id) = 1
  AND (token_type NOT IN ('verification', 'management', 'share') OR registration_id IS NOT NULL)
  AND (token_type <> 'sign_in' OR sign_in_request_id IS NOT NULL)
  AND (token_type <> 'staff_invitation' OR staff_invitation_id IS NOT NULL));

-- TR-15 extended: the new owner column is immutable like the others.
CREATE OR REPLACE FUNCTION app.access_tokens_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.token_hash IS DISTINCT FROM OLD.token_hash OR NEW.token_type IS DISTINCT FROM OLD.token_type
     OR NEW.registration_id IS DISTINCT FROM OLD.registration_id OR NEW.sign_in_request_id IS DISTINCT FROM OLD.sign_in_request_id
     OR NEW.staff_invitation_id IS DISTINCT FROM OLD.staff_invitation_id
     OR NEW.event_id IS DISTINCT FROM OLD.event_id OR NEW.issued_at IS DISTINCT FROM OLD.issued_at
     OR (OLD.revoked_at IS NOT NULL AND NEW.revoked_at IS DISTINCT FROM OLD.revoked_at) THEN
    RAISE EXCEPTION 'access tokens are immutable except for a single revocation' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
