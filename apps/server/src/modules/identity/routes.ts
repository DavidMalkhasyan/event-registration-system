import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { AppContext } from '../../composition/context.js';
import { InvalidLinkError } from '../../platform/errors.js';
import { linkToken } from '../../platform/http.js';
import { withLinkRateLimit } from '../access-tokens/link-guard.js';
import { ORG_COOKIE, PRESESSION_COOKIE, RECENT_AUTH_MS, csrfTokenFor, requireOrganizer } from './sessions.js';
import { confirmSignIn, requestSignIn, resolveSignInLink } from './sign-in.js';

const emailSchema = z.object({ email: z.email().max(254) }).strict();

const cookieBase = { path: '/', secure: true, httpOnly: true } as const;

export function registerIdentityRoutes(app: FastifyInstance, ctx: AppContext): void {
  app.post('/api/auth/sign-in-requests', async (request, reply) => {
    const { email } = emailSchema.parse(request.body);
    await requestSignIn(ctx, email, request.ip, request.id);
    return reply.code(202).send({ status: 'check_your_email' });
  });

  app.get('/api/auth/session', async (request) => {
    const principal = await requireOrganizer(ctx, request, { csrf: false });
    return {
      accountId: principal.accountId,
      email: principal.email,
      authenticatedAt: principal.authenticatedAt.toISOString(),
      recentAuthUntil: new Date(principal.authenticatedAt.getTime() + RECENT_AUTH_MS).toISOString(),
      csrfToken: csrfTokenFor(ctx.config.CSRF_SECRET, 'org', principal.sessionId),
    };
  });

  app.post('/api/auth/sign-out', async (request, reply) => {
    const principal = await requireOrganizer(ctx, request, { csrf: true });
    await ctx.db
      .updateTable('app.organizer_sessions')
      .set({ revoked_at: new Date(), revoke_reason: 'sign_out' })
      .where('id', '=', principal.sessionId)
      .where('revoked_at', 'is', null)
      .execute();
    reply.clearCookie(ORG_COOKIE, { ...cookieBase, sameSite: 'lax' });
    return reply.code(204).send();
  });

  // Link routes: the token comes only from "Authorization: Link"; session cookies are ignored.
  app.get('/api/links/sign-in', async (request, reply) => {
    const view = await withLinkRateLimit(ctx, request, () => resolveSignInLink(ctx, linkToken(request)));
    if (request.method === 'GET') {
      reply.setCookie(PRESESSION_COOKIE, view.nonce, { ...cookieBase, sameSite: 'strict', maxAge: 900 });
    }
    return { maskedEmail: view.maskedEmail, purpose: view.purpose, preSessionToken: view.preSessionToken };
  });

  app.post('/api/links/sign-in/confirm', async (request, reply) => {
    const header = request.headers['x-csrf-token'];
    const result = await withLinkRateLimit(ctx, request, () =>
      confirmSignIn(ctx, linkToken(request), request.cookies[PRESESSION_COOKIE], typeof header === 'string' ? header : undefined),
    );
    reply.setCookie(ORG_COOKIE, result.sessionId, { ...cookieBase, sameSite: 'lax', maxAge: result.maxAgeSeconds });
    reply.clearCookie(PRESESSION_COOKIE, { ...cookieBase, sameSite: 'strict' });
    return { redirect: '/organizer/' };
  });
}

export { InvalidLinkError };
