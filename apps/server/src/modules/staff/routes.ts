import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { AppContext } from '../../composition/context.js';
import { AppError } from '../../platform/errors.js';
import { linkToken } from '../../platform/http.js';
import { withLinkRateLimit } from '../access-tokens/link-guard.js';
import { csrfTokenFor, requireOrganizer } from '../identity/sessions.js';
import { safeEqual } from '../../platform/crypto.js';
import { STAFF_COOKIE, resolveStaff } from '../identity/staff-sessions.js';
import {
  endStaffSession,
  acceptInvitation,
  inviteSchema,
  inviteStaff,
  resolveInvitation,
  revokeInvitation,
  revokeStaffSession,
  staffOverview,
  staffSessionView,
} from './staff.js';

const cookieBase = { path: '/', secure: true, httpOnly: true, sameSite: 'lax' } as const;
const eventParams = z.object({ eventId: z.string() });

// Staff routes (API #14 to #16, #46 to #50; PD-56).
export function registerStaffRoutes(app: FastifyInstance, ctx: AppContext): void {
  // ---- invitation links (token only in "Authorization: Link"; opening grants nothing)
  app.get('/api/links/invite', async (request) =>
    withLinkRateLimit(ctx, request, () => resolveInvitation(ctx, linkToken(request))),
  );
  app.post('/api/links/invite/accept', async (request, reply) => {
    const result = await withLinkRateLimit(ctx, request, () => acceptInvitation(ctx, linkToken(request)));
    reply.setCookie(STAFF_COOKIE, result.sessionId, { ...cookieBase, maxAge: result.maxAgeSeconds });
    return { redirect: '/staff' };
  });

  // ---- the staff device
  app.get('/api/staff/session', async (request, reply) => {
    const staff = await resolveStaff(ctx, request);
    if (!staff) {
      if (request.cookies[STAFF_COOKIE]) reply.clearCookie(STAFF_COOKIE, cookieBase); // ADR-010 §3
      throw new AppError(401, 'unauthenticated');
    }
    return staffSessionView(ctx, staff);
  });

  // K-715 (PD-95): the device ends its own access (a shared phone at the end of a shift).
  app.post('/api/staff/sign-out', async (request, reply) => {
    const staff = await resolveStaff(ctx, request);
    if (!staff) {
      reply.clearCookie(STAFF_COOKIE, cookieBase);
      return reply.code(204).send();
    }
    const header = request.headers['x-csrf-token'];
    if (
      typeof header !== 'string' ||
      !safeEqual(header, csrfTokenFor(ctx.config.CSRF_SECRET, 'staff', staff.staffSessionId))
    )
      throw new AppError(403, 'csrf_failed');
    await endStaffSession(ctx, staff);
    reply.clearCookie(STAFF_COOKIE, cookieBase);
    return reply.code(204).send();
  });

  // ---- the owner
  app.get('/api/events/:eventId/staff', async (request) =>
    staffOverview(
      ctx,
      await requireOrganizer(ctx, request, { csrf: false }),
      eventParams.parse(request.params).eventId,
    ),
  );
  app.post('/api/events/:eventId/staff-invitations', async (request, reply) => {
    const principal = await requireOrganizer(ctx, request, { csrf: true });
    const eventId = eventParams.parse(request.params).eventId;
    const created = await inviteStaff(ctx, principal, eventId, inviteSchema.parse(request.body), request.id);
    return reply.code(201).send(created);
  });
  app.post('/api/events/:eventId/staff-invitations/:invitationId/revocation', async (request, reply) => {
    const principal = await requireOrganizer(ctx, request, { csrf: true });
    const { eventId, invitationId } = z
      .object({ eventId: z.string(), invitationId: z.string() })
      .parse(request.params);
    await revokeInvitation(ctx, principal, eventId, invitationId);
    return reply.code(204).send();
  });
  app.post('/api/events/:eventId/staff-sessions/:staffSessionId/revocation', async (request, reply) => {
    const principal = await requireOrganizer(ctx, request, { csrf: true });
    const { eventId, staffSessionId } = z
      .object({ eventId: z.string(), staffSessionId: z.string() })
      .parse(request.params);
    await revokeStaffSession(ctx, principal, eventId, staffSessionId);
    return reply.code(204).send();
  });
}
