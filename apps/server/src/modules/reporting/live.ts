import type { FastifyInstance } from 'fastify';
import pg from 'pg';
import { z } from 'zod';
import type { AppContext } from '../../composition/context.js';
import { AppError } from '../../platform/errors.js';
import { requireOrganizer, resolveOrganizer } from '../identity/sessions.js';

// Live checked-in count (FR-DSH-2, FR-DSH-3, API-D6): PostgreSQL LISTEN/NOTIFY → SSE.
// Every connection starts with the authoritative count; updates are re-read from committed
// state; authorization is re-validated before every push and at least every 30 seconds.

type Listener = (eventId: string) => void;

export class LiveHub {
  private client: pg.Client | null = null;
  private readonly listeners = new Set<Listener>();

  constructor(private readonly connectionString: string) {}

  async start(): Promise<void> {
    this.client = new pg.Client({ connectionString: this.connectionString, application_name: 'ers-live' });
    await this.client.connect();
    this.client.on('notification', (n) => {
      if (n.channel === 'checkin_count' && n.payload) for (const l of this.listeners) l(n.payload);
    });
    await this.client.query('LISTEN checkin_count');
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  async stop(): Promise<void> {
    await this.client?.end();
    this.client = null;
  }
}

async function checkedInCount(ctx: AppContext, eventId: string): Promise<number> {
  const row = await ctx.db
    .selectFrom('app.check_ins')
    .select((eb) => eb.fn.countAll<number>().as('n'))
    .where('event_id', '=', eventId)
    .where('undone_at', 'is', null)
    .executeTakeFirstOrThrow();
  return Number(row.n);
}

const REVALIDATE_MS = 30_000;
const KEEPALIVE_MS = 15_000;

export function registerLiveRoutes(app: FastifyInstance, ctx: AppContext, hub: LiveHub): void {
  app.get('/api/events/:eventId/check-in-count', async (request) => {
    const principal = await requireOrganizer(ctx, request, { csrf: false });
    const { eventId } = z.object({ eventId: z.uuid() }).parse(request.params);
    const owned = await ctx.db
      .selectFrom('app.events')
      .select('id')
      .where('id', '=', eventId)
      .where('owner_account_id', '=', principal.accountId)
      .executeTakeFirst();
    if (!owned) throw new AppError(404, 'not_found');
    return { checkedIn: await checkedInCount(ctx, eventId) };
  });

  app.get('/api/events/:eventId/live', async (request, reply) => {
    const principal = await requireOrganizer(ctx, request, { csrf: false });
    const parsed = z.object({ eventId: z.uuid() }).safeParse(request.params);
    if (!parsed.success) throw new AppError(404, 'not_found');
    const eventId = parsed.data.eventId;
    const owned = await ctx.db
      .selectFrom('app.events')
      .select('id')
      .where('id', '=', eventId)
      .where('owner_account_id', '=', principal.accountId)
      .executeTakeFirst();
    if (!owned) throw new AppError(404, 'not_found');

    reply.hijack();
    const res = reply.raw;
    res.writeHead(200, {
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-store',
      connection: 'keep-alive',
      'x-content-type-options': 'nosniff',
      'referrer-policy': 'no-referrer',
    });
    res.write('retry: 3000\n\n');

    let closed = false;
    let pending: NodeJS.Timeout | null = null;
    // Re-validate the session with a fresh read before each send (API-D6, FR-STAFF-3 guarantee).
    const authorized = async () => {
      const current = await resolveOrganizer(ctx, request).catch(() => null);
      return current?.sessionId === principal.sessionId;
    };
    const close = (reason?: string) => {
      if (closed) return;
      closed = true;
      if (reason) res.write(`event: access_ended\ndata: ${JSON.stringify({ reason })}\n\n`);
      res.end();
    };
    const push = async () => {
      if (closed) return;
      if (!(await authorized())) return close('expired');
      const count = await checkedInCount(ctx, eventId);
      if (!closed) res.write(`event: count\ndata: ${JSON.stringify({ checkedIn: count })}\n\n`);
    };
    const unsubscribe = hub.subscribe((changed) => {
      if (changed !== eventId || pending) return;
      pending = setTimeout(() => {
        pending = null;
        void push().catch(() => close());
      }, 250); // coalesce bursts
    });
    const keepAlive = setInterval(() => !closed && res.write(': keep-alive\n\n'), KEEPALIVE_MS);
    const revalidate = setInterval(() => {
      void authorized().then((ok) => !ok && close('expired'));
    }, REVALIDATE_MS);
    request.raw.on('close', () => {
      closed = true;
      unsubscribe();
      clearInterval(keepAlive);
      clearInterval(revalidate);
      if (pending) clearTimeout(pending);
    });
    await push();
  });
}
