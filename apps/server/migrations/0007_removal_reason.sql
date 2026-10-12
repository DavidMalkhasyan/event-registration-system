-- 0007_removal_reason: the optional reason of a waiting-list removal (FR-WL-13, TX-W01; PD-63).
-- The audit record may hold IDs and enumerations only (DATABASE_DESIGN §5.8, AC-100), so the
-- free-text reason is kept on the registration, as check_ins.undo_reason is for check-in undo.

ALTER TABLE app.registrations ADD COLUMN removal_reason text;
ALTER TABLE app.registrations ADD CONSTRAINT registrations_removal_reason_ck CHECK (
  removal_reason IS NULL
  OR (end_reason = 'removed_by_organizer' AND char_length(removal_reason) BETWEEN 1 AND 500));
