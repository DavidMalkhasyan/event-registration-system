import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import fastifyCookie from '@fastify/cookie';
import fastifyStatic from '@fastify/static';
import Fastify, { type FastifyInstance } from 'fastify';
import type { Config } from '../platform/config.js';
import type { Database } from '../platform/db.js';
import { registerHttpPlumbing } from '../platform/http.js';
import { RateLimiter } from '../platform/ratelimit.js';
import { registerEventCoreRoutes } from '../modules/event-core/routes.js';
import { registerIdentityRoutes } from '../modules/identity/routes.js';
import { registerParticipantPortalRoutes } from '../modules/participant-portal/routes.js';
import { registerStaffRoutes } from '../modules/staff/routes.js';
import { registerLiveRoutes, type LiveHub } from '../modules/reporting/live.js';
import { registerDevMailbox } from './dev-mailbox.js';
import type { AppContext } from './context.js';

export interface WebAppOptions {
  logger?: boolean;
  /** Log destination (tests capture the real request logs, PD-51); stdout by default. */
  logStream?: NodeJS.WritableStream;
  liveHub?: LiveHub;
}

/** Builds the web process (HTTP API, live counts, dev mailbox, built client). */
export async function buildWebApp(
  config: Config,
  db: Database,
  options: WebAppOptions = {},
): Promise<FastifyInstance> {
  const app = Fastify({
    genReqId: () => randomUUID(),
    logger:
      options.logger === false
        ? false
        : {
            level: config.NODE_ENV === 'production' ? 'info' : 'debug',
            // ENG-ERR-6: credential headers are never logged; URLs never carry link tokens (ADR-011).
            redact: [
              'req.headers.authorization',
              'req.headers.cookie',
              'req.headers["x-csrf-token"]',
              'res.headers["set-cookie"]',
            ],
            ...(options.logStream ? { stream: options.logStream } : {}),
          },
  });
  await app.register(fastifyCookie);
  registerHttpPlumbing(app, config.PUBLIC_ORIGIN);

  const ctx: AppContext = { db, config, limiter: new RateLimiter(db, config.RATE_LIMIT_SECRET) };
  registerIdentityRoutes(app, ctx);
  registerEventCoreRoutes(app, ctx);
  registerParticipantPortalRoutes(app, ctx);
  registerStaffRoutes(app, ctx);
  if (options.liveHub) registerLiveRoutes(app, ctx, options.liveHub);

  app.get('/healthz', async () => {
    const row = await db
      .selectFrom('app.schema_migrations')
      .select((eb) => eb.fn.max('version').as('v'))
      .executeTakeFirst();
    return { schemaVersion: Number(row?.v ?? 0), database: 'ok' };
  });

  if (config.NODE_ENV !== 'production' && config.EMAIL_PROVIDER === 'fake')
    registerDevMailbox(app, config.DEV_MAILBOX_DIR);

  // Serve the built client on the same origin (ADR-013); each path family gets its HTML entry.
  if (config.CLIENT_DIST_DIR && existsSync(config.CLIENT_DIST_DIR)) {
    await app.register(fastifyStatic, {
      root: resolve(config.CLIENT_DIST_DIR),
      index: false,
      wildcard: false,
    });
    const entry = (file: string) => async (_req: unknown, reply: { sendFile: (f: string) => unknown }) =>
      reply.sendFile(file);
    for (const path of [
      '/e/*',
      '/verify',
      '/manage',
      '/ticket',
      '/sign-in',
      '/invite',
      '/verify-account',
      '/reset-password',
    ])
      app.get(path, entry('public.html'));
    for (const path of ['/', '/organizer', '/organizer/*']) app.get(path, entry('organizer.html'));
    app.get('/staff', entry('staff.html')); // dedicated staff entry (PD-69)
    app.get('/assets/*', async (request, reply) =>
      reply.sendFile((request.params as { '*': string })['*'], resolve(config.CLIENT_DIST_DIR!, 'assets')),
    );
  }
  return app;
}
