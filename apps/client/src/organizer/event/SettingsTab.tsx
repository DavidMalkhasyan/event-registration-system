import { useId, useState, type FormEvent, type ReactNode } from 'react';
import { ChevronDown } from 'lucide-react';
import { ApiError, api, errorMessage } from '../../shared/api';
import { Alert, Button, ConfirmDialog, Field, formatLocal } from '../../shared/ui';
import { ReauthPrompt } from '../auth/Reauth';
import type { Counts, EventItem, Notice, Session } from '../types';
import { describeLocalInput, toZonedLocalInput } from './schedule';

// Settings of one event (PD-68, K-702). Each form keeps the organizer's unsaved edit as a draft: the
// field shows the server's current value until it is edited, and a background refresh never
// overwrites an edit. Save is disabled while nothing differs from the current value.

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** Confirmed and waiting participants: the people an event-wide email goes to. */
function audience(counts?: Counts): string {
  if (!counts) return 'every confirmed and waiting participant';
  const n = counts.confirmed + counts.waitlisted;
  return n === 0
    ? 'nobody (no confirmed or waiting participants yet)'
    : plural(n, 'participant', 'participants');
}

type OnSaved = (updated: EventItem) => void;

function DetailsEditor({
  session,
  event,
  onSaved,
}: {
  session: Session;
  event: EventItem;
  onSaved: OnSaved;
}) {
  const [titleDraft, setTitleDraft] = useState<string>();
  const [descriptionDraft, setDescriptionDraft] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<Notice>();
  const title = titleDraft ?? event.title;
  const description = descriptionDraft ?? event.description ?? '';
  const dirty = title !== event.title || description !== (event.description ?? '');
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setMessage(undefined);
    try {
      // FR-EVT-5: title and description only; participants are not emailed (AC-105).
      const updated = await api<EventItem>(`/api/events/${event.id}`, {
        method: 'PATCH',
        csrf: session.csrfToken,
        body: { title, description: description || null },
      });
      setMessage({ kind: 'success', text: 'Details saved. Participants are not emailed about this change.' });
      setTitleDraft(undefined);
      setDescriptionDraft(undefined);
      onSaved(updated);
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
            onChange={(e) => setTitleDraft(e.target.value)}
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
            onChange={(e) => setDescriptionDraft(e.target.value)}
          />
        )}
      </Field>
      <div>
        <Button type="submit" disabled={busy || !dirty}>
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
  onSaved,
}: {
  session: Session;
  event: EventItem;
  onSaved: OnSaved;
}) {
  const [draft, setDraft] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<Notice>();
  const capacity = draft ?? String(event.capacity);
  const dirty = capacity !== String(event.capacity);
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
        text: `Capacity is now ${updated.capacity}.${promotes ? ' Free seats were offered to the waiting list in order; ticket emails for promoted participants are queued.' : ''}`,
      });
      setDraft(undefined);
      onSaved(updated);
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
              onChange={(e) => setDraft(e.target.value)}
            />
          )}
        </Field>
        <Button type="submit" disabled={busy || !dirty}>
          {busy ? 'Saving…' : 'Update capacity'}
        </Button>
      </form>
      {message && <Alert kind={message.kind}>{message.text}</Alert>}
    </>
  );
}

/**
 * Reschedule (FR-EVT-6, TX-E04). The field starts with the current start in the event's own time zone.
 * A real change asks for confirmation first, because every confirmed and waiting participant is emailed;
 * an unchanged value can't be submitted (and the server would send nothing for it). The schedule
 * version guards against a concurrent change; a repeated daylight-saving hour asks for the offset.
 */
