import { ArrowRight, ArrowUpRight, CalendarDays, Users } from 'lucide-react';
import { Status, cx, formatDay, formatTime } from '../../shared/ui';
import { Link } from '../router';
import type { EventListItem } from '../types';
import { EventArtwork } from '../../shared/artwork';
import { fillPercent, phaseOf } from './event-status';

/** An event in the gallery (v0 editorial card); every number is the server's (PD-67). */
export function EventCard({ event, featured = false }: { event: EventListItem; featured?: boolean }) {
  const phase = phaseOf(event);
  const percent = fillPercent(event.confirmedCount, event.capacity);
  return (
    <Link
      to={`/organizer/events/${event.id}`}
      className={cx('editorial-card', featured && 'featured-card')}
      aria-label={`${event.title}, ${phase.label}, ${event.confirmedCount} of ${event.capacity} registered`}
    >
      <div className="card-art-wrap">
        <EventArtwork artKey={event.publicId} caption={new Date(event.startsAt).getFullYear().toString()} />
        <span className="card-pill">{formatDay(event.startsAt, event.timeZone)}</span>
        <span className="card-open" aria-hidden="true">
          <ArrowUpRight size={18} />
        </span>
      </div>
      <div className="editorial-card-body">
        <div className="card-date">
          <CalendarDays size={14} aria-hidden="true" />
          {formatDay(event.startsAt, event.timeZone)} · {formatTime(event.startsAt, event.timeZone)}
        </div>
        <h3>{event.title}</h3>
        {featured && event.description && <p className="featured-description">{event.description}</p>}
        <div className="card-status">
          <Status tone={phase.tone}>{phase.label}</Status>
          {event.waitlistedCount > 0 && <span>{event.waitlistedCount} on the waiting list</span>}
        </div>
        <div className="card-capacity">
          <span>
            <Users size={14} aria-hidden="true" />
            <strong>{event.confirmedCount}</strong> / {event.capacity} registered
          </span>
          <strong>{percent}%</strong>
        </div>
        <div className="capacity-track" aria-hidden="true">
          <span style={{ width: `${percent}%` }} />
        </div>
        <div className="card-manage">
          Manage event <ArrowRight size={16} aria-hidden="true" />
        </div>
      </div>
    </Link>
  );
}
