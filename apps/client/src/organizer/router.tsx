import { useEffect, useState, type AnchorHTMLAttributes } from 'react';

// Path-based routing for the organizer entry (no hash routing; URLs from UI_INVENTORY §3 keep working).

/** The view a path shows: a page, or one event (all sections of an event are the same view). */
function viewOf(path: string): string {
  const route = parseRoute(path);
  return route.page === 'event' ? `event:${route.eventId}` : route.page;
}

/**
 * Client-side navigation (K-706). A new view (another page or another event) starts at the top; moving
 * between sections of the same event keeps the scroll position, so the workspace and its tabs stay
 * where they were. Back and forward use the browser's own scroll restoration.
 */
export function navigate(path: string) {
  const newView = viewOf(window.location.pathname) !== viewOf(path);
  window.history.pushState(null, '', path);
  window.dispatchEvent(new PopStateEvent('popstate'));
  if (newView) window.scrollTo({ top: 0 });
}

export function useLocationPath(): { path: string; search: string } {
  const read = () => ({ path: window.location.pathname, search: window.location.search });
  const [location, setLocation] = useState(read);
  useEffect(() => {
    const onPop = () => setLocation(read());
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);
  return location;
}

/** A real link (open in new tab works); a plain click navigates without a page load. */
export function Link({ to, onClick, ...props }: AnchorHTMLAttributes<HTMLAnchorElement> & { to: string }) {
  return (
    <a
      href={to}
      {...props}
      onClick={(e) => {
        onClick?.(e);
        if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
        e.preventDefault();
        navigate(to);
      }}
    />
  );
}

export const EVENT_TABS = [
  'participants',
  'waiting-list',
  'check-in',
  'staff',
  'photos',
  'settings',
] as const;
export type EventTab = 'overview' | (typeof EVENT_TABS)[number];

export type Route =
  | { page: 'overview' }
  | { page: 'events' }
  | { page: 'create' }
  | { page: 'event'; eventId: string; tab: EventTab }
  | { page: 'not-found' };

const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';

export function parseRoute(path: string): Route {
  if (path === '/' || path === '/organizer' || path === '/organizer/') return { page: 'overview' };
  if (path === '/organizer/events') return { page: 'events' };
  if (path === '/organizer/events/new') return { page: 'create' };
  const match = new RegExp(`^/organizer/events/(${UUID})(?:/([a-z-]+))?$`).exec(path);
  if (match) {
    const tab = match[2];
    if (!tab) return { page: 'event', eventId: match[1]!, tab: 'overview' };
    if ((EVENT_TABS as readonly string[]).includes(tab))
      return { page: 'event', eventId: match[1]!, tab: tab as EventTab };
  }
  return { page: 'not-found' };
}

export const eventPath = (eventId: string, tab: EventTab = 'overview') =>
  tab === 'overview' ? `/organizer/events/${eventId}` : `/organizer/events/${eventId}/${tab}`;
