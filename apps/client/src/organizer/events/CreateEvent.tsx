import { useRef, useState, type FormEvent } from 'react';
import { ArrowLeft } from 'lucide-react';
import { ApiError, api, errorMessage } from '../../shared/api';
import { CAPACITY_MAX, CAPACITY_MIN, normalizeCapacity, type CapacityCheck } from '../../shared/capacity';
import { Alert, Button, Field, PageHeader, SectionHeading, buttonClass } from '../../shared/ui';
import { Link, navigate } from '../router';
import type { EventItem, Session } from '../types';

function defaultZone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
}

/** Event creation (FR-EVT-1): idempotent per request ID (D-17); DST-ambiguous times ask for the offset. */
export function CreateEvent({ session, onCreated }: { session: Session; onCreated: () => void }) {
  const [form, setForm] = useState({
    title: '',
    description: '',
    date: '',
    time: '',
    timeZone: defaultZone(),
    capacity: '50',
    utcOffset: '',
  });
  const [offsets, setOffsets] = useState<string[]>([]);
  const [capacityCheck, setCapacityCheck] = useState<CapacityCheck>();
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  // One request ID per distinct payload: retries of the same submission are idempotent (D-17).
  const requestRef = useRef<{ key: string; id: string } | null>(null);
  const set = (patch: Partial<typeof form>) => setForm((f) => ({ ...f, ...patch }));

  /** Corrects the capacity on leaving the field or submitting (K-707); returns whether it can be sent as is. */
  const commitCapacity = () => {
    const check = normalizeCapacity(form.capacity);
    setCapacityCheck(check.note || check.error ? check : undefined);
    if (check.value !== form.capacity) set({ capacity: check.value });
    return !check.error && check.value === form.capacity;
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!commitCapacity()) return; // corrected or invalid: shown to the organizer before anything is sent
    setBusy(true);
    setError(undefined);
    const payload = {
      title: form.title,
      description: form.description || null,
      localStart: `${form.date}T${form.time}`,
      timeZone: form.timeZone,
      capacity: Number(form.capacity),
      ...(form.utcOffset ? { utcOffset: form.utcOffset } : {}),
    };
    const key = JSON.stringify(payload);
    if (requestRef.current?.key !== key) requestRef.current = { key, id: crypto.randomUUID() };
    try {
      const created = await api<{ event: EventItem }>('/api/events', {
        method: 'POST',
        csrf: session.csrfToken,
        body: { requestId: requestRef.current.id, ...payload },
      });
      requestRef.current = null;
      onCreated();
      navigate(`/organizer/events/${created.event.id}`);
    } catch (err) {
      if (err instanceof ApiError && err.code === 'ambiguous_local_time')
        setOffsets((err.body.offsets as string[]) ?? []);
      setError(errorMessage(err));
      setBusy(false);
    }
  };

  return (
    <>
      <Link to="/organizer/events" className="back-link">
        <ArrowLeft size={16} aria-hidden="true" />
        Back to events
      </Link>
      <PageHeader
        title="Something great starts here."
        description="A few details are all you need to open registration."
      />
      <form className="panel event-form" onSubmit={submit}>
        <SectionHeading
          title="Event details"
          description="Everything on this form appears on your registration page."
        />
        <div className="form-grid">
          <Field label="Event title">
            {(id) => (
              <input
                id={id}
                className="input"
                required
                maxLength={200}
                value={form.title}
                onChange={(e) => set({ title: e.target.value })}
                placeholder="Give your gathering a name"
              />
            )}
          </Field>
          <Field label="Description">
            {(id) => (
              <textarea
                id={id}
                className="textarea"
                maxLength={5000}
                rows={4}
                value={form.description}
                onChange={(e) => set({ description: e.target.value })}
                placeholder="What can participants look forward to?"
              />
            )}
          </Field>
          <div className="form-columns">
            <Field label="Date">
              {(id) => (
                <input
                  id={id}
                  className="input"
                  type="date"
                  required
                  value={form.date}
                  onChange={(e) => set({ date: e.target.value, utcOffset: '' })}
                />
              )}
            </Field>
            <Field label="Start time">
              {(id) => (
                <input
                  id={id}
                  className="input"
                  type="time"
                  required
                  value={form.time}
                  onChange={(e) => set({ time: e.target.value, utcOffset: '' })}
                />
              )}
            </Field>
          </div>
          <div className="form-columns">
            <Field label="Time zone" hint="Participants see the time in this zone, with its name.">
              {(id) => (
                <select
                  id={id}
                  className="select"
                  value={form.timeZone}
                  onChange={(e) => set({ timeZone: e.target.value, utcOffset: '' })}
                >
                  {Intl.supportedValuesOf('timeZone').map((z) => (
                    <option key={z}>{z}</option>
                  ))}
                </select>
              )}
            </Field>
            <Field
              label="Capacity (1 to 100,000 seats)"
              hint="When the event is full, new registrations join the waiting list in order. After creation, capacity can only be increased."
            >
              {(id) => (
                <>
                  <input
                    id={id}
                    className="input"
                    type="number"
                    inputMode="numeric"
                    min={CAPACITY_MIN}
                    max={CAPACITY_MAX}
                    step={1}
                    required
                    aria-invalid={capacityCheck?.error ? true : undefined}
                    value={form.capacity}
                    onChange={(e) => {
                      set({ capacity: e.target.value });
                      setCapacityCheck(undefined);
                    }}
                    onBlur={commitCapacity}
                  />
                  {capacityCheck && (
                    <p className={capacityCheck.error ? 'field-error' : 'field-note'} role="status">
                      {capacityCheck.error ?? capacityCheck.note}
                    </p>
                  )}
                </>
              )}
            </Field>
          </div>
          {offsets.length > 0 && (
            <Field label="This time occurs twice because of a daylight-saving change. Choose the UTC offset">
              {(id) => (
                <select
                  id={id}
                  className="select"
                  value={form.utcOffset}
                  onChange={(e) => set({ utcOffset: e.target.value })}
                >
                  <option value="">Choose…</option>
                  {offsets.map((o) => (
                    <option key={o}>{o}</option>
                  ))}
                </select>
              )}
            </Field>
          )}
        </div>
        {error && <Alert>{error}</Alert>}
        <div className="form-footer">
          <Link to="/organizer/events" className={buttonClass('outline')}>
            Cancel
          </Link>
          <Button type="submit" disabled={busy}>
            {busy ? 'Creating…' : 'Create event'}
          </Button>
        </div>
      </form>
    </>
  );
}
