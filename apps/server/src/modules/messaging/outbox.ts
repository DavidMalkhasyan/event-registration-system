import type { Tx } from '../../platform/tx.js';

// §4.9 message-type policy (DATABASE_DESIGN §5.6.1, CK-48).
export const MESSAGE_POLICY = {
  verification: { regenClass: 'A', lane: 'bulk', required: false },
  existing_access: { regenClass: 'A', lane: 'bulk', required: false },
  ticket_resend: { regenClass: 'A', lane: 'bulk', required: false },
  management_link_replaced: { regenClass: 'A', lane: 'bulk', required: false },
  staff_invitation: { regenClass: 'A', lane: 'bulk', required: false },
  sign_in: { regenClass: 'A', lane: 'priority', required: false },
  email_change_confirmation: { regenClass: 'A', lane: 'priority', required: false },
  ticket_confirmation: { regenClass: 'B', lane: 'bulk', required: false },
  promotion: { regenClass: 'B', lane: 'bulk', required: false },
  event_change: { regenClass: 'B', lane: 'bulk', required: false },
  event_cancellation: { regenClass: 'B', lane: 'bulk', required: false },
  registration_cancelled: { regenClass: 'B', lane: 'bulk', required: true },
  waitlist_removed: { regenClass: 'B', lane: 'bulk', required: true },
  email_change_notice: { regenClass: 'B', lane: 'bulk', required: false },
  waitlist_confirmation: { regenClass: 'C', lane: 'bulk', required: false },
  reminder: { regenClass: 'C', lane: 'bulk', required: false },
  waitlist_closed: { regenClass: 'C', lane: 'bulk', required: false },
} as const;

export type MessageType = keyof typeof MESSAGE_POLICY;

export const DEFAULT_RETRY_HORIZON_MS = 6 * 3_600_000; // NFR-REL-4 (provisional, OQ-9)

export interface EnqueueInput {
  /** Optional pre-generated ID, used when a reminder slot is claimed for the message (FR-NTF-2a). */
  id?: string;
  type: MessageType;
  logicalKey: string;
  recipientEmail: string;
  now: Date;
  horizonAt?: Date;
  eventId?: string | null;
  registrationId?: string | null;
  accountId?: string | null;
  signInRequestId?: string | null;
  scheduleVersion?: number | null;
  verificationGeneration?: number | null;
  requestRef?: string | null;
  payload?: Record<string, unknown>;
  correlationId: string;
}

/** Inserts a logical message in the caller's transaction (NFR-REL-1, BR-18). Idempotent by logical key. */
export async function enqueue(trx: Tx, input: EnqueueInput): Promise<void> {
  const policy = MESSAGE_POLICY[input.type];
  await trx
    .insertInto('app.outbox_messages')
    .values({
      ...(input.id ? { id: input.id } : {}),
      logical_key: input.logicalKey,
      message_type: input.type,
      lane: policy.lane,
      regen_class: policy.regenClass,
      is_required_notice: policy.required,
      event_id: input.eventId ?? null,
      registration_id: input.registrationId ?? null,
      account_id: input.accountId ?? null,
      sign_in_request_id: input.signInRequestId ?? null,
      schedule_version: input.scheduleVersion ?? null,
      verification_generation: input.verificationGeneration ?? null,
      request_ref: input.requestRef ?? null,
      recipient_email: input.recipientEmail,
      payload: JSON.stringify(input.payload ?? {}),
      next_attempt_at: input.now,
      horizon_at: input.horizonAt ?? new Date(input.now.getTime() + DEFAULT_RETRY_HORIZON_MS),
      created_at: input.now,
      correlation_id: input.correlationId,
    })
    .onConflict((oc) => oc.column('logical_key').doNothing())
    .execute();
}
