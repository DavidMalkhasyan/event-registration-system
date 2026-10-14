import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { cutoffOf } from '../src/platform/time.js';
import {
  ORIGIN,
  confirm,
  createEvent,
  createHarness,
  drain,
  moveClockTo,
  organizerHeaders,
  register,
  registerAndGetVerifyToken,
  registerConfirmed,
  resetData,
  signIn,
  tokenFromLink,
  type Harness,
  type Session,
} from './harness.js';

// Public availability on GET /api/public/events/:publicId (PD-81): aggregate counts only,
// derived from committed state with the rule TX-R02 applies at confirmation.

let h: Harness;
beforeAll(async () => {
  h = await createHarness();
});
afterAll(async () => h.close());
beforeEach(async () => resetData(h));

const ORGANIZER = 'organizer@example.test';
const AVAILABILITY_KEYS = [
  'capacity',
  'confirmedCount',
  'estimatedAvailableSeats',
  'registrationMode',
  'waitlistedCount',
];
// K-711 added `location` (the organizer's venue, or null) and K-712 `images` (the cover and gallery the
// organizer published); both are public like the title.
const EVENT_KEYS = [
  'availability',
  'description',
  'images',
  'location',
  'phase',
  'startsAt',
  'timeZone',
  'title',
];

async function publicEvent(publicId: string) {
  const response = await h.app.inject({ method: 'GET', url: `/api/public/events/${publicId}` });
  expect(response.statusCode).toBe(200);
  return response.json() as {
    phase: string;
    availability: {
      registrationMode: string;
      capacity: number | null;
      confirmedCount: number | null;
      waitlistedCount: number | null;
      estimatedAvailableSeats: number | null;
    };
  };
}

async function setup(
  capacity: number,
  startsInHours = 72,
): Promise<{ s: Session; publicId: string; id: string }> {
  const s = await signIn(h, ORGANIZER);
  const event = await createEvent(h, s, { capacity, startsInHours });
  return { s, publicId: event.publicId, id: event.id };
}

function setCapacity(s: Session, eventId: string, capacity: number) {
  return h.app.inject({
    method: 'PUT',
    url: `/api/events/${eventId}/capacity`,
    headers: organizerHeaders(s),
    payload: { capacity },
  });
}

