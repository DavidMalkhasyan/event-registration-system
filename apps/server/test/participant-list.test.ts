import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  createEvent,
  createHarness,
  organizerHeaders,
  registerConfirmed,
  resetData,
  signIn,
  type Harness,
  type Session,
} from './harness.js';

// K-723: the participant list comes in pages ordered by registration time. Before, it stopped silently
// at 1,000 rows (an event may have up to 100,000) and always answered nextCursor: null. Waiting-list
// positions are counted over the whole event, not the page.

let h: Harness;
beforeAll(async () => {
  h = await createHarness();
});
afterAll(async () => {
  await h.close();
});
beforeEach(async () => {
  await resetData(h);
});

interface Item {
  registrationId: string;
  email: string;
  state: string;
  position?: number;
}

async function page(s: Session, eventId: string, query = '') {
  return h.app.inject({
    method: 'GET',
    url: `/api/events/${eventId}/participants${query}`,
    headers: organizerHeaders(s),
  });
}

async function allPages(s: Session, eventId: string, limit: number) {
  const pages: Item[][] = [];
  let cursor: string | null = null;
  do {
    const query: string = `?limit=${limit}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`;
    const r = await page(s, eventId, query);
    expect(r.statusCode).toBe(200);
    pages.push(r.json().items);
    cursor = r.json().nextCursor;
  } while (cursor && pages.length < 20);
  return pages;
}

describe('participant list pages (K-723)', () => {
  it('returns every registration once across pages, in order, with positions over the whole event', async () => {
    const s = await signIn(h, 'owner@example.test');
    const event = await createEvent(h, s, { capacity: 1, startsInHours: 48 });
    const emails = ['p0', 'p1', 'p2', 'p3', 'p4'].map((p) => `${p}@example.test`);
    for (const email of emails) await registerConfirmed(h, event.publicId, email);
    // Equal registration times: the id breaks the tie, so no row is skipped or repeated at a page edge.
    await h.owner
      .updateTable('app.registrations')
      .set({ created_at: new Date('2026-01-01T00:00:00.123456Z') })
      .where('event_id', '=', event.id)
      .execute();

    const whole = (await page(s, event.id)).json();
    expect(whole.items).toHaveLength(5);
    expect(whole.nextCursor).toBeNull();

    const pages = await allPages(s, event.id, 2);
    expect(pages.map((p) => p.length)).toEqual([2, 2, 1]);
    const paged = pages.flat();
    expect(paged.map((i) => i.registrationId)).toEqual(whole.items.map((i: Item) => i.registrationId));
    expect(new Set(paged.map((i) => i.registrationId)).size).toBe(5);
    expect(paged.filter((i) => i.state === 'CONFIRMED')).toHaveLength(1);
    // Positions 1 to 4 although each page holds at most two of them.
    expect(
      paged
        .filter((i) => i.state === 'WAITLISTED')
        .map((i) => i.position)
        .sort(),
    ).toEqual([1, 2, 3, 4]);
    expect(
      paged
        .filter((i) => i.state === 'WAITLISTED')
        .every((i) =>
          whole.items.some((w: Item) => w.registrationId === i.registrationId && w.position === i.position),
        ),
    ).toBe(true);
  });

  it('refuses a cursor it did not issue and a page size outside 1 to 1,000', async () => {
    const s = await signIn(h, 'owner@example.test');
    const event = await createEvent(h, s, { capacity: 5, startsInHours: 48 });
    for (const cursor of ['not-a-cursor', Buffer.from('["x","y"]').toString('base64url')]) {
      const r = await page(s, event.id, `?cursor=${cursor}`);
      expect(r.statusCode).toBe(422);
      expect(r.json().code).toBe('validation_failed');
    }
    expect((await page(s, event.id, '?limit=0')).statusCode).toBe(422);
    expect((await page(s, event.id, '?limit=1001')).statusCode).toBe(422);
    expect((await page(s, event.id, '?limit=1000')).statusCode).toBe(200);
  });
});
