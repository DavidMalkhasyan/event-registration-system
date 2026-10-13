import { useCallback, useEffect, useRef, useState } from 'react';
import { ApiError, api, errorMessage } from '../shared/api';
import type { EventSummary } from './shell';
import type { EventImage } from '../shared/images';

// Live public availability (PD-81): the public event is re-read every REFRESH_MS while the page is
// visible, and at once when it becomes visible again or regains focus. Hidden tabs make no requests.
// A failed refresh keeps the last known state; the server stays authoritative for every decision.

export const REFRESH_MS = 15_000;
const MIN_GAP_MS = 2_000; // focus and visibility events often arrive together

export type RegistrationMode = 'seats_available' | 'waiting_list' | 'closed';

export interface PublicAvailability {
  registrationMode: RegistrationMode;
  capacity: number | null;
  confirmedCount: number | null;
  waitlistedCount: number | null;
  estimatedAvailableSeats: number | null;
}

export type PublicEvent = EventSummary & {
  description: string | null;
  /** K-713: the published cover and gallery. */
  images?: { cover: EventImage | null; gallery: EventImage[] };
  phase: string;
  availability: PublicAvailability;
};

export interface PublicEventState {
  event?: PublicEvent;
  /** The first load failed; nothing to show. */
  loadError?: string;
  /** The last refresh failed; `event` is the last known state. */
  stale: boolean;
  /** The event no longer exists (deleted after the page was opened). */
  gone: boolean;
  refresh: () => void;
}

const TERMINAL = new Set(['cancelled', 'started']);

export function usePublicEvent(publicId: string): PublicEventState {
  const [event, setEvent] = useState<PublicEvent>();
  const [loadError, setLoadError] = useState<string>();
  const [stale, setStale] = useState(false);
  const [gone, setGone] = useState(false);
  const live = useRef({ disposed: false, inFlight: false, last: 0, done: false });

  const refresh = useCallback(() => {
    const state = live.current;
    if (state.disposed || state.inFlight || state.done) return;
    state.inFlight = true;
    state.last = Date.now();
    api<PublicEvent>(`/api/public/events/${publicId}`)
      .then((next) => {
        if (state.disposed) return;
        setEvent(next);
        setStale(false);
        if (TERMINAL.has(next.phase)) state.done = true; // nothing can change any more
      })
      .catch((e: unknown) => {
        if (state.disposed) return;
        if (e instanceof ApiError && e.status === 404) {
          state.done = true;
          setGone(true);
          setLoadError('Event not found.');
          return;
        }
        setStale(true);
        setLoadError(errorMessage(e));
      })
      .finally(() => {
        state.inFlight = false;
      });
  }, [publicId]);

  useEffect(() => {
    const state = live.current;
    state.disposed = false;
    state.done = false;
    refresh();
    const timer = setInterval(() => {
      if (document.visibilityState === 'visible') refresh();
    }, REFRESH_MS);
    const wake = () => {
      if (document.visibilityState === 'visible' && Date.now() - state.last >= MIN_GAP_MS) refresh();
    };
    document.addEventListener('visibilitychange', wake);
    window.addEventListener('focus', wake);
    return () => {
      state.disposed = true;
      clearInterval(timer);
      document.removeEventListener('visibilitychange', wake);
      window.removeEventListener('focus', wake);
    };
  }, [refresh]);

  return { event, loadError, stale, gone, refresh };
}