function Reschedule({
  session,
  event,
  counts,
  onSaved,
  onDone,
}: {
  session: Session;
  event: EventItem;
  counts?: Counts;
  onSaved: OnSaved;
  onDone: () => void;
}) {
  const current = toZonedLocalInput(event.startsAt, event.timeZone);
  const [draft, setDraft] = useState<string>();
  const [offsets, setOffsets] = useState<string[]>([]);
  const [utcOffset, setUtcOffset] = useState('');
  const [step, setStep] = useState<'idle' | 'confirming' | 'sending'>('idle');
  const [message, setMessage] = useState<Notice>();
  const value = draft ?? current;
  const dirty = value !== current;
  const needsOffset = offsets.length > 0 && !utcOffset;

  const edit = (next: string) => {
    setDraft(next);
    setOffsets([]);
    setUtcOffset('');
    setMessage(undefined);
  };
  const send = async () => {
    setStep('sending');
    try {
      const updated = await api<EventItem>(`/api/events/${event.id}/reschedule`, {
        method: 'POST',
        csrf: session.csrfToken,
        body: {
          localStart: value,
          expectedScheduleVersion: event.scheduleVersion,
          ...(utcOffset ? { utcOffset } : {}),
        },
      });
      if (updated.scheduleVersion === event.scheduleVersion) {
        setMessage({ kind: 'success', text: 'The date and time did not change, so nobody was emailed.' });
      } else {
        setMessage({
          kind: 'success',
          text: `Rescheduled to ${formatLocal(updated.startsAt, updated.timeZone)}. Change emails are queued for ${audience(counts)}.`,
        });
      }
      setDraft(undefined); // the field now shows the server's new start
      setOffsets([]);
      setUtcOffset('');
      onSaved(updated);
    } catch (err) {
      if (err instanceof ApiError && err.code === 'ambiguous_local_time') {
        setOffsets((err.body.offsets as string[]) ?? []);
        setMessage({
          kind: 'error',
          text: `${describeLocalInput(value)} happens twice in ${event.timeZone} because the clocks go back. Choose which one you mean.`,
        });
      } else if (err instanceof ApiError && err.code === 'nonexistent_local_time') {
        setMessage({
          kind: 'error',
          text: `${describeLocalInput(value)} does not exist in ${event.timeZone} because the clocks go forward. Choose another time.`,
        });
      } else if (err instanceof ApiError && err.code === 'schedule_version_mismatch') {
        setDraft(undefined);
        setMessage({
          kind: 'error',
          text: 'The date was changed elsewhere in the meantime. The form now shows the current date; nothing was changed.',
        });
        onDone();
      } else if (err instanceof ApiError && err.code === 'start_not_in_future') {
        setMessage({ kind: 'error', text: 'The new start must be in the future.' });
      } else {
        setMessage({ kind: 'error', text: errorMessage(err) });
      }
    } finally {
      setStep('idle');
    }
  };
  return (
    <>
      <form
        className="inline-form"
        onSubmit={(e) => {
          e.preventDefault();
          if (dirty && !needsOffset) setStep('confirming');
        }}
      >
        <Field label={`Start date and time (${event.timeZone})`}>
          {(id) => (
            <input
              id={id}
              className="input"
              type="datetime-local"
              required
              value={value}
              onChange={(e) => edit(e.target.value)}
            />
          )}
        </Field>
        <Button type="submit" disabled={!dirty || needsOffset || step !== 'idle'}>
          {step === 'sending' ? 'Rescheduling…' : 'Save new date'}
        </Button>
      </form>
      {offsets.length > 0 && (
        <Field label="This time occurs twice because of a daylight-saving change. Choose the UTC offset">
          {(id) => (
            <select
              id={id}
              className="select"
              value={utcOffset}
              onChange={(e) => setUtcOffset(e.target.value)}
            >
              <option value="">Choose…</option>
              {offsets.map((o) => (
                <option key={o}>{o}</option>
              ))}
            </select>
          )}
        </Field>
      )}
      {message && <Alert kind={message.kind}>{message.text}</Alert>}
      <ConfirmDialog
        open={step === 'confirming' || step === 'sending'}
        title="Change the date and time?"
        confirmLabel={step === 'sending' ? 'Rescheduling…' : 'Yes, reschedule and notify'}
        cancelLabel="Keep the current date"
        busy={step === 'sending'}
        onConfirm={send}
        onClose={() => setStep('idle')}
      >
        <p>
          Move “{event.title}” from {formatLocal(event.startsAt, event.timeZone)} to{' '}
          <strong>
            {describeLocalInput(value)}
            {utcOffset ? ` (UTC${utcOffset})` : ''}
          </strong>{' '}
          ({event.timeZone})?
        </p>
        <p>
          A change email is queued for {audience(counts)}: every confirmed and waiting participant is told the
          new date. Registration closes 2 hours before the new start.
        </p>
      </ConfirmDialog>
    </>
  );
}

/** A labelled region, so each destructive action can be found by name (and by assistive technology). */
function DangerItem({ title, children }: { title: string; children: ReactNode }) {
  const id = useId();
  return (
    <section className="danger-item" aria-labelledby={id}>
      <h3 id={id}>{title}</h3>
      {children}
    </section>
  );
}

/**
 * Event cancellation (FR-EVT-9, BR-16), the one prominent destructive action. If the sign-in is not
 * recent, the server answers reauthentication_required (FR-ORG-5): only then does the organizer confirm
 * it's them by email, and afterwards they must confirm the cancellation again; nothing runs on its own.
 */
