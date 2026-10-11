import { sql } from 'kysely';
import { z } from 'zod';
import type { AppContext } from '../../composition/context.js';
import { canonicalJson, hmac, safeEqual, sha256 } from '../../platform/crypto.js';
import { AppError } from '../../platform/errors.js';
import { withEventLock, type LockedEvent, type Tx } from '../../platform/tx.js';
import { recordAudit } from '../audit/audit.js';
import { requireRecentAuthentication, type OrganizerPrincipal } from '../identity/sessions.js';

// Event deletion (K-304d): FR-EVT-10, FR-EVT-11, FR-EVT-13, FR-EVT-14, BR-26, BR-29; TX-E06;
// API #37 getDeletionPreview and #38 deleteEvent; API_DESIGN §7.4; PD-43 to PD-46.

const PREVIEW_TTL_MS = 10 * 60_000;
const PENDING = ['QUEUED', 'SENDING', 'WAITING_RETRY', 'AWAITING_EVIDENCE'] as const; // Glossary: pending message
const PREVIEW_TOKEN = /^v1\.[0-9]{1,5}\.[0-9]{10}\.[A-Za-z0-9_-]{43}$/;

export const deleteEventSchema = z
  .object({ confirmed: z.literal(true), previewToken: z.string().regex(PREVIEW_TOKEN) })
  .strict();

type Blocker =
  | 'event_cancelled'
  | 'has_confirmed_registrations'
  | 'has_waitlisted_registrations'
  | 'notifications_pending';

interface NoticeIssue {
  outboxId: string;
  registrationId: string;
  messageType: string;
  sendState: 'FAILED' | 'UNCONFIRMED';
  reason: string | null;
  settledAt: string;
}

/** The eligibility state the preview shows and the deletion re-checks (API_DESIGN §7.4). */
interface Snapshot {
  status: string;
  scheduleVersion: number;
  confirmed: number;
  waitlisted: number;
  pendingRequired: number;
  issues: NoticeIssue[];
}

async function snapshotOf(trx: Tx, event: LockedEvent): Promise<Snapshot> {
  const waiting = await trx
    .selectFrom('app.registrations')
    .select((eb) => eb.fn.countAll<number>().as('n'))
    .where('event_id', '=', event.id)
    .where('state', '=', 'WAITLISTED')
    .executeTakeFirstOrThrow();
  const pending = await trx
    .selectFrom('app.outbox_messages')
    .select((eb) => eb.fn.countAll<number>().as('n'))
    .where('event_id', '=', event.id)
    .where('is_required_notice', '=', true)
    .where('status', 'in', [...PENDING])
    .executeTakeFirstOrThrow();
  // Settled required notices that need the owner's attention (FR-DSH-6, BR-29).
  const issues = await trx
    .selectFrom('app.outbox_messages')
    .select(['id', 'registration_id', 'message_type', 'status', 'settle_reason', 'settled_at'])
    .where('event_id', '=', event.id)
    .where('is_required_notice', '=', true)
    .where('status', 'in', ['FAILED', 'UNCONFIRMED'])
    .orderBy('id')
    .execute();
  return {
    status: event.status,
    scheduleVersion: event.schedule_version,
    confirmed: event.confirmed_count,
    waitlisted: Number(waiting.n),
    pendingRequired: Number(pending.n),
    issues: issues.map((m) => ({
      outboxId: m.id,
      registrationId: m.registration_id!,
      messageType: m.message_type,
      sendState: m.status as 'FAILED' | 'UNCONFIRMED',
      reason: m.settle_reason,
      settledAt: m.settled_at!.toISOString(),
    })),
  };
}

function blockersOf(s: Snapshot): Blocker[] {
  const blockers: Blocker[] = [];
  if (s.status === 'CANCELLED') blockers.push('event_cancelled');
  if (s.confirmed > 0) blockers.push('has_confirmed_registrations');
  if (s.waitlisted > 0) blockers.push('has_waitlisted_registrations');
  if (s.pendingRequired > 0) blockers.push('notifications_pending');
  return blockers;
}

function previewMac(secret: string, accountId: string, s: Snapshot, eventId: string, exp: number): string {
  const snapshotHash = sha256(canonicalJson(s)).toString('hex');
  return hmac(
    secret,
    'ers/preview/v1',
    accountId,
    eventId,
    String(s.scheduleVersion),
    String(exp),
    snapshotHash,
  );
}

/** PD-45: without provider facts, the owner-facing label follows the send state (NFR-REL-11). */
const LABEL = { FAILED: 'failed', UNCONFIRMED: 'delivery_outcome_unknown' } as const;

/** GET /api/events/:id/deletion-preview (API #37): read-only; recent authentication required. */
export async function getDeletionPreview(ctx: AppContext, principal: OrganizerPrincipal, eventId: string) {
  if (!z.uuid().safeParse(eventId).success) throw new AppError(404, 'not_found');
  const result = await withEventLock(ctx.db, eventId, 'shared', async ({ trx, now, event }) => {
    if (event.owner_account_id !== principal.accountId) return null;
    await requireRecentAuthentication(trx, principal.sessionId, now);
    const snapshot = await snapshotOf(trx, event);
    const exp = Math.floor((now.getTime() + PREVIEW_TTL_MS) / 1000);
    const blockers = blockersOf(snapshot);
    return {
      eligible: blockers.length === 0,
      blockers,
      requiredNoticeIssues: snapshot.issues.map((i) => ({
        registrationId: i.registrationId,
        messageType: i.messageType,
        sendState: i.sendState,
        label: LABEL[i.sendState],
        ...(i.reason ? { reason: i.reason } : {}),
      })),
      previewToken: `v1.1.${exp}.${previewMac(ctx.config.PREVIEW_SECRET, principal.accountId, snapshot, eventId, exp)}`,
      previewExpiresAt: new Date(exp * 1000).toISOString(),
    };
  });
  if (!result) throw new AppError(404, 'not_found');
  return result;
}

