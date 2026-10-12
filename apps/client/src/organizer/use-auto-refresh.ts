import { useCallback, useEffect, useRef, useState } from 'react';
import { errorMessage } from '../shared/api';

// Organizer data refresh (K-704, PD-84). The caller's `load` fetches and applies one view's data; this
// hook decides when it runs: on refresh() (initial load, the Refresh button, after a change), every
// REFRESH_MS while `poll` is on and the page is visible, and at once when the page becomes visible
// again or regains focus (at most every FOCUS_GAP_MS). Hidden tabs make no requests.
//
// One request at a time: a refresh asked for while one runs is run once afterwards, so a change is
// never missed and responses are applied in the order they were asked for. The data on screen stays as
// it is while a refresh runs and after one fails. Unmounting aborts the request and stops everything.

export const REFRESH_MS = 15_000;
export const FOCUS_GAP_MS = 3_000;

export type Load = (signal: AbortSignal, reason: 'manual' | 'poll') => Promise<void>;

export interface AutoRefresh {
  refresh: () => void;
  /** A manual refresh is running (polls run silently). */
  refreshing: boolean;
  /** The last refresh failed: the message; the previous data is still shown. */
  error?: string;
  updatedAt?: Date;
}

export function useAutoRefresh(load: Load, poll: boolean): AutoRefresh {
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string>();
  const [updatedAt, setUpdatedAt] = useState<Date>();
  const loadRef = useRef(load);
  useEffect(() => {
    loadRef.current = load;
  });
  const run = useRef({ disposed: false, inFlight: false, again: null as null | 'manual' | 'poll', last: 0 });
  const controller = useRef<AbortController | null>(null);

  const start = useCallback((first: 'manual' | 'poll') => {
    const state = run.current;
    function begin(reason: 'manual' | 'poll') {
      if (state.disposed) return;
      if (state.inFlight) {
        // Keep the stronger reason: a manual refresh also loads what a poll may skip.
        state.again = state.again === 'manual' || reason === 'manual' ? 'manual' : 'poll';
        return;
      }
      state.inFlight = true;
      state.last = Date.now();
      const abort = new AbortController();
      controller.current = abort;
      if (reason === 'manual') setRefreshing(true); // polls stay silent
      loadRef
        .current(abort.signal, reason)
        .then(() => {
          if (state.disposed) return;
          setError(undefined);
          setUpdatedAt(new Date());
        })
        .catch((e: unknown) => {
          if (!state.disposed && !abort.signal.aborted) setError(errorMessage(e));
        })
        .finally(() => {
          state.inFlight = false;
          if (state.disposed) return;
          setRefreshing(false);
          const next = state.again;
          state.again = null;
          if (next) begin(next);
        });
    }
    begin(first);
  }, []);

  useEffect(() => {
    const state = run.current;
    state.disposed = false;
    return () => {
      state.disposed = true;
      controller.current?.abort();
    };
  }, []);

  useEffect(() => {
    if (!poll) return;
    const timer = setInterval(() => {
      if (document.visibilityState === 'visible') start('poll');
    }, REFRESH_MS);
    const wake = () => {
      if (document.visibilityState === 'visible' && Date.now() - run.current.last >= FOCUS_GAP_MS)
        start('poll');
    };
    document.addEventListener('visibilitychange', wake);
    window.addEventListener('focus', wake);
    return () => {
      clearInterval(timer);
      document.removeEventListener('visibilitychange', wake);
      window.removeEventListener('focus', wake);
    };
  }, [poll, start]);

  const refresh = useCallback(() => start('manual'), [start]);
  return { refresh, refreshing, error, updatedAt };
}
