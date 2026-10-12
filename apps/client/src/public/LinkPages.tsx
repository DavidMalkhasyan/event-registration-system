import { useEffect, useState } from 'react';
import { CalendarCheck, Clock3, KeyRound, ScanLine, ShieldCheck } from 'lucide-react';
import { linkToken } from './bootstrap-token';
import { ApiError, api, errorMessage } from '../shared/api';
import { takeReturnTo } from '../shared/return-to';
import { Alert, Button, CopyLink, formatLocal } from '../shared/ui';
import { CenterPage, InvalidLinkPage, LoadingPage, TicketCard, type EventSummary } from './shell';

// Link pages (ADR-011): the token comes from bootstrap-token (memory only) and is sent as
// Authorization: Link. Opening a link only reads; every change is an explicit POST.

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

/** Email verification and the seat decision (FR-REG-4, FR-REG-5): the place is decided on confirm. */
export function VerifyPage() {
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

  if (invalid) return <InvalidLinkPage />;
  if (result?.result === 'confirmed')
    return (
      <CenterPage wide>
        <div className="management-heading">
          <span className="eyebrow">You’re on the list</span>
          <h1>You are registered</h1>
          <p>Your ticket is below and in your email.</p>
        </div>
        <div className="management-grid">
          <TicketCard
            event={result.event}
            status={{ tone: 'confirmed', label: 'Confirmed' }}
            code={result.ticket.code}
          />
          <aside className="panel manage-actions">
            <h2>Keep these links</h2>
            <CopyLink
              label="Your management link (view or cancel your registration)"
              url={result.links.management}
            />
            <p className="muted">Anyone you forward this link to can manage or cancel this registration.</p>
            <CopyLink label="Share link (send this to pass on only the ticket)" url={result.links.share} />
            <RecoveryNote />
          </aside>
        </div>
      </CenterPage>
    );
  if (result?.result === 'waitlisted')
    return (
      <CenterPage wide>
        <div className="management-heading">
          <span className="eyebrow">Good things are worth the wait</span>
          <h1>You are on the waiting list</h1>
          <p>
            The event is full. Your current position is <strong>{result.position}</strong>. This position can
            change.
          </p>
        </div>
        <div className="management-grid">
          <TicketCard
            event={result.event}
            status={{ tone: 'waiting', label: `Waiting list · #${result.position}` }}
            note={
              <>
                <Clock3 aria-hidden="true" />
                <p>
                  If a place becomes free before registration closes, you are moved up automatically and
                  receive your ticket by email.
                </p>
              </>
            }
          />
          <aside className="panel manage-actions">
            <h2>Keep this link</h2>
            <CopyLink
              label="Your management link (see your current position or leave the waiting list)"
              url={result.links.management}
            />
            <RecoveryNote />
          </aside>
        </div>
      </CenterPage>
    );
  if (result?.result === 'already_confirmed' || view?.state === 'already_confirmed')
    return (
      <CenterPage>
        <section className="center-card">
          <span className="result-icon">
            <CalendarCheck aria-hidden="true" />
          </span>
          <h1>Already confirmed</h1>
          <p>
            This registration was already confirmed. Your confirmation email has your ticket or waiting-list
            details.
          </p>
        </section>
      </CenterPage>
    );
  if (!view)
    return error ? (
      <CenterPage>
        <section className="center-card">
          <h1>Confirm registration</h1>
          <Alert>{error}</Alert>
        </section>
      </CenterPage>
    ) : (
      <LoadingPage />
    );
  return (
    <CenterPage>
      <section className="center-card">
        <span className="eyebrow">One small step</span>
        <h1>Confirm your registration</h1>
        <h2 className="center-subtitle">{view.event.title}</h2>
        <p>{formatLocal(view.event.startsAt, view.event.timeZone)}</p>
        <p>
          Your place is decided when you confirm: a free seat gives you a ticket; otherwise you join the
          waiting list.
        </p>
        <Button size="lg" className="btn-block" onClick={confirm} disabled={busy}>
          {busy ? 'Confirming…' : 'Confirm my registration'}
        </Button>
        {error && <Alert>{error}</Alert>}
      </section>
    </CenterPage>
  );
}

type ShareView =
  | { state: 'valid'; event: EventSummary; ticket: { code: string } }
  | { state: 'checked_in' | 'not_available'; event: EventSummary };

