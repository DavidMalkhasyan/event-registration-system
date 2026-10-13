import type { FastifyInstance } from 'fastify';
import type { AppContext } from '../../composition/context.js';
import { AppError } from '../../platform/errors.js';
import { recordProviderEvent, verifySvix } from './webhooks.js';

// K-402 (PD-98): Resend's delivery webhooks. Enabled only when RESEND_WEBHOOK_SECRET is set. Authenticated
// by the Svix signature over the raw body (not by cookies or the Origin header, which a server does not
// send), so this path is exempt from the browser Origin check and nothing else is.

const MAX_BODY = 256 * 1024;

export function registerWebhookRoutes(app: FastifyInstance, ctx: AppContext): void {
  void app.register(async (scope) => {
    // The signature covers the exact bytes: keep the body raw.
    scope.removeContentTypeParser('application/json');
    scope.addContentTypeParser(
      'application/json',
      { parseAs: 'string', bodyLimit: MAX_BODY },
      (_r, body, done) => done(null, body),
    );
    scope.post('/api/webhooks/resend', async (request, reply) => {
      const secret = ctx.config.RESEND_WEBHOOK_SECRET;
      if (!secret) throw new AppError(404, 'not_found');
      const header = (name: string) => {
        const v = request.headers[name];
        return typeof v === 'string' ? v : undefined;
      };
      const raw = typeof request.body === 'string' ? request.body : '';
      const ok = verifySvix(
        secret,
        { id: header('svix-id'), timestamp: header('svix-timestamp'), signature: header('svix-signature') },
        raw,
        Math.floor(Date.now() / 1000),
      );
      if (!ok) throw new AppError(401, 'unauthenticated');
      const result = await recordProviderEvent(ctx.db, header('svix-id')!, raw);
      return reply.code(200).send({ received: result });
    });
  });
}