/**
 * POST /api/events/:id/deletion (API #38, TX-E06). Under the exclusive event lock, so it is
 * serialized with verification, promotion, cancellation and every other event operation
 * (FR-EVT-13). Check order (PD-46): owner; session and recent authentication; a cancelled
 * event (AC-86); the preview token against the CURRENT snapshot, so the owner deletes exactly
 * what the preview showed; eligibility. Then, in one transaction: the marker counts (FR-EVT-14),
 * settling pending non-required messages (never a required notice, BR-29), the marker, the
 * audit record, explicit child deletes in dependency order (§8.4) and the event row.
 */
export async function deleteEvent(
  ctx: AppContext,
  principal: OrganizerPrincipal,
  eventId: string,
  input: z.infer<typeof deleteEventSchema>,
): Promise<void> {
  if (!z.uuid().safeParse(eventId).success) throw new AppError(404, 'not_found');
  const result = await withEventLock(ctx.db, eventId, 'exclusive', async ({ trx, now, event }) => {
    if (event.owner_account_id !== principal.accountId) return { error: new AppError(404, 'not_found') };
    await requireRecentAuthentication(trx, principal.sessionId, now);
    if (event.status === 'CANCELLED') return { error: new AppError(409, 'cancelled_event_not_deletable') };

    const snapshot = await snapshotOf(trx, event);
    const [, , expText, mac] = input.previewToken.split('.');
    const exp = Number(expText);
    const valid =
      exp * 1000 > now.getTime() &&
      safeEqual(mac!, previewMac(ctx.config.PREVIEW_SECRET, principal.accountId, snapshot, eventId, exp));
    if (!valid) return { error: new AppError(409, 'preview_invalid') };
    const blockers = blockersOf(snapshot);
    if (blockers.some((b) => b === 'has_confirmed_registrations' || b === 'has_waitlisted_registrations'))
      return { error: new AppError(409, 'deletion_blocked', { reasons: blockers }) };
    if (blockers.includes('notifications_pending'))
      return { error: new AppError(409, 'notifications_pending') };

    // FR-EVT-14 counts, as a snapshot in this transaction (PD-45: send states only, no provider facts).
    const registrations = await trx
      .selectFrom('app.registrations')
      .select((eb) => eb.fn.countAll<number>().as('n'))
      .where('event_id', '=', eventId)
      .executeTakeFirstOrThrow();
    const notices = await trx
      .selectFrom('app.outbox_messages')
      .select(['status'])
      .where('event_id', '=', eventId)
      .where('is_required_notice', '=', true)
      .execute();
    const failed = notices.filter((n) => n.status === 'FAILED').length;
    const unconfirmed = notices.filter((n) => n.status === 'UNCONFIRMED').length;

    // FR-EVT-10: other pending messages settle; DROPPED only if nothing may have been submitted (D-12).
    await sql`UPDATE app.outbox_messages
      SET status = CASE WHEN possibly_accepted THEN 'UNCONFIRMED' ELSE 'DROPPED' END,
          settle_reason = 'event_deleted', settled_at = ${now}, lease_expires_at = NULL, preclaim_failures = 0
      WHERE event_id = ${eventId} AND NOT is_required_notice AND status IN ('QUEUED', 'WAITING_RETRY')`.execute(
      trx,
    );

    await trx
      .insertInto('app.deletion_markers')
      .values({
        event_id: eventId,
        owner_account_id: event.owner_account_id,
        scheduled_start: event.starts_at,
        time_zone: event.time_zone,
        deleted_at: now,
        deleted_by_account_id: principal.accountId,
        registrations_deleted: Number(registrations.n),
        failed_required_notices: failed,
        unconfirmed_required_notices: unconfirmed,
      })
      .execute();
    await recordAudit(trx, {
      now,
      action: 'event_deleted',
      actorKind: 'owner',
      actorAccountId: principal.accountId,
      eventId,
      outcome: 'success',
      details: { registrationsDeleted: Number(registrations.n) },
    });

    // §8.4: explicit, set-based deletes in dependency order; the CASCADE foreign keys stay as a safety net.
    // PD-47: rotation_requests first, because FK-17 and FK-18 to access_tokens are NO ACTION, not deferrable.
    await trx.deleteFrom('app.rotation_requests').where('event_id', '=', eventId).execute();
    await trx.deleteFrom('app.access_tokens').where('event_id', '=', eventId).execute();
    await trx.deleteFrom('app.reminder_slots').where('event_id', '=', eventId).execute();
    await trx.deleteFrom('app.check_in_requests').where('event_id', '=', eventId).execute();
    await trx.deleteFrom('app.check_ins').where('event_id', '=', eventId).execute();
    await trx.deleteFrom('app.tickets').where('event_id', '=', eventId).execute();
    await trx.deleteFrom('app.registrations').where('event_id', '=', eventId).execute();
    await trx.deleteFrom('app.events').where('id', '=', eventId).execute();
    return { error: null };
  });
  if (result === null) throw new AppError(404, 'not_found'); // already deleted: a repeat gets 404
  if (result.error) throw result.error;
}
