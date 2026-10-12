import { useEffect, useState, type FormEvent } from 'react';
import { ArrowRight, CalendarDays, Clock3, Globe, Mail, ShieldCheck } from 'lucide-react';
import { ApiError, api, errorMessage } from '../shared/api';
import { EventArtwork } from '../shared/artwork';
import {
  Alert,
  Button,
  DevMailboxHint,
  Field,
  Status,
  formatDay,
  formatLocal,
  formatTime,
} from '../shared/ui';
import { CenterPage, LoadingPage, PublicShell, type EventSummary } from './shell';

type PublicEvent = EventSummary & { description: string | null; phase: string };

const PHASE: Record<string, { tone: string; label: string }> = {
  registration_open: { tone: 'open', label: 'Registration open' },
  registration_closed: { tone: 'closed', label: 'Registration closed' },
  started: { tone: 'started', label: 'This event has started' },
  cancelled: { tone: 'cancelled', label: 'Cancelled' },
};

/** The public event page and email registration (FR-REG-1, FR-EVT-12): only an email is collected. */
export function EventPage({ publicId }: { publicId: string }) {
  const [event, setEvent] = useState<PublicEvent>();
  const [error, setError] = useState<string>();
  const [email, setEmail] = useState('');
  const [submitted, setSubmitted] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api<PublicEvent>(`/api/public/events/${publicId}`)
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

  if (!event)
    return error ? (
      <CenterPage>
        <section className="center-card">
          <h1>Event</h1>
          <Alert>{error}</Alert>
        </section>
      </CenterPage>
    ) : (
      <LoadingPage />
    );

  const open = event.phase === 'registration_open';
  const phase = PHASE[event.phase] ?? { tone: 'neutral', label: event.phase };
  const headline =
    event.phase === 'cancelled'
      ? 'This gathering won’t take place.'
      : event.phase === 'started'
        ? 'This event is under way.'
        : open
          ? 'You’re invited.'
          : 'See you there.';
  return (
    <PublicShell>
      <main className="public-main">
        <div className="public-art">
          <EventArtwork artKey={publicId} />
          <div>
            <span>{formatDay(event.startsAt, event.timeZone).toUpperCase()}</span>
            <h1>{event.title}</h1>
            <p>
              {formatTime(event.startsAt, event.timeZone)} · {event.timeZone}
            </p>
          </div>
        </div>
        <div className="public-grid">
          <article>
            <span className="eyebrow">
              {event.phase === 'cancelled' ? 'About this event' : 'The next chapter starts together'}
            </span>
            <h2>{headline}</h2>
            {event.description && <p className="event-description">{event.description}</p>}
            <div className="event-facts">
              <div>
                <CalendarDays aria-hidden="true" />
                <span>
                  <strong>{formatLocal(event.startsAt, event.timeZone)}</strong>
                  {event.phase !== 'cancelled' && <small>Save a little space on your calendar</small>}
                </span>
              </div>
              {open && (
                <div>
                  <Clock3 aria-hidden="true" />
                  <span>
                    <strong>Registration closes 2 hours before the start</strong>
                    <small>Your place is decided when you confirm your email</small>
                  </span>
                </div>
              )}
              <div>
                <Globe aria-hidden="true" />
                <span>
                  <strong>{event.timeZone}</strong>
                  <small>All times are shown in the event’s time zone</small>
                </span>
              </div>
            </div>
          </article>
          <aside className="registration-card" aria-label="Registration">
            <Status tone={phase.tone}>{phase.label}</Status>
            {event.phase === 'cancelled' ? (
              <>
                <h2>This event is cancelled.</h2>
                <Alert kind="error">
                  <strong>Cancelled.</strong> The organizer has cancelled this event.
                </Alert>
              </>
            ) : !open ? (
              <>
                <h2>Registration is closed.</h2>
                <p>We’re no longer accepting registrations for this event.</p>
              </>
            ) : submitted ? (
              <div className="registration-result" role="status">
                <span className="result-icon">
                  <Mail aria-hidden="true" />
                </span>
                <span className="eyebrow">One small step</span>
                <h2>Check your email.</h2>
                <p>
                  We sent a link to <strong>{email}</strong> to confirm your registration. Your place is
                  decided when you confirm.
                </p>
              </div>
            ) : (
              <>
                <h2>We’ll save you a seat.</h2>
                <p>Just your email. No accounts, no passwords.</p>
                <form className="stack" onSubmit={submit}>
                  <Field label="Email address">
                    {(id) => (
                      <input
                        id={id}
                        className="input"
                        type="email"
                        required
                        maxLength={254}
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        autoComplete="email"
                        placeholder="you@example.com"
                      />
                    )}
                  </Field>
                  <Button type="submit" size="lg" disabled={busy}>
                    {busy ? 'Sending…' : 'Register'}
                    {!busy && <ArrowRight aria-hidden="true" />}
                  </Button>
                </form>
                <p className="registration-reassurance">
                  <ShieldCheck size={15} aria-hidden="true" /> Only your email address is collected, for this
                  event only.
                </p>
              </>
            )}
            {error && <Alert>{error}</Alert>}
            {open && <DevMailboxHint />}
          </aside>
        </div>
      </main>
    </PublicShell>
  );
}
