import type { Database } from '../../platform/db.js';
import { hashToken, randomToken } from '../../platform/crypto.js';
import type { TokenType } from '../../platform/schema.js';
import type { Tx } from '../../platform/tx.js';

// ADR-012: one access_tokens table, hash-only storage, the route decides the token type.

export interface IssueInput {
  type: TokenType;
  now: Date;
  registrationId?: string;
  eventId?: string;
  signInRequestId?: string;
  via: 'page' | 'email';
  outboxMessageId?: string;
  attemptNo?: number;
  expiresAt?: Date;
}

/** Issues a new token and returns the raw value; only its hash is stored (FR-LNK-1). */
export async function issueToken(trx: Tx, input: IssueInput): Promise<string> {
  const raw = randomToken();
  await trx
    .insertInto('app.access_tokens')
    .values({
      token_type: input.type,
      token_hash: hashToken(input.type, raw)!,
      registration_id: input.registrationId ?? null,
      sign_in_request_id: input.signInRequestId ?? null,
      event_id: input.eventId ?? null,
      issued_at: input.now,
      issued_via: input.via,
      outbox_message_id: input.outboxMessageId ?? null,
      attempt_no: input.attemptNo ?? null,
      expires_at: input.expiresAt ?? null,
    })
    .execute();
  return raw;
}

export interface TokenRow {
  id: string;
  token_type: TokenType;
  registration_id: string | null;
  sign_in_request_id: string | null;
  event_id: string | null;
  issued_at: Date;
  expires_at: Date | null;
  revoked_at: Date | null;
}

/** Plain, non-locking lookup by hash and route type (NFR-CON-4 b). Null for unknown or malformed. */
export async function findToken(db: Database | Tx, type: TokenType, raw: string): Promise<TokenRow | null> {
  const hash = hashToken(type, raw);
  if (!hash) return null;
  const row = await db
    .selectFrom('app.access_tokens')
    .select(['id', 'token_type', 'registration_id', 'sign_in_request_id', 'event_id', 'issued_at', 'expires_at', 'revoked_at'])
    .where('token_hash', '=', hash)
    .where('token_type', '=', type)
    .executeTakeFirst();
  return row ?? null;
}

export async function revokeRegistrationTokens(
  trx: Tx,
  registrationId: string,
  type: TokenType,
  reason: 'resubmitted' | 'rotated',
  now: Date,
): Promise<void> {
  await trx
    .updateTable('app.access_tokens')
    .set({ revoked_at: now, revoke_reason: reason })
    .where('registration_id', '=', registrationId)
    .where('token_type', '=', type)
    .where('revoked_at', 'is', null)
    .execute();
}
