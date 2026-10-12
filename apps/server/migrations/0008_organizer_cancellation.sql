-- 0008_organizer_cancellation: the owner cancels one CONFIRMED registration (K-703, PD-83).
-- A distinct end reason, so the record never reads as the participant's own cancellation, and a
-- dedicated required notice (class B, bulk lane, never dropped: CK-69), like the waiting-list removal
-- notice. Both constraints are widened only; every existing row stays valid.

ALTER TABLE app.registrations DROP CONSTRAINT registrations_ck24;
ALTER TABLE app.registrations ADD CONSTRAINT registrations_ck24 CHECK (
  (state IN ('CANCELLED', 'EXPIRED')) = (ended_at IS NOT NULL AND end_reason IS NOT NULL)
  AND (state <> 'CANCELLED'
       OR end_reason IN ('participant_cancelled', 'removed_by_organizer', 'event_cancelled', 'cancelled_by_organizer'))
  AND (state <> 'EXPIRED' OR end_reason IN ('cutoff', 'event_cancelled')));

ALTER TABLE app.outbox_messages DROP CONSTRAINT outbox_messages_ck48;
ALTER TABLE app.outbox_messages ADD CONSTRAINT outbox_messages_ck48 CHECK ((message_type, regen_class, lane, is_required_notice) IN (
  ('verification', 'A', 'bulk', false), ('existing_access', 'A', 'bulk', false), ('ticket_resend', 'A', 'bulk', false),
  ('management_link_replaced', 'A', 'bulk', false), ('staff_invitation', 'A', 'bulk', false),
  ('sign_in', 'A', 'priority', false), ('email_change_confirmation', 'A', 'priority', false),
  ('ticket_confirmation', 'B', 'bulk', false), ('promotion', 'B', 'bulk', false), ('event_change', 'B', 'bulk', false),
  ('event_cancellation', 'B', 'bulk', false), ('registration_cancelled', 'B', 'bulk', true), ('waitlist_removed', 'B', 'bulk', true),
  ('organizer_cancellation', 'B', 'bulk', true),
  ('email_change_notice', 'B', 'bulk', false), ('waitlist_confirmation', 'C', 'bulk', false), ('reminder', 'C', 'bulk', false),
  ('waitlist_closed', 'C', 'bulk', false)));
