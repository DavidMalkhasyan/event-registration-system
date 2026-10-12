import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  createEvent,
  createHarness,
  organizerHeaders,
  registerAndGetVerifyToken,
  registerConfirmed,
  resetData,
  signIn,
  type Harness,
  type Session,
} from './harness.js';

// Reschedule (TX-E04) as the K-702 settings form uses it: an unchanged start sends nothing; a change
// emails every confirmed and waiting participant once; the schedule version guards concurrent changes;
// daylight-saving gaps and repeats are refused or need an explicit offset.

let h: Harness;
beforeAll(async () => {
  h = await createHarness();
});
afterAll(async () => h.close());
beforeEach(async () => resetData(h));

const ORGANIZER = 'organizer@example.test';

function reschedule(
  s: Session,
  eventId: string,
  body: { localStart: string; expectedScheduleVersion: number; utcOffset?: string },
) {
  return h.app.inject({
    method: 'POST',
    url: `/api/events/${eventId}/reschedule`,
    headers: organizerHeaders(s),
    payload: body,
  });
}

async function changeEmails(eventId: string) {
  return h.db
    .selectFrom('app.outbox_messages')
    .select(['recipient_email', 'schedule_version'])
    .where('event_id', '=', eventId)
    .where('message_type', '=', 'event_change')
    .execute();
}

async function eventRow(eventId: string) {
  return h.db
    .selectFrom('app.events')
    .select(['starts_at', 'schedule_version'])
    .where('id', '=', eventId)
    .executeTakeFirstOrThrow();
}

/** A Europe/Berlin event (the zone has both daylight-saving transitions). */
async function berlinEvent(s: Session, localStart: string) {
  const response = await h.app.inject({
    method: 'POST',
    url: '/api/events',
    headers: organizerHeaders(s),
    payload: {
      requestId: randomUUID(),
      title: 'Berlin event',
      description: null,
      localStart,
      timeZone: 'Europe/Berlin',
      capacity: 5,
    },
  });
  expect(response.statusCode).toBe(201);
  return response.json().event as { id: string; publicId: string; scheduleVersion: number; startsAt: string };
}

describe('reschedule (K-702)', () => {
  it('sends nothing and keeps the version when the start is unchanged', async () => {
    const s = await signIn(h, ORGANIZER);
    const event = await berlinEvent(s, '2027-01-15T19:00');
    await registerConfirmed(h, event.publicId, 'a@example.test');
    const response = await reschedule(s, event.id, {
      localStart: '2027-01-15T19:00',
      expectedScheduleVersion: 1,
    });
    expect(response.statusCode).toBe(200);
    expect(response.json().scheduleVersion).toBe(1);
    expect(await changeEmails(event.id)).toHaveLength(0);
    expect((await eventRow(event.id)).schedule_version).toBe(1);
  });

  it('emails each confirmed and waiting participant once, and nobody pending, for a real change', async () => {
    const s = await signIn(h, ORGANIZER);
    const event = await createEvent(h, s, { capacity: 1, startsInHours: 72 });
    await registerConfirmed(h, event.publicId, 'a@example.test');
    await registerConfirmed(h, event.publicId, 'w@example.test'); // waiting list
    await registerAndGetVerifyToken(h, event.publicId, 'pending@example.test');
    const later = new Date(new Date(event.startsAt).getTime() + 24 * 3_600_000);
    const localStart = later.toISOString().slice(0, 16); // the harness creates events in UTC
    const response = await reschedule(s, event.id, {
      localStart,
      expectedScheduleVersion: event.scheduleVersion,
    });
    expect(response.statusCode).toBe(200);
    expect(response.json().startsAt).toBe(`${localStart}:00.000Z`);
    expect(response.json().scheduleVersion).toBe(event.scheduleVersion + 1);
    const mails = await changeEmails(event.id);
    expect(mails.map((m) => m.recipient_email).sort()).toEqual(['a@example.test', 'w@example.test']);
    expect(mails.every((m) => m.schedule_version === event.scheduleVersion + 1)).toBe(true);

    // The same request again: the start is now unchanged, so nothing more is sent.
    const again = await reschedule(s, event.id, {
      localStart,
      expectedScheduleVersion: event.scheduleVersion + 1,
    });
    expect(again.statusCode).toBe(200);
    expect(await changeEmails(event.id)).toHaveLength(2);
  });

  it('rejects a stale schedule version without changing anything', async () => {
    const s = await signIn(h, ORGANIZER);
    const event = await createEvent(h, s, { capacity: 2, startsInHours: 72 });
    await registerConfirmed(h, event.publicId, 'a@example.test');
    const first = new Date(new Date(event.startsAt).getTime() + 3_600_000).toISOString().slice(0, 16);
    const second = new Date(new Date(event.startsAt).getTime() + 7_200_000).toISOString().slice(0, 16);
    expect(
      (await reschedule(s, event.id, { localStart: first, expectedScheduleVersion: 1 })).statusCode,
    ).toBe(200);
    // A second form still holding version 1 (opened before the first change).
    const stale = await reschedule(s, event.id, { localStart: second, expectedScheduleVersion: 1 });
    expect(stale.statusCode).toBe(409);
    expect(stale.json()).toMatchObject({ code: 'schedule_version_mismatch', currentScheduleVersion: 2 });
    expect((await eventRow(event.id)).starts_at.toISOString()).toBe(`${first}:00.000Z`);
    expect(await changeEmails(event.id)).toHaveLength(1);
  });

  it('asks for the offset of a repeated hour and refuses a skipped one (Europe/Berlin)', async () => {
    const s = await signIn(h, ORGANIZER);
    const event = await berlinEvent(s, '2027-01-15T19:00');
    // 31 October 2027: clocks go back at 03:00 CEST, so 02:30 happens twice.
    const ambiguous = await reschedule(s, event.id, {
      localStart: '2027-10-31T02:30',
      expectedScheduleVersion: 1,
    });
    expect(ambiguous.statusCode).toBe(422);
    expect(ambiguous.json()).toMatchObject({ code: 'ambiguous_local_time', offsets: ['+01:00', '+02:00'] });
    // 28 March 2027: clocks go forward at 02:00 CET, so 02:30 does not exist.
    const skipped = await reschedule(s, event.id, {
      localStart: '2027-03-28T02:30',
      expectedScheduleVersion: 1,
    });
    expect(skipped.statusCode).toBe(422);
    expect(skipped.json().code).toBe('nonexistent_local_time');
    expect((await eventRow(event.id)).schedule_version).toBe(1);
    expect(await changeEmails(event.id)).toHaveLength(0);

    const chosen = await reschedule(s, event.id, {
      localStart: '2027-10-31T02:30',
      utcOffset: '+01:00',
      expectedScheduleVersion: 1,
    });
    expect(chosen.statusCode).toBe(200);
    expect(chosen.json().startsAt).toBe('2027-10-31T01:30:00.000Z'); // the second 02:30
  });
});