describe('public availability (PD-81)', () => {
  it('shows free seats while confirmed registrations are below capacity; a pending verification holds no seat', async () => {
    const { publicId } = await setup(3);
    expect((await publicEvent(publicId)).availability).toEqual({
      registrationMode: 'seats_available',
      capacity: 3,
      confirmedCount: 0,
      waitlistedCount: 0,
      estimatedAvailableSeats: 3,
    });
    await registerConfirmed(h, publicId, 'a@example.test');
    await registerAndGetVerifyToken(h, publicId, 'pending@example.test'); // FR-REG-2: no seat yet
    expect((await publicEvent(publicId)).availability).toMatchObject({
      registrationMode: 'seats_available',
      confirmedCount: 1,
      estimatedAvailableSeats: 2,
    });
  });

  it('switches to the waiting list when the final seat is taken, and counts waiting participants', async () => {
    const { publicId } = await setup(1);
    await registerConfirmed(h, publicId, 'a@example.test');
    expect((await publicEvent(publicId)).availability).toEqual({
      registrationMode: 'waiting_list',
      capacity: 1,
      confirmedCount: 1,
      waitlistedCount: 0,
      estimatedAvailableSeats: 0,
    });
    const waiting = await registerConfirmed(h, publicId, 'w1@example.test');
    expect(waiting.result).toBe('waitlisted');
    await registerConfirmed(h, publicId, 'w2@example.test');
    expect((await publicEvent(publicId)).availability).toMatchObject({
      registrationMode: 'waiting_list',
      waitlistedCount: 2,
      estimatedAvailableSeats: 0,
    });
  });

  it('follows a cancellation and its FIFO promotion', async () => {
    const { publicId } = await setup(1);
    const first = await registerConfirmed(h, publicId, 'a@example.test');
    await registerConfirmed(h, publicId, 'w1@example.test');
    await registerConfirmed(h, publicId, 'w2@example.test');
    const cancelled = await h.app.inject({
      method: 'POST',
      url: '/api/links/manage/cancel',
      headers: { origin: ORIGIN, authorization: `Link ${tokenFromLink(first.links.management)}` },
      payload: { confirmed: true },
    });
    expect(cancelled.statusCode).toBe(200);
    // w1 was promoted into the freed seat, so the event is still full with one person waiting.
    expect((await publicEvent(publicId)).availability).toMatchObject({
      registrationMode: 'waiting_list',
      confirmedCount: 1,
      waitlistedCount: 1,
      estimatedAvailableSeats: 0,
    });
  });

  it('shows the seats a capacity increase leaves free after promoting the waiting list', async () => {
    const { s, publicId, id } = await setup(1);
    await registerConfirmed(h, publicId, 'a@example.test');
    await registerConfirmed(h, publicId, 'w1@example.test');
    expect((await setCapacity(s, id, 3)).statusCode).toBe(200);
    expect((await publicEvent(publicId)).availability).toEqual({
      registrationMode: 'seats_available',
      capacity: 3,
      confirmedCount: 2,
      waitlistedCount: 0,
      estimatedAvailableSeats: 1,
    });
  });

  it('publishes no counts and accepts no registration from the cutoff onward', async () => {
    const s = await signIn(h, ORGANIZER);
    const event = await createEvent(h, s, { capacity: 1, startsInHours: 72 });
    await registerConfirmed(h, event.publicId, 'a@example.test');
    moveClockTo(cutoffOf(new Date(event.startsAt)), 1_000);
    const after = await publicEvent(event.publicId);
    expect(after.phase).toBe('registration_closed');
    expect(after.availability).toEqual({
      registrationMode: 'closed',
      capacity: null,
      confirmedCount: null,
      waitlistedCount: null,
      estimatedAvailableSeats: null,
    });
    // Never a waiting-list entry after the cutoff: the server refuses the registration.
    const late = await register(h, event.publicId, 'late@example.test');
    expect(late.statusCode).toBe(409);
    expect(late.json().code).toBe('registration_closed');
  });

  it('is closed for a cancelled event', async () => {
    const { s, publicId, id } = await setup(2);
    await registerConfirmed(h, publicId, 'a@example.test');
    const cancelled = await h.app.inject({
      method: 'POST',
      url: `/api/events/${id}/cancellation`,
      headers: organizerHeaders(s),
      payload: { confirmed: true },
    });
    expect(cancelled.statusCode).toBe(200);
    const after = await publicEvent(publicId);
    expect(after.phase).toBe('cancelled');
    expect(after.availability.registrationMode).toBe('closed');
    expect(after.availability.confirmedCount).toBeNull();
  });

  it('stays consistent while several visitors confirm for the last seats at the same moment', async () => {
    const { publicId } = await setup(2);
    const tokens: string[] = [];
    for (const p of ['p1', 'p2', 'p3', 'p4', 'p5'])
      tokens.push(await registerAndGetVerifyToken(h, publicId, `${p}@example.test`)); // the helper drains the outbox
    // Reads interleaved with the confirmations always see a committed, consistent snapshot.
    const [results, ...reads] = await Promise.all([
      Promise.all(tokens.map((t) => confirm(h, t))),
      publicEvent(publicId),
      publicEvent(publicId),
      publicEvent(publicId),
    ]);
    for (const read of reads) {
      const a = read.availability;
      expect(a.confirmedCount! + a.estimatedAvailableSeats!).toBe(2);
      expect(a.confirmedCount).toBeLessThanOrEqual(2);
    }
    const outcomes = results.map((r) => r.json().result).sort();
    expect(outcomes).toEqual(['confirmed', 'confirmed', 'waitlisted', 'waitlisted', 'waitlisted']);
    expect((await publicEvent(publicId)).availability).toEqual({
      registrationMode: 'waiting_list',
      capacity: 2,
      confirmedCount: 2,
      waitlistedCount: 3,
      estimatedAvailableSeats: 0,
    });
  });

  it('exposes no personal data: only the documented fields, no addresses, codes or identifiers', async () => {
    const { publicId, id } = await setup(1);
    const confirmed = await registerConfirmed(h, publicId, 'private.person@example.test');
    await registerConfirmed(h, publicId, 'waiting.person@example.test');
    await drain(h);
    const response = await h.app.inject({ method: 'GET', url: `/api/public/events/${publicId}` });
    const body = response.json();
    expect(Object.keys(body).sort()).toEqual(EVENT_KEYS);
    expect(Object.keys(body.availability).sort()).toEqual(AVAILABILITY_KEYS);
    expect(body.location).toBeNull(); // this event has no venue; nothing else is put in its place
    expect(body.images).toEqual({ cover: null, gallery: [] });
    const text = response.body;
    expect(text).not.toContain('@');
    expect(text).not.toContain('private.person');
    expect(text).not.toContain(confirmed.ticket.code);
    expect(text).not.toContain(id); // the internal event ID stays private
    expect(response.headers['cache-control']).toContain('no-store');
  });
});
