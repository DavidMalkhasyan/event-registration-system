import type { FastifyInstance } from 'fastify';
import type { AppContext } from '../../composition/context.js';
import { linkToken } from '../../platform/http.js';
import { withLinkRateLimit } from '../access-tokens/link-guard.js';
import { issueShareLink, requestTicketResend, rotateLink } from './portal.js';

// Management-link routes (API #9 to #11). The token comes only from "Authorization: Link";
// session cookies are ignored; unusable tokens get the generic invalid-link response (FR-LNK-7).
export function registerParticipantPortalRoutes(app: FastifyInstance, ctx: AppContext): void {
  app.post('/api/links/manage/resend', async (request, reply) => {
    const result = await withLinkRateLimit(ctx, request, () =>
      requestTicketResend(ctx, linkToken(request), request.body ?? {}, request.id),
    );
    return reply.code(202).send(result);
  });

  app.post('/api/links/manage/share-links', async (request, reply) => {
    const result = await withLinkRateLimit(ctx, request, () => issueShareLink(ctx, linkToken(request)));
    return reply.code(201).send(result);
  });

  app.post('/api/links/manage/rotations', async (request) =>
    withLinkRateLimit(ctx, request, () =>
      rotateLink(ctx, linkToken(request), request.body ?? {}, request.id),
    ),
  );
}
