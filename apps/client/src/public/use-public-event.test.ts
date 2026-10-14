import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { REFRESH_MS, usePublicEvent, type PublicEvent } from './use-public-event';

// The live public availability hook (PD-81): polling only while visible, an immediate refresh on
// return, the last known state on failure, nothing left running after unmount.

const ID = 'AbCdEfGhIjKlMnOpQrStUv';

function eventWith(confirmed: number, phase = 'registration_open'): PublicEvent {
  return {
    title: 'Event',
    description: null,
    startsAt: '2030-01-01T10:00:00.000Z',
    timeZone: 'UTC',
    phase,
    availability: {
      registrationMode: confirmed < 2 ? 'seats_available' : 'waiting_list',
      capacity: 2,
      confirmedCount: confirmed,
      waitlistedCount: 0,
      estimatedAvailableSeats: 2 - confirmed,
    },
  };
}

const ok = (body: unknown) =>
  Promise.resolve(
    new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } }),
  );

let visibility: DocumentVisibilityState = 'visible';
let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.useFakeTimers();
  visibility = 'visible';
  vi.spyOn(document, 'visibilityState', 'get').mockImplementation(() => visibility);
  fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => {
  cleanup(); // unmount every hook, so no listener survives into the next test
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

const flush = () => act(async () => {});

describe('usePublicEvent (PD-81)', () => {
  it('refreshes on the interval while visible and makes no request from a hidden tab', async () => {
    fetchMock.mockImplementation(() => ok(eventWith(0)));
    const { result } = renderHook(() => usePublicEvent(ID));
    await flush();
    expect(result.current.event?.availability.estimatedAvailableSeats).toBe(2);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]![0]).toBe(`/api/public/events/${ID}`);

    fetchMock.mockImplementation(() => ok(eventWith(1)));
    await act(async () => vi.advanceTimersByTime(REFRESH_MS));
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(result.current.event?.availability.estimatedAvailableSeats).toBe(1);

    visibility = 'hidden';
    await act(async () => vi.advanceTimersByTime(REFRESH_MS * 4));
    expect(fetchMock).toHaveBeenCalledTimes(2); // hidden: no requests

    visibility = 'visible';
    await act(async () => document.dispatchEvent(new Event('visibilitychange')));
    expect(fetchMock).toHaveBeenCalledTimes(3); // back: at once, without waiting for the timer
  });

  it('keeps the last known availability when a refresh fails, and recovers', async () => {
    fetchMock.mockImplementation(() => ok(eventWith(1)));
    const { result } = renderHook(() => usePublicEvent(ID));
    await flush();
    fetchMock.mockImplementation(() => Promise.reject(new TypeError('offline')));
    await act(async () => vi.advanceTimersByTime(REFRESH_MS));
    expect(result.current.stale).toBe(true);
    expect(result.current.event?.availability.confirmedCount).toBe(1); // last known, not cleared

    fetchMock.mockImplementation(() => ok(eventWith(2)));
    await act(async () => vi.advanceTimersByTime(REFRESH_MS));
    expect(result.current.stale).toBe(false);
    expect(result.current.event?.availability.registrationMode).toBe('waiting_list');
  });

  it('stops for a cancelled event and leaves no timer or listener after unmount', async () => {
    fetchMock.mockImplementation(() => ok(eventWith(0, 'cancelled')));
    const { unmount } = renderHook(() => usePublicEvent(ID));
    await flush();
    await act(async () => vi.advanceTimersByTime(REFRESH_MS * 3));
    expect(fetchMock).toHaveBeenCalledTimes(1); // nothing can change any more

    fetchMock.mockClear();
    unmount();
    expect(vi.getTimerCount()).toBe(0);
    document.dispatchEvent(new Event('visibilitychange'));
    window.dispatchEvent(new Event('focus'));
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
