-- 0017_admin_totp: a second factor for Super Admins (K-718, PD-99). A TOTP secret, encrypted with
-- AES-256-GCM under the operator key ADMIN_TOTP_KEY (never stored in the database), the time it was
-- enrolled, and the last time step used, so the same code cannot be used twice. Enrolment is only
-- through the operator command `pnpm admin:totp`; nothing on the web sets or reads it.

ALTER TABLE app.platform_admins
  ADD COLUMN totp_secret_sealed bytea,
  ADD COLUMN totp_enrolled_at   timestamptz,
  ADD COLUMN totp_last_step     bigint,
  ADD CONSTRAINT platform_admins_ck_totp CHECK ((totp_secret_sealed IS NULL) = (totp_enrolled_at IS NULL)
    AND (totp_secret_sealed IS NULL OR octet_length(totp_secret_sealed) BETWEEN 40 AND 100));
