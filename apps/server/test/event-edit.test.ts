import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  ORIGIN,
  createEvent,
  createHarness,
  drain,
  moveClockTo,
  organizerHeaders,
  registerAndGetVerifyToken,
  registerConfirmed,
  resetData,
  signIn,
  type Harness,
  type Session,
} from './harness.js';
import { readMailbox } from '../src/modules/messaging/fake-provider.js';

let h: Harness;
beforeAll(async () => {
  h = await createHarness();
});
afterAll(async () => h.close());
beforeEach(async () => resetData(h));

function patch(s: Session, eventId: string, payload: unknown) {
  return h.app.inject({
    method: 'PATCH',
    url: `/api/events/${eventId}`,
    headers: organizerHeaders(s),
    payload: payload as Record<string, unknown>,
  });
}

async function eventRow(eventId: string) {
  return h.db.selectFrom('app.events').selectAll().where('id', '=', eventId).executeTakeFirstOrThrow();
}

/** Everything a title or description edit must leave untouched. */
async function snapshot(eventId: string) {
  const { title: _t, description: _d, updated_at: _u, ...event } = await eventRow(eventId);
  const registrations = await h.db
    .selectFrom('app.registrations')
    .selectAll()
    .where('event_id', '=', eventId)
    .orderBy('id')
    .execute();
  const tickets = await h.db
    .selectFrom('app.tickets')
    .selectAll()
    .where('event_id', '=', eventId)
    .orderBy('id')
    .execute();
  const checkIns = await h.db
    .selectFrom('app.check_ins')
    .selectAll()
    .where('event_id', '=', eventId)
    .execute();
  const tasks = await h.db
    .selectFrom('app.scheduled_tasks')
    .selectAll()
    .where('event_id', '=', eventId)
    .orderBy('id')
    .execute();
  const outbox = await h.db.selectFrom('app.outbox_messages').select('id').orderBy('id').execute();
  return { event, registrations, tickets, checkIns, tasks, outbox };
}

async function audits(eventId: string) {
  return h.db
    .selectFrom('app.audit_records')
    .select('details')
    .where('event_id', '=', eventId)
    .where('action', '=', 'event_details_edit')
    .execute();
}