/** The read-only share view (FR-SHR-2, FR-SHR-4): never checks in, never shows the participant. */
export function TicketPage() {
  const token = linkToken();
  const [view, setView] = useState<ShareView>();
  const [invalid, setInvalid] = useState(!token);
  useEffect(() => {
    if (!token) return;
    api<ShareView>('/api/links/ticket', { linkToken: token })
      .then(setView)
      .catch(() => setInvalid(true));
  }, [token]);
  if (invalid) return <InvalidLinkPage />;
  if (!view) return <LoadingPage />;
  return (
    <CenterPage>
      <h1 className="sr-only">{view.event.title}</h1>
      <div className="single-ticket">
        <TicketCard
          event={view.event}
          status={
            view.state === 'valid'
              ? { tone: 'valid', label: 'Valid' }
              : view.state === 'checked_in'
                ? { tone: 'started', label: 'Checked in' }
                : { tone: 'cancelled', label: 'Not available' }
          }
          code={view.state === 'valid' ? view.ticket.code : undefined}
          note={
            view.state === 'checked_in' ? (
              <>
                <ScanLine aria-hidden="true" />
                <Alert kind="info">Already checked in.</Alert>
              </>
            ) : (
              <Alert kind="info">This ticket is no longer available for use.</Alert>
            )
          }
        />
      </div>
    </CenterPage>
  );
}

/** Organizer sign-in and re-authentication links (ADR-010 §8): confirming is an explicit POST. */
export function SignInPage() {
  const token = linkToken();
  const [view, setView] = useState<{ maskedEmail: string; purpose: string; preSessionToken: string }>();
  const [invalid, setInvalid] = useState(!token);
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!token) return;
    api<{ maskedEmail: string; purpose: string; preSessionToken: string }>('/api/links/sign-in', {
      linkToken: token,
    })
      .then(setView)
      .catch(() => setInvalid(true));
  }, [token]);
  const confirm = async () => {
    setBusy(true);
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
      setBusy(false);
    }
  };
  if (invalid) return <InvalidLinkPage />;
  if (!view) return <LoadingPage />;
  const reauth = view.purpose === 'reauth';
  return (
    <CenterPage>
      <section className="center-card">
        <span className="result-icon">
          {reauth ? <ShieldCheck aria-hidden="true" /> : <KeyRound aria-hidden="true" />}
        </span>
        {reauth ? (
          <>
            <h1>Confirm it’s you</h1>
            <p>
              Confirm that you are <strong>{view.maskedEmail}</strong>?
            </p>
            <p>
              This only signs you in again. It does not cancel, delete or change any event. Afterwards you go
              back to the page you came from and confirm the action yourself.
            </p>
          </>
        ) : (
          <>
            <h1>Sign in</h1>
            <p>
              Sign in as <strong>{view.maskedEmail}</strong>?
            </p>
          </>
        )}
        <Button size="lg" className="btn-block" onClick={confirm} disabled={busy}>
          {reauth ? 'Confirm it is you' : 'Sign in'}
        </Button>
        {error && <Alert>{error}</Alert>}
      </section>
    </CenterPage>
  );
}

/** Staff invitation (FR-STAFF-1): accepting turns this device into a check-in device for one event. */
export function InvitePage() {
  const token = linkToken();
  const [view, setView] = useState<{ event: EventSummary }>();
  const [invalid, setInvalid] = useState(!token);
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!token) return;
    api<{ event: EventSummary }>('/api/links/invite', { linkToken: token })
      .then(setView)
      .catch(() => setInvalid(true));
  }, [token]);
  const accept = async () => {
    setBusy(true);
    try {
      await api('/api/links/invite/accept', { method: 'POST', linkToken: token });
      window.location.assign('/staff');
    } catch (e) {
      if (e instanceof ApiError && e.code === 'invalid_link') setInvalid(true);
      else setError(errorMessage(e));
      setBusy(false);
    }
  };
  if (invalid) return <InvalidLinkPage />;
  if (!view) return <LoadingPage />;
  return (
    <CenterPage>
      <section className="center-card">
        <span className="result-icon">
          <ScanLine aria-hidden="true" />
        </span>
        <span className="eyebrow">Staff check-in</span>
        <h1>Check-in invitation</h1>
        <h2 className="center-subtitle">{view.event.title}</h2>
        <p>{formatLocal(view.event.startsAt, view.event.timeZone)}</p>
        <p>
          You were invited to check in participants at the entrance. Accept on the device you will use. You
          will be able to check tickets in and see the checked-in count for this event only, during its
          check-in window.
        </p>
        <Button size="lg" className="btn-block" onClick={accept} disabled={busy}>
          {busy ? 'Accepting…' : 'Accept'}
        </Button>
        {error && <Alert>{error}</Alert>}
      </section>
    </CenterPage>
  );
}
