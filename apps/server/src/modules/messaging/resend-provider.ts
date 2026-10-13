import { createHash } from 'node:crypto';
import type { EmailProvider, ProviderResult } from './fake-provider.js';
import type { RenderedEmail } from '../notifications/handlers.js';

// Resend (K-717, PD-97): the production email provider behind the same interface as the fake one.
// The dispatcher calls it only after `send_started_at` is committed and outside every registration,
// cancellation or other business transaction (the transactional outbox is unchanged). Every response is
// classified so that "accepted" is only ever claimed when Resend answered 200 with an email ID:
//   200 + id                         accepted (also Resend's replay of the same idempotency key)
//   409 invalid_idempotent_request   idempotent_key_conflict (the key was used with another body)
//   409 concurrent_idempotent_requests  concurrent_conflict (an earlier attempt is still in flight)
//   429 (rate or quota)              rate_limited, with Retry-After; not accepted
//   401, 403                         config_fault: key, permission or unverified domain; not accepted
//   400, 404, 405, 422               permanent: the request itself is wrong; not accepted, no retry
//   5xx, other, network, timeout     ambiguous: maybe accepted; retried with the same idempotency key
// Nothing here logs: errors carry only the HTTP status and Resend's error name, never the API key,
// the recipient, the body or its links (sign-in, verification and management tokens).
// API reference: https://resend.com/docs/api-reference/emails/send-email (read 2026-10-13).

export interface ResendConfig {
  apiKey: string;
  from: string;
  replyTo?: string;
  apiUrl: string;
  timeoutMs?: number;
}

const TIMEOUT_MS = 10_000;
const TAG = /[^A-Za-z0-9_-]/g;

/** Resend accepts keys of 1 to 256 characters; longer logical keys are hashed (still deterministic). */
export function resendIdempotencyKey(key: string): string {
  return key.length <= 256 ? key : `sha256:${createHash('sha256').update(key).digest('hex')}`;
}

export class ResendEmailProvider implements EmailProvider {
  constructor(
    private readonly config: ResendConfig,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  async send(input: {
    idempotencyKey: string;
    to: string;
    email: RenderedEmail;
    tags: Record<string, string>;
  }): Promise<ProviderResult> {
    const response = await this.fetchImpl(`${this.config.apiUrl.replace(/\/$/, '')}/emails`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${this.config.apiKey}`,
        'content-type': 'application/json',
        'user-agent': 'EventFlow/1.0',
        'idempotency-key': resendIdempotencyKey(input.idempotencyKey),
      },
      body: JSON.stringify({
        from: this.config.from,
        to: [input.to],
        subject: input.email.subject,
        html: input.email.html,
        text: input.email.text,
        ...(this.config.replyTo ? { reply_to: this.config.replyTo } : {}),
        tags: Object.entries(input.tags).map(([name, value]) => ({
          name: name.replace(TAG, '_').slice(0, 256),
          value: value.replace(TAG, '_').slice(0, 256),
        })),
      }),
      redirect: 'error',
      signal: AbortSignal.timeout(this.config.timeoutMs ?? TIMEOUT_MS),
    }); // a network error or timeout throws: the dispatcher records it as ambiguous

    const body = (await response.json().catch(() => ({}))) as { id?: unknown; name?: unknown };
    const errorCode = typeof body.name === 'string' ? body.name.slice(0, 64) : undefined;
    const base = { httpStatus: response.status, ...(errorCode ? { errorCode } : {}) };
    if (response.status === 200 && typeof body.id === 'string')
      return { category: 'accepted', providerMessageId: body.id, ...base };
    if (response.status === 409)
      return {
        category:
          errorCode === 'concurrent_idempotent_requests' ? 'concurrent_conflict' : 'idempotent_key_conflict',
        ...base,
      };
    if (response.status === 429) {
      const retryAfter = Number(response.headers.get('retry-after'));
      return {
        category: 'rate_limited',
        ...base,
        ...(Number.isFinite(retryAfter) && retryAfter > 0
          ? { retryAfterSeconds: Math.min(retryAfter, 86_400) }
          : {}),
      };
    }
    if (response.status === 401 || response.status === 403) return { category: 'config_fault', ...base };
    if ([400, 404, 405, 422].includes(response.status)) return { category: 'permanent', ...base };
    return { category: 'ambiguous', ...base };
  }
}