describe('title and description editing (K-304b: FR-EVT-5, TX-E02, AC-105)', () => {
  it('edits the title, the description, or both, and returns the updated event', async () => {
    const s = await signIn(h, 'organizer@example.test');
    const event = await createEvent(h, s, { capacity: 3, startsInHours: 72, title: 'Original title' });

    const titleOnly = await patch(s, event.id, { title: '  Renamed workshop  ' });
    expect(titleOnly.statusCode).toBe(200);
    expect(titleOnly.json().title).toBe('Renamed workshop'); // trimmed, like creation
    expect(titleOnly.json().description).toBe('An event used by the automated tests'); // untouched

    const descriptionOnly = await patch(s, event.id, {
      description: 'Bring a laptop.\nDoors open at 18:00.',
    });
    expect(descriptionOnly.json().title).toBe('Renamed workshop');
    expect(descriptionOnly.json().description).toBe('Bring a laptop.\nDoors open at 18:00.');

    const both = await patch(s, event.id, { title: 'Final title', description: null });
    expect(both.statusCode).toBe(200);
    expect(both.json()).toMatchObject({ title: 'Final title', description: null });
    expect((await patch(s, event.id, { description: 'Again' })).json().description).toBe('Again');
    expect((await patch(s, event.id, { description: '' })).json().description).toBeNull(); // empty = none

    // The public event page shows the new details.
    const page = await h.app.inject({ method: 'GET', url: `/api/public/events/${event.publicId}` });
    expect(page.json()).toMatchObject({ title: 'Final title', description: null });

    // Allowed while SCHEDULED, also after the start (FR-EVT-5: "at any time while SCHEDULED").
    moveClockTo(new Date(event.startsAt), 3_600_000);
    expect((await patch(s, event.id, { title: 'After the start' })).statusCode).toBe(200);
    expect((await audits(event.id)).map((a) => a.details)).toEqual([
      { changed: 'title' },
      { changed: 'description' },
      { changed: 'title,description' },
      { changed: 'description' },
      { changed: 'description' },
      { changed: 'title' },
    ]);
  });

  it('rejects invalid input with the validation error and changes nothing', async () => {
    const s = await signIn(h, 'organizer@example.test');
    const event = await createEvent(h, s, { capacity: 3, startsInHours: 72, title: 'Valid title' });
    const invalid = [
      {}, // at least one field
      { title: '' },
      { title: '    ' }, // empty after trimming
      { title: 'x'.repeat(201) },
      { title: 42 },
      { title: null }, // a title is required, it can't be removed
      { description: 'x'.repeat(5001) },
      { title: 'ok', capacity: 99 }, // capacity has its own endpoint
      { title: 'ok', localStart: '2099-01-01T10:00' }, // the schedule has its own endpoint
      { title: 'ok', timeZone: 'Europe/Berlin' },
    ];
    for (const payload of invalid) {
      const response = await patch(s, event.id, payload);
      expect(response.statusCode, JSON.stringify(payload)).toBe(422);
      expect(response.json().code).toBe('validation_failed');
    }
    expect(
      (await patch(s, event.id, { title: 'x'.repeat(200), description: 'y'.repeat(5000) })).statusCode,
    ).toBe(200);
    const row = await eventRow(event.id);
    expect(row.capacity).toBe(3);
    expect(row.title).toBe('x'.repeat(200));
  });

  it('hides other organizers’ events and requires a session, the CSRF token and the exact origin', async () => {
    const owner = await signIn(h, 'organizer@example.test');
    const event = await createEvent(h, owner, { capacity: 3, startsInHours: 72, title: 'Mine' });
    const intruder = await signIn(h, 'intruder@example.test');

    expect((await patch(intruder, event.id, { title: 'Hijacked' })).statusCode).toBe(404);
    expect((await patch(intruder, randomUUID(), { title: 'Hijacked' })).statusCode).toBe(404);
    const noSession = await h.app.inject({
      method: 'PATCH',
      url: `/api/events/${event.id}`,
      headers: { origin: ORIGIN },
      payload: { title: 'Hijacked' },
    });
    expect(noSession.statusCode).toBe(401);
    const badCsrf = await h.app.inject({
      method: 'PATCH',
      url: `/api/events/${event.id}`,
      headers: { origin: ORIGIN, cookie: owner.cookie, 'x-csrf-token': 'v1.1.wrong' },
      payload: { title: 'Hijacked' },
    });
    expect(badCsrf.json().code).toBe('csrf_failed');
    const foreignOrigin = await h.app.inject({
      method: 'PATCH',
      url: `/api/events/${event.id}`,
      headers: { ...organizerHeaders(owner), origin: 'https://evil.example' },
      payload: { title: 'Hijacked' },
    });
    expect(foreignOrigin.json().code).toBe('origin_check_failed');
    expect((await eventRow(event.id)).title).toBe('Mine');
    expect(await audits(event.id)).toHaveLength(0);
  });

  it('rejects edits once the event is no longer SCHEDULED', async () => {
    const s = await signIn(h, 'organizer@example.test');
    const event = await createEvent(h, s, { capacity: 3, startsInHours: 72, title: 'Cancelled event' });
    // Fixture: event cancellation (K-304c) has no endpoint yet, so the state is set directly.
    await h.db
      .updateTable('app.events')
      .set({ status: 'CANCELLED', cancelled_at: new Date() })
      .where('id', '=', event.id)
      .execute();
    const response = await patch(s, event.id, { title: 'Too late' });
    expect(response.statusCode).toBe(409);
    expect(response.json().code).toBe('event_not_scheduled');
    expect((await eventRow(event.id)).title).toBe('Cancelled event');
  });

  it('leaves the schedule, capacity, registrations, waiting list, tickets and check-ins untouched and sends no email (AC-105)', async () => {
    const s = await signIn(h, 'organizer@example.test');
    const event = await createEvent(h, s, { capacity: 1, startsInHours: 72, title: 'Busy event' });
    const confirmed = await registerConfirmed(h, event.publicId, 'a@example.test');
    await registerConfirmed(h, event.publicId, 'w1@example.test');
    await registerConfirmed(h, event.publicId, 'w2@example.test');
    await registerAndGetVerifyToken(h, event.publicId, 'pending@example.test');
    moveClockTo(new Date(event.startsAt), -3_600_000);
    const checkIn = await h.app.inject({
      method: 'POST',
      url: `/api/events/${event.id}/check-ins`,
      headers: organizerHeaders(s),
      payload: { code: confirmed.ticket.code, requestId: randomUUID() },
    });
    expect(checkIn.json().outcome).toBe('CHECKED_IN');
    await drain(h);
    const before = await snapshot(event.id);
    const mailBefore = readMailbox(h.mailboxDir).length;

    expect((await patch(s, event.id, { title: 'Renamed', description: 'New text' })).statusCode).toBe(200);
    await drain(h);

    expect(await snapshot(event.id)).toEqual(before); // including the outbox: no message was created
    expect(readMailbox(h.mailboxDir)).toHaveLength(mailBefore);
    const dashboard = await h.app.inject({
      method: 'GET',
      url: `/api/events/${event.id}/dashboard`,
      headers: { cookie: s.cookie },
    });
    expect(dashboard.json().counts).toEqual({ confirmed: 1, waitlisted: 2, checkedIn: 1 });
  });

  it('treats repeated identical requests as no-ops, including simultaneous ones', async () => {
    const s = await signIn(h, 'organizer@example.test');
    const event = await createEvent(h, s, { capacity: 3, startsInHours: 72, title: 'Before' });
    const payload = { title: 'After', description: 'Same text' };
    const responses = await Promise.all([1, 2, 3].map(() => patch(s, event.id, payload)));
    expect(responses.map((r) => r.statusCode)).toEqual([200, 200, 200]);
    const firstUpdate = (await eventRow(event.id)).updated_at;

    const retry = await patch(s, event.id, payload);
    expect(retry.statusCode).toBe(200);
    expect(retry.json()).toMatchObject(payload);
    expect((await eventRow(event.id)).updated_at).toEqual(firstUpdate); // no write
    expect(await audits(event.id)).toHaveLength(1); // only the effective change is recorded
  });
});
