import { useCallback, useEffect, useState } from 'react';
import { useLiveCount } from '../../checkin/use-live-count';
import { ApiError, api, errorMessage } from '../../shared/api';
import type { Counts, EventItem, Participant } from '../types';

/**
 * One event's own data (never mixed with other events): details, its dashboard counts, its
 * participants, and the live checked-in count. Confirmed and waiting counts are refreshed whenever
 * the live count changes, as before the redesign.
 */
export function useEventData(eventId: string) {
  const [event, setEvent] = useState<EventItem>();
  const [counts, setCounts] = useState<Counts>();
  const [participants, setParticipants] = useState<Participant[]>();
  const [error, setError] = useState<string>();
  const live = useLiveCount(eventId);

  const load = useCallback(() => {
    Promise.all([
      api<EventItem>(`/api/events/${eventId}`),
      api<{ counts: Counts }>(`/api/events/${eventId}/dashboard`),
      api<{ items: Participant[] }>(`/api/events/${eventId}/participants`),
    ])
      .then(([e, d, p]) => {
        setEvent(e);
        setCounts(d.counts);
        setParticipants(p.items);
        setError(undefined);
      })
      .catch((e: unknown) =>
        setError(e instanceof ApiError && e.status === 404 ? 'Event not found.' : errorMessage(e)),
      );
  }, [eventId]);

  useEffect(load, [load]);
  useEffect(() => {
    if (live.count !== null) load();
  }, [live.count, load]);

  return { event, counts, participants, error, live, reload: load };
}
