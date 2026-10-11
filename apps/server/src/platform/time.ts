import { DateTime, IANAZone } from 'luxon';

// FR-EVT-2, FR-EVT-3, NFR-TIME-1: local input → UTC instant, with DST validation.

export const HOUR_MS = 3_600_000;
export const CUTOFF_MS = 2 * HOUR_MS;
export const CHECK_IN_OPENS_BEFORE_MS = 2 * HOUR_MS;
export const CHECK_IN_CLOSES_AFTER_MS = 12 * HOUR_MS;

export function isValidTimeZone(zone: string): boolean {
  return IANAZone.isValidZone(zone);
}

export type LocalStartResult =
  | { kind: 'ok'; instant: Date }
  | { kind: 'nonexistent' }
  | { kind: 'ambiguous'; offsets: string[] };

function formatOffset(minutes: number): string {
  const sign = minutes < 0 ? '-' : '+';
  const abs = Math.abs(minutes);
  return `${sign}${String(Math.floor(abs / 60)).padStart(2, '0')}:${String(abs % 60).padStart(2, '0')}`;
}

/** Resolves "YYYY-MM-DDTHH:mm" in an IANA zone. An ambiguous time needs utcOffset (±HH:MM). */
export function resolveLocalStart(localStart: string, zone: string, utcOffset?: string): LocalStartResult {
  const asUtc = DateTime.fromISO(`${localStart}:00`, { zone: 'UTC' });
  if (!asUtc.isValid) return { kind: 'nonexistent' };
  const target = asUtc.toFormat("yyyy-MM-dd'T'HH:mm");
  // Candidate offsets: every offset the zone uses within a day of the local time.
  const offsets = new Set<number>();
  for (const hours of [-26, -13, 0, 13, 26]) {
    offsets.add(DateTime.fromMillis(asUtc.toMillis() + hours * HOUR_MS, { zone }).offset);
  }
  const matches: { offset: number; instant: Date }[] = [];
  for (const offset of offsets) {
    const millis = asUtc.toMillis() - offset * 60_000;
    const local = DateTime.fromMillis(millis, { zone });
    if (local.offset === offset && local.toFormat("yyyy-MM-dd'T'HH:mm") === target) {
      matches.push({ offset, instant: new Date(millis) });
    }
  }
  if (matches.length === 0) return { kind: 'nonexistent' };
  if (matches.length === 1) return { kind: 'ok', instant: matches[0]!.instant };
  const chosen = utcOffset ? matches.find((m) => formatOffset(m.offset) === utcOffset) : undefined;
  if (chosen) return { kind: 'ok', instant: chosen.instant };
  return { kind: 'ambiguous', offsets: matches.map((m) => formatOffset(m.offset)).sort() };
}

export function cutoffOf(startsAt: Date): Date {
  return new Date(startsAt.getTime() - CUTOFF_MS);
}

export function checkInWindow(startsAt: Date): { opens: Date; closes: Date } {
  return {
    opens: new Date(startsAt.getTime() - CHECK_IN_OPENS_BEFORE_MS),
    closes: new Date(startsAt.getTime() + CHECK_IN_CLOSES_AFTER_MS),
  };
}

export type EventPhase = 'registration_open' | 'registration_closed' | 'started' | 'cancelled';

export function eventPhase(status: string, startsAt: Date, now: Date): EventPhase {
  if (status === 'CANCELLED') return 'cancelled';
  if (now.getTime() >= startsAt.getTime()) return 'started';
  if (now.getTime() >= cutoffOf(startsAt).getTime()) return 'registration_closed';
  return 'registration_open';
}
