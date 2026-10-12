import { useCallback, useEffect, useState } from 'react';
import { api, errorMessage } from '../shared/api';
import { Empty, PageSkeleton, buttonClass } from '../shared/ui';
import { SignInRequest } from './auth/SignInRequest';
import { Overview } from './dashboard/Overview';
import { EventWorkspace } from './event/EventWorkspace';
import { CreateEvent } from './events/CreateEvent';
import { EventsList } from './events/EventsList';
import { Link, parseRoute, useLocationPath } from './router';
import { AppShell } from './shell/AppShell';
import type { EventListItem, Session } from './types';

/** The organizer area: one signed-in organizer and all of their events. */
export function App() {
  const { path, search } = useLocationPath();
  const [session, setSession] = useState<Session | null | undefined>();
  const [events, setEvents] = useState<EventListItem[]>();
  const [eventsError, setEventsError] = useState<string>();

  useEffect(() => {
    api<Session>('/api/auth/session')
      .then(setSession)
      .catch(() => setSession(null));
  }, []);
  const loadEvents = useCallback(() => {
    api<{ items: EventListItem[] }>('/api/events')
      .then((r) => {
        setEvents(r.items);
        setEventsError(undefined);
      })
      .catch((e: unknown) => setEventsError(errorMessage(e)));
  }, []);
  // Reloaded on every navigation, so global figures are never stale (participants register elsewhere).
  useEffect(() => {
    if (session) loadEvents();
  }, [session, path, loadEvents]);

  if (session === undefined)
    return (
      <div className="main-content">
        <PageSkeleton />
      </div>
    );
  if (session === null) return <SignInRequest />;

  const route = parseRoute(path);
  if (route.page === 'event') {
    const title = events?.find((e) => e.id === route.eventId)?.title ?? 'Event';
    return (
      <AppShell
        session={session}
        events={events}
        active="events"
        activeEventId={route.eventId}
        crumbs={[{ label: 'All events', to: '/organizer/events' }, { label: title }]}
      >
        <EventWorkspace
          key={route.eventId}
          session={session}
          eventId={route.eventId}
          tab={route.tab}
          onChanged={loadEvents}
        />
      </AppShell>
    );
  }
  if (route.page === 'events')
    return (
      <AppShell session={session} events={events} active="events" crumbs={[{ label: 'All events' }]}>
        <EventsList events={events} error={eventsError} />
      </AppShell>
    );
  if (route.page === 'create')
    return (
      <AppShell session={session} events={events} active="create" crumbs={[{ label: 'Create event' }]}>
        <CreateEvent session={session} onCreated={loadEvents} />
      </AppShell>
    );
  if (route.page === 'overview')
    return (
      <AppShell session={session} events={events} active="overview" crumbs={[{ label: 'Overview' }]}>
        <Overview events={events} error={eventsError} deleted={new URLSearchParams(search).has('deleted')} />
      </AppShell>
    );
  return (
    <AppShell session={session} events={events} active="overview" crumbs={[{ label: 'Not found' }]}>
      <div className="panel">
        <Empty
          title="This page doesn’t exist."
          text="The address may be mistyped, or the event was deleted."
        />
        <div className="empty-state empty-actions">
          <Link to="/organizer" className={buttonClass('outline')}>
            Back to overview
          </Link>
        </div>
      </div>
    </AppShell>
  );
}
