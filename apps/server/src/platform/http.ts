import type { FastifyError, FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { ZodError } from 'zod';
import {
  AppError,
  GENERIC_INVALID_LINK_BODY,
  InvalidLinkError,
  problemBody,
  serverProblem,
} from './errors.js';
import { InfrastructureError } from './tx.js';

const STATE_CHANGING = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

export function isLinkRoute(url: string): boolean {
  return url.startsWith('/api/links/');
}

/** Extracts the token from "Authorization: Link <token>" (FR-LNK-10 c). */
export function linkToken(request: FastifyRequest): string {
  const header = request.headers.authorization ?? '';
  const match = /^Link ([A-Za-z0-9_-]{1,200})$/.exec(header);
  return match?.[1] ?? '';
}

export function sendGenericInvalidLink(reply: FastifyReply, rateLimited = false): FastifyReply {
  reply.code(rateLimited ? 429 : 404).header('content-type', 'application/json; charset=utf-8');
  if (rateLimited) reply.header('retry-after', '600');
  return reply.send(GENERIC_INVALID_LINK_BODY);
}

function isInfrastructure(error: unknown): boolean {
  if (error instanceof InfrastructureError) return true;
  const code = (error as { code?: string }).code ?? '';
  // Connection failures, admin shutdown, lock or statement timeouts after retries.
  return /^(08|57P|53)/.test(code) || code === 'ECONNREFUSED' || code === 'ETIMEDOUT' || code === '57014';
}

/**
 * FR-LNK-8, AC-51: the pages allow scripts, styles, fonts and connections only from our own origin,
 * images also as data: URLs (QR codes, the inline icon), and no framing. No 'unsafe-inline', no eval.
 */
export const PAGE_CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self'",
  "img-src 'self' data:",
  "font-src 'self'",
  "connect-src 'self'",
  "media-src 'self'",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join('; ');

/** API responses are data, never documents: nothing may load or frame them. */
export const API_CSP = "default-src 'none'; frame-ancestors 'none'";

export function registerHttpPlumbing(app: FastifyInstance, publicOrigin: string): void {
  // Security headers on every response (FR-LNK-8, AC-51; ADR-013: no CORS headers).
  app.addHook('onSend', async (request, reply, payload) => {
    reply.header('x-content-type-options', 'nosniff');
    reply.header('referrer-policy', 'no-referrer');
    if (request.url.startsWith('/api/') || request.url.startsWith('/dev/'))
      reply.header('cache-control', 'no-store');
    if (request.url.startsWith('/api/')) {
      reply.header('content-security-policy', API_CSP);
      reply.header('x-robots-tag', 'noindex, nofollow');
    } else if (
      String(reply.getHeader('content-type') ?? '').startsWith('text/html') &&
      !request.url.startsWith('/dev/') // the development-only mailbox page is not a link page
    ) {
      // Every HTML entry (link pages, organizer, staff): never cached, never indexed, never framed.
      reply.header('content-security-policy', PAGE_CSP);
      reply.header('cache-control', 'no-store');
      reply.header('x-robots-tag', 'noindex, nofollow');
      reply.header('x-frame-options', 'DENY');
    }
    if (!isLinkRoute(request.url)) reply.header('x-correlation-id', request.id);
    return payload;
  });

  // Exact Origin check on every state-changing API request (ADR-010 §6).
  app.addHook('onRequest', async (request, reply) => {
    if (!STATE_CHANGING.has(request.method) || !request.url.startsWith('/api/')) return;
    if (request.headers.origin !== publicOrigin) {
      const error = new AppError(403, 'origin_check_failed');
      await reply.code(403).type('application/problem+json').send(problemBody(error, request.id));
    }
  });

  app.setErrorHandler((error: FastifyError | Error, request, reply) => {
    const link = isLinkRoute(request.url);
    if (error instanceof InvalidLinkError) return sendGenericInvalidLink(reply, error.rateLimited);
    if (error instanceof AppError) {
      if (error.status === 429) reply.header('retry-after', String(error.extras.retryAfterSeconds ?? 60));
      return reply.code(error.status).type('application/problem+json').send(problemBody(error, request.id));
    }
    if (error instanceof ZodError) {
      const errors = error.issues.map((i) => ({ field: i.path.join('.') || '(body)', code: i.code }));
      const problem = new AppError(422, 'validation_failed', { errors });
      return reply.code(422).type('application/problem+json').send(problemBody(problem, request.id));
    }
    const statusCode = (error as FastifyError).statusCode;
    if (statusCode && statusCode >= 400 && statusCode < 500) {
      const problem = new AppError(400, 'bad_request');
      return reply.code(400).type('application/problem+json').send(problemBody(problem, request.id));
    }
    const status = isInfrastructure(error) ? 503 : 500;
    request.log.error({ err: error, link }, 'request failed');
    return reply.code(status).type('application/problem+json').send(serverProblem(status, request.id));
  });

  app.setNotFoundHandler((request, reply) => {
    if (isLinkRoute(request.url)) return sendGenericInvalidLink(reply);
    return reply
      .code(404)
      .type('application/problem+json')
      .send(problemBody(new AppError(404, 'not_found'), request.id));
  });
}

export function clientIp(request: FastifyRequest): string {
  return request.ip;
}
