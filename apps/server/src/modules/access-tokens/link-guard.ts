import type { FastifyRequest } from 'fastify';
import type { AppContext } from '../../composition/context.js';
import { InvalidLinkError } from '../../platform/errors.js';
import { RULES } from '../../platform/ratelimit.js';

/**
 * Wraps a link-route handler (FR-LNK-7): over the failed-lookup limit, the generic 429; an unusable
 * token counts as a failed lookup and returns the generic 404. Writing the counter fails open
 * (ADR-017 §2.3), so an outage never makes invalid tokens distinguishable.
 */
export async function withLinkRateLimit<T>(
  ctx: AppContext,
  request: FastifyRequest,
  run: () => Promise<T>,
): Promise<T> {
  if (await ctx.limiter.isLimited(RULES.failedLinkLookupsPerIp, request.ip).catch(() => false)) {
    throw new InvalidLinkError(true);
  }
  try {
    return await run();
  } catch (error) {
    if (error instanceof InvalidLinkError) {
      await ctx.limiter.hit(RULES.failedLinkLookupsPerIp, request.ip).catch((counterError: unknown) => {
        request.log.warn({ err: counterError }, 'failed-lookup counter not written');
      });
    }
    throw error;
  }
}
