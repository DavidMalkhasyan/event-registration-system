import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { AppContext } from '../../composition/context.js';
import { AppError } from '../../platform/errors.js';
import { csrfTokenFor } from '../identity/sessions.js';
import {
  ADMIN_COOKIE,
  adminSignIn,
  adminSignInSchema,
  adminSignOut,
  decideOrganization,
  decisionSchema,
  listOrganizations,
  organizationAudit,
  organizationListSchema,
  requireAdmin,
} from './admin.js';

// K-710 (PD-90): the Super Admin API. There is no route that creates a Super Admin or grants the
// role: that is only the operator command (`pnpm admin:create`).

const cookie = { path: '/', secure: true, httpOnly: true, sameSite: 'strict' } as const;

function organizationId(params: unknown): string {
  const parsed = z.object({ id: z.uuid() }).safeParse(params);
  if (!parsed.success) throw new AppError(404, 'not_found');
  return parsed.data.id;
}

export function registerPlatformAdminRoutes(app: FastifyInstance, ctx: AppContext): void {
  app.post('/api/admin/sessions', async (request, reply) => {
    const result = await adminSignIn(ctx, adminSignInSchema.parse(request.body), request.ip);
    reply.setCookie(ADMIN_COOKIE, result.sessionId, { ...cookie, maxAge: result.maxAgeSeconds });
    return { redirect: '/admin' };
  });

  app.get('/api/admin/session', async (request) => {
    const principal = await requireAdmin(ctx, request, { csrf: false });
    return {
      email: principal.email,
      displayName: principal.displayName,
      csrfToken: csrfTokenFor(ctx.config.CSRF_SECRET, 'admin', principal.sessionId),
    };
  });

  app.post('/api/admin/sign-out', async (request, reply) => {
    const principal = await requireAdmin(ctx, request, { csrf: true });
    await adminSignOut(ctx, principal);
    reply.clearCookie(ADMIN_COOKIE, cookie);
    return reply.code(204).send();
  });

  app.get('/api/admin/organizations', async (request) => {
    await requireAdmin(ctx, request, { csrf: false });
    const { status } = organizationListSchema.parse(request.query);
    return listOrganizations(ctx, status);
  });

  app.get('/api/admin/organizations/:id/audit', async (request) => {
    await requireAdmin(ctx, request, { csrf: false });
    return { records: await organizationAudit(ctx, organizationId(request.params)) };
  });

  app.post('/api/admin/organizations/:id/decisions', async (request) => {
    const principal = await requireAdmin(ctx, request, { csrf: true });
    return decideOrganization(
      ctx,
      principal,
      organizationId(request.params),
      decisionSchema.parse(request.body),
      request.id,
    );
  });
}
