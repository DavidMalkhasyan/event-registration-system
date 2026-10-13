import { createHmac, timingSafeEqual } from 'node:crypto';
import { sql } from 'kysely';
import type { Database } from '../../platform/db.js';
import { AppError } from '../../platform/errors.js';
import { decisionTime } from '../../platform/tx.js';

// Delivery evidence (K-402, PD-98). Resend signs each webhook with Svix: HMAC-SHA256 over
// `${svix-id}.${svix-timestamp}.${raw body}` with the base64 secret after `whsec_`, sent as
// space-separated `v1,<base64>` signatures (https://docs.svix.com/receiving/verifying-payloads/how-manual,
// read 2026-10-13). Only verified events within five minutes of their timestamp are accepted; each is
// stored once (by its svix-id), matched to an outbox generation by the provider's email ID (or our tags),
// and the generation's delivery facts are recomputed from all of its events. Evidence of acceptance
// settles a message whose outcome was unknown as ACCEPTED; contradicting evidence for a FAILED or
// DROPPED message is only flagged (evidence_anomaly_at), never rewritten (D-13). Nothing personal is
// stored: no recipient, subject or link, only the event type, IDs, times and the bounce kind.

export const TOLERANCE_SECONDS = 300;

/** Verifies a Svix signature; false for anything malformed, old, from the future or not matching. */
export function verifySvix(
  secret: string,
  headers: { id?: string; timestamp?: string; signature?: string },
  rawBody: string,
  nowSeconds: number,
): boolean {
  const { id, timestamp, signature } = headers;
  if (!id || !timestamp || !signature || !/^\d{1,12}$/.test(timestamp)) return false;
  if (Math.abs(nowSeconds - Number(timestamp)) > TOLERANCE_SECONDS) return false;
  const key = Buffer.from(secret.replace(/^whsec_/, ''), 'base64');
  if (key.length === 0) return false;
  const expected = createHmac('sha256', key).update(`${id}.${timestamp}.${rawBody}`).digest();
  return signature.split(' ').some((part) => {
    const [version, value] = part.split(',');
    if (version !== 'v1' || !value) return false;
    const given = Buffer.from(value, 'base64');
    return given.length === expected.length && timingSafeEqual(given, expected);
  });
}

// Events that prove Resend accepted the message (D-12): the outcome is no longer unknown.
const ACCEPTANCE = new Set([
  'email.sent',
  'email.delivered',
  'email.delivery_delayed',
  'email.bounced',
  'email.complained',
  'email.opened',
  'email.clicked',
]);

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface ResendEvent {
  type?: unknown;
  created_at?: unknown;
  data?: {
    email_id?: unknown;
    tags?: unknown;
    bounce?: { type?: unknown; subType?: unknown };
  };
}

const str = (v: unknown, max = 128) => (typeof v === 'string' && v.length > 0 ? v.slice(0, max) : null);

/** Tags as Resend reports them: an object, or an array of { name, value }. */
function tagOf(tags: unknown, name: string): string | null {
  if (Array.isArray(tags))
    return str((tags as { name?: unknown; value?: unknown }[]).find((t) => t?.name === name)?.value);
  if (tags && typeof tags === 'object') return str((tags as Record<string, unknown>)[name]);
  return null;
}

