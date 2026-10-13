import { useCallback, useEffect, useState } from 'react';
import { api } from '../shared/api';
import { Empty, PageSkeleton, buttonClass } from '../shared/ui';
import {
  ForgotPassword,
  OrganizationStatus,
  PasswordSignIn,
  JoinAccount,
  RegisterOrganization,
  SignInLinkRequest,
} from './auth/AuthPages';
import { Invitations } from './organization/Invitations';
import { OrganizationPage } from './organization/OrganizationPage';
import { Overview } from './dashboard/Overview';
import { EventWorkspace } from './event/EventWorkspace';
import { CreateEvent } from './events/CreateEvent';
import { EventsList } from './events/EventsList';
import { Link, parseRoute, useLocationPath } from './router';
import { AppShell } from './shell/AppShell';
import type { EventListItem, Session } from './types';
import { useAutoRefresh } from './use-auto-refresh';

/** The organizer area: one signed-in organizer and all of their events. */
export function App() {
  const { path, search } = useLocationPath();
  const [session, setSession] = useState<Session | null | undefined>();
  const [events, setEvents] = useState<EventListItem[]>();

  useEffect(() => {
    api<Session>('/api/auth/session')
      .then(setSession)
      .catch(() => setSession(null));
  }, []);
  // K-704: the list (sidebar, overview, All events) reloads on every navigation and after a change,
  // and polls while the overview or All events is shown; another page refreshes its own data.
  const route = parseRoute(path);
  const listView = route.page === 'overview' || route.page === 'events';
  const loadEvents = useCallback(async (signal: AbortSignal) => {
    const r = await api<{ items: EventListItem[] }>('/api/events', { signal });
    setEvents(r.items);
  }, []);
  const eventsRefresh = useAutoRefresh(loadEvents, !!session && listView);
  const reloadEvents = eventsRefresh.refresh;
  useEffect(() => {
    if (session) reloadEvents();
  }, [session, path, reloadEvents]);
  const eventsError = events ? undefined : eventsRefresh.error;

  if (session === undefined)
    return (
      <div className="main-content">
        <PageSkeleton />
      </div>
    );
  if (session === null) {
    // K-709: organizer accounts sign in with a password; registration and resets are public pages.
    if (path === '/organizer/register') return <RegisterOrganization />;
    if (path === '/organizer/forgot-password') return <ForgotPassword />;
    if (path === '/organizer/sign-in-link') return <SignInLinkRequest />;
    if (path === '/organizer/join') return <JoinAccount />;
    return <PasswordSignIn />;
  }
  if (!session.organizations.some((o) => o.status === 'active'))
    return (
      <OrganizationStatus
        session={session}
        onSignOut={() =>
          void api('/api/auth/sign-out', { method: 'POST', csrf: session.csrfToken })
            .catch(() => undefined)
            .then(() => window.location.assign('/organizer'))
        }
      />
    );

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
          onChanged={reloadEvents}
        />
      </AppShell>
    );
  }
  if (route.page === 'events')
    return (
      <AppShell session={session} events={events} active="events" crumbs={[{ label: 'All events' }]}>
        <EventsList events={events} error={eventsError} refresh={eventsRefresh} />
      </AppShell>
    );
  if (route.page === 'organization')
    return (
      <AppShell session={session} events={events} active="organization" crumbs={[{ label: 'Organization' }]}>
        <Invitations session={session} />
        <OrganizationPage session={session} />
      </AppShell>
    );
  if (route.page === 'create')
    return (
      <AppShell session={session} events={events} active="create" crumbs={[{ label: 'Create event' }]}>
        <CreateEvent session={session} onCreated={reloadEvents} />
      </AppShell>
    );
  if (route.page === 'overview')
    return (
      <AppShell session={session} events={events} active="overview" crumbs={[{ label: 'Overview' }]}>
        <Invitations session={session} />
        <Overview
          events={events}
          error={eventsError}
          refresh={eventsRefresh}
          deleted={new URLSearchParams(search).has('deleted')}
        />
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
