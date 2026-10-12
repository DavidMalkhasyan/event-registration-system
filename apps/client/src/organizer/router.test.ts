import { describe, expect, it } from 'vitest';
import { fillPercent, matchesFilter } from './events/event-status';
import { eventPath, parseRoute } from './router';

const ID = '0192f0c4-7a1b-7c3d-9e8f-0123456789ab';

describe('organizer routes (K-507)', () => {
  it('keeps the existing URLs and adds the workspace sections as paths', () => {
    expect(parseRoute('/')).toEqual({ page: 'overview' });
    expect(parseRoute('/organizer')).toEqual({ page: 'overview' });
    expect(parseRoute('/organizer/events')).toEqual({ page: 'events' });
    expect(parseRoute('/organizer/events/new')).toEqual({ page: 'create' });
    expect(parseRoute(`/organizer/events/${ID}`)).toEqual({ page: 'event', eventId: ID, tab: 'overview' });
    // The pre-redesign check-in URL still opens the check-in screen.
    expect(parseRoute(`/organizer/events/${ID}/check-in`)).toEqual({
      page: 'event',
      eventId: ID,
      tab: 'check-in',
    });
    expect(parseRoute(`/organizer/events/${ID}/settings`)).toEqual({
      page: 'event',
      eventId: ID,
      tab: 'settings',
    });
  });

  it('rejects unknown sections and malformed IDs instead of guessing', () => {
    expect(parseRoute(`/organizer/events/${ID}/delete`)).toEqual({ page: 'not-found' });
    expect(parseRoute('/organizer/events/not-an-id')).toEqual({ page: 'not-found' });
    expect(parseRoute('/organizer/../admin')).toEqual({ page: 'not-found' });
  });

  it('builds section paths that the re-authentication return check accepts (organizer paths only)', () => {
    expect(eventPath(ID)).toBe(`/organizer/events/${ID}`);
    expect(eventPath(ID, 'waiting-list')).toBe(`/organizer/events/${ID}/waiting-list`);
    expect(eventPath(ID, 'settings')).toMatch(/^\/organizer(\/[A-Za-z0-9_-]+)*$/);
  });
});

describe('event filters use real phases only (PD-66)', () => {
  it('maps upcoming, past and cancelled', () => {
    expect(matchesFilter({ phase: 'registration_open' }, 'upcoming')).toBe(true);
    expect(matchesFilter({ phase: 'registration_closed' }, 'upcoming')).toBe(true);
    expect(matchesFilter({ phase: 'started' }, 'upcoming')).toBe(false);
    expect(matchesFilter({ phase: 'started' }, 'past')).toBe(true);
    expect(matchesFilter({ phase: 'cancelled' }, 'cancelled')).toBe(true);
    expect(matchesFilter({ phase: 'cancelled' }, 'upcoming')).toBe(false);
    expect(matchesFilter({ phase: 'cancelled' }, 'all')).toBe(true);
  });

  it('caps the fill percentage and handles zero capacity', () => {
    expect(fillPercent(3, 3)).toBe(100);
    expect(fillPercent(1, 3)).toBe(33);
    expect(fillPercent(5, 0)).toBe(0);
  });
});