function CancelEvent({
  session,
  event,
  counts,
  onDone,
}: {
  session: Session;
  event: EventItem;
  counts?: Counts;
  onDone: () => void;
}) {
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
        Cancelling is permanent. Every ticket stops working, registration and the waiting list close, and a
        cancellation email is queued for each confirmed and waiting participant. Check-in records are kept.
      </p>
      {step === 'reauth' ? (
        <ReauthPrompt
          session={session}
          intro="For your security, cancelling needs a recent sign-in. Confirm it’s you by email; the event is not cancelled until you confirm the cancellation again."
        />
      ) : (
        <div>
          <Button variant="destructive" onClick={() => setStep('confirming')}>
            Cancel event
          </Button>
        </div>
      )}
      <ConfirmDialog
        open={step === 'confirming' || step === 'sending'}
        title={`Cancel “${event.title}”?`}
        confirmLabel={step === 'sending' ? 'Cancelling…' : 'Yes, cancel the event permanently'}
        cancelLabel="Keep the event"
        destructive
        busy={step === 'sending'}
        onConfirm={cancel}
        onClose={() => setStep('idle')}
      >
        <p>
          <strong>{event.title}</strong> on {formatLocal(event.startsAt, event.timeZone)} will be cancelled
          permanently. This cannot be undone.
        </p>
        <ul className="dialog-list">
          <li>A cancellation email is queued for {audience(counts)}.</li>
          <li>Every ticket stops being valid, and nobody can register or join the waiting list.</li>
          <li>The event, its participants and check-in records stay visible here.</li>
        </ul>
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
 * Event deletion (FR-EVT-10, FR-EVT-14), a different operation from cancellation: the preview shows
 * what will be deleted and why it may be blocked; the confirmation sends the preview token, so the
 * server deletes only that state. Needs a recent sign-in (FR-ORG-5). Not offered for cancelled events.
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
        Deleting is not cancelling: it removes the event and its unconfirmed registrations permanently, and is
        only possible while nobody is confirmed or waiting. To call off an event with participants, cancel it.
      </p>
      {step === 'reauth' && (
        <ReauthPrompt
          session={session}
          intro="For your security, deleting needs a recent sign-in. Confirm it’s you by email; nothing is deleted until you confirm the deletion again."
        />
      )}
      {(step === 'idle' || step === 'loading') && (
        <div>
          <Button variant="outline" onClick={() => loadPreview()} disabled={step === 'loading'}>
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

/** Settings of one event: each change is its own operation with its own effect (PD-68, K-702). */
export function SettingsTab({
  session,
  event,
  counts,
  onDone,
}: {
  session: Session;
  event: EventItem;
  counts?: Counts;
  onDone: () => void;
}) {
  if (event.status !== 'SCHEDULED')
    return (
      <Alert kind="info">
        This event is cancelled. Its details, capacity and date can no longer be changed, and it cannot be
        deleted. Its records are kept.
      </Alert>
    );
  return <SettingsSections session={session} event={event} counts={counts} onDone={onDone} />;
}

function SettingsSections({
  session,
  event: loaded,
  counts,
  onDone,
}: {
  session: Session;
  event: EventItem;
  counts?: Counts;
  onDone: () => void;
}) {
  // The response of a save is shown at once; the next reload of the workspace replaces it (a new object).
  const [saved, setSaved] = useState<{ base: EventItem; value: EventItem }>();
  const event = saved?.base === loaded ? saved.value : loaded;
  const onSaved = (value: EventItem) => {
    setSaved({ base: loaded, value });
    onDone();
  };
  const started = event.phase === 'started';
  return (
    <div className="settings-sections">
      <div className="settings-section">
        <div>
          <h3>Event details</h3>
          <p>Title and description on the registration page. Participants are not emailed.</p>
        </div>
        <DetailsEditor session={session} event={event} onSaved={onSaved} />
      </div>
      <div className="settings-section">
        <div>
          <h3>Capacity</h3>
          <p>Raising it offers free seats to the waiting list in order, until registration closes.</p>
        </div>
        <CapacityEditor session={session} event={event} onSaved={onSaved} />
      </div>
      {!started && (
        <div className="settings-section">
          <div>
            <h3>Date and time</h3>
            <p>
              Shown in the event’s time zone. Every confirmed and waiting participant is emailed the new date.
            </p>
          </div>
          <Reschedule session={session} event={event} counts={counts} onSaved={onSaved} onDone={onDone} />
        </div>
      )}
      {!started && (
        <div className="danger-zone">
          <CancelEvent session={session} event={event} counts={counts} onDone={onDone} />
        </div>
      )}
      <details className="more-actions">
        <summary>
          More actions <ChevronDown size={16} aria-hidden="true" />
        </summary>
        <DeleteEvent session={session} event={event} />
      </details>
    </div>
  );
}
