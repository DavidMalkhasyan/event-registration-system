import { StrictMode, useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { createRoot } from 'react-dom/client';
import { ApiError, api, errorMessage } from '../shared/api';
import { Alert, Card, CopyLink, DevMailboxHint, Page, formatLocal } from '../shared/ui';

interface Session {
  accountId: string;
  email: string;
  csrfToken: string;
}

interface EventItem {
  id: string;
  publicUrl: string;
  title: string;
  description: string | null;
  startsAt: string;
  timeZone: string;
  capacity: number;
  confirmedCount: number;
  status: string;
  phase: string;
  scheduleVersion: number;
  checkInOpensAt: string;
  checkInClosesAt: string;
}

function navigate(path: string) {
  window.history.pushState(null, '', path);
  window.dispatchEvent(new PopStateEvent('popstate'));
}

function Link({ to, children }: { to: string; children: React.ReactNode }) {
  return (
    <a
      href={to}
      onClick={(e) => {
        e.preventDefault();
        navigate(to);
      }}
    >
      {children}
    </a>
  );
}

const PHASE_LABEL: Record<string, string> = {
  registration_open: 'Registration open',
  registration_closed: 'Registration closed',
  started: 'Started',
  cancelled: 'Cancelled',
};

// ---------------------------------------------------------------- sign-in request
function SignInRequest() {
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string>();
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(undefined);
    try {
      await api('/api/auth/sign-in-requests', { method: 'POST', body: { email } });
      setSent(true);
    } catch (err) {
      setError(errorMessage(err));
    }
  };
  return (
    <Page title="Organizer sign-in">
      <Card>
        {sent ? (
          <Alert kind="success">
            Check your email for a sign-in link. It expires 15 minutes after you requested it and works once.
          </Alert>
        ) : (
          <form className="stack" onSubmit={submit}>
            <p>
              Sign in or create your organizer account with a link sent to your email address. No password
              needed.
            </p>
            <label>
              Email address
              <input
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                autoComplete="email"
              />
            </label>
            <button>Send sign-in link</button>
          </form>
        )}
        {error && <Alert>{error}</Alert>}
        <DevMailboxHint />
      </Card>
    </Page>
  );
}

// ---------------------------------------------------------------- events list and creation
function defaultZone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
}

function CreateEvent({ session, onCreated }: { session: Session; onCreated: () => void }) {
  const [form, setForm] = useState({
    title: '',
    description: '',
    localStart: '',
    timeZone: defaultZone(),
    capacity: 50,
    utcOffset: '',
  });
  const [offsets, setOffsets] = useState<string[]>([]);
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  // One request ID per distinct payload: retries of the same submission are idempotent (D-17).
  const requestRef = useRef<{ key: string; id: string } | null>(null);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(undefined);
    const payload = {
      title: form.title,
      description: form.description || null,
      localStart: form.localStart,
      timeZone: form.timeZone,
      capacity: Number(form.capacity),
      ...(form.utcOffset ? { utcOffset: form.utcOffset } : {}),
    };
    const key = JSON.stringify(payload);
    if (requestRef.current?.key !== key) requestRef.current = { key, id: crypto.randomUUID() };
    try {
      await api('/api/events', {
        method: 'POST',
        csrf: session.csrfToken,
        body: { requestId: requestRef.current.id, ...payload },
      });
      setForm({ ...form, title: '', description: '', localStart: '', utcOffset: '' });
      setOffsets([]);
      requestRef.current = null;
      onCreated();
    } catch (err) {
      if (err instanceof ApiError && err.code === 'ambiguous_local_time')
        setOffsets((err.body.offsets as string[]) ?? []);
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card title="Create an event">
      <form className="stack" onSubmit={submit}>
        <label>
          Title
          <input
            required
            maxLength={200}
            value={form.title}
            onChange={(e) => setForm({ ...form, title: e.target.value })}
          />
        </label>
        <label>
          Description
          <textarea
            maxLength={5000}
            rows={3}
            value={form.description}
            onChange={(e) => setForm({ ...form, description: e.target.value })}
          />
        </label>
        <div className="row">
          <label>
            Date and time (local)
            <input
              type="datetime-local"
              required
              value={form.localStart}
              onChange={(e) => setForm({ ...form, localStart: e.target.value, utcOffset: '' })}
            />
          </label>
          <label>
            Time zone
            <select
              value={form.timeZone}
              onChange={(e) => setForm({ ...form, timeZone: e.target.value, utcOffset: '' })}
            >
              {Intl.supportedValuesOf('timeZone').map((z) => (
                <option key={z}>{z}</option>
              ))}
            </select>
          </label>
          <label>
            Capacity
            <input
              type="number"
              min={1}
              max={100000}
              required
              value={form.capacity}
              onChange={(e) => setForm({ ...form, capacity: Number(e.target.value) })}
            />
          </label>
        </div>
        {offsets.length > 0 && (
          <label>
            This time occurs twice because of a daylight-saving change. Choose the UTC offset
            <select value={form.utcOffset} onChange={(e) => setForm({ ...form, utcOffset: e.target.value })}>
              <option value="">Choose…</option>
              {offsets.map((o) => (
                <option key={o}>{o}</option>
              ))}
            </select>
          </label>
        )}
        <button disabled={busy}>{busy ? 'Creating…' : 'Create event'}</button>
        {error && <Alert>{error}</Alert>}
      </form>
    </Card>
  );
}

