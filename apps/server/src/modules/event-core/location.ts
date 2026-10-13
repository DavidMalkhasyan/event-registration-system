import { z } from 'zod';
import type { AppContext } from '../../composition/context.js';
import { AppError } from '../../platform/errors.js';
import { withEventLock } from '../../platform/tx.js';
import { recordAudit } from '../audit/audit.js';
import { enqueue } from '../messaging/outbox.js';
import { sessionStillValid, type OrganizerPrincipal } from '../identity/sessions.js';
import { assertEventAccess } from '../organizations/access.js';

// Event location (K-711, amendment A-5, PD-91). Optional; coordinates only as the organizer entered
// them, never derived or guessed. A change of a scheduled event's venue after people registered
// queues one notice per confirmed and waiting participant through the outbox, in the same
// transaction; whether each email was delivered is the outbox's business, never claimed here.

const text = (max: number) => z.string().trim().min(1).max(max);
const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .nullable()
    .optional()
    .transform((v) => (v ? v : null));

export const locationSchema = z
  .object({
    venueName: text(200),
    streetAddress: text(300),
    city: text(120),
    region: optionalText(120),
    postalCode: optionalText(20),
    country: z.string().trim().min(2).max(120),
    arrivalInstructions: optionalText(1000),
    latitude: z.number().min(-90).max(90).nullable().optional(),
    longitude: z.number().min(-180).max(180).nullable().optional(),
  })
  .strict()
  .refine((l) => (l.latitude == null) === (l.longitude == null), {
    message: 'Give both latitude and longitude, or neither',
    path: ['longitude'],
  });
export type LocationInput = z.infer<typeof locationSchema>;

export const LOCATION_COLUMNS = [
  'venue_name',
  'street_address',
  'city',
  'region',
  'postal_code',
  'country',
  'arrival_instructions',
  'latitude',
  'longitude',
  'location_version',
] as const;

export interface LocationRow {
  venue_name: string | null;
  street_address: string | null;
  city: string | null;
  region: string | null;
  postal_code: string | null;
  country: string | null;
  arrival_instructions: string | null;
  latitude: string | null;
  longitude: string | null;
  location_version: number;
}

export interface Location {
  venueName: string;
  streetAddress: string;
  city: string;
  region: string | null;
  postalCode: string | null;
  country: string;
  arrivalInstructions: string | null;
  coordinates: { latitude: number; longitude: number } | null;
}

/** The API shape of an event's location, or null when it has none. */
export function locationView(row: LocationRow): Location | null {
  if (!row.venue_name || !row.street_address || !row.city || !row.country) return null;
  return {
    venueName: row.venue_name,
    streetAddress: row.street_address,
    city: row.city,
    region: row.region,
    postalCode: row.postal_code,
    country: row.country,
    arrivalInstructions: row.arrival_instructions,
    coordinates:
      row.latitude !== null && row.longitude !== null
        ? { latitude: Number(row.latitude), longitude: Number(row.longitude) }
        : null,
  };
}

/** The address as one line, as emails and the directions link use it. */
export function addressLine(l: Location): string {
  return [l.streetAddress, [l.postalCode, l.city].filter(Boolean).join(' '), l.region, l.country]
    .filter(Boolean)
    .join(', ');
}

/** The column values for a location (or for none). */
export function locationColumns(input: LocationInput | null) {
  return {
    venue_name: input?.venueName ?? null,
    street_address: input?.streetAddress ?? null,
    city: input?.city ?? null,
    region: input?.region ?? null,
    postal_code: input?.postalCode ?? null,
    country: input?.country ?? null,
    arrival_instructions: input?.arrivalInstructions ?? null,
    latitude: input?.latitude == null ? null : input.latitude.toFixed(6),
    longitude: input?.longitude == null ? null : input.longitude.toFixed(6),
  };
}

// What participants are told about: where to go. A change of the coordinates alone (the same address)
// does not send a notice.
const NOTIFIED: (keyof Location)[] = [
  'venueName',
  'streetAddress',
  'city',
  'region',
  'postalCode',
  'country',
  'arrivalInstructions',
];

export const setLocationSchema = z
  .object({ location: locationSchema.nullable(), expectedLocationVersion: z.number().int().min(0) })
  .strict();

/**
 * PUT /api/events/:id/location. Under the exclusive event lock: the organizer's access, a scheduled
 * event that has not started, and the version the organizer saw (409 location_version_mismatch, so a
 * stale form never overwrites a newer venue). Returns how many participants were queued a notice.
 */
export async function setLocation(
  ctx: AppContext,
  principal: OrganizerPrincipal,
  eventId: string,
  input: z.infer<typeof setLocationSchema>,
  correlationId: string,
): Promise<{ location: Location | null; locationVersion: number; notified: number }> {
  if (!z.uuid().safeParse(eventId).success) throw new AppError(404, 'not_found');
  const result = await withEventLock(ctx.db, eventId, 'exclusive', async ({ trx, now, event }) => {
    await assertEventAccess(trx, principal.accountId, event);
    if (!(await sessionStillValid(trx, principal.sessionId, now))) throw new AppError(401, 'unauthenticated');
    if (event.status !== 'SCHEDULED') throw new AppError(409, 'event_not_scheduled');
    if (now >= event.starts_at) throw new AppError(409, 'event_started');
    const current = await trx
      .selectFrom('app.events')
      .select([...LOCATION_COLUMNS])
      .where('id', '=', eventId)
      .executeTakeFirstOrThrow();
    if (current.location_version !== input.expectedLocationVersion)
      throw new AppError(409, 'location_version_mismatch', { locationVersion: current.location_version });
    const before = locationView(current);
    const columns = locationColumns(input.location);
    const after = locationView({ ...columns, location_version: current.location_version });
    if (JSON.stringify(before) === JSON.stringify(after))
      return { location: before, locationVersion: current.location_version, notified: 0 };

    const version = current.location_version + 1;
    await trx
      .updateTable('app.events')
      .set({ ...columns, location_version: version, updated_at: now })
      .where('id', '=', eventId)
      .execute();
    const changedForParticipants = NOTIFIED.some(
      (k) => JSON.stringify(before?.[k] ?? null) !== JSON.stringify(after?.[k] ?? null),
    );
    let notified = 0;
    if (changedForParticipants) {
      const affected = await trx
        .selectFrom('app.registrations')
        .select(['id', 'email'])
        .where('event_id', '=', eventId)
        .where('state', 'in', ['CONFIRMED', 'WAITLISTED'])
        .orderBy('id')
        .execute();
      for (const reg of affected) {
        await enqueue(trx, {
          type: 'venue_change',
          logicalKey: `venue_change:${reg.id}:${version}`,
          recipientEmail: reg.email,
          now,
          eventId,
          registrationId: reg.id,
          payload: { locationVersion: version },
          correlationId,
        });
      }
      notified = affected.length;
    }
    await recordAudit(trx, {
      now,
      action: before ? (after ? 'location_changed' : 'location_removed') : 'location_set',
      actorKind: 'owner',
      actorAccountId: principal.accountId,
      eventId,
      outcome: 'success',
      details: { locationVersion: version, noticesQueued: notified },
    });
    return { location: after, locationVersion: version, notified };
  });
  if (!result) throw new AppError(404, 'not_found');
  return result;
}
