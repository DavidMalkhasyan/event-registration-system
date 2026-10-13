import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { allParticipants } from './use-event-data';

// K-723: the participant list comes in pages; the organizer page loads every page, following the
// server's cursor until there is none.

const ok = (body: unknown) =>
  Promise.resolve(
    new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } }),
  );

const person = (n: number) => ({ registrationId: `r${n}`, email: `p${n}@example.test`, state: 'CONFIRMED' });

let fetchMock: ReturnType<typeof vi.fn>;
beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe('allParticipants (K-723)', () => {
  it('follows nextCursor until the last page and keeps the order', async () => {
    fetchMock
      .mockImplementationOnce(() => ok({ items: [person(1), person(2)], nextCursor: 'c/1+' }))
      .mockImplementationOnce(() => ok({ items: [person(3)], nextCursor: 'c2' }))
      .mockImplementationOnce(() => ok({ items: [person(4)], nextCursor: null }));
    const items = await allParticipants('ev1', new AbortController().signal);
    expect(items.map((p) => p.registrationId)).toEqual(['r1', 'r2', 'r3', 'r4']);
    expect(fetchMock.mock.calls.map((c) => c[0])).toEqual([
      '/api/events/ev1/participants',
      `/api/events/ev1/participants?cursor=${encodeURIComponent('c/1+')}`,
      '/api/events/ev1/participants?cursor=c2',
    ]);
  });

  it('makes one request when everything fits on one page', async () => {
    fetchMock.mockImplementation(() => ok({ items: [person(1)], nextCursor: null }));
    expect(await allParticipants('ev1', new AbortController().signal)).toHaveLength(1);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