function EventsPage({ session }: { session: Session }) {
  const [events, setEvents] = useState<EventItem[]>();
  const [error, setError] = useState<string>();
  const load = useCallback(() => {
    api<{ items: EventItem[] }>('/api/events')
      .then((r) => setEvents(r.items))
      .catch((e: unknown) => setError(errorMessage(e)));
  }, []);
  useEffect(load, [load]);
  return (
    <Page title="Your events" actions={<SignOut session={session} />}>
      <CreateEvent session={session} onCreated={load} />
      <Card title="Events">
        {error && <Alert>{error}</Alert>}
        {events?.length === 0 && <p className="muted">No events yet.</p>}
        <ul className="event-list">
          {events?.map((e) => (
            <li key={e.id}>
              <Link to={`/organizer/events/${e.id}`}>
                <strong>{e.title}</strong>
                <br />
                <span className="muted">
                  {formatLocal(e.startsAt, e.timeZone)} · {e.confirmedCount}/{e.capacity} confirmed ·{' '}
                  {PHASE_LABEL[e.phase]}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      </Card>
    </Page>
  );
}

function SignOut({ session }: { session: Session }) {
  return (
    <div className="row" style={{ flex: '0 0 auto' }}>
      <span className="muted">{session.email}</span>
      <button
        className="secondary"
        onClick={async () => {
          await api('/api/auth/sign-out', { method: 'POST', csrf: session.csrfToken }).catch(() => undefined);
          window.location.assign('/organizer');
        }}
      >
        Sign out
      </button>
    </div>
  );
}

// ---------------------------------------------------------------- live count (SSE)
function useLiveCount(eventId: string): { count: number | null; connected: boolean } {
  const [count, setCount] = useState<number | null>(null);
  const [connected, setConnected] = useState(false);
  useEffect(() => {
    // EventSource reconnects automatically; each connection starts with the authoritative count (FR-DSH-3).
    const source = new EventSource(`/api/events/${eventId}/live`);
    source.addEventListener('count', (e) => {
      setCount(JSON.parse((e as MessageEvent<string>).data).checkedIn);
      setConnected(true);
    });
    source.addEventListener('access_ended', () => source.close());
    source.onerror = () => setConnected(false);
    return () => source.close();
  }, [eventId]);
  return { count, connected };
}

// ---------------------------------------------------------------- event detail
interface Participant {
  registrationId: string;
  email: string;
  state: string;
  position?: number;
  checkedInAt?: string;
  emailIssues: { messageType: string; label: string }[];
}

function EventDetail({ session, eventId }: { session: Session; eventId: string }) {
  const [event, setEvent] = useState<EventItem>();
  const [counts, setCounts] = useState<{ confirmed: number; waitlisted: number; checkedIn: number }>();
  const [participants, setParticipants] = useState<Participant[]>([]);
  const [error, setError] = useState<string>();
  const live = useLiveCount(eventId);

  const load = useCallback(() => {
    Promise.all([
      api<EventItem>(`/api/events/${eventId}`),
      api<{ counts: { confirmed: number; waitlisted: number; checkedIn: number } }>(
        `/api/events/${eventId}/dashboard`,
      ),
      api<{ items: Participant[] }>(`/api/events/${eventId}/participants`),
    ])
      .then(([e, d, p]) => {
        setEvent(e);
        setCounts(d.counts);
        setParticipants(p.items);
      })
      .catch((e: unknown) =>
        setError(e instanceof ApiError && e.status === 404 ? 'Event not found.' : errorMessage(e)),
      );
  }, [eventId]);
  useEffect(load, [load]);
  // Refresh confirmed and waiting counts whenever the live check-in count changes.
  useEffect(() => {
    if (live.count !== null) load();
  }, [live.count, load]);

  if (!event) return <Page title="Event">{error ? <Alert>{error}</Alert> : <p>Loading…</p>}</Page>;
  return (
    <Page title={event.title} actions={<Link to="/organizer">← All events</Link>}>
      <Card>
        <p>
          <strong>{formatLocal(event.startsAt, event.timeZone)}</strong> · {PHASE_LABEL[event.phase]} ·
          capacity {event.capacity}
        </p>
        {event.description && <p style={{ whiteSpace: 'pre-wrap' }}>{event.description}</p>}
        <CopyLink label="Public registration link" url={event.publicUrl} />
        <p>
          <Link to={`/organizer/events/${event.id}/check-in`}>Open the entrance check-in screen →</Link>
        </p>
      </Card>
      <div className="stats" aria-live="polite">
        <div className="stat">
          <strong>{counts?.confirmed ?? '–'}</strong>
          <span>Confirmed</span>
        </div>
        <div className="stat">
          <strong>{counts?.waitlisted ?? '–'}</strong>
          <span>Waiting list</span>
        </div>
        <div className="stat">
          <strong>{live.count ?? counts?.checkedIn ?? '–'}</strong>
          <span>
            {live.connected && <span className="live-dot" aria-hidden />}Checked in
            {live.connected ? ' (live)' : ''}
          </span>
        </div>
      </div>
      <DetailsEditor session={session} event={event} onDone={load} />
      <CapacityEditor session={session} event={event} onDone={load} />
      <Reschedule session={session} event={event} onDone={load} />
      <Card title={`Participants (${participants.length})`}>
        <table>
          <thead>
            <tr>
              <th>Email</th>
              <th>Status</th>
              <th>Checked in</th>
              <th>Email issues</th>
            </tr>
          </thead>
          <tbody>
            {participants.map((p) => (
              <tr key={p.registrationId}>
                <td>{p.email}</td>
                <td>
                  <span className="badge">
                    {p.state === 'WAITLISTED' ? `WAITLISTED #${p.position}` : p.state.replace('_', ' ')}
                  </span>
                </td>
                <td>{p.checkedInAt ? new Date(p.checkedInAt).toLocaleTimeString() : ''}</td>
                <td>{p.emailIssues.map((i) => `${i.messageType}: ${i.label}`).join(', ')}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </Page>
  );
}

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
  const [message, setMessage] = useState<{ kind: 'success' | 'error'; text: string }>();
  if (event.status !== 'SCHEDULED') return null;
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
    <Card title="Event details">
      <form className="stack" onSubmit={submit}>
        <label>
          Event title
          <input required maxLength={200} value={title} onChange={(e) => setTitle(e.target.value)} />
        </label>
        <label>
          Event description
          <textarea
            maxLength={5000}
            rows={3}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />
        </label>
        <button disabled={busy}>{busy ? 'Saving…' : 'Save details'}</button>
      </form>
      {message && <Alert kind={message.kind}>{message.text}</Alert>}
    </Card>
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
  const [message, setMessage] = useState<{ kind: 'success' | 'error'; text: string }>();
  if (event.status !== 'SCHEDULED') return null;
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
    <Card title="Capacity">
      <form className="row" onSubmit={submit}>
        <label>
          Number of seats
          <input
            type="number"
            min={1}
            max={100000}
            required
            value={capacity}
            onChange={(e) => setCapacity(e.target.value)}
          />
        </label>
        <button style={{ flex: '0 0 auto' }} disabled={busy}>
          {busy ? 'Saving…' : 'Update capacity'}
        </button>
      </form>
      {message && <Alert kind={message.kind}>{message.text}</Alert>}
    </Card>
  );
}

function Reschedule({ session, event, onDone }: { session: Session; event: EventItem; onDone: () => void }) {
  const [localStart, setLocalStart] = useState('');
  const [message, setMessage] = useState<{ kind: 'success' | 'error'; text: string }>();
  if (event.status !== 'SCHEDULED' || event.phase === 'started') return null;
  const submit = async (e: FormEvent) => {
    e.preventDefault();
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
    }
  };
  return (
    <Card title="Reschedule">
      <form className="row" onSubmit={submit}>
        <label>
          New date and time ({event.timeZone})
          <input
            type="datetime-local"
            required
            value={localStart}
            onChange={(e) => setLocalStart(e.target.value)}
          />
        </label>
        <button style={{ flex: '0 0 auto' }}>Reschedule and notify</button>
      </form>
      {message && <Alert kind={message.kind}>{message.text}</Alert>}
    </Card>
  );
}

// ---------------------------------------------------------------- entrance check-in
const OUTCOME_TEXT: Record<string, string> = {
  CHECKED_IN: '✔ Checked in',
  ALREADY_CHECKED_IN: '✖ Already checked in',
  INVALID_CODE: '✖ Unknown ticket code',
  WRONG_EVENT: '✖ Ticket for another event',
  TICKET_CANCELLED: '✖ Ticket cancelled',
  EVENT_CANCELLED: '✖ Event cancelled',
  OUTSIDE_CHECK_IN_WINDOW: '✖ Outside the check-in window',
};

declare global {
  interface Window {
    BarcodeDetector?: new (options: { formats: string[] }) => {
      detect(source: CanvasImageSource): Promise<{ rawValue: string }[]>;
    };
  }
}

function CheckIn({ session, eventId }: { session: Session; eventId: string }) {
  const [event, setEvent] = useState<EventItem>();
  const [code, setCode] = useState('');
  const [result, setResult] = useState<{ outcome: string; firstCheckedInAt?: string } | 'offline'>();
  const [busy, setBusy] = useState(false);
  const [scanning, setScanning] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);
  const live = useLiveCount(eventId);

  useEffect(() => {
    void api<EventItem>(`/api/events/${eventId}`).then(setEvent);
  }, [eventId]);

  const submit = useCallback(
    async (value: string) => {
      if (!value.trim()) return;
      setBusy(true);
      const requestId = crypto.randomUUID();
      // Retry with the same request ID after a network failure; never assume success (FR-CHK-3, FR-CHK-6).
      for (let attempt = 0; attempt < 2; attempt += 1) {
        try {
          const r = await api<{ outcome: string; firstCheckedInAt?: string }>(
            `/api/events/${eventId}/check-ins`,
            {
              method: 'POST',
              csrf: session.csrfToken,
              body: { code: value.trim(), requestId },
            },
          );
          setResult(r);
          setCode('');
          setBusy(false);
          return;
        } catch (err) {
          if (!(err instanceof ApiError) || err.code !== 'network_error') {
            setResult({ outcome: errorMessage(err) });
            setBusy(false);
            return;
          }
        }
      }
      setResult('offline');
      setBusy(false);
    },
    [eventId, session.csrfToken],
  );

  // Camera scanning where the browser provides BarcodeDetector; manual entry always works.
  useEffect(() => {
    if (!scanning || !window.BarcodeDetector) return;
    let stop = false;
    let stream: MediaStream | undefined;
    const detector = new window.BarcodeDetector({ formats: ['qr_code'] });
    void navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } }).then(async (s) => {
      stream = s;
      const video = videoRef.current!;
      video.srcObject = s;
      await video.play();
      while (!stop) {
        const codes = await detector.detect(video).catch(() => []);
        if (codes[0]?.rawValue) {
          await submit(codes[0].rawValue);
          await new Promise((r) => setTimeout(r, 2000));
        }
        await new Promise((r) => setTimeout(r, 300));
      }
    });
    return () => {
      stop = true;
      stream?.getTracks().forEach((t) => t.stop());
    };
  }, [scanning, submit]);

  const ok = result !== 'offline' && result?.outcome === 'CHECKED_IN';
  return (
    <Page
      title={event ? `Check-in: ${event.title}` : 'Check-in'}
      actions={<Link to={`/organizer/events/${eventId}`}>← Dashboard</Link>}
    >
      <div className="stats">
        <div className="stat">
          <strong>{live.count ?? '–'}</strong>
          <span>{live.connected && <span className="live-dot" aria-hidden />}Checked in</span>
        </div>
      </div>
      <Card title="Scan or type a ticket code">
        <form
          className="row"
          onSubmit={(e) => {
            e.preventDefault();
            void submit(code);
          }}
        >
          <label>
            Ticket code
            <input
              autoFocus
              value={code}
              onChange={(e) => setCode(e.target.value)}
              placeholder="e.g. 7K3QX9M2B4TW"
              autoComplete="off"
            />
          </label>
          <button style={{ flex: '0 0 auto' }} disabled={busy}>
            {busy ? 'Checking…' : 'Check in'}
          </button>
        </form>
        {window.BarcodeDetector && (
          <p>
            <button className="secondary" onClick={() => setScanning(!scanning)}>
              {scanning ? 'Stop camera' : 'Scan QR code with camera'}
            </button>
          </p>
        )}
        {scanning && <video ref={videoRef} muted playsInline style={{ width: '100%', borderRadius: 12 }} />}
        {result === 'offline' && (
          <div className="outcome outcome-bad">
            Cannot validate: the server is unreachable. Do not admit yet.
          </div>
        )}
        {result && result !== 'offline' && (
          <div className={`outcome ${ok ? 'outcome-ok' : 'outcome-bad'}`} role="status">
            {OUTCOME_TEXT[result.outcome] ?? result.outcome}
            {result.firstCheckedInAt && (
              <div className="muted">
                First check-in at {new Date(result.firstCheckedInAt).toLocaleTimeString()}
              </div>
            )}
          </div>
        )}
        {event && (
          <p className="muted">
            Check-in window: {formatLocal(event.checkInOpensAt, event.timeZone)} to{' '}
            {formatLocal(event.checkInClosesAt, event.timeZone)}.
          </p>
        )}
      </Card>
    </Page>
  );
}

// ---------------------------------------------------------------- app shell
function App() {
  const [path, setPath] = useState(window.location.pathname);
  const [session, setSession] = useState<Session | null | undefined>();
  useEffect(() => {
    const onPop = () => setPath(window.location.pathname);
    window.addEventListener('popstate', onPop);
    api<Session>('/api/auth/session')
      .then(setSession)
      .catch(() => setSession(null));
    return () => window.removeEventListener('popstate', onPop);
  }, []);

  if (session === undefined) return <Page title="Loading…">{null}</Page>;
  if (session === null) return <SignInRequest />;
  const checkIn = /^\/organizer\/events\/([0-9a-f-]{36})\/check-in$/.exec(path);
  if (checkIn) return <CheckIn session={session} eventId={checkIn[1]!} />;
  const detail = /^\/organizer\/events\/([0-9a-f-]{36})$/.exec(path);
  if (detail) return <EventDetail session={session} eventId={detail[1]!} />;
  return <EventsPage session={session} />;
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
