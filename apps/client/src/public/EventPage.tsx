import { useState, type FormEvent } from 'react';
import { ArrowRight, CalendarDays, Clock3, Globe, Info, Mail, ShieldCheck } from 'lucide-react';
import { api, errorMessage } from '../shared/api';
import { EventCover, Gallery } from '../shared/images';
import { Alert, Button, DevMailboxHint, Field, formatDay, formatLocal, formatTime } from '../shared/ui';
import { VenueDetails } from '../shared/location';
import { Availability } from './Availability';
import { CenterPage, LoadingPage, PublicShell } from './shell';
import { usePublicEvent } from './use-public-event';

const CLOSED_HEADING: Record<string, string> = {
  cancelled: 'This event is cancelled.',
  started: 'This event has started.',
  registration_closed: 'Registration is closed.',
};
const CLOSED_BUTTON: Record<string, string> = {
  cancelled: 'Event cancelled',
  started: 'Event has started',
  registration_closed: 'Registration closed',
};

/**
 * The public event page and email registration (FR-REG-1, FR-EVT-12): only an email is collected.
 * Availability refreshes in place (PD-81). The button label follows it, but both labels submit the same
 * registration, and the server decides the seat or waiting-list place at email confirmation (FR-REG-2).
 */
export function EventPage({ publicId }: { publicId: string }) {
  const { event, loadError, stale, gone, refresh } = usePublicEvent(publicId);
  const [error, setError] = useState<string>();
  const [email, setEmail] = useState('');
  const [submitted, setSubmitted] = useState(false);
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(undefined);
    try {
      await api(`/api/public/events/${publicId}/registrations`, { method: 'POST', body: { email } });
      setSubmitted(true);
    } catch (err) {
      setError(errorMessage(err));
      refresh(); // for example, the cutoff passed or the event was cancelled while the form was open
    } finally {
      setBusy(false);
    }
  };

  if (!event)
    return loadError ? (
      <CenterPage>
        <section className="center-card">
          <h1>Event</h1>
          <Alert>{loadError}</Alert>
        </section>
      </CenterPage>
    ) : (
      <LoadingPage />
    );

  const mode = event.availability.registrationMode;
  const open = event.phase === 'registration_open' && mode !== 'closed' && !gone;
  const waitlist = open && mode === 'waiting_list';
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
          <EventCover artKey={publicId} src={event.images?.cover?.url} alt={event.images?.cover?.alt} />
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
            {event.location && <VenueDetails location={event.location} />}
            {event.images && <Gallery images={event.images.gallery} title={event.title} />}
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
            <Availability phase={event.phase} availability={event.availability} gone={gone} stale={stale} />
            {submitted ? (
              <div className="registration-result" role="status">
                <span className="result-icon">
                  <Mail aria-hidden="true" />
                </span>
                <span className="eyebrow">One small step</span>
                <h2>Check your email.</h2>
                <p>
                  We sent a link to <strong>{email}</strong> to confirm your registration. Your place is
                  decided when you confirm, so availability may change until then.
                </p>
              </div>
            ) : (
              <>
                <h2>
                  {gone
                    ? 'This event is no longer available.'
                    : open
                      ? waitlist
                        ? 'Join the waiting list.'
                        : 'Join us.'
                      : (CLOSED_HEADING[event.phase] ?? 'Registration is closed.')}
                </h2>
                {event.phase === 'cancelled' && (
                  <Alert kind="error">
                    <strong>Cancelled.</strong> The organizer has cancelled this event.
                  </Alert>
                )}
                {open && <p>Just your email. No accounts, no passwords.</p>}
                {!open && !gone && event.phase !== 'cancelled' && (
                  <p>We’re no longer accepting registrations for this event.</p>
                )}
                <form onSubmit={submit}>
                  <fieldset className="stack registration-fieldset" disabled={!open || busy}>
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
                    <Button type="submit" size="lg">
                      {busy
                        ? 'Sending…'
                        : gone
                          ? 'Unavailable'
                          : open
                            ? waitlist
                              ? 'Join waiting list'
                              : 'Register for event'
                            : (CLOSED_BUTTON[event.phase] ?? 'Registration closed')}
                      {!busy && open && <ArrowRight aria-hidden="true" />}
                    </Button>
                  </fieldset>
                </form>
                {open && (
                  <>
                    <p className="registration-clarification">
                      <Info size={15} aria-hidden="true" />
                      <span>
                        Your place is determined when you confirm your email. Availability may change.
                      </span>
                    </p>
                    <p className="registration-reassurance">
                      <ShieldCheck size={15} aria-hidden="true" /> Only your email address is collected, for
                      this event only.
                    </p>
                  </>
                )}
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
