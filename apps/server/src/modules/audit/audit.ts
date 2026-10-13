import type { Tx } from '../../platform/tx.js';

// NFR-SEC-5: audit records hold opaque IDs only (never emails, tokens or hashes).
export interface AuditInput {
  now: Date;
  action: string;
  actorKind: 'owner' | 'staff' | 'participant_link' | 'system' | 'account' | 'platform_admin';
  actorAccountId?: string | null;
  actorAdminId?: string | null;
  actorStaffSessionId?: string | null;
  eventId?: string | null;
  registrationId?: string | null;
  ticketId?: string | null;
  subjectId?: string | null;
  outcome: string;
  details?: Record<string, string | number | boolean | null>;
}

export async function recordAudit(trx: Tx, input: AuditInput): Promise<void> {
  await trx
    .insertInto('app.audit_records')
    .values({
      occurred_at: input.now,
      action: input.action,
      actor_kind: input.actorKind,
      actor_account_id: input.actorAccountId ?? null,
      actor_admin_id: input.actorAdminId ?? null,
      actor_staff_session_id: input.actorStaffSessionId ?? null,
      event_id: input.eventId ?? null,
      registration_id: input.registrationId ?? null,
      ticket_id: input.ticketId ?? null,
      subject_id: input.subjectId ?? null,
      outcome: input.outcome,
      details: JSON.stringify(input.details ?? {}),
    })
    .execute();
}
