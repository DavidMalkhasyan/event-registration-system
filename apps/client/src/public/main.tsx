import { linkToken } from './bootstrap-token'; // must stay the first import (FR-LNK-10 b)
import { useEffect, useState, type FormEvent } from 'react';
import { createRoot } from 'react-dom/client';
import { ApiError, api, errorMessage } from '../shared/api';
import { takeReturnTo } from '../shared/return-to';
import {
  Alert,
  Card,
  CopyLink,
  DevMailboxHint,
  InvalidLink,
  Page,
  TRANSFER_STATEMENT,
  TicketQr,
  formatLocal,
} from '../shared/ui';

interface EventSummary {
  title: string;
  startsAt: string;
  timeZone: string;
}

function Loading() {
  return <Page title="Loading…">{null}</Page>;
}

// ---------------------------------------------------------------- public event page and registration
function EventPage({ publicId }: { publicId: string }) {
  const [event, setEvent] = useState<EventSummary & { description: string | null; phase: string }>();
  const [error, setError] = useState<string>();
  const [email, setEmail] = useState('');
  const [submitted, setSubmitted] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api<EventSummary & { description: string | null; phase: string }>(`/api/public/events/${publicId}`)
      .then(setEvent)
      .catch((e: unknown) =>
        setError(e instanceof ApiError && e.status === 404 ? 'Event not found.' : errorMessage(e)),
      );
  }, [publicId]);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(undefined);
    try {
      await api(`/api/public/events/${publicId}/registrations`, { method: 'POST', body: { email } });
      setSubmitted(true);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  if (!event) return error ? <Page title="Event">{<Alert>{error}</Alert>}</Page> : <Loading />;
  const open = event.phase === 'registration_open';
  return (
    <Page title={event.title}>
      <Card>
        {event.phase === 'cancelled' && (
          <Alert kind="error">
            <strong>Cancelled.</strong> The organizer has cancelled this event.
          </Alert>
        )}
        <p>
          <strong>{formatLocal(event.startsAt, event.timeZone)}</strong>
        </p>
        {event.description && <p style={{ whiteSpace: 'pre-wrap' }}>{event.description}</p>}
      </Card>
      <Card title="Register">
        {!open && (
          <Alert kind="info">
            {event.phase === 'cancelled' ? 'This event was cancelled.' : 'Registration is closed.'}
          </Alert>
        )}
        {open && submitted && (
          <Alert kind="success">
            Check your email. We sent you a link to confirm your registration; your place is decided when you
            confirm.
          </Alert>
        )}
        {open && !submitted && (
          <form className="stack" onSubmit={submit}>
            <label>
              Email address
              <input
                type="email"
                required
                maxLength={254}
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                autoComplete="email"
              />
            </label>
            <button disabled={busy}>{busy ? 'Sending…' : 'Register'}</button>
            <p className="muted">Only your email address is collected.</p>
          </form>
        )}
        {error && <Alert>{error}</Alert>}
        <DevMailboxHint />
      </Card>
    </Page>
  );
}

// ---------------------------------------------------------------- verification
type VerifyResult =
  | {
      result: 'confirmed';
      event: EventSummary;
      ticket: { code: string };
      links: { management: string; share: string };
    }
  | { result: 'waitlisted'; event: EventSummary; position: number; links: { management: string } }
  | { result: 'already_confirmed' };

function RecoveryNote() {
  return (
    <p className="muted">
      Copy these links now. They are not saved in this browser: if you reload this page, use the links in your
      email, or submit the registration form again to receive an access email.
    </p>
  );
}