/** POST /api/webhooks/resend after verification. Returns what happened, for the response and tests. */
export async function recordProviderEvent(
  db: Database,
  svixId: string,
  rawBody: string,
): Promise<'stored' | 'duplicate'> {
  let event: ResendEvent;
  try {
    event = JSON.parse(rawBody) as ResendEvent;
  } catch {
    throw new AppError(400, 'bad_request');
  }
  const type = str(event.type, 64);
  if (!type) throw new AppError(400, 'bad_request');
  const emailId = str(event.data?.email_id);
  const tagOutbox = tagOf(event.data?.tags, 'outbox_id');
  const tagGeneration = Number(tagOf(event.data?.tags, 'generation'));
  const createdAt = str(event.created_at, 40);
  const providerCreatedAt = createdAt && !Number.isNaN(Date.parse(createdAt)) ? new Date(createdAt) : null;
  const bounceKind = event.data?.bounce ? str(event.data.bounce.type, 32) : null;
  const bounceSub = event.data?.bounce ? str(event.data.bounce.subType, 32) : null;

  return db.transaction().execute(async (trx) => {
    const now = await decisionTime(trx);
    const inserted = await trx
      .insertInto('app.provider_events')
      .values({
        svix_id: svixId.slice(0, 128),
        event_type: type,
        provider_email_id: emailId,
        tag_outbox_id: tagOutbox && UUID.test(tagOutbox) ? tagOutbox : null,
        tag_generation: tagGeneration === 1 || tagGeneration === 2 ? tagGeneration : null,
        provider_created_at: providerCreatedAt,
        received_at: now,
        bounce_kind: bounceKind,
        reason_masked: bounceKind ? [bounceKind, bounceSub].filter(Boolean).join('/') : null,
        payload_masked: JSON.stringify({ type, email_id: emailId, created_at: createdAt }),
      })
      .onConflict((oc) => oc.column('svix_id').doNothing())
      .returning('id')
      .executeTakeFirst();
    if (!inserted) return 'duplicate' as const; // Svix redelivers; the first copy counts

    // Match: the provider's email ID first, then our tags.
    let generation = emailId
      ? await trx
          .selectFrom('app.outbox_generations')
          .select(['outbox_id', 'generation'])
          .where('provider_message_id', '=', emailId)
          .executeTakeFirst()
      : undefined;
    let method: 'provider_id' | 'tag' = 'provider_id';
    if (!generation && tagOutbox && UUID.test(tagOutbox)) {
      generation = await trx
        .selectFrom('app.outbox_generations')
        .select(['outbox_id', 'generation'])
        .where('outbox_id', '=', tagOutbox)
        .where('generation', '=', tagGeneration === 2 ? 2 : 1)
        .executeTakeFirst();
      method = 'tag';
    }
    if (!generation) return 'stored' as const; // kept as evidence; nothing to update

    await trx
      .insertInto('app.provider_event_matches')
      .values({ provider_event_id: inserted.id, ...generation, method, matched_at: now })
      .execute();

    // Recompute the generation's facts from all of its matched events (arrival order does not matter).
    await sql`
      UPDATE app.outbox_generations g SET
        delivered_at = f.delivered, bounced_at = f.bounced, complained_at = f.complained,
        failed_at = f.failed, suppressed_at = f.suppressed, last_delayed_at = f.delayed,
        failure_reason = f.reason, facts_updated_at = ${now}
      FROM (
        SELECT
          min(e.provider_created_at) FILTER (WHERE e.event_type = 'email.delivered') AS delivered,
          min(e.provider_created_at) FILTER (WHERE e.event_type = 'email.bounced') AS bounced,
          min(e.provider_created_at) FILTER (WHERE e.event_type = 'email.complained') AS complained,
          min(e.provider_created_at) FILTER (WHERE e.event_type = 'email.failed') AS failed,
          min(e.provider_created_at) FILTER (WHERE e.event_type = 'email.suppressed') AS suppressed,
          max(e.provider_created_at) FILTER (WHERE e.event_type = 'email.delivery_delayed') AS delayed,
          (array_agg(e.reason_masked ORDER BY e.provider_created_at) FILTER (WHERE e.reason_masked IS NOT NULL))[1] AS reason
        FROM app.provider_event_matches m JOIN app.provider_events e ON e.id = m.provider_event_id
        WHERE m.outbox_id = ${generation.outbox_id} AND m.generation = ${generation.generation}
      ) f
      WHERE g.outbox_id = ${generation.outbox_id} AND g.generation = ${generation.generation}`.execute(trx);

    if (ACCEPTANCE.has(type)) {
      const message = await trx
        .selectFrom('app.outbox_messages')
        .select(['status'])
        .where('id', '=', generation.outbox_id)
        .forUpdate()
        .executeTakeFirst();
      if (message && ['AWAITING_EVIDENCE', 'UNCONFIRMED', 'WAITING_RETRY'].includes(message.status)) {
        await trx
          .updateTable('app.outbox_messages')
          .set({
            status: 'ACCEPTED',
            settle_reason: 'provider_evidence',
            settled_at: now,
            lease_expires_at: null,
            awaiting_evidence_since: null,
          })
          .where('id', '=', generation.outbox_id)
          .execute();
        await trx
          .updateTable('app.outbox_generations')
          .set({ accepted_at: sql`coalesce(accepted_at, ${now})` })
          .where('outbox_id', '=', generation.outbox_id)
          .where('generation', '=', generation.generation)
          .execute();
      } else if (message && ['FAILED', 'DROPPED'].includes(message.status)) {
        await trx
          .updateTable('app.outbox_messages')
          .set({ evidence_anomaly_at: now })
          .where('id', '=', generation.outbox_id)
          .execute();
      }
    }
    return 'stored' as const;
  });
}
