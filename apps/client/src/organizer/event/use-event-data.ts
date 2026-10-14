import { useCallback, useEffect, useState } from 'react';
import { useLiveCount } from '../../checkin/use-live-count';
import { ApiError, api } from '../../shared/api';
import type { Counts, EventItem, Participant } from '../types';
import { useAutoRefresh, type AutoRefresh } from '../use-auto-refresh';

/** K-723: the participant list comes in pages (up to 1,000 each); every page is loaded. */
export async function allParticipants(eventId: string, signal: AbortSignal): Promise<Participant[]> {
  const items: Participant[] = [];
  let cursor: string | null = null;
  do {
    const query: string = cursor ? `?cursor=${encodeURIComponent(cursor)}` : '';
    const page: { items: Participant[]; nextCursor: string | null } = await api(
      `/api/events/${eventId}/participants${query}`,
      { signal },
    );
    items.push(...page.items);
    cursor = page.nextCursor;
  } while (cursor);
  return items;
}

/**
 * One event's own data (never mixed with other events): details, its dashboard counts, its
 * participants, and the live checked-in count (SSE, unchanged). K-704: refreshed in place by the
 * Refresh button, after every change, when the live count changes, and every 15 s while the page is
 * visible. A poll skips the participant list unless the section shows it; a manual refresh loads all.
 * The last data stays on screen while a refresh runs and after one fails.
 */
export function useEventData(eventId: string, participantsShown: boolean) {
  const [event, setEvent] = useState<EventItem>();
  const [counts, setCounts] = useState<Counts>();
  const [participants, setParticipants] = useState<Participant[]>();
  const [notFound, setNotFound] = useState(false);
  const live = useLiveCount(eventId);

  const load = useCallback(
    async (signal: AbortSignal, reason: 'manual' | 'poll') => {
      const withParticipants = reason === 'manual' || participantsShown;
      try {
        const [e, d, p] = await Promise.all([
          api<EventItem>(`/api/events/${eventId}`, { signal }),
          api<{ counts: Counts }>(`/api/events/${eventId}/dashboard`, { signal }),
          withParticipants ? allParticipants(eventId, signal) : Promise.resolve(null),
        ]);
        setEvent(e);
        setCounts(d.counts);
        if (p) setParticipants(p);
      } catch (err) {
        if (err instanceof ApiError && err.status === 404) {
          setNotFound(true);
          return;
        }
        throw err;
      }
    },
    [eventId, participantsShown],
  );
  const refresher: AutoRefresh = useAutoRefresh(load, !notFound);
  const reload = refresher.refresh;

  // On opening, and when the section changes (a section showing participants loads them at once).
  useEffect(() => {
    reload();
  }, [reload, participantsShown]);
  useEffect(() => {
    if (live.count !== null) reload();
  }, [live.count, reload]);

  const error = notFound ? 'Event not found.' : event ? undefined : refresher.error;
  return { event, counts, participants, error, live, reload, refresher };
}
