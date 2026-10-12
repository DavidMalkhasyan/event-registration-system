import { useMemo, useState } from 'react';
import { ArrowUpRight, LayoutGrid, List, Plus, Search, X } from 'lucide-react';
import {
  Alert,
  Empty,
  PageHeader,
  PageSkeleton,
  Status,
  buttonClass,
  formatDay,
  formatTime,
} from '../../shared/ui';
import { Link } from '../router';
import type { EventListItem } from '../types';
import { EventCard } from './EventCard';
import { FILTER_LABEL, matchesFilter, phaseOf, type EventFilter } from './event-status';

/** All events of the organizer: search, filter by real phase (PD-66), sort, grid or list. */
export function EventsList({ events, error }: { events: EventListItem[] | undefined; error?: string }) {
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<EventFilter>('all');
  const [sort, setSort] = useState<'soonest' | 'latest'>('soonest');
  const [view, setView] = useState<'grid' | 'list'>('grid');

  const searched = useMemo(() => {
    const q = search.trim().toLowerCase();
    return (events ?? []).filter((e) => !q || e.title.toLowerCase().includes(q));
  }, [events, search]);
  const shown = searched
    .filter((e) => matchesFilter(e, filter))
    .sort((a, b) => (sort === 'soonest' ? 1 : -1) * a.startsAt.localeCompare(b.startsAt));

  return (
    <>
      <PageHeader
        eyebrow="All your ideas, in one place"
        title="Made for bringing people together."
        description="Big conferences. Small gatherings. Every event has a home here."
        actions={
          <Link to="/organizer/events/new" className={buttonClass('primary', 'lg')}>
            <Plus aria-hidden="true" />
            Create event
          </Link>
        }
      />
      {!events ? (
        error ? (
          <Alert>{error}</Alert>
        ) : (
          <PageSkeleton />
        )
      ) : (
        <>
          <div className="gallery-tools">
            <div className="search-box">
              <Search size={16} aria-hidden="true" />
              <input
                type="search"
                aria-label="Search events"
                placeholder="Search events…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
              {search && (
                <button aria-label="Clear search" onClick={() => setSearch('')}>
                  <X size={14} aria-hidden="true" />
                </button>
              )}
            </div>
            <div className="cluster">
              <select
                className="select"
                aria-label="Sort events"
                value={sort}
                onChange={(e) => setSort(e.target.value as 'soonest' | 'latest')}
              >
                <option value="soonest">Date: soonest first</option>
                <option value="latest">Date: latest first</option>
              </select>
              <div className="segmented" role="group" aria-label="Event view">
                <button aria-label="Grid view" aria-pressed={view === 'grid'} onClick={() => setView('grid')}>
                  <LayoutGrid size={17} aria-hidden="true" />
                </button>
                <button aria-label="List view" aria-pressed={view === 'list'} onClick={() => setView('list')}>
                  <List size={17} aria-hidden="true" />
                </button>
              </div>
            </div>
          </div>
          <div className="filter-pills" role="group" aria-label="Filter events">
            {(Object.keys(FILTER_LABEL) as EventFilter[]).map((f) => (
              <button key={f} aria-pressed={filter === f} onClick={() => setFilter(f)}>
                {FILTER_LABEL[f]}
                <span className="pill-count">{searched.filter((e) => matchesFilter(e, f)).length}</span>
              </button>
            ))}
          </div>
          {shown.length === 0 ? (
            <div className="panel">
              <Empty
                title={events.length === 0 ? 'Nothing here just yet.' : 'No events match.'}
                text={
                  events.length === 0
                    ? 'Create your first event to open registration.'
                    : 'Try another search or filter.'
                }
              />
            </div>
          ) : view === 'grid' ? (
            <div className="event-gallery">
              {shown.map((e) => (
                <EventCard key={e.id} event={e} />
              ))}
            </div>
          ) : (
            <div className="panel table-scroll">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Event</th>
                    <th>Date and time</th>
                    <th>Status</th>
                    <th>Registrations</th>
                    <th>Waiting list</th>
                    <th>Checked in</th>
                  </tr>
                </thead>
                <tbody>
                  {shown.map((e) => {
                    const phase = phaseOf(e);
                    return (
                      <tr key={e.id}>
                        <td>
                          <Link to={`/organizer/events/${e.id}`} className="text-action">
                            {e.title} <ArrowUpRight size={14} aria-hidden="true" />
                          </Link>
                        </td>
                        <td>
                          {formatDay(e.startsAt, e.timeZone)}
                          <small>
                            {formatTime(e.startsAt, e.timeZone)} · {e.timeZone}
                          </small>
                        </td>
                        <td>
                          <Status tone={phase.tone}>{phase.label}</Status>
                        </td>
                        <td>
                          {e.confirmedCount} / {e.capacity}
                        </td>
                        <td>{e.waitlistedCount}</td>
                        <td>{e.checkedInCount}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
          <p className="gallery-footer muted">
            {shown.length} of {events.length} events
          </p>
        </>
      )}
    </>
  );
}
