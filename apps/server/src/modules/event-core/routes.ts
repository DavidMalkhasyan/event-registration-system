import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { AppContext } from '../../composition/context.js';
import { linkToken } from '../../platform/http.js';
import { withLinkRateLimit } from '../access-tokens/link-guard.js';
import { requireOrganizer } from '../identity/sessions.js';
import { checkInAsOwner, checkInSchema } from './checkin.js';
import {
  createEvent,
  dashboard,
  eventCreateSchema,
  getOwnedEvent,
  getPublicEvent,
  listEvents,
  listParticipants,
} from './events.js';
import {
  cancelByManagementLink,
  capacitySchema,
  eventDetailsSchema,
  managementView,
  rescheduleEvent,
  rescheduleSchema,
  setCapacity,
  shareView,
  updateEventDetails,
} from './lifecycle.js';
import { confirmVerification, resolveVerification, submitRegistration } from './registrations.js';

const registrationSchema = z.object({ email: z.email().max(254) }).strict();
const params = z.object({ eventId: z.string() });
const publicParams = z.object({ publicId: z.string().regex(/^[A-Za-z0-9_-]{22,64}$/) });

export function registerEventCoreRoutes(app: FastifyInstance, ctx: AppContext): void {
  // ---- public
  app.get('/api/public/events/:publicId', async (request) => {
    const { publicId } = publicParams.parse(request.params);
    return getPublicEvent(ctx, publicId);
  });

  app.post('/api/public/events/:publicId/registrations', async (request, reply) => {
    const { publicId } = publicParams.parse(request.params);
    const { email } = registrationSchema.parse(request.body);
    await submitRegistration(ctx, publicId, email, request.ip, request.id);
    return reply.code(202).send({ status: 'check_your_email' });
  });

  // ---- verification link (Authorization: Link)
  app.get('/api/links/verify', async (request) =>
    withLinkRateLimit(ctx, request, () => resolveVerification(ctx, linkToken(request))),
  );
  app.post('/api/links/verify/confirm', async (request) =>
    withLinkRateLimit(ctx, request, () => confirmVerification(ctx, linkToken(request), request.id)),
  );

  // ---- management link (FR-SELF-1 to FR-SELF-3); POST needs an explicit confirmation (FR-LNK-9, API-D4)
  app.get('/api/links/manage', async (request) =>
    withLinkRateLimit(ctx, request, () => managementView(ctx, linkToken(request))),
  );
  app.post('/api/links/manage/cancel', async (request) =>
    withLinkRateLimit(ctx, request, () =>
      cancelByManagementLink(ctx, linkToken(request), request.body, request.id),
    ),
  );

  app.get('/api/links/ticket', async (request) =>
    withLinkRateLimit(ctx, request, () => shareView(ctx, linkToken(request))),
  );

  // ---- organizer
  app.get('/api/events', async (request) =>
    listEvents(ctx, await requireOrganizer(ctx, request, { csrf: false })),
  );

  app.post('/api/events', async (request, reply) => {
    const principal = await requireOrganizer(ctx, request, { csrf: true });
    const input = eventCreateSchema.parse(request.body);
    const result = await createEvent(ctx, principal, input);
    const warnings = result.event.phase === 'registration_closed' ? ['registration_closed_immediately'] : [];
    return reply.code(result.created ? 201 : 200).send({ event: result.event, warnings });
  });

  app.get('/api/events/:eventId', async (request) => {
    const principal = await requireOrganizer(ctx, request, { csrf: false });
    return getOwnedEvent(ctx, principal, params.parse(request.params).eventId);
  });

  app.get('/api/events/:eventId/dashboard', async (request) => {
    const principal = await requireOrganizer(ctx, request, { csrf: false });
    return dashboard(ctx, principal, params.parse(request.params).eventId);
  });

  app.get('/api/events/:eventId/participants', async (request) => {
    const principal = await requireOrganizer(ctx, request, { csrf: false });
    return listParticipants(ctx, principal, params.parse(request.params).eventId);
  });

  app.post('/api/events/:eventId/reschedule', async (request) => {
    const principal = await requireOrganizer(ctx, request, { csrf: true });
    const eventId = params.parse(request.params).eventId;
    await rescheduleEvent(ctx, principal, eventId, rescheduleSchema.parse(request.body), request.id);
    return getOwnedEvent(ctx, principal, eventId);
  });

  // updateEventDetails (API catalogue #33): title and/or description; no emails.
  app.patch('/api/events/:eventId', async (request) => {
    const principal = await requireOrganizer(ctx, request, { csrf: true });
    const eventId = params.parse(request.params).eventId;
    await updateEventDetails(ctx, principal, eventId, eventDetailsSchema.parse(request.body));
    return getOwnedEvent(ctx, principal, eventId);
  });

  // setCapacity (API catalogue #34): absolute value; retries are idempotent.
  app.put('/api/events/:eventId/capacity', async (request) => {
    const principal = await requireOrganizer(ctx, request, { csrf: true });
    const eventId = params.parse(request.params).eventId;
    await setCapacity(ctx, principal, eventId, capacitySchema.parse(request.body), request.id);
    return getOwnedEvent(ctx, principal, eventId);
  });

  app.post('/api/events/:eventId/check-ins', async (request) => {
    const principal = await requireOrganizer(ctx, request, { csrf: true });
    return checkInAsOwner(
      ctx,
      principal,
      params.parse(request.params).eventId,
      checkInSchema.parse(request.body),
    );
  });
}
