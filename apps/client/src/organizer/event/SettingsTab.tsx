import { useId, useState, type FormEvent, type ReactNode } from 'react';
import { ApiError, api, errorMessage } from '../../shared/api';
import { Alert, Button, ConfirmDialog, Field } from '../../shared/ui';
import { RecentSignIn, ReauthPrompt } from '../auth/Reauth';
import type { EventItem, Notice, Session } from '../types';

function DetailsEditor({
  session,
  event,
  onDone,
}: {
  session: Session;
  event: EventItem;
  onDone: () => void;
}) {
  const [title, setTitle] = useState(event.title);
  const [description, setDescription] = useState(event.description ?? '');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<Notice>();
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setMessage(undefined);
    try {
      // FR-EVT-5: title and description only; participants are not emailed (AC-105).
      await api<EventItem>(`/api/events/${event.id}`, {
        method: 'PATCH',
        csrf: session.csrfToken,
        body: { title, description: description || null },
      });
      setMessage({ kind: 'success', text: 'Details saved. Participants are not emailed about this change.' });
      onDone();
    } catch (err) {
      setMessage({ kind: 'error', text: errorMessage(err) });
    } finally {
      setBusy(false);
    }
  };
  return (
    <form className="stack" onSubmit={submit}>
      <Field label="Event title">
        {(id) => (
          <input
            id={id}
            className="input"
            required
            maxLength={200}
            value={title}
            onChange={(e) => setTitle(e.target.value)}
          />
        )}
      </Field>
      <Field label="Event description">
        {(id) => (
          <textarea
            id={id}
            className="textarea"
            maxLength={5000}
            rows={4}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />
        )}
      </Field>
      <div>
        <Button type="submit" disabled={busy}>
          {busy ? 'Saving…' : 'Save details'}
        </Button>
      </div>
      {message && <Alert kind={message.kind}>{message.text}</Alert>}
    </form>
  );
}

function CapacityEditor({
  session,
  event,
  onDone,
}: {
  session: Session;
  event: EventItem;
  onDone: () => void;
}) {
  const [capacity, setCapacity] = useState(String(event.capacity));
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<Notice>();
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setMessage(undefined);
    try {
      // Absolute value (FR-EVT-7, FR-EVT-8): repeating the same request changes nothing.
      const updated = await api<EventItem>(`/api/events/${event.id}/capacity`, {
        method: 'PUT',
        csrf: session.csrfToken,
        body: { capacity: Number(capacity) },
      });
      const promotes = updated.capacity > event.capacity && event.phase === 'registration_open';
      setMessage({
        kind: 'success',
        text: `Capacity is now ${updated.capacity}.${promotes ? ' Free seats were offered to the waiting list in order, and promoted participants are emailed their tickets.' : ''}`,
      });
      onDone();
    } catch (err) {
      const minimum =
        err instanceof ApiError && err.code === 'capacity_below_confirmed'
          ? err.body.minimumCapacity
          : undefined;
      setMessage({
        kind: 'error',
        text:
          typeof minimum === 'number'
            ? `Capacity can't be lower than the ${minimum} confirmed participants. The minimum allowed capacity is ${minimum}.`
            : errorMessage(err),
      });
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <form className="inline-form" onSubmit={submit}>
        <Field label="Number of seats">
          {(id) => (
            <input
              id={id}
              className="input"
              type="number"
              min={1}
              max={100000}
              required
              value={capacity}
              onChange={(e) => setCapacity(e.target.value)}
            />
          )}
        </Field>
        <Button type="submit" disabled={busy}>
          {busy ? 'Saving…' : 'Update capacity'}
        </Button>
      </form>
      {message && <Alert kind={message.kind}>{message.text}</Alert>}
    </>
  );
}

function Reschedule({ session, event, onDone }: { session: Session; event: EventItem; onDone: () => void }) {
  const [localStart, setLocalStart] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<Notice>();
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      await api(`/api/events/${event.id}/reschedule`, {
        method: 'POST',
        csrf: session.csrfToken,
        body: { localStart, expectedScheduleVersion: event.scheduleVersion },
      });
      setMessage({
        kind: 'success',
        text: 'Rescheduled. Every confirmed and waiting participant is being notified by email.',
      });
      setLocalStart('');
      onDone();
    } catch (err) {
      setMessage({ kind: 'error', text: errorMessage(err) });
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <form className="inline-form" onSubmit={submit}>
        <Field label={`New date and time (${event.timeZone})`}>
          {(id) => (
            <input
              id={id}
              className="input"
              type="datetime-local"
              required
              value={localStart}
              onChange={(e) => setLocalStart(e.target.value)}
            />
          )}
        </Field>
        <Button type="submit" disabled={busy}>
          {busy ? 'Rescheduling…' : 'Reschedule and notify'}
        </Button>
      </form>
      {message && <Alert kind={message.kind}>{message.text}</Alert>}
    </>
  );
}

