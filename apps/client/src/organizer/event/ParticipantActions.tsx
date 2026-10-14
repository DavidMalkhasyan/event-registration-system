import { useState } from 'react';
import { RotateCcw, UserMinus, UserX } from 'lucide-react';
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
 * Owner-only cancellation of one CONFIRMED registration (K-703, PD-83): an explicit confirmation step.
 * The participant is emailed that the organizer cancelled it, the ticket stops being valid, and the
 * freed seat goes to the first person on the waiting list before registration closes. A checked-in
 * participant can't be cancelled; the row says why instead of offering the action.
 */
export function CancelRegistration({
  session,
  eventId,
  participant,
  waiting,
  promotionOpen,
  onDone,
}: {
  session: Session;
  eventId: string;
  participant: Participant;
  /** Number of people on the waiting list. */
  waiting: number;
  /** Whether a freed seat is still offered to the waiting list (before the cutoff). */
  promotionOpen: boolean;
  onDone: (notice: Notice) => void;
}) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  if (participant.state !== 'CONFIRMED') return null;
  if (participant.checkInId)
    return (
      <span className="muted action-note">
        Checked in, so the registration can’t be cancelled. Undo the check-in first if it was a mistake.
      </span>
    );
  const submit = async () => {
    setBusy(true);
    try {
      const result = await api<{ result: 'cancelled'; promoted: number }>(
        `/api/events/${eventId}/registrations/${participant.registrationId}/organizer-cancellation`,
        { method: 'POST', csrf: session.csrfToken, body: { confirmed: true } },
      );
      onDone({
        kind: 'success',
        text: `The registration of ${participant.email} was cancelled; a cancellation email to them is queued.${
          result.promoted > 0
            ? ' The seat went to the first person on the waiting list; their ticket email is queued.'
            : ''
        }`,
      });
    } catch (err) {
      const code = err instanceof ApiError ? err.code : '';
      onDone({
        kind: 'error',
        text:
          code === 'registration_not_confirmed'
            ? `${participant.email} is no longer confirmed (already cancelled or changed elsewhere). Nothing was changed.`
            : code === 'ticket_checked_in'
              ? `${participant.email} was checked in in the meantime, so the registration was not cancelled.`
              : errorMessage(err),
      });
    }
    setBusy(false);
    setOpen(false);
  };
  return (
    <>
      <Button variant="ghost" size="sm" onClick={() => setOpen(true)}>
        <UserX aria-hidden="true" />
        Cancel registration
      </Button>
      <ConfirmDialog
        open={open}
        title="Cancel this registration?"
        confirmLabel={busy ? 'Cancelling…' : 'Yes, cancel registration'}
        cancelLabel="Keep registration"
        destructive
        busy={busy}
        onConfirm={submit}
        onClose={() => setOpen(false)}
      >
        <p>
          Cancel the registration of <strong>{participant.email}</strong>? This can’t be undone.
        </p>
        <ul className="dialog-list">
          <li>Their ticket stops being valid.</li>
          <li>A cancellation email is queued for them, saying that the organizer cancelled it.</li>
          <li>
            {!promotionOpen
              ? 'Registration has closed, so the seat stays empty.'
              : waiting > 0
                ? `The seat goes to the first person on the waiting list (${waiting} waiting), who is emailed a ticket.`
                : 'The seat becomes free for new registrations.'}
          </li>
        </ul>
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
