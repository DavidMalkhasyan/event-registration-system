import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildWebApp } from '../src/composition/web-app.js';
import { LiveHub } from '../src/modules/reporting/live.js';
import type { FastifyInstance } from 'fastify';
import {
  createEvent,
  createHarness,
  moveClockTo,
  organizerHeaders,
  registerConfirmed,
  resetData,
  signIn,
  type Harness,
} from './harness.js';

let h: Harness;
let server: FastifyInstance;
let hub: LiveHub;
let base: string;

beforeAll(async () => {
  h = await createHarness();
  await resetData(h);
  hub = new LiveHub(h.config.DATABASE_URL);
  await hub.start();
  server = await buildWebApp(h.config, h.db, { logger: false, liveHub: hub });
  base = await server.listen({ host: '127.0.0.1', port: 0 });
});
afterAll(async () => {
  await server.close();
  await hub.stop();
  await h.close();
});

/** Reads SSE "count" events from a real HTTP connection until `want` counts arrived. */
async function readCounts(url: string, cookie: string, want: number, onOpen: () => Promise<void>): Promise<number[]> {
  const controller = new AbortController();
  const response = await fetch(url, { headers: { cookie }, signal: controller.signal });
  expect(response.headers.get('content-type')).toContain('text/event-stream');
  const reader = response.body!.getReader();
  const decoder = new TextDecoder();
  const counts: number[] = [];
  let buffer = '';
  let opened = false;
  const deadline = Date.now() + 10_000;
  while (counts.length < want && Date.now() < deadline) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let index;
    while ((index = buffer.indexOf('\n\n')) >= 0) {
      const frame = buffer.slice(0, index);
      buffer = buffer.slice(index + 2);
      const data = /event: count\ndata: (.*)/.exec(frame)?.[1];
      if (data) counts.push(JSON.parse(data).checkedIn);
    }
    if (!opened && counts.length > 0) {
      opened = true;
      await onOpen();
    }
  }
  controller.abort();
  return counts;
}

describe('live checked-in count over SSE (P0 #12, FR-DSH-2, FR-DSH-3)', () => {
  it('pushes the new committed count to every connected dashboard without a refresh', async () => {
    const s = await signIn(h, 'organizer@example.test');
    const event = await createEvent(h, s, { capacity: 2, startsInHours: 72 });
    const ticket = await registerConfirmed(h, event.publicId, 'a@example.test');
    moveClockTo(new Date(event.startsAt), -10 * 60_000);

    const url = `${base}/api/events/${event.id}/live`;
    const checkIn = () =>
      h.app
        .inject({
          method: 'POST',
          url: `/api/events/${event.id}/check-ins`,
          headers: organizerHeaders(s),
          payload: { code: ticket.ticket.code, requestId: randomUUID() },
        })
        .then(() => undefined);
    // Two simultaneous dashboards (two browser clients): check in only after both received their initial count.
    let opened = 0;
    let release!: () => void;
    const bothOpen = new Promise<void>((resolve) => (release = resolve));
    const onOpen = async () => {
      opened += 1;
      if (opened === 2) {
        await checkIn();
        release();
      }
      await bothOpen;
    };
    const [first, second] = await Promise.all([readCounts(url, s.cookie, 2, onOpen), readCounts(url, s.cookie, 2, onOpen)]);
    expect(first).toEqual([0, 1]);
    expect(second).toEqual([0, 1]);
  });

  it('refuses the stream without a session', async () => {
    const response = await fetch(`${base}/api/events/${randomUUID()}/live`);
    expect(response.status).toBe(401);
  });
});
