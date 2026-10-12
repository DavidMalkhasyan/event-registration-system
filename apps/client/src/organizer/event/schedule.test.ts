import { describe, expect, it } from 'vitest';
import { describeLocalInput, toZonedLocalInput, zonedOffset } from './schedule';

// The reschedule form shows the event's start in the event's own time zone (K-702), whatever the
// browser's zone is. The test runner's zone is not the event's in any of these cases.

describe('event start as a datetime-local value in the event time zone (K-702)', () => {
  it('converts UTC into the event zone, not the browser zone', () => {
    expect(toZonedLocalInput('2026-11-20T17:30:00.000Z', 'Asia/Yerevan')).toBe('2026-11-20T21:30');
    expect(toZonedLocalInput('2026-11-20T17:30:00.000Z', 'America/New_York')).toBe('2026-11-20T12:30');
    expect(toZonedLocalInput('2026-11-20T17:30:00.000Z', 'UTC')).toBe('2026-11-20T17:30');
    // Across the date line, the local day differs from the UTC day.
    expect(toZonedLocalInput('2026-11-20T17:30:00.000Z', 'Pacific/Auckland')).toBe('2026-11-21T06:30');
  });

  it('uses 00 for midnight and keeps half-hour zones', () => {
    expect(toZonedLocalInput('2026-11-20T23:00:00.000Z', 'Europe/Berlin')).toBe('2026-11-21T00:00');
    expect(toZonedLocalInput('2026-11-20T12:00:00.000Z', 'Asia/Kolkata')).toBe('2026-11-20T17:30');
  });

  it('shows both instants of a repeated daylight-saving hour as the same wall time, with their offsets', () => {
    // Europe/Berlin falls back at 03:00 CEST on 25 October 2026: 02:30 happens twice.
    const first = '2026-10-25T00:30:00.000Z'; // 02:30 +02:00
    const second = '2026-10-25T01:30:00.000Z'; // 02:30 +01:00
    expect(toZonedLocalInput(first, 'Europe/Berlin')).toBe('2026-10-25T02:30');
    expect(toZonedLocalInput(second, 'Europe/Berlin')).toBe('2026-10-25T02:30');
    expect(zonedOffset(first, 'Europe/Berlin')).toBe('+02:00');
    expect(zonedOffset(second, 'Europe/Berlin')).toBe('+01:00');
  });

  it('formats offsets west of UTC and fractional offsets', () => {
    expect(zonedOffset('2026-07-01T12:00:00.000Z', 'America/New_York')).toBe('-04:00');
    expect(zonedOffset('2026-07-01T12:00:00.000Z', 'Asia/Kathmandu')).toBe('+05:45');
  });

  it('describes a wall-clock value without converting it', () => {
    expect(describeLocalInput('2026-10-25T02:30')).toBe('Sunday 25 October 2026, 02:30');
    expect(describeLocalInput('not a date')).toBe('not a date');
  });
});
