-- 0015_staff_self_end: a staff device can end its own check-in access (K-715, PD-95), for example a
-- shared or borrowed phone at the end of a shift. The session is revoked like an owner's revocation,
-- with its own reason, so the organizer's records show who ended it.

ALTER TABLE app.staff_sessions DROP CONSTRAINT staff_sessions_ck74;
ALTER TABLE app.staff_sessions ADD CONSTRAINT staff_sessions_ck74 CHECK (hash_alg = 1 AND octet_length(session_hash) = 32
  AND absolute_expires_at > created_at
  AND (revoked_at IS NULL) = (revoke_reason IS NULL)
  AND (revoke_reason IS NULL OR revoke_reason IN ('owner_revoked', 'staff_ended')));