/** A labelled region, so each destructive action can be found by name (and by assistive technology). */
function DangerItem({ title, children }: { title: string; children: ReactNode }) {
  const id = useId();
  return (
    <section className="danger-item" aria-labelledby={id}>
      <h4 id={id}>{title}</h4>
      {children}
    </section>
  );
}

/**
 * Event cancellation (FR-EVT-9, BR-16): a destructive action with an explicit confirmation step.
 * If the sign-in is not recent, the server answers reauthentication_required (FR-ORG-5): the
 * organizer confirms it's them by email and then has to confirm the cancellation again.
 */
function CancelEvent({ session, event, onDone }: { session: Session; event: EventItem; onDone: () => void }) {
  const [step, setStep] = useState<'idle' | 'confirming' | 'sending' | 'reauth'>('idle');
  const [error, setError] = useState<string>();
  const cancel = async () => {
    setStep('sending');
    setError(undefined);
    try {
      await api(`/api/events/${event.id}/cancellation`, {
        method: 'POST',
        csrf: session.csrfToken,
        body: { confirmed: true },
      });
      setStep('idle');
      onDone();
    } catch (err) {
      if (err instanceof ApiError && err.code === 'reauthentication_required') {
        setStep('reauth'); // the confirmation must be given again after re-authentication
        return;
      }
      setError(errorMessage(err));
      setStep('idle');
    }
  };
  return (
    <DangerItem title="Cancel event">
      <p className="muted">
        Cancelling is permanent. Every ticket stops working, the waiting list is closed, and each confirmed
        and waiting participant is emailed. Checked-in records are kept.
      </p>
      {step === 'reauth' ? (
        <ReauthPrompt
          session={session}
          intro="For your security, cancelling needs a sign-in from the last 15 minutes. Confirm it’s you by email; the event is not cancelled until you confirm the cancellation again."
        />
      ) : (
        <div>
          <Button variant="destructive" onClick={() => setStep('confirming')}>
            Cancel this event…
          </Button>
        </div>
      )}
      <ConfirmDialog
        open={step === 'confirming' || step === 'sending'}
        title="Cancel this event?"
        confirmLabel={step === 'sending' ? 'Cancelling…' : 'Yes, cancel the event permanently'}
        cancelLabel="Keep the event"
        destructive
        busy={step === 'sending'}
        onConfirm={cancel}
        onClose={() => setStep('idle')}
      >
        <p>
          Cancel “{event.title}” permanently? This cannot be undone. Every confirmed and waiting participant
          is emailed, and tickets stop working.
        </p>
      </ConfirmDialog>
      {error && <Alert>{error}</Alert>}
    </DangerItem>
  );
}

interface DeletionPreview {
  eligible: boolean;
  blockers: string[];
  requiredNoticeIssues: { registrationId: string; messageType: string; sendState: string; label: string }[];
  previewToken: string;
}

const BLOCKER_TEXT: Record<string, string> = {
  has_confirmed_registrations:
    'It still has confirmed participants. Only events without confirmed or waiting participants can be deleted; you can cancel the event instead.',
  has_waitlisted_registrations: 'It still has participants on the waiting list.',
  notifications_pending: 'Notifications are still being sent; try again later.',
  event_cancelled: "Cancelled events can't be deleted.",
};

const NOTICE_TEXT: Record<string, string> = {
  failed: 'failed',
  delivery_outcome_unknown: 'delivery outcome unknown',
};

/**
 * Event deletion (FR-EVT-10, FR-EVT-14): the preview shows what will be deleted and why it may be
 * blocked; the confirmation sends the preview token, so the server deletes only that state. Needs a
 * recent sign-in (FR-ORG-5). Not offered for cancelled events (FR-EVT-11).
 */
