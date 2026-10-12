import { useState } from 'react';
import { ArrowRight, ArrowUpRight, Plus } from 'lucide-react';
import { Alert, Empty, PageHeader, PageSkeleton, buttonClass } from '../../shared/ui';
import { RefreshControl } from '../RefreshControl';
import type { AutoRefresh } from '../use-auto-refresh';
import { EventCard } from '../events/EventCard';
import { SWATCHES, artworkIndex } from '../../shared/artwork';
import { isCancelled, isPast, isUpcoming } from '../events/event-status';
import { Link } from '../router';
import type { EventListItem } from '../types';

type OverviewFilter = 'upcoming' | 'past' | 'cancelled';
const FILTERS: { key: OverviewFilter; label: string; test: (e: EventListItem) => boolean }[] = [
  { key: 'upcoming', label: 'Upcoming', test: isUpcoming },
  { key: 'past', label: 'Past', test: isPast },
  { key: 'cancelled', label: 'Cancelled', test: isCancelled },
];

/**
 * The global dashboard: every event of this organizer (one organizer, many events). Totals are sums
 * of the per-event values from GET /api/events (PD-67); an event's own figures live on its page.
 */
export function Overview({
  events,
  error,
  refresh,
  deleted,
}: {
  events: EventListItem[] | undefined;
  error?: string;
  refresh: AutoRefresh;
  deleted: boolean;
}) {
  const [filter, setFilter] = useState<OverviewFilter>('upcoming');
  const createLink = (
    <Link to="/organizer/events/new" className={buttonClass('primary', 'lg')}>
      <Plus aria-hidden="true" />
      Create event
    </Link>
  );
  const header = (
    <PageHeader
      eyebrow="Your workspace, in good company"
      title="Good things happen together."
      description="Every event you organize, in one place. Pick one to manage it, or start something new."
      actions={
        <>
          <RefreshControl state={refresh} label="Refresh overview" />
          {createLink}
        </>
      }
    />
  );
  if (!events)
    return (
      <>
        {header}
        {error ? <Alert>{error}</Alert> : <PageSkeleton />}
      </>
    );

  const upcoming = events.filter(isUpcoming);
  const active = events.filter((e) => !isCancelled(e));
  const totals = {
    events: events.length,
    upcoming: upcoming.length,
    confirmed: active.reduce((n, e) => n + e.confirmedCount, 0),
    waiting: active.reduce((n, e) => n + e.waitlistedCount, 0),
    checkedIn: events.reduce((n, e) => n + e.checkedInCount, 0),
  };
  const current = FILTERS.find((f) => f.key === filter)!;
  const shown = events
    .filter(current.test)
    .sort((a, b) =>
      filter === 'upcoming' ? a.startsAt.localeCompare(b.startsAt) : b.startsAt.localeCompare(a.startsAt),
    );
  const [featured, ...rest] = shown;

  return (
    <div className="editorial-overview">
      {header}
      {deleted && (
        <Alert kind="success">
          The event was deleted. A deletion record and the audit history are kept; no personal data is in
          them.
        </Alert>
      )}
      <section className="organization-stats" aria-label="Across all your events">
        <div>
          <span className="org-label">Total events</span>
          <strong>
            {totals.events}
            <span className="stat-spark" aria-hidden="true">
              ↗
            </span>
          </strong>
          <small>{totals.upcoming} upcoming</small>
        </div>
        <div>
          <span className="org-label">Upcoming events</span>
          <strong>{totals.upcoming}</strong>
          <small>On your calendar</small>
        </div>
        <div>
          <span className="org-label">Confirmed participants</span>
          <strong>
            {totals.confirmed}
            <span className="stat-spark" aria-hidden="true">
              +
            </span>
          </strong>
          <small>
            {totals.waiting > 0 ? `${totals.waiting} more on waiting lists` : 'Across all your events'}
          </small>
        </div>
        <div>
          <span className="org-label">Checked in</span>
          <strong>
            {totals.checkedIn}
            <span className="stat-spark" aria-hidden="true">
              ✓
            </span>
          </strong>
          <small>Across all your events</small>
        </div>
      </section>

      <section aria-labelledby="gatherings-heading">
        <div className="editorial-section-heading">
          <div>
            <span className="eyebrow">Make room for what’s next</span>
            <h2 id="gatherings-heading">
              Your next great gatherings<span className="coral-dot">.</span>
            </h2>
          </div>
          <Link to="/organizer/events" className="text-action">
            All events <ArrowUpRight size={17} aria-hidden="true" />
          </Link>
        </div>
        <div className="filter-pills" role="group" aria-label="Show events">
          {FILTERS.map((f) => (
            <button key={f.key} aria-pressed={filter === f.key} onClick={() => setFilter(f.key)}>
              {f.label}
              <span className="pill-count">{events.filter(f.test).length}</span>
            </button>
          ))}
        </div>
        {featured ? (
          <div className="overview-event-grid">
            <EventCard event={featured} featured />
            {rest.length > 0 && (
              <div className="small-event-grid">
                {rest.slice(0, 2).map((e) => (
                  <EventCard key={e.id} event={e} />
                ))}
              </div>
            )}
          </div>
        ) : (
          <div className="panel">
            <Empty
              title={events.length === 0 ? 'A little room for something new.' : 'Nothing in this view.'}
              text={
                events.length === 0
                  ? 'You have no events yet. Your next great gathering starts with an idea.'
                  : 'Try another view, or create a new event.'
              }
            />
          </div>
        )}
      </section>

      <div className="overview-bottom-grid">
        <section className="across-events" aria-labelledby="across-heading">
          <div className="editorial-section-heading">
            <h2 id="across-heading">Across your events</h2>
            <span className="eyebrow eyebrow-flat">Live figures</span>
          </div>
          {upcoming.length === 0 ? (
            <p className="muted">No upcoming events.</p>
          ) : (
            upcoming
              .sort((a, b) => a.startsAt.localeCompare(b.startsAt))
              .slice(0, 5)
              .map((e) => (
                <Link key={e.id} to={`/organizer/events/${e.id}`} className="across-row">
                  <span
                    className="event-swatch"
                    style={{ background: SWATCHES[artworkIndex(e.publicId)] }}
                    aria-hidden="true"
                  />
                  <span>
                    <strong>{e.title}</strong>
                    <small>
                      {e.confirmedCount} confirmed · {e.checkedInCount} checked in
                      {e.waitlistedCount ? ` · ${e.waitlistedCount} waiting` : ''}
                    </small>
                  </span>
                  <ArrowUpRight size={17} aria-hidden="true" />
                </Link>
              ))
          )}
        </section>
        <section className="create-callout">
          <div>
            <span className="eyebrow">Big ideas. Real connections.</span>
            <h2>What will you bring people together for?</h2>
          </div>
          <Link to="/organizer/events/new">
            Start something good <ArrowRight size={18} aria-hidden="true" />
          </Link>
          <span className="callout-asterisk" aria-hidden="true">
            ✳
          </span>
        </section>
      </div>
      <p className="workspace-footnote">A little less organizing. A lot more connecting.</p>
    </div>
  );
}
