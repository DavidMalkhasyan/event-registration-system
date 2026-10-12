import type { EventItem } from '../types';

// Real event states only (PD-66): the phase computed by the server from status and start time.

export const PHASE: Record<string, { label: string; tone: string }> = {
  registration_open: { label: 'Registration open', tone: 'open' },
  registration_closed: { label: 'Registration closed', tone: 'closed' },
  started: { label: 'Started', tone: 'started' },
  cancelled: { label: 'Cancelled', tone: 'cancelled' },
};

export const phaseOf = (e: Pick<EventItem, 'phase'>) => PHASE[e.phase] ?? { label: e.phase, tone: 'neutral' };

export const isUpcoming = (e: Pick<EventItem, 'phase'>) =>
  e.phase === 'registration_open' || e.phase === 'registration_closed';
export const isPast = (e: Pick<EventItem, 'phase'>) => e.phase === 'started';
export const isCancelled = (e: Pick<EventItem, 'phase'>) => e.phase === 'cancelled';

export type EventFilter = 'all' | 'upcoming' | 'past' | 'cancelled';

export const FILTER_LABEL: Record<EventFilter, string> = {
  all: 'All events',
  upcoming: 'Upcoming',
  past: 'Past',
  cancelled: 'Cancelled',
};

export function matchesFilter(e: Pick<EventItem, 'phase'>, filter: EventFilter) {
  if (filter === 'upcoming') return isUpcoming(e);
  if (filter === 'past') return isPast(e);
  if (filter === 'cancelled') return isCancelled(e);
  return true;
}

export const fillPercent = (confirmed: number, capacity: number) =>
  capacity > 0 ? Math.min(100, Math.round((confirmed / capacity) * 100)) : 0;
