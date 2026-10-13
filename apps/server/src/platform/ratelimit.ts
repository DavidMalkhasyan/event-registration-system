import { sql } from 'kysely';
import { createHmac } from 'node:crypto';
import type { Database } from './db.js';
import { decisionTime } from './tx.js';

// Fixed-window counters in PostgreSQL (NFR-SEC-3, Proposed ADR-015); identifiers are HMAC-keyed (D-6).
const KEY_ID = 1;

export interface RateLimitRule {
  scope: string;
  limit: number;
  windowSeconds: number;
}

// Defaults from the requirements where they exist (A); the rest are OQ-9 placeholders.
export const RULES = {
  failedLinkLookupsPerIp: { scope: 'token_lookup_ip', limit: 20, windowSeconds: 600 },
  signInPerAddress: { scope: 'signin_email', limit: 5, windowSeconds: 900 },
  signInPerIp: { scope: 'signin_ip', limit: 30, windowSeconds: 900 },
  // API_DESIGN §11: re-authentication requests per account (value provisional, OQ-9).
  reauthPerAccount: { scope: 'reauth_account', limit: 5, windowSeconds: 900 },
  // PD-38 (stakeholder D3): event cancellations per organizer account, provisional for OQ-9.
  eventCancellationPerAccount: { scope: 'event_cancel_account', limit: 5, windowSeconds: 900 },
  // FR-SELF-4 and FR-ROT-8 defaults (PD-48).
  ticketResendPerRegistration: { scope: 'resend_registration', limit: 3, windowSeconds: 3600 },
  rotationPerRegistrationAndType: { scope: 'rotation_registration_type', limit: 5, windowSeconds: 3600 },
  // PD-55: staff invitations per event (provisional, OQ-9).
  staffInvitationsPerEvent: { scope: 'staff_invite_event', limit: 20, windowSeconds: 3600 },
  registrationPerIp: { scope: 'register_ip', limit: 30, windowSeconds: 900 },
  registrationPerAddress: { scope: 'register_email', limit: 5, windowSeconds: 900 },
  failedCheckInsPerSession: { scope: 'checkin_fail_session', limit: 30, windowSeconds: 300 },
  // K-709 (PD-89): organizer accounts.
  organizationRegistrationPerIp: { scope: 'org_register_ip', limit: 10, windowSeconds: 3600 },
  organizationRegistrationPerAddress: { scope: 'org_register_email', limit: 3, windowSeconds: 3600 },
  passwordSignInPerAddress: { scope: 'password_signin_email', limit: 10, windowSeconds: 900 },
  passwordSignInPerIp: { scope: 'password_signin_ip', limit: 30, windowSeconds: 900 },
  passwordResetPerAddress: { scope: 'password_reset_email', limit: 3, windowSeconds: 900 },
} satisfies Record<string, RateLimitRule>;

export class RateLimiter {
  constructor(
    private readonly db: Database,
    private readonly secret: string,
  ) {}

  private keyHash(rule: RateLimitRule, identifier: string): Buffer {
    return createHmac('sha256', this.secret).update(`${rule.scope}\u0000${identifier}`).digest();
  }

  private async window(rule: RateLimitRule): Promise<{ start: Date; end: Date }> {
    const now = await decisionTime(this.db);
    const ms = rule.windowSeconds * 1000;
    const start = new Date(Math.floor(now.getTime() / ms) * ms);
    return { start, end: new Date(start.getTime() + ms) };
  }

  /** Counts one hit in its own short transaction. Returns seconds until retry when over the limit. */
  async hit(
    rule: RateLimitRule,
    identifier: string,
  ): Promise<{ allowed: boolean; retryAfterSeconds: number }> {
    const { start, end } = await this.window(rule);
    const result = await sql<{ count: number }>`
      INSERT INTO app.rate_limit_counters (scope, key_id, key_hash, window_start, count, expires_at)
      VALUES (${rule.scope}, ${KEY_ID}, ${this.keyHash(rule, identifier)}, ${start}, 1, ${end})
      ON CONFLICT (scope, key_id, key_hash, window_start) DO UPDATE SET count = app.rate_limit_counters.count + 1
      RETURNING count`.execute(this.db);
    const count = result.rows[0]?.count ?? 1;
    return {
      allowed: count <= rule.limit,
      retryAfterSeconds: Math.max(1, Math.ceil((end.getTime() - Date.now()) / 1000)),
    };
  }

  /** Reads the current count without counting (used before link lookups). */
  async isLimited(rule: RateLimitRule, identifier: string): Promise<boolean> {
    const { start } = await this.window(rule);
    const row = await this.db
      .selectFrom('app.rate_limit_counters')
      .select('count')
      .where('scope', '=', rule.scope)
      .where('key_id', '=', KEY_ID)
      .where('key_hash', '=', this.keyHash(rule, identifier))
      .where('window_start', '=', start)
      .executeTakeFirst();
    return (row?.count ?? 0) >= rule.limit;
  }
}
