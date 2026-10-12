// The event's start as the organizer edits it: a datetime-local value ("YYYY-MM-DDTHH:mm") on the
// event's own IANA time zone, never the browser's (API-D5). The server stays authoritative: it resolves
// the local time in that zone and rejects nonexistent or ambiguous daylight-saving times (422).

function zonedParts(iso: string, timeZone: string): Record<string, string> {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(new Date(iso));
  return Object.fromEntries(parts.map((p) => [p.type, p.value]));
}

/** The instant `iso` as a datetime-local value in `timeZone`. */
export function toZonedLocalInput(iso: string, timeZone: string): string {
  const p = zonedParts(iso, timeZone);
  return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}`;
}

/** The UTC offset `timeZone` has at the instant `iso`, as "+02:00" (the format the API uses). */
export function zonedOffset(iso: string, timeZone: string): string {
  const p = zonedParts(iso, timeZone);
  const wall = Date.UTC(+p.year!, +p.month! - 1, +p.day!, +p.hour!, +p.minute!, +p.second!);
  const instant = Math.floor(new Date(iso).getTime() / 1000) * 1000;
  const minutes = Math.round((wall - instant) / 60_000);
  const sign = minutes < 0 ? '-' : '+';
  const abs = Math.abs(minutes);
  return `${sign}${String(Math.floor(abs / 60)).padStart(2, '0')}:${String(abs % 60).padStart(2, '0')}`;
}

/** A readable form of a datetime-local value, for the confirmation dialog ("Sunday 25 October 2026, 02:30"). */
export function describeLocalInput(value: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(value);
  if (!match) return value;
  const [, y, mo, d, h, mi] = match;
  // Formatted in UTC on purpose: the value is a wall-clock time, not an instant.
  const date = new Date(Date.UTC(+y!, +mo! - 1, +d!, +h!, +mi!));
  const p = Object.fromEntries(
    new Intl.DateTimeFormat('en-GB', {
      timeZone: 'UTC',
      weekday: 'long',
      day: 'numeric',
      month: 'long',
      year: 'numeric',
    })
      .formatToParts(date)
      .map((part) => [part.type, part.value]),
  );
  return `${p.weekday} ${p.day} ${p.month} ${p.year}, ${h}:${mi}`;
}
