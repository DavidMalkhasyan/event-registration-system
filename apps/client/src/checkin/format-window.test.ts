import { describe, expect, it } from 'vitest';
import { formatWindow } from './CheckInPanel';

// K-715: the check-in window is shown once per day it spans, in the event's time zone.
describe('formatWindow', () => {
  it('names the day once when the window opens and closes on the same day', () => {
    expect(formatWindow('2026-10-13T06:47:00Z', '2026-10-13T20:47:00Z', 'Europe/Berlin')).toBe(
      'Tuesday, 13 October 2026, 08:47–22:47 (Europe/Berlin)',
    );
  });

  it('keeps both dates when the window crosses midnight in the event’s zone', () => {
    expect(formatWindow('2026-10-13T20:00:00Z', '2026-10-14T10:00:00Z', 'Europe/Berlin')).toBe(
      'Tuesday, 13 October 2026 at 22:00 (Europe/Berlin) to Wednesday, 14 October 2026 at 12:00 (Europe/Berlin)',
    );
  });
});
