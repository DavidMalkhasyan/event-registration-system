import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { AppContext } from '../../composition/context.js';
import { requireOrganizer } from '../identity/sessions.js';
import {
  answerInvitation,
  changeRole,
  invite,
  inviteSchema,
  listMembers,
  removeMember,
  revokeInvitation,
  roleChangeSchema,
} from './members.js';

// K-716 (PD-94): members and invitations of an organization.

const params = z.object({
  organizationId: z.string(),
  accountId: z.string().optional(),
  invitationId: z.string().optional(),
});

export function registerOrganizationRoutes(app: FastifyInstance, ctx: AppContext): void {
  app.get('/api/organizations/:organizationId/members', async (request) => {
    const principal = await requireOrganizer(ctx, request, { csrf: false });
    return listMembers(ctx, principal, params.parse(request.params).organizationId);
  });

  app.post('/api/organizations/:organizationId/invitations', async (request, reply) => {
    const principal = await requireOrganizer(ctx, request, { csrf: true });
    const { organizationId } = params.parse(request.params);
    const invitation = await invite(
      ctx,
      principal,
      organizationId,
      inviteSchema.parse(request.body),
      request.id,
    );
    return reply.code(201).send(invitation);
  });

  app.delete('/api/organizations/:organizationId/invitations/:invitationId', async (request, reply) => {
    const principal = await requireOrganizer(ctx, request, { csrf: true });
    const { organizationId, invitationId } = params.parse(request.params);
    await revokeInvitation(ctx, principal, organizationId, invitationId!);
    return reply.code(204).send();
  });

  app.patch('/api/organizations/:organizationId/members/:accountId', async (request, reply) => {
    const principal = await requireOrganizer(ctx, request, { csrf: true });
    const { organizationId, accountId } = params.parse(request.params);
    await changeRole(ctx, principal, organizationId, accountId!, roleChangeSchema.parse(request.body));
    return reply.code(204).send();
  });

  app.delete('/api/organizations/:organizationId/members/:accountId', async (request, reply) => {
    const principal = await requireOrganizer(ctx, request, { csrf: true });
    const { organizationId, accountId } = params.parse(request.params);
    await removeMember(ctx, principal, organizationId, accountId!);
    return reply.code(204).send();
  });

  for (const answer of ['accept', 'decline'] as const)
    app.post(`/api/invitations/:invitationId/${answer}`, async (request, reply) => {
      const principal = await requireOrganizer(ctx, request, { csrf: true });
      const { invitationId } = z.object({ invitationId: z.string() }).parse(request.params);
      await answerInvitation(ctx, principal, invitationId, answer);
      return reply.code(204).send();
    });
}
