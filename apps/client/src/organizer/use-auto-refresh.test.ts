import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FOCUS_GAP_MS, REFRESH_MS, useAutoRefresh, type Load } from './use-auto-refresh';

// K-704 (PD-84): the organizer refresh scheduler.

let visibility: DocumentVisibilityState = 'visible';

beforeEach(() => {
  vi.useFakeTimers();
  visibility = 'visible';
  vi.spyOn(document, 'visibilityState', 'get').mockImplementation(() => visibility);
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

/** A load whose calls resolve when the test says so. */
function controlledLoad() {
  const calls: { reason: string; signal: AbortSignal; resolve: () => void; reject: (e: unknown) => void }[] =
    [];
  const load: Load = (signal, reason) =>
    new Promise<void>((resolve, reject) => calls.push({ reason, signal, resolve, reject }));
  return { load, calls };
}

const settle = () => act(async () => {});

describe('useAutoRefresh (K-704)', () => {
  it('polls while visible, never while hidden, and refreshes at once on return, throttled', async () => {
    const load = vi.fn<Load>(() => Promise.resolve());
    renderHook(() => useAutoRefresh(load, true));
    await act(async () => vi.advanceTimersByTime(REFRESH_MS));
    expect(load).toHaveBeenCalledTimes(1);
    expect(load.mock.calls[0]![1]).toBe('poll');

    visibility = 'hidden';
    await act(async () => vi.advanceTimersByTime(REFRESH_MS * 3));
    expect(load).toHaveBeenCalledTimes(1);

    visibility = 'visible';
    await act(async () => document.dispatchEvent(new Event('visibilitychange')));
    expect(load).toHaveBeenCalledTimes(2);
    await act(async () => window.dispatchEvent(new Event('focus'))); // within FOCUS_GAP_MS: ignored
    expect(load).toHaveBeenCalledTimes(2);
    await act(async () => vi.advanceTimersByTime(FOCUS_GAP_MS));
    await act(async () => window.dispatchEvent(new Event('focus')));
    expect(load).toHaveBeenCalledTimes(3);
  });

  it('does not poll an inactive view, but refreshes it on request', async () => {
    const load = vi.fn<Load>(() => Promise.resolve());
    const { result } = renderHook(() => useAutoRefresh(load, false));
    await act(async () => vi.advanceTimersByTime(REFRESH_MS * 3));
    expect(load).not.toHaveBeenCalled();
    await act(async () => result.current.refresh());
    expect(load).toHaveBeenCalledWith(expect.any(AbortSignal), 'manual');
  });

  it('runs one request at a time and repeats once for refreshes asked for meanwhile, in order', async () => {
    const { load, calls } = controlledLoad();
    const { result } = renderHook(() => useAutoRefresh(load, true));
    act(() => result.current.refresh());
    expect(result.current.refreshing).toBe(true);
    act(() => result.current.refresh());
    act(() => result.current.refresh());
    await act(async () => vi.advanceTimersByTime(REFRESH_MS)); // a poll while busy is merged too
    expect(calls).toHaveLength(1);
    await act(async () => calls[0]!.resolve());
    expect(calls).toHaveLength(2); // exactly one follow-up, as a manual refresh
    expect(calls[1]!.reason).toBe('manual');
    await act(async () => calls[1]!.resolve());
    expect(calls).toHaveLength(2);
    expect(result.current.refreshing).toBe(false);
    expect(result.current.updatedAt).toBeInstanceOf(Date);
  });

  it('reports a failed refresh without clearing anything, and clears the error on success', async () => {
    const { load, calls } = controlledLoad();
    const { result } = renderHook(() => useAutoRefresh(load, true));
    act(() => result.current.refresh());
    await act(async () => calls[0]!.reject(new TypeError('offline')));
    expect(result.current.error).toBe('Something went wrong. Please try again.');
    act(() => result.current.refresh());
    await act(async () => calls[1]!.resolve());
    expect(result.current.error).toBeUndefined();
  });

  it('aborts the request and stops polling when the view goes away', async () => {
    const { load, calls } = controlledLoad();
    const { result, unmount } = renderHook(() => useAutoRefresh(load, true));
    act(() => result.current.refresh());
    unmount();
    expect(calls[0]!.signal.aborted).toBe(true);
    await settle();
    expect(vi.getTimerCount()).toBe(0);
    document.dispatchEvent(new Event('visibilitychange'));
    window.dispatchEvent(new Event('focus'));
    expect(calls).toHaveLength(1);
  });
});
