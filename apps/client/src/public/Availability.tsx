import { Status } from '../shared/ui';
import type { PublicAvailability } from './use-public-event';

// The availability panel on the public event page (PD-81). Every figure is the server's; the free-seat
// number is an estimate, because the place is decided when the visitor confirms their email (FR-REG-2).

export interface AvailabilityView {
  tone: string;
  label: string;
}

export function availabilityView(
  phase: string,
  availability: PublicAvailability,
  gone: boolean,
): AvailabilityView {
  if (gone) return { tone: 'neutral', label: 'Event unavailable' };
  if (phase === 'cancelled') return { tone: 'cancelled', label: 'Event cancelled' };
  if (phase === 'started') return { tone: 'started', label: 'Event has started' };
  if (availability.registrationMode === 'seats_available') return { tone: 'open', label: 'Spots available' };
  if (availability.registrationMode === 'waiting_list')
    return { tone: 'waiting', label: 'Waiting list available' };
  return { tone: 'closed', label: 'Registration closed' };
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

export function Availability({
  phase,
  availability,
  gone,
  stale,
}: {
  phase: string;
  availability: PublicAvailability;
  gone: boolean;
  stale: boolean;
}) {
  const view = availabilityView(phase, availability, gone);
  const {
    registrationMode: mode,
    capacity,
    confirmedCount,
    waitlistedCount,
    estimatedAvailableSeats,
  } = availability;
  const counted = mode !== 'closed' && !gone && capacity !== null && confirmedCount !== null;
  const percent = counted ? Math.min(100, Math.round((confirmedCount / capacity) * 100)) : 0;

  return (
    <section className={`availability availability-${view.tone}`} aria-labelledby="availability-title">
      <div className="availability-head">
        <h3 id="availability-title" className="sr-only">
          Availability
        </h3>
        <Status tone={view.tone}>{view.label}</Status>
        {!gone && mode !== 'closed' && (
          <span className={`availability-live${stale ? ' is-stale' : ''}`}>
            <span className="availability-live-dot" aria-hidden="true" />
            {stale ? 'Reconnecting…' : 'Live'}
          </span>
        )}
      </div>
      {/* Announced once per change of state, not on every count update. */}
      <p className="sr-only" role="status" aria-live="polite">
        {view.label}
      </p>

      {counted && mode === 'seats_available' && (
        <div className="availability-figure">
          <strong>{estimatedAvailableSeats}</strong>
          <span>
            {estimatedAvailableSeats === 1 ? 'seat left' : 'seats left'}
            <small>of {plural(capacity, 'seat', 'seats')} · estimated</small>
          </span>
        </div>
      )}
      {counted && mode === 'waiting_list' && (
        <div className="availability-figure">
          <strong>{capacity}</strong>
          <span>
            of {capacity} seats taken
            <small>
              {waitlistedCount
                ? `${plural(waitlistedCount, 'person', 'people')} waiting`
                : 'No one is waiting yet'}
            </small>
          </span>
        </div>
      )}
      {counted && (
        <div
          className="availability-track"
          role="img"
          aria-label={`${confirmedCount} of ${capacity} seats confirmed`}
        >
          <span style={{ width: `${percent}%` }} />
        </div>
      )}

      {counted && mode === 'waiting_list' && (
        <p className="availability-note">
          The event is full, but you can still register to join the waiting list. If a seat becomes free, it
          is offered to the waiting list in order.
        </p>
      )}
      {stale && counted && (
        <p className="availability-note">Showing the last known availability while we reconnect.</p>
      )}
    </section>
  );
}
