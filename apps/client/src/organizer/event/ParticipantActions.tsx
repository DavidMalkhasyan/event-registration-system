import { useState } from 'react';
import { RotateCcw, UserMinus } from 'lucide-react';
import { ApiError, api, errorMessage } from '../../shared/api';
import { Button, ConfirmDialog, Field } from '../../shared/ui';
import type { Notice, Participant, Session } from '../types';

/**
 * Owner-only removal of one waiting-list entry (FR-WL-10 to FR-WL-13, PD-62): an explicit confirmation
 * step and an optional reason. It never promotes anyone; the participant is emailed a removal notice.
 */
export function RemoveFromWaitlist({
  session,
  eventId,
  participant,
  onDone,
}: {
  session: Session;
  eventId: string;
  participant: Participant;
  onDone: (notice: Notice) => void;
}) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  if (participant.state !== 'WAITLISTED') return null;
  const close = () => {
    setOpen(false);
    setReason('');
  };
  const submit = async () => {
    setBusy(true);
    try {
      await api(`/api/events/${eventId}/registrations/${participant.registrationId}/waitlist-removal`, {
        method: 'POST',
        csrf: session.csrfToken,
        body: { confirmed: true, ...(reason.trim() ? { reason: reason.trim() } : {}) },
      });
      onDone({
        kind: 'success',
        text: `${participant.email} was removed from the waiting list and has been emailed.`,
      });
    } catch (err) {
      onDone({
        kind: 'error',
        text:
          err instanceof ApiError && err.code === 'not_waitlisted'
            ? `${participant.email} is no longer on the waiting list (already removed, promoted or cancelled). Nothing was changed.`
            : errorMessage(err),
      });
    }
    setBusy(false);
    close();
  };
  return (
    <>
      <Button variant="ghost" size="sm" onClick={() => setOpen(true)}>
        <UserMinus aria-hidden="true" />
        Remove from waiting list
      </Button>
      <ConfirmDialog
        open={open}
        title="Remove from the waiting list?"
        confirmLabel={busy ? 'Removing…' : 'Yes, remove'}
        cancelLabel="Keep on the list"
        destructive
        busy={busy}
        onConfirm={submit}
        onClose={close}
      >
        <p>
          Remove {participant.email} (position {participant.position}) from the waiting list? Nobody is
          promoted, and they will be emailed that you removed them.
        </p>
        <Field label="Reason (optional, not sent to the participant)">
          {(id) => (
            <input
              id={id}
              className="input"
              value={reason}
              maxLength={500}
              onChange={(e) => setReason(e.target.value)}
            />
          )}
        </Field>
      </ConfirmDialog>
    </>
  );
}

/**
 * Owner-only undo of a check-in (FR-CHK-8, PD-59, PD-60), with an explicit confirmation step and an
 * optional reason. The staff screen never shows this; the server refuses staff anyway (AC-26).
 */
export function UndoCheckIn({
  session,
  eventId,
  participant,
  onDone,
}: {
  session: Session;
  eventId: string;
  participant: Participant;
  onDone: (notice: Notice) => void;
}) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  if (!participant.checkInId) return null;
  const close = () => {
    setOpen(false);
    setReason('');
  };
  const submit = async () => {
    setBusy(true);
    try {
      await api(`/api/events/${eventId}/check-ins/${participant.checkInId}/undo`, {
        method: 'POST',
        csrf: session.csrfToken,
        body: reason.trim() ? { reason: reason.trim() } : {},
      });
      onDone({
        kind: 'success',
        text: `Check-in undone for ${participant.email}. The ticket can be checked in again.`,
      });
    } catch (err) {
      onDone({ kind: 'error', text: errorMessage(err) });
    }
    setBusy(false);
    close();
  };
  return (
    <>
      <Button variant="ghost" size="sm" onClick={() => setOpen(true)}>
        <RotateCcw aria-hidden="true" />
        Undo check-in
      </Button>
      <ConfirmDialog
        open={open}
        title="Undo this check-in?"
        confirmLabel={busy ? 'Undoing…' : 'Confirm undo'}
        cancelLabel="Keep check-in"
        busy={busy}
        onConfirm={submit}
        onClose={close}
      >
        <p>
          The ticket of {participant.email} becomes valid again and can be checked in once more. The undo is
          recorded with your account and the time.
        </p>
        <Field label="Reason (optional)">
          {(id) => (
            <input
              id={id}
              className="input"
              value={reason}
              maxLength={500}
              onChange={(e) => setReason(e.target.value)}
            />
          )}
        </Field>
      </ConfirmDialog>
    </>
  );
}