function VerifyPage() {
  const token = linkToken();
  const [view, setView] = useState<{ state: string; event: EventSummary }>();
  const [result, setResult] = useState<VerifyResult>();
  const [invalid, setInvalid] = useState(!token);
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!token) return;
    api<{ state: string; event: EventSummary }>('/api/links/verify', { linkToken: token })
      .then(setView)
      .catch((e: unknown) =>
        e instanceof ApiError && e.code === 'invalid_link' ? setInvalid(true) : setError(errorMessage(e)),
      );
  }, [token]);

  const confirm = async () => {
    setBusy(true);
    try {
      setResult(await api<VerifyResult>('/api/links/verify/confirm', { method: 'POST', linkToken: token }));
    } catch (e) {
      if (e instanceof ApiError && e.code === 'invalid_link') setInvalid(true);
      else setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  if (invalid) return <InvalidLink />;
  if (result?.result === 'confirmed') {
    return (
      <Page title="You are registered">
        <Card title={result.event.title}>
          <p>{formatLocal(result.event.startsAt, result.event.timeZone)}</p>
          <TicketQr code={result.ticket.code} />
          <p>
            <strong>{TRANSFER_STATEMENT}</strong>
          </p>
          <CopyLink
            label="Your management link (view or cancel your registration)"
            url={result.links.management}
          />
          <p className="muted">Anyone you forward this link to can manage or cancel this registration.</p>
          <CopyLink label="Share link (send this to pass on only the ticket)" url={result.links.share} />
          <RecoveryNote />
        </Card>
      </Page>
    );
  }
  if (result?.result === 'waitlisted') {
    return (
      <Page title="You are on the waiting list">
        <Card title={result.event.title}>
          <p>
            The event is full. Your current position is <strong>{result.position}</strong>. This position can
            change.
          </p>
          <p>
            If a place becomes free before registration closes, you are moved up automatically and receive
            your ticket by email.
          </p>
          <CopyLink
            label="Your management link (see your current position or leave the waiting list)"
            url={result.links.management}
          />
          <RecoveryNote />
        </Card>
      </Page>
    );
  }
  if (result?.result === 'already_confirmed' || view?.state === 'already_confirmed') {
    return (
      <Page title="Already confirmed">
        <Card>
          <p>
            This registration was already confirmed. Your confirmation email has your ticket or waiting-list
            details.
          </p>
        </Card>
      </Page>
    );
  }
  if (!view) return error ? <Page title="Confirm registration">{<Alert>{error}</Alert>}</Page> : <Loading />;
  return (
    <Page title="Confirm your registration">
      <Card title={view.event.title}>
        <p>{formatLocal(view.event.startsAt, view.event.timeZone)}</p>
        <p>
          Your place is decided when you confirm: a free seat gives you a ticket; otherwise you join the
          waiting list.
        </p>
        <button onClick={confirm} disabled={busy}>
          {busy ? 'Confirming…' : 'Confirm my registration'}
        </button>
        {error && <Alert>{error}</Alert>}
      </Card>
    </Page>
  );
}

// ---------------------------------------------------------------- management link
type ManageView =
  | {
      state: 'CONFIRMED';
      event: EventSummary;
      ticket: { code: string };
      checkedIn: boolean;
      actions: { cancel: boolean };
    }
  | { state: 'WAITLISTED'; event: EventSummary; position: number; actions: { cancel: boolean } };

function ManagePage() {
  const token = linkToken();
  const [view, setView] = useState<ManageView>();
  const [invalid, setInvalid] = useState(!token);
  const [confirming, setConfirming] = useState(false);
  const [cancelled, setCancelled] = useState<string>();
  const [error, setError] = useState<string>();

  useEffect(() => {
    if (!token) return;
    api<ManageView>('/api/links/manage', { linkToken: token })
      .then(setView)
      .catch((e: unknown) =>
        e instanceof ApiError && e.code === 'invalid_link' ? setInvalid(true) : setError(errorMessage(e)),
      );
  }, [token]);

  const cancel = async () => {
    try {
      const response = await api<{ previousState: string }>('/api/links/manage/cancel', {
        method: 'POST',
        linkToken: token,
        body: { confirmed: true },
      });
      setCancelled(response.previousState);
    } catch (e) {
      if (e instanceof ApiError && e.code === 'invalid_link') setInvalid(true);
      else setError(errorMessage(e));
    }
  };

  if (cancelled) {
    return (
      <Page title="Registration cancelled">
        <Card>
          <p>
            {cancelled === 'CONFIRMED'
              ? 'Your registration is cancelled and your ticket is no longer valid.'
              : 'You have left the waiting list.'}
          </p>
          <p className="muted">A confirmation email is on its way. This management link no longer works.</p>
        </Card>
      </Page>
    );
  }
  if (invalid) return <InvalidLink />;
  if (!view) return error ? <Page title="Your registration">{<Alert>{error}</Alert>}</Page> : <Loading />;
  return (
    <Page title="Your registration">
      <Card title={view.event.title}>
        <p>{formatLocal(view.event.startsAt, view.event.timeZone)}</p>
        {view.state === 'CONFIRMED' ? (
          <>
            <p>
              Status: <strong>confirmed</strong>
              {view.checkedIn && ' · checked in'}
            </p>
            <TicketQr code={view.ticket.code} />
            <p>
              <strong>{TRANSFER_STATEMENT}</strong>
            </p>
          </>
        ) : (
          <p>
            Status: <strong>waiting list</strong>, current position <strong>{view.position}</strong>. This
            position can change.
          </p>
        )}
      </Card>
      {view.actions.cancel && (
        <Card title="Cancel registration">
          {!confirming ? (
            <button className="secondary" onClick={() => setConfirming(true)}>
              Cancel my registration…
            </button>
          ) : (
            <div className="stack">
              <Alert kind="info">
                {view.state === 'CONFIRMED'
                  ? 'Your ticket will stop working immediately and your seat goes to the next person on the waiting list. This cannot be undone.'
                  : 'You will leave the waiting list. This cannot be undone.'}
              </Alert>
              <div className="row">
                <button className="danger" onClick={cancel}>
                  Yes, cancel my registration
                </button>
                <button className="secondary" onClick={() => setConfirming(false)}>
                  Keep my registration
                </button>
              </div>
            </div>
          )}
          {error && <Alert>{error}</Alert>}
        </Card>
      )}
    </Page>
  );
}

// ---------------------------------------------------------------- share view
type ShareView =
  | { state: 'valid'; event: EventSummary; ticket: { code: string } }
  | { state: 'checked_in' | 'not_available'; event: EventSummary };

function TicketPage() {
  const token = linkToken();
  const [view, setView] = useState<ShareView>();
  const [invalid, setInvalid] = useState(!token);
  useEffect(() => {
    if (!token) return;
    api<ShareView>('/api/links/ticket', { linkToken: token })
      .then(setView)
      .catch(() => setInvalid(true));
  }, [token]);
  if (invalid) return <InvalidLink />;
  if (!view) return <Loading />;
  return (
    <Page title={view.event.title}>
      <Card>
        <p>{formatLocal(view.event.startsAt, view.event.timeZone)}</p>
        {view.state === 'valid' && <TicketQr code={view.ticket.code} />}
        {view.state === 'checked_in' && <Alert kind="info">Already checked in.</Alert>}
        {view.state === 'not_available' && (
          <Alert kind="info">This ticket is no longer available for use.</Alert>
        )}
        {view.state !== 'not_available' && (
          <p>
            <strong>{TRANSFER_STATEMENT}</strong>
          </p>
        )}
      </Card>
    </Page>
  );
}

// ---------------------------------------------------------------- sign-in link confirmation
function SignInPage() {
  const token = linkToken();
  const [view, setView] = useState<{ maskedEmail: string; purpose: string; preSessionToken: string }>();
  const [invalid, setInvalid] = useState(!token);
  const [error, setError] = useState<string>();
  useEffect(() => {
    if (!token) return;
    api<{ maskedEmail: string; purpose: string; preSessionToken: string }>('/api/links/sign-in', {
      linkToken: token,
    })
      .then(setView)
      .catch(() => setInvalid(true));
  }, [token]);
  const confirm = async () => {
    try {
      await api('/api/links/sign-in/confirm', {
        method: 'POST',
        linkToken: token,
        csrf: view!.preSessionToken,
      });
      // A full page load: the new session brings a new anti-forgery token (ADR-010 §8).
      window.location.assign((view!.purpose === 'reauth' ? takeReturnTo() : null) ?? '/organizer');
    } catch (e) {
      if (e instanceof ApiError && e.code === 'invalid_link') setInvalid(true);
      else setError(errorMessage(e));
    }
  };
  if (invalid) return <InvalidLink />;
  if (!view) return <Loading />;
  if (view.purpose === 'reauth') {
    return (
      <Page title="Confirm it’s you">
        <Card>
          <p>
            Confirm that you are <strong>{view.maskedEmail}</strong>?
          </p>
          <p>
            This only signs you in again. It does not cancel, delete or change any event. Afterwards you go
            back to the page you came from and confirm the action yourself.
          </p>
          <button onClick={confirm}>Confirm it is you</button>
          {error && <Alert>{error}</Alert>}
        </Card>
      </Page>
    );
  }
  return (
    <Page title="Sign in">
      <Card>
        <p>
          Sign in as <strong>{view.maskedEmail}</strong>?
        </p>
        <button onClick={confirm}>Sign in</button>
        {error && <Alert>{error}</Alert>}
      </Card>
    </Page>
  );
}

function App() {
  const path = window.location.pathname;
  const eventMatch = /^\/e\/([A-Za-z0-9_-]{22,64})$/.exec(path);
  if (eventMatch) return <EventPage publicId={eventMatch[1]!} />;
  if (path === '/verify') return <VerifyPage />;
  if (path === '/manage') return <ManagePage />;
  if (path === '/ticket') return <TicketPage />;
  if (path === '/sign-in') return <SignInPage />;
  return <InvalidLink />;
}

// No StrictMode here: its doubled effects would resolve a sign-in link twice and set two different pre-session cookies.
createRoot(document.getElementById('root')!).render(<App />);
