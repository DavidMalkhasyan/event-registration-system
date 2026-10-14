import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  createEvent,
  createHarness,
  drain,
  localIn,
  mailFor,
  moveClockTo,
  organizerHeaders,
  register,
  registerConfirmed,
  resetData,
  signIn,
  tokenFromLink,
  type Harness,
  type Session,
} from './harness.js';

// K-711 (amendment A-5, PD-91): an event's venue, its display on the organizer, public, management
// and ticket views, and the venue-change notice to confirmed and waiting participants.

let h: Harness;
beforeAll(async () => {
  h = await createHarness();
});
afterAll(async () => h.close());
beforeEach(async () => resetData(h));

const HALL = {
  venueName: 'Riverside Hall',
  streetAddress: '12 Mill Lane',
  city: 'Yerevan',
  postalCode: '0010',
  country: 'Armenia',
  arrivalInstructions: 'Use the side entrance; the main door is closed after 18:00.',
};

const putLocation = (s: Session, eventId: string, payload: unknown) =>
  h.app.inject({
    method: 'PUT',
    url: `/api/events/${eventId}/location`,
    headers: organizerHeaders(s),
    payload: payload as object,
  });

const getEvent = async (s: Session, id: string) =>
  (await h.app.inject({ method: 'GET', url: `/api/events/${id}`, headers: { cookie: s.cookie } })).json();

const link = (url: string, token: string) =>
  h.app.inject({ method: 'GET', url, headers: { authorization: `Link ${token}` } });

describe('creating and showing a location', () => {
  it('stores an optional venue at creation and shows it to organizers and the public; coordinates only as given', async () => {
    const owner = await signIn(h, 'owner@example.test');
    const created = await h.app.inject({
      method: 'POST',
      url: '/api/events',
      headers: organizerHeaders(owner),
      payload: {
        requestId: randomUUID(),
        title: 'Concert',
        localStart: localIn(48),
        timeZone: 'UTC',
        capacity: 10,
        location: { ...HALL, latitude: 40.177628, longitude: 44.512546 },
      },
    });
    expect(created.statusCode).toBe(201);
    const event = created.json().event;
    expect(event.location).toEqual({
      ...HALL,
      region: null,
      coordinates: { latitude: 40.177628, longitude: 44.512546 },
    });
    expect(event.locationVersion).toBe(0);
    const pub = (await h.app.inject({ method: 'GET', url: `/api/public/events/${event.publicId}` })).json();
    expect(pub.location.venueName).toBe('Riverside Hall');
    expect(pub.location.coordinates).toEqual({ latitude: 40.177628, longitude: 44.512546 });

    // Without a location (as every event from before K-711): null everywhere, nothing invented.
    const plain = await createEvent(h, owner, { capacity: 5, startsInHours: 48 });
    expect((await getEvent(owner, plain.id)).location).toBeNull();
    expect(
      (await h.app.inject({ method: 'GET', url: `/api/public/events/${plain.publicId}` })).json().location,
    ).toBeNull();
  });

  it('validates the venue on the server', async () => {
    const owner = await signIn(h, 'owner@example.test');
    const event = await createEvent(h, owner, { capacity: 5, startsInHours: 48 });
    const bad = [
      { ...HALL, latitude: 40.1 }, // latitude without longitude
      { ...HALL, latitude: 91, longitude: 10 },
      { ...HALL, latitude: 10, longitude: 181 },
      { ...HALL, city: '   ' },
      { ...HALL, venueName: 'x'.repeat(201) },
      { ...HALL, country: 'A' },
      { ...HALL, extra: 'field' },
    ];
    for (const location of bad)
      expect((await putLocation(owner, event.id, { location, expectedLocationVersion: 0 })).statusCode).toBe(
        422,
      );
    expect((await getEvent(owner, event.id)).locationVersion).toBe(0);
  });
});

