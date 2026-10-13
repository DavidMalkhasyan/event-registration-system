import { useLayoutEffect, useRef, useState } from 'react';
import {
  ArrowLeft,
  ArrowUpRight,
  CalendarClock,
  CalendarDays,
  Clock3,
  ExternalLink,
  ScanLine,
  Users,
} from 'lucide-react';
import {
  Alert,
  CopyLink,
  PageHeader,
  PageSkeleton,
  Status,
  buttonClass,
  formatDay,
  formatLocal,
} from '../../shared/ui';
import { EventCover } from '../../shared/images';
import { fillPercent, phaseOf } from '../events/event-status';
import { Link, eventPath, type EventTab } from '../router';
import type { Counts, EventItem, Notice, Session } from '../types';
import { CheckInTab } from './CheckInTab';
import { ParticipantsTab } from './ParticipantsTab';
import { SettingsTab } from './SettingsTab';
import { PhotosTab } from './PhotosTab';
import { StaffTab } from './StaffTab';
import { RefreshControl } from '../RefreshControl';
import { useEventData } from './use-event-data';

const TABS: { key: EventTab; label: string }[] = [
  { key: 'overview', label: 'Overview' },
  { key: 'participants', label: 'Participants' },
  { key: 'waiting-list', label: 'Waiting list' },
  { key: 'check-in', label: 'Check-in' },
  { key: 'staff', label: 'Staff' },
  { key: 'photos', label: 'Photos' },
  { key: 'settings', label: 'Settings' },
];

function EventStats({
  event,
  counts,
  live,
}: {
  event: EventItem;
  counts?: Counts;
  live: { count: number | null; connected: boolean };
}) {
  const confirmed = counts?.confirmed ?? event.confirmedCount;
  return (
    <section className="stats-grid" aria-label="This event" aria-live="polite">
      <div className="stat-card stat">
        <div className="stat-label">
          Event capacity <CalendarDays aria-hidden="true" />
        </div>
        <strong>{event.capacity}</strong>
        <p>Seats in total</p>
      </div>
      <div className="stat-card stat">
        <div className="stat-label">
          Confirmed registrations <Users aria-hidden="true" />
        </div>
        <strong>{counts ? confirmed : '–'}</strong>
        <p>{fillPercent(confirmed, event.capacity)}% of the seats</p>
      </div>
      <div className="stat-card stat">
        <div className="stat-label">
          On the waiting list <Clock3 aria-hidden="true" />
        </div>
        <strong>{counts?.waitlisted ?? '–'}</strong>
        <p>First come, first served</p>
      </div>
      <div className="stat-card stat">
        <div className="stat-label">
          <span className="stat-live">
            {live.connected && <span className="live-dot" aria-hidden="true" />}
            Checked in{live.connected ? ' (live)' : ''}
          </span>
          <ScanLine aria-hidden="true" />
        </div>
        <strong>{live.count ?? counts?.checkedIn ?? '–'}</strong>
        <p>Updated as tickets are scanned</p>
      </div>
    </section>
  );
}

function OverviewTab({ event, counts }: { event: EventItem; counts?: Counts }) {
  return (
    <div className="event-overview-content">
      <div>
        <span className="eyebrow">The gathering</span>
        <h2>A little more about your event.</h2>
        {event.description ? (
          <p className="event-description">{event.description}</p>
        ) : (
          <p className="muted">No description yet. Add one in Settings.</p>
        )}
        <p className="overview-link">
          <Link to={eventPath(event.id, 'settings')} className="text-action">
            Edit details, capacity and date <ArrowUpRight size={16} aria-hidden="true" />
          </Link>
        </p>
      </div>
      <aside className="glance">
        <span className="eyebrow">Registration at a glance</span>
        <h3>{counts?.confirmed ?? event.confirmedCount} people. One great gathering.</h3>
        <p>
          {counts?.waitlisted ?? 0} on the waiting list · {counts?.checkedIn ?? 0} checked in
        </p>
        <Link to={eventPath(event.id, 'participants')} className="text-action">
          Meet your participants <ArrowUpRight size={16} aria-hidden="true" />
        </Link>
        <div className="glance-facts">
          <div>
            <CalendarDays aria-hidden="true" />
            <span>
              <strong>Starts</strong>
              <small>{formatLocal(event.startsAt, event.timeZone)}</small>
            </span>
          </div>
          <div>
            <CalendarClock aria-hidden="true" />
            <span>
              <strong>Check-in window</strong>
              <small>
                {formatLocal(event.checkInOpensAt, event.timeZone)} to{' '}
                {formatLocal(event.checkInClosesAt, event.timeZone)}
              </small>
            </span>
          </div>
        </div>
      </aside>
    </div>
  );
}