function DeleteEvent({ session, event }: { session: Session; event: EventItem }) {
  const [step, setStep] = useState<'idle' | 'loading' | 'preview' | 'deleting' | 'reauth'>('idle');
  const [view, setView] = useState<DeletionPreview>();
  const [message, setMessage] = useState<string>();
  const loadPreview = async (note?: string) => {
    setStep('loading');
    setMessage(note);
    try {
      setView(await api<DeletionPreview>(`/api/events/${event.id}/deletion-preview`));
      setStep('preview');
    } catch (err) {
      if (err instanceof ApiError && err.code === 'reauthentication_required') setStep('reauth');
      else {
        setMessage(errorMessage(err));
        setStep('idle');
      }
    }
  };
  const remove = async () => {
    setStep('deleting');
    try {
      await api(`/api/events/${event.id}/deletion`, {
        method: 'POST',
        csrf: session.csrfToken,
        body: { confirmed: true, previewToken: view!.previewToken },
      });
      window.location.assign('/organizer?deleted=1');
    } catch (err) {
      if (err instanceof ApiError && err.code === 'reauthentication_required') setStep('reauth');
      else if (
        err instanceof ApiError &&
        ['preview_invalid', 'deletion_blocked', 'notifications_pending'].includes(err.code)
      )
        await loadPreview('The event changed since you opened this check. Review the current state below.');
      else {
        setMessage(errorMessage(err));
        setStep('preview');
      }
    }
  };
  const eligibleOpen = (step === 'preview' || step === 'deleting') && !!view?.eligible;
  return (
    <DangerItem title="Delete event">
      <p className="muted">
        Deleting removes the event and its unconfirmed registrations permanently. It is only possible while
        nobody is confirmed or waiting.
      </p>
      {step === 'reauth' && (
        <ReauthPrompt
          session={session}
          intro="For your security, deleting needs a sign-in from the last 15 minutes. Confirm it’s you by email; nothing is deleted until you confirm the deletion again."
        />
      )}
      {(step === 'idle' || step === 'loading') && (
        <div>
          <Button variant="destructive" onClick={() => loadPreview()} disabled={step === 'loading'}>
            {step === 'loading' ? 'Checking…' : 'Delete this event…'}
          </Button>
        </div>
      )}
      {message && <Alert kind="info">{message}</Alert>}
      {step === 'preview' && view && !view.eligible && (
        <div className="stack">
          <Alert>
            This event can’t be deleted now:
            <ul>
              {view.blockers.map((b) => (
                <li key={b}>{BLOCKER_TEXT[b] ?? b}</li>
              ))}
            </ul>
          </Alert>
          <div>
            <Button variant="outline" onClick={() => setStep('idle')}>
              Close
            </Button>
          </div>
        </div>
      )}
      <ConfirmDialog
        open={eligibleOpen}
        title={`Delete “${event.title}” permanently?`}
        confirmLabel={step === 'deleting' ? 'Deleting…' : 'Yes, delete the event permanently'}
        cancelLabel="Keep the event"
        destructive
        busy={step === 'deleting'}
        onConfirm={remove}
        onClose={() => setStep('idle')}
      >
        <p>This cannot be undone. A deletion record without personal data is kept.</p>
        {view && view.requiredNoticeIssues.length > 0 && (
          <Alert kind="info">
            Some cancellation confirmations could not be confirmed as sent:{' '}
            {view.requiredNoticeIssues.map((i) => NOTICE_TEXT[i.label] ?? i.label).join(', ')}. They are kept
            in the records.
          </Alert>
        )}
      </ConfirmDialog>
    </DangerItem>
  );
}

/** Settings of one event: each change is its own operation with its own effect (PD-68). */
export function SettingsTab({
  session,
  event,
  onDone,
}: {
  session: Session;
  event: EventItem;
  onDone: () => void;
}) {
  if (event.status !== 'SCHEDULED')
    return (
      <Alert kind="info">
        This event is cancelled. Its details, capacity and date can no longer be changed, and it cannot be
        deleted. Its records are kept.
      </Alert>
    );
  const started = event.phase === 'started';
  return (
    <div className="settings-sections">
      <div className="settings-section">
        <div>
          <h3>Event details</h3>
          <p>Title and description on the registration page. Participants are not emailed.</p>
        </div>
        <DetailsEditor session={session} event={event} onDone={onDone} />
      </div>
      <div className="settings-section">
        <div>
          <h3>Capacity</h3>
          <p>Raising it offers free seats to the waiting list in order, until registration closes.</p>
        </div>
        <CapacityEditor session={session} event={event} onDone={onDone} />
      </div>
      {!started && (
        <div className="settings-section">
          <div>
            <h3>Date and time</h3>
            <p>Every confirmed and waiting participant is emailed the new date.</p>
          </div>
          <Reschedule session={session} event={event} onDone={onDone} />
        </div>
      )}
      <div className="settings-section">
        <div>
          <h3>Recent sign-in</h3>
          <p>Required for protected actions below.</p>
        </div>
        <RecentSignIn session={session} />
      </div>
      <div className="danger-zone">
        <h3>Careful changes</h3>
        <p>These actions are permanent and ask for a confirmation first.</p>
        {!started && <CancelEvent session={session} event={event} onDone={onDone} />}
        <DeleteEvent session={session} event={event} />
      </div>
    </div>
  );
}