describe('changing the location', () => {
  it('notifies confirmed and waiting participants once, through the outbox, with the new venue', async () => {
    const owner = await signIn(h, 'owner@example.test');
    const event = await createEvent(h, owner, { capacity: 1, startsInHours: 48 });
    const anna = await registerConfirmed(h, event.publicId, 'anna@example.test');
    await registerConfirmed(h, event.publicId, 'ben@example.test'); // waiting list
    await register(h, event.publicId, 'cleo@example.test'); // not confirmed: no notice
    await drain(h);

    const first = await putLocation(owner, event.id, { location: HALL, expectedLocationVersion: 0 });
    expect(first.statusCode).toBe(200);
    expect(first.json()).toMatchObject({ locationVersion: 1, notified: 2 });
    await drain(h);
    for (const who of ['anna@example.test', 'ben@example.test']) {
      const mail = mailFor(h, who).filter((m) => m.subject.startsWith('Venue changed'));
      expect(mail, who).toHaveLength(1);
      expect(mail[0]!.text).toContain('New venue: Riverside Hall, 12 Mill Lane, 0010 Yerevan, Armenia.');
      expect(mail[0]!.text).toContain('Arrival: Use the side entrance');
      expect(mail[0]!.text).toMatch(/\/manage#t=[A-Za-z0-9_-]{43}/);
    }
    expect(mailFor(h, 'cleo@example.test').filter((m) => m.subject.startsWith('Venue changed'))).toEqual([]);

    // The participant's own pages show the venue.
    const manage = await link('/api/links/manage', tokenFromLink(anna.links.management));
    expect(manage.json().event.location.streetAddress).toBe('12 Mill Lane');
    const ticket = await link('/api/links/ticket', tokenFromLink(anna.links.share));
    expect(ticket.json().event.location.venueName).toBe('Riverside Hall');

    // The same location again changes nothing; coordinates alone change the version, not the participants.
    const same = await putLocation(owner, event.id, { location: HALL, expectedLocationVersion: 1 });
    expect(same.json()).toMatchObject({ locationVersion: 1, notified: 0 });
    const pinned = await putLocation(owner, event.id, {
      location: { ...HALL, latitude: 40.1776, longitude: 44.5125 },
      expectedLocationVersion: 1,
    });
    expect(pinned.json()).toMatchObject({ locationVersion: 2, notified: 0 });

    // A stale form does not overwrite a newer venue.
    const stale = await putLocation(owner, event.id, {
      location: { ...HALL, venueName: 'Old idea' },
      expectedLocationVersion: 1,
    });
    expect(stale.statusCode).toBe(409);
    expect(stale.json()).toMatchObject({ code: 'location_version_mismatch', locationVersion: 2 });

    const audit = await h.db
      .selectFrom('app.audit_records')
      .select(['action', 'details'])
      .where('event_id', '=', event.id)
      .where('action', 'like', 'location_%')
      .orderBy('occurred_at')
      .execute();
    expect(audit.map((a) => a.action)).toEqual(['location_set', 'location_changed']);
    expect(audit[0]!.details).toMatchObject({ noticesQueued: 2 });
  });

  it('sends only the latest of two quick changes; a removal is announced too', async () => {
    const owner = await signIn(h, 'owner@example.test');
    const event = await createEvent(h, owner, { capacity: 5, startsInHours: 48 });
    await registerConfirmed(h, event.publicId, 'anna@example.test');
    await drain(h);
    await putLocation(owner, event.id, { location: HALL, expectedLocationVersion: 0 });
    await putLocation(owner, event.id, {
      location: { ...HALL, venueName: 'Garden Pavilion', arrivalInstructions: null },
      expectedLocationVersion: 1,
    });
    await drain(h);
    const venueMails = mailFor(h, 'anna@example.test').filter((m) => m.subject.startsWith('Venue changed'));
    expect(venueMails).toHaveLength(1);
    expect(venueMails[0]!.text).toContain('New venue: Garden Pavilion');
    const dropped = await h.db
      .selectFrom('app.outbox_messages')
      .select(['status', 'settle_reason'])
      .where('message_type', '=', 'venue_change')
      .where('status', '=', 'DROPPED')
      .execute();
    expect(dropped).toHaveLength(1); // the first notice, made obsolete by the second

    await putLocation(owner, event.id, { location: null, expectedLocationVersion: 2 });
    await drain(h);
    const removal = mailFor(h, 'anna@example.test').filter((m) => m.subject.startsWith('Venue changed'));
    expect(removal).toHaveLength(2);
    expect(removal.some((m) => m.text.includes('has been removed from the event page'))).toBe(true);
    expect((await getEvent(owner, event.id)).location).toBeNull();
  });

  it('is refused for another organization, a started or cancelled event', async () => {
    const owner = await signIn(h, 'owner@example.test');
    const other = await signIn(h, 'other@example.test');
    const event = await createEvent(h, owner, { capacity: 5, startsInHours: 48 });
    expect(
      (await putLocation(other, event.id, { location: HALL, expectedLocationVersion: 0 })).statusCode,
    ).toBe(404);
    moveClockTo(new Date(Date.now() + 49 * 3_600_000));
    const started = await putLocation(owner, event.id, { location: HALL, expectedLocationVersion: 0 });
    expect(started.statusCode).toBe(409);
    expect(started.json().code).toBe('event_started');
    moveClockTo(new Date());
    const cancel = await h.app.inject({
      method: 'POST',
      url: `/api/events/${event.id}/cancellation`,
      headers: organizerHeaders(owner),
      payload: { confirmed: true },
    });
    expect(cancel.statusCode).toBe(200);
    const cancelled = await putLocation(owner, event.id, { location: HALL, expectedLocationVersion: 0 });
    expect(cancelled.statusCode).toBe(409);
    expect(cancelled.json().code).toBe('event_not_scheduled');
  });
});