/** One event's workspace (PD-68): only this event's data; sections are real URLs. */
export function EventWorkspace({
  session,
  eventId,
  tab,
  onChanged,
}: {
  session: Session;
  eventId: string;
  tab: EventTab;
  /** Tell the shell that the event list (global figures) may have changed. */
  onChanged: () => void;
}) {
  const participantsShown = tab === 'participants' || tab === 'waiting-list' || tab === 'check-in';
  const { event, counts, participants, error, live, reload, refresher } = useEventData(
    eventId,
    participantsShown,
  );
  // K-706: sections opened once stay mounted (hidden while another is shown), so their search, filters
  // and unsaved form values survive switching sections. Check-in is the exception: leaving it stops the
  // camera. Every section still shows the same, shared event data.
  const [visited, setVisited] = useState<ReadonlySet<EventTab>>(() => new Set([tab]));
  if (!visited.has(tab)) setVisited(new Set(visited).add(tab));
  const kept = (key: EventTab) => visited.has(key) || tab === key;
  // K-706: the section tabs stay where they were on screen when a section changes, even when the
  // content above them changes height (the check-in screen hides the cover and the figures).
  const tabsRef = useRef<HTMLElement>(null);
  const tabsTopBefore = useRef<number | null>(null);
  useLayoutEffect(() => {
    const before = tabsTopBefore.current;
    tabsTopBefore.current = null;
    const tabs = tabsRef.current;
    if (before === null || !tabs) return;
    const shift = tabs.getBoundingClientRect().top - before;
    if (Math.abs(shift) > 1) window.scrollBy({ top: shift });
  }, [tab]);
  // A result message belongs to the section where the action happened.
  const [tagged, setTagged] = useState<{ tab: EventTab; notice: Notice }>();
  const notice = tagged?.tab === tab ? tagged.notice : undefined;
  const changed = () => {
    reload();
    onChanged();
  };
  const onNotice = (n: Notice) => {
    setTagged({ tab, notice: n });
    changed();
  };

  if (!event)
    return error ? (
      <>
        <Link to="/organizer/events" className="back-link">
          <ArrowLeft size={16} aria-hidden="true" /> All events
        </Link>
        <Alert>{error}</Alert>
      </>
    ) : (
      <PageSkeleton />
    );

  const phase = phaseOf(event);
  const confirmed = counts?.confirmed ?? event.confirmedCount;
  const percent = fillPercent(confirmed, event.capacity);
  const focused = tab === 'check-in'; // the door screen stays compact
  return (
    <>
      <Link to="/organizer/events" className="back-link">
        <ArrowLeft size={16} aria-hidden="true" />
        All events
      </Link>
      {!focused && (
        <div className="event-cover">
          <EventCover
            artKey={event.publicId}
            src={event.cover?.url}
            alt={event.cover?.alt}
            caption={formatDay(event.startsAt, event.timeZone)}
          />
          <span className="cover-caption">{formatDay(event.startsAt, event.timeZone)}</span>
        </div>
      )}
      <PageHeader
        eyebrow="Your event workspace"
        title={event.title}
        description={`${formatLocal(event.startsAt, event.timeZone)} · capacity ${event.capacity}`}
        actions={
          <>
            {tab !== 'check-in' && event.status === 'SCHEDULED' && (
              <Link to={eventPath(event.id, 'check-in')} className={buttonClass('outline')}>
                <ScanLine aria-hidden="true" />
                Open check-in
              </Link>
            )}
            <a href={event.publicUrl} target="_blank" rel="noreferrer" className={buttonClass('primary')}>
              View public page
              <ExternalLink aria-hidden="true" />
            </a>
          </>
        }
      />
      {event.status === 'CANCELLED' && (
        <Alert kind="error">
          <strong>Status: CANCELLED.</strong> This event was cancelled
          {event.cancelledAt ? ` on ${formatLocal(event.cancelledAt, event.timeZone)}` : ''}. Registration,
          check-in and changes are closed, and a cancellation email was queued for every confirmed and waiting
          participant (delivery problems show on the Participants page).
        </Alert>
      )}
      {!focused && (
        <>
          <div className="event-meta-strip">
            <Status tone={phase.tone}>{phase.label}</Status>
            <CopyLink label="Public registration link" url={event.publicUrl} compact />
          </div>
          <EventStats event={event} counts={counts} live={live} />
          <div className="panel capacity-panel">
            <div>
              <strong>Room for great connections</strong>
              <p>
                {confirmed} of {event.capacity} seats filled · {Math.max(0, event.capacity - confirmed)} seats
                available
              </p>
            </div>
            <div>
              <strong>{percent}%</strong>
              <div className="capacity-track" aria-hidden="true">
                <span style={{ width: `${percent}%` }} />
              </div>
            </div>
          </div>
        </>
      )}
      <section className="panel workspace-sections">
        <nav className="tabs" aria-label="Event sections" ref={tabsRef}>
          {TABS.map((t) => (
            <Link
              key={t.key}
              to={eventPath(event.id, t.key)}
              className="tab"
              aria-current={tab === t.key ? 'page' : undefined}
              onClick={() => {
                tabsTopBefore.current = tabsRef.current?.getBoundingClientRect().top ?? null;
              }}
            >
              {t.label}
              {t.key === 'participants' && participants && (
                <span className="tab-count">{participants.length}</span>
              )}
              {t.key === 'waiting-list' && counts && <span className="tab-count">{counts.waitlisted}</span>}
            </Link>
          ))}
        </nav>
        {tab !== 'staff' && (
          <div className="tab-toolbar">
            <RefreshControl state={refresher} label="Refresh event data" />
          </div>
        )}
        <div className="tab-panel">
          {tab === 'overview' && <OverviewTab event={event} counts={counts} />}
          {(['participants', 'waiting-list'] as const).map(
            (key) =>
              kept(key) && (
                <div key={key} hidden={tab !== key}>
                  {participants ? (
                    <ParticipantsTab
                      session={session}
                      event={event}
                      participants={participants}
                      waitingOnly={key === 'waiting-list'}
                      notice={tab === key ? notice : undefined}
                      onNotice={onNotice}
                    />
                  ) : (
                    <PageSkeleton />
                  )}
                </div>
              ),
          )}
          {tab === 'check-in' && (
            <CheckInTab
              session={session}
              event={event}
              participants={participants ?? []}
              notice={notice}
              onNotice={onNotice}
            />
          )}
          {kept('staff') && (
            <div hidden={tab !== 'staff'}>
              <StaffTab session={session} event={event} active={tab === 'staff'} />
            </div>
          )}
          {kept('photos') && (
            <div hidden={tab !== 'photos'}>
              <PhotosTab session={session} event={event} onChanged={changed} />
            </div>
          )}
          {kept('settings') && (
            <div hidden={tab !== 'settings'}>
              <SettingsTab session={session} event={event} counts={counts} onDone={changed} />
            </div>
          )}
        </div>
      </section>
    </>
  );
}
