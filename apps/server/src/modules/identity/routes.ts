import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { AppContext } from '../../composition/context.js';
import { InvalidLinkError } from '../../platform/errors.js';
import { linkToken } from '../../platform/http.js';
import { withLinkRateLimit } from '../access-tokens/link-guard.js';
import { ORG_COOKIE, PRESESSION_COOKIE, RECENT_AUTH_MS, csrfTokenFor, requireOrganizer } from './sessions.js';
import { confirmSignIn, requestReauthentication, requestSignIn, resolveSignInLink } from './sign-in.js';
import {
  confirmAccountVerification,
  confirmPasswordReset,
  organizationRegistrationSchema,
  accountRegistrationSchema,
  passwordReauthentication,
  passwordSignIn,
  passwordSignInSchema,
  registerOrganization,
  requestPasswordReset,
  resolveAccountLink,
} from './accounts.js';
import { membershipsOf } from '../organizations/access.js';
import { invitationsFor } from '../organizations/members.js';

const emailSchema = z.object({ email: z.email().max(254) }).strict();

const cookieBase = { path: '/', secure: true, httpOnly: true } as const;

export function registerIdentityRoutes(app: FastifyInstance, ctx: AppContext): void {
  app.post('/api/auth/sign-in-requests', async (request, reply) => {
    const { email } = emailSchema.parse(request.body);
    await requestSignIn(ctx, email, request.ip, request.id);
    return reply.code(202).send({ status: 'check_your_email' });
  });

  // requestReauthentication (API #27; FR-ORG-5): session, CSRF and Origin required; no body.
  app.post('/api/auth/reauthentication', async (request, reply) => {
    const principal = await requireOrganizer(ctx, request, { csrf: true });
    await requestReauthentication(ctx, principal, request.id);
    return reply.code(202).send({ status: 'check_your_email' });
  });

  // K-709 (PD-89): organization registration, password sign-in, password reset.
  app.post('/api/organizations/registrations', async (request, reply) => {
    await registerOrganization(
      ctx,
      organizationRegistrationSchema.parse(request.body),
      request.ip,
      request.id,
    );
    return reply.code(202).send({ status: 'check_your_email' });
  });

  // K-716: an organizer account without an organization (for invitees); the same answers and limits.
  app.post('/api/accounts/registrations', async (request, reply) => {
    await registerOrganization(ctx, accountRegistrationSchema.parse(request.body), request.ip, request.id);
    return reply.code(202).send({ status: 'check_your_email' });
  });

  app.post('/api/auth/password-sessions', async (request, reply) => {
    const result = await passwordSignIn(ctx, passwordSignInSchema.parse(request.body), request.ip);
    reply.setCookie(ORG_COOKIE, result.sessionId, {
      ...cookieBase,
      sameSite: 'lax',
      maxAge: result.maxAgeSeconds,
    });
    return { redirect: '/organizer/' };
  });

  app.post('/api/auth/password-reset-requests', async (request, reply) => {
    const { email } = emailSchema.parse(request.body);
    await requestPasswordReset(ctx, email, request.ip, request.id);
    return reply.code(202).send({ status: 'check_your_email' });
  });

  app.post('/api/auth/password-reauthentication', async (request, reply) => {
    const principal = await requireOrganizer(ctx, request, { csrf: true });
    await passwordReauthentication(ctx, principal, request.body);
    return reply.code(204).send();
  });

  app.get('/api/links/account-verification', async (request) =>
    withLinkRateLimit(ctx, request, () =>
      resolveAccountLink(ctx, 'account_verification', linkToken(request)),
    ),
  );
  app.post('/api/links/account-verification/confirm', async (request) =>
    withLinkRateLimit(ctx, request, () => confirmAccountVerification(ctx, linkToken(request))),
  );
  app.get('/api/links/password-reset', async (request) =>
    withLinkRateLimit(ctx, request, () => resolveAccountLink(ctx, 'password_reset', linkToken(request))),
  );
  app.post('/api/links/password-reset/confirm', async (request) =>
    withLinkRateLimit(ctx, request, () => confirmPasswordReset(ctx, linkToken(request), request.body)),
  );

  app.get('/api/auth/session', async (request) => {
    const principal = await requireOrganizer(ctx, request, { csrf: false });
    const account = await ctx.db
      .selectFrom('app.accounts')
      .select(['display_name', 'password_hash'])
      .where('id', '=', principal.accountId)
      .executeTakeFirst();
    return {
      displayName: account?.display_name ?? null,
      hasPassword: !!account?.password_hash,
      accountId: principal.accountId,
      email: principal.email,
      authenticatedAt: principal.authenticatedAt.toISOString(),
      recentAuthUntil: new Date(principal.authenticatedAt.getTime() + RECENT_AUTH_MS).toISOString(),
      csrfToken: csrfTokenFor(ctx.config.CSRF_SECRET, 'org', principal.sessionId),
      organizations: await membershipsOf(ctx.db, principal.accountId), // K-708
      invitations: await invitationsFor(ctx.db, principal.accountId), // K-716
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
      confirmSignIn(
        ctx,
        linkToken(request),
        request.cookies[PRESESSION_COOKIE],
        typeof header === 'string' ? header : undefined,
      ),
    );
    reply.setCookie(ORG_COOKIE, result.sessionId, {
      ...cookieBase,
      sameSite: 'lax',
      maxAge: result.maxAgeSeconds,
    });
    reply.clearCookie(PRESESSION_COOKIE, { ...cookieBase, sameSite: 'strict' });
    return { redirect: '/organizer/' };
  });
}

export { InvalidLinkError };
