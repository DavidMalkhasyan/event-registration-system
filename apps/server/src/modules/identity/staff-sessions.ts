import type { FastifyRequest } from 'fastify';
import type { AppContext } from '../../composition/context.js';
import { hashToken, safeEqual } from '../../platform/crypto.js';
import { AppError } from '../../platform/errors.js';
import { checkInWindow } from '../../platform/time.js';
import { decisionTime, type Tx } from '../../platform/tx.js';
import { csrfTokenFor, resolveOrganizer, type OrganizerPrincipal } from './sessions.js';

// Staff device sessions (FR-STAFF-2, ADR-010 §3 and §5, D-4): a separate __Host- cookie, stored only
// as a hash, limited to one event's check-in interface and checked-in count. Valid while not revoked,
// within the absolute (30 days) and idle (7 days) limits, the event SCHEDULED and its check-in window
// open (DATABASE_DESIGN §5.4). Checked on every request and again after the event lock.

export const STAFF_COOKIE = '__Host-ers_staff';
export const STAFF_SESSION_ABSOLUTE_MS = 720 * 3_600_000;
const STAFF_SESSION_IDLE_MS = 168 * 3_600_000;
const LAST_SEEN_THROTTLE_MS = 5 * 60_000;

export interface StaffPrincipal {
  kind: 'staff';
  staffSessionId: string;
  eventId: string;
}

export type EventPrincipal = ({ kind: 'owner' } & OrganizerPrincipal) | StaffPrincipal;

interface StaffRow {
  id: string;
  event_id: string;
  created_at: Date;
  last_seen_at: Date;
  absolute_expires_at: Date;
  revoked_at: Date | null;
  status: string;
  starts_at: Date;
}

function staffValid(row: StaffRow | undefined, now: Date): row is StaffRow {
  return (
    !!row &&
    !row.revoked_at &&
    now < row.absolute_expires_at &&
    now.getTime() < row.last_seen_at.getTime() + STAFF_SESSION_IDLE_MS &&
    row.status === 'SCHEDULED' &&
    now <= checkInWindow(row.starts_at).closes
  );
}

/** Resolves the staff session cookie; null when absent or no longer valid. */
export async function resolveStaff(ctx: AppContext, request: FastifyRequest): Promise<StaffPrincipal | null> {
  const raw = request.cookies[STAFF_COOKIE];
  if (!raw) return null;
  const hash = hashToken('staff_session', raw);
  if (!hash) return null;
  const row = await ctx.db
    .selectFrom('app.staff_sessions as s')
    .innerJoin('app.events as e', 'e.id', 's.event_id')
    .select([
      's.id',
      's.event_id',
      's.created_at',
      's.last_seen_at',
      's.absolute_expires_at',
      's.revoked_at',
      'e.status',
      'e.starts_at',
    ])
    .where('s.session_hash', '=', hash)
    .executeTakeFirst();
  const now = await decisionTime(ctx.db);
  if (!staffValid(row, now)) return null;
  if (now.getTime() - row.last_seen_at.getTime() > LAST_SEEN_THROTTLE_MS) {
    // Own single-row statement, never inside an event-locked transaction (D-4).
    await ctx.db
      .updateTable('app.staff_sessions')
      .set({ last_seen_at: now })
      .where('id', '=', row.id)
      .where('last_seen_at', '<', new Date(now.getTime() - LAST_SEEN_THROTTLE_MS))
      .execute();
  }
  return { kind: 'staff', staffSessionId: row.id, eventId: row.event_id };
}

/**
 * Re-check after the event lock (FR-STAFF-2, AC-156). The row is read FOR SHARE; revocation
 * (TX-S03) runs under the exclusive event lock, so a check-in and a revocation are serialized and
 * no check-in commits after a revocation has committed.
 */
export async function staffStillValid(trx: Tx, staffSessionId: string, now: Date): Promise<boolean> {
  const row = await trx
    .selectFrom('app.staff_sessions as s')
    .innerJoin('app.events as e', 'e.id', 's.event_id')
    .select([
      's.id',
      's.event_id',
      's.created_at',
      's.last_seen_at',
      's.absolute_expires_at',
      's.revoked_at',
      'e.status',
      'e.starts_at',
    ])
    .where('s.id', '=', staffSessionId)
    .forShare('s')
    .executeTakeFirst();
  return staffValid(row, now);
}

function checkCsrf(ctx: AppContext, request: FastifyRequest, kind: 'org' | 'staff', sessionId: string) {
  const header = request.headers['x-csrf-token'];
  if (typeof header !== 'string' || !safeEqual(header, csrfTokenFor(ctx.config.CSRF_SECRET, kind, sessionId)))
    throw new AppError(403, 'csrf_failed');
}

/**
 * For the routes open to owners and staff (check-in, count, live stream; PD-56): the organizer
 * session first, otherwise a staff session, which must belong to this event (else 404, without
 * revealing whether the event exists).
 */
export async function requireEventPrincipal(
  ctx: AppContext,
  request: FastifyRequest,
  eventId: string,
  options: { csrf: boolean },
): Promise<EventPrincipal> {
  const organizer = await resolveOrganizer(ctx, request);
  if (organizer) {
    if (options.csrf) checkCsrf(ctx, request, 'org', organizer.sessionId);
    return { kind: 'owner', ...organizer };
  }
  const staff = await resolveStaff(ctx, request);
  if (!staff) throw new AppError(401, 'unauthenticated');
  if (staff.eventId !== eventId) throw new AppError(404, 'not_found');
  if (options.csrf) checkCsrf(ctx, request, 'staff', staff.staffSessionId);
  return staff;
}
