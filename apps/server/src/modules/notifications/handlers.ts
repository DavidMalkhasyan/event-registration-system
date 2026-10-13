import { DateTime } from 'luxon';
import type { Database } from '../../platform/db.js';
import { checkInWindow, cutoffOf } from '../../platform/time.js';
import type { Tx } from '../../platform/tx.js';
import { issueToken } from '../access-tokens/tokens.js';

// The §4.9 catalogue in code for the message types of this slice: freshness checks, link issuance
// at send time (FR-LNK-3) and deterministic rendering (NFR-REL-17). Texts are English (OQ-8 pending).

export interface OutboxRow {
  id: string;
  message_type: string;
  event_id: string | null;
  registration_id: string | null;
  sign_in_request_id: string | null;
  verification_generation: number | null;
  request_ref?: string | null;
  schedule_version?: number | null;
  recipient_email: string;
  payload: Record<string, unknown>;
}

export type Freshness =
  { fresh: true } | { fresh: false; reason: 'obsolete' | 'link_expiry' | 'request_replaced' };

export interface RenderedEmail {
  subject: string;
  text: string;
  html: string;
}

export interface MessageHandler {
  freshness(trx: Tx, msg: OutboxRow, now: Date): Promise<Freshness>;
  issueTokens(trx: Tx, msg: OutboxRow, now: Date, attemptNo: number): Promise<Record<string, string>>;
  render(
    db: Database,
    msg: OutboxRow,
    tokens: Record<string, string>,
    origin: string,
  ): Promise<RenderedEmail>;
}

const TRANSFER = 'This ticket can be transferred, but it admits one person, once.';
const FORWARD_WARNING = 'Anyone you forward this email or link to can manage or cancel this registration.';
const SHARE_HINT = 'To pass on only your ticket, send this share link instead of forwarding this email.';

function escapeHtml(value: string): string {
  return value.replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!,
  );
}

function localTime(startsAt: Date, zone: string): string {
  return `${DateTime.fromJSDate(startsAt, { zone }).toFormat('cccc d LLLL yyyy, HH:mm')} (${zone})`;
}

function email(subject: string, lines: (string | { link: string; label: string })[]): RenderedEmail {
  const text = lines.map((l) => (typeof l === 'string' ? l : `${l.label}: ${l.link}`)).join('\n\n');
  const html = lines
    .map((l) =>
      typeof l === 'string'
        ? `<p>${escapeHtml(l)}</p>`
        : `<p><a href="${escapeHtml(l.link)}">${escapeHtml(l.label)}</a></p>`,
    )
    .join('\n');
  return { subject, text, html };
}

async function eventOf(db: Database | Tx, eventId: string) {
  return db
    .selectFrom('app.events')
    .select(['title', 'starts_at', 'time_zone', 'status'])
    .where('id', '=', eventId)
    .executeTakeFirst();
}

async function registrationOf(db: Database | Tx, id: string) {
  return db
    .selectFrom('app.registrations')
    .select(['id', 'state', 'verification_generation', 'event_id'])
    .where('id', '=', id)
    .executeTakeFirst();
}

async function ticketCodeOf(db: Database, registrationId: string): Promise<string | undefined> {
  const row = await db
    .selectFrom('app.tickets')
    .select('code')
    .where('registration_id', '=', registrationId)
    .executeTakeFirst();
  return row?.code;
}

const signIn: MessageHandler = {
  async freshness(trx, msg, now) {
    // Claim only while active with at least 2 minutes left (NFR-REL-12 c). The request row is read FOR SHARE.
    const request = await trx
      .selectFrom('app.sign_in_requests')
      .select(['status', 'expires_at'])
      .where('id', '=', msg.sign_in_request_id!)
      .forShare()
      .executeTakeFirst();
    if (!request || request.status !== 'active') return { fresh: false, reason: 'request_replaced' };
    if (now.getTime() + 2 * 60_000 > request.expires_at.getTime())
      return { fresh: false, reason: 'link_expiry' };
    return { fresh: true };
  },
  async issueTokens(trx, msg, now, attemptNo) {
    const t = await issueToken(trx, {
      type: 'sign_in',
      now,
      signInRequestId: msg.sign_in_request_id!,
      via: 'email',
      outboxMessageId: msg.id,
      attemptNo,
    });
    return { signIn: t };
  },
  async render(db, msg, tokens, origin) {
    const request = await db
      .selectFrom('app.sign_in_requests')
      .select('purpose')
      .where('id', '=', msg.sign_in_request_id!)
      .executeTakeFirst();
    if (request?.purpose === 'reauth') {
      // FR-ORG-5, AC-149: the link only confirms identity; it never performs the action.
      return email('Confirm it is you: Event Registration', [
        'You asked to confirm your sign-in before a protected action, such as cancelling or deleting an event.',
        'Confirming this link only signs you in again. It does not cancel, delete or otherwise change any event. After confirming, return to the event and confirm the action yourself.',
        { label: 'Confirm it is you', link: `${origin}/sign-in#t=${tokens.signIn}` },
        'The link works once and expires 15 minutes after you requested it. Confirming it signs out the browser that asked for it and signs in the browser where you open it.',
        'If you did not request this, you can ignore this email.',
      ]);
    }
    return email('Your sign-in link for Event Registration', [
      'Use this link to sign in. It works once and expires 15 minutes after you requested it.',
      { label: 'Sign in', link: `${origin}/sign-in#t=${tokens.signIn}` },
      'If you did not request this, you can ignore this email.',
    ]);
  },
};

const verification: MessageHandler = {
  async freshness(trx, msg, now) {
    const registration = await registrationOf(trx, msg.registration_id!);
    const event = await eventOf(trx, msg.event_id!);
    const current =
      !!registration &&
      !!event &&
      registration.state === 'PENDING_VERIFICATION' &&
      registration.verification_generation === msg.verification_generation &&
      event.status === 'SCHEDULED' &&
      now < cutoffOf(event.starts_at);
    return current ? { fresh: true } : { fresh: false, reason: 'obsolete' };
  },
  async issueTokens(trx, msg, now, attemptNo) {
    const t = await issueToken(trx, {
      type: 'verification',
      now,
      registrationId: msg.registration_id!,
      eventId: msg.event_id!,
      via: 'email',
      outboxMessageId: msg.id,
      attemptNo,
      expiresAt: new Date(now.getTime() + 24 * 3_600_000),
    });
    return { verify: t };
  },
  async render(db, msg, tokens, origin) {
    const event = (await eventOf(db, msg.event_id!))!;
    return email(`Confirm your registration: ${event.title}`, [
      `Please confirm your registration for "${event.title}" on ${localTime(event.starts_at, event.time_zone)}.`,
      'Opening the link shows a confirmation page; your place is decided when you press "Confirm my registration".',
      { label: 'Confirm my registration', link: `${origin}/verify#t=${tokens.verify}` },
    ]);
  },
};

function registrationMessage(
  requiredState: 'CONFIRMED' | 'WAITLISTED' | 'ACTIVE',
  withShare: boolean,
): Pick<MessageHandler, 'freshness' | 'issueTokens'> {
  return {
    async freshness(trx, msg) {
      const registration = await registrationOf(trx, msg.registration_id!);
      const event = await eventOf(trx, msg.event_id!);
      const stateOk =
        requiredState === 'ACTIVE'
          ? !!registration && ['PENDING_VERIFICATION', 'CONFIRMED', 'WAITLISTED'].includes(registration.state)
          : registration?.state === requiredState;
      return stateOk && event?.status === 'SCHEDULED'
        ? { fresh: true }
        : { fresh: false, reason: 'obsolete' };
    },
    async issueTokens(trx, msg, now, attemptNo) {
      const common = {
        now,
        registrationId: msg.registration_id!,
        eventId: msg.event_id!,
        via: 'email' as const,
        outboxMessageId: msg.id,
        attemptNo,
      };
      const tokens: Record<string, string> = {
        manage: await issueToken(trx, { type: 'management', ...common }),
      };
      if (withShare) tokens.share = await issueToken(trx, { type: 'share', ...common });
      return tokens;
    },
  };
}

const ticketConfirmation: MessageHandler = {
  ...registrationMessage('CONFIRMED', true),
  async render(db, msg, tokens, origin) {
    const event = (await eventOf(db, msg.event_id!))!;
    const code = await ticketCodeOf(db, msg.registration_id!);
    return email(`Your ticket: ${event.title}`, [
      `Your registration for "${event.title}" on ${localTime(event.starts_at, event.time_zone)} is confirmed.`,
      `Ticket code: ${code ?? '(unavailable)'}`,
      TRANSFER,
      { label: 'Manage or cancel your registration', link: `${origin}/manage#t=${tokens.manage}` },
      FORWARD_WARNING,
      { label: 'Share ticket', link: `${origin}/ticket#t=${tokens.share}` },
      SHARE_HINT,
    ]);
  },
};

const waitlistConfirmation: MessageHandler = {
  ...registrationMessage('WAITLISTED', false),
  async render(db, msg, tokens, origin) {
    const event = (await eventOf(db, msg.event_id!))!;
    const position = Number(msg.payload.position ?? 0);
    return email(`You are on the waiting list: ${event.title}`, [
      `"${event.title}" on ${localTime(event.starts_at, event.time_zone)} is full. Your status is WAITLISTED.`,
      `Your position when this email was created: ${position}. This position can change; the management page always shows your current position.`,
      { label: 'Manage or cancel your registration', link: `${origin}/manage#t=${tokens.manage}` },
      FORWARD_WARNING,
    ]);
  },
};

const existingAccess: MessageHandler = {
  ...registrationMessage('ACTIVE', false),
  async render(db, msg, tokens, origin) {
    const event = (await eventOf(db, msg.event_id!))!;
    return email(`Your registration: ${event.title}`, [
      `Someone (hopefully you) tried to register this address for "${event.title}" again. You are already registered.`,
      { label: 'Open your registration', link: `${origin}/manage#t=${tokens.manage}` },
      FORWARD_WARNING,
    ]);
  },
};

const promotion: MessageHandler = {
  ...registrationMessage('CONFIRMED', true),
  async render(db, msg, tokens, origin) {
    const event = (await eventOf(db, msg.event_id!))!;
    const code = await ticketCodeOf(db, msg.registration_id!);
    return email(`A place became free: ${event.title}`, [
      `Good news: a place became free and your registration for "${event.title}" on ${localTime(event.starts_at, event.time_zone)} is now confirmed.`,
      `Ticket code: ${code ?? '(unavailable)'}`,
      TRANSFER,
      { label: 'Manage or cancel your registration', link: `${origin}/manage#t=${tokens.manage}` },
      FORWARD_WARNING,
      { label: 'Share ticket', link: `${origin}/ticket#t=${tokens.share}` },
      SHARE_HINT,
    ]);
  },
};

const reminder: MessageHandler = {
  async freshness(trx, msg, now) {
    // FR-NTF send-time checks: still CONFIRMED, event SCHEDULED, same schedule version, before Start.
    const registration = await registrationOf(trx, msg.registration_id!);
    const event = await trx
      .selectFrom('app.events')
      .select(['status', 'starts_at', 'schedule_version'])
      .where('id', '=', msg.event_id!)
      .executeTakeFirst();
    const fresh =
      registration?.state === 'CONFIRMED' &&
      event?.status === 'SCHEDULED' &&
      event.schedule_version === msg.schedule_version &&
      now < event.starts_at;
    return fresh ? { fresh: true } : { fresh: false, reason: 'obsolete' };
  },
  issueTokens: registrationMessage('CONFIRMED', false).issueTokens,
  async render(db, msg, tokens, origin) {
    const event = (await eventOf(db, msg.event_id!))!;
    const code = await ticketCodeOf(db, msg.registration_id!);
    return email(`Reminder: ${event.title} starts in 24 hours`, [
      `This is a reminder for "${event.title}" on ${localTime(event.starts_at, event.time_zone)}.`,
      `Ticket code: ${code ?? '(unavailable)'}`,
      { label: 'Manage or cancel your registration', link: `${origin}/manage#t=${tokens.manage}` },
      FORWARD_WARNING,
    ]);
  },
};

const eventChange: MessageHandler = {
  async freshness(trx, msg) {
    const registration = await registrationOf(trx, msg.registration_id!);
    const event = await trx
      .selectFrom('app.events')
      .select(['status', 'schedule_version'])
      .where('id', '=', msg.event_id!)
      .executeTakeFirst();
    const fresh =
      !!registration &&
      ['CONFIRMED', 'WAITLISTED'].includes(registration.state) &&
      event?.status === 'SCHEDULED' &&
      event.schedule_version === msg.schedule_version;
    return fresh ? { fresh: true } : { fresh: false, reason: 'obsolete' };
  },
  issueTokens: registrationMessage('ACTIVE', false).issueTokens,
  async render(db, msg, tokens, origin) {
    const event = (await eventOf(db, msg.event_id!))!;
    const lines: (string | { link: string; label: string })[] = [
      `"${event.title}" has been moved. The new date and time is ${localTime(event.starts_at, event.time_zone)}.`,
    ];
    if (msg.payload.registrationClosed === true) {
      lines.push('Registration for this event is now closed, and no place became available for you.');
    }
    lines.push(
      { label: 'Manage or cancel your registration', link: `${origin}/manage#t=${tokens.manage}` },
      FORWARD_WARNING,
    );
    return email(`Date changed: ${event.title}`, lines);
  },
};

const waitlistClosed: MessageHandler = {
  // §4.9 "Waiting list closed" (FR-WL-5): event SCHEDULED, version current, still WAITLISTED. No links.
  async freshness(trx, msg) {
    const registration = await registrationOf(trx, msg.registration_id!);
    const event = await trx
      .selectFrom('app.events')
      .select(['status', 'schedule_version'])
      .where('id', '=', msg.event_id!)
      .executeTakeFirst();
    const fresh =
      registration?.state === 'WAITLISTED' &&
      event?.status === 'SCHEDULED' &&
      event.schedule_version === msg.schedule_version;
    return fresh ? { fresh: true } : { fresh: false, reason: 'obsolete' };
  },
  async issueTokens() {
    return {};
  },
  async render(db, msg) {
    const event = (await eventOf(db, msg.event_id!))!;
    return email(`Registration closed: ${event.title}`, [
      `Registration for "${event.title}" on ${localTime(event.starts_at, event.time_zone)} is now closed, and no place became available for you.`,
      'You will not receive a ticket for this date. If the organizer moves the event to a later date, you will be told by email.',
    ]);
  },
};

const staffInvitation: MessageHandler = {
  // §4.9 "Staff invitation": invitation still pending and unexpired, event SCHEDULED, window open (PD-54).
  async freshness(trx, msg, now) {
    const invitation = await trx
      .selectFrom('app.staff_invitations as i')
      .innerJoin('app.events as e', 'e.id', 'i.event_id')
      .select(['i.status', 'i.expires_at', 'e.status as event_status', 'e.starts_at'])
      .where('i.id', '=', msg.request_ref!)
      .executeTakeFirst();
    const fresh =
      invitation?.status === 'pending' &&
      now < invitation.expires_at &&
      invitation.event_status === 'SCHEDULED' &&
      now <= checkInWindow(invitation.starts_at).closes;
    return fresh ? { fresh: true } : { fresh: false, reason: 'obsolete' };
  },
  async issueTokens(trx, msg, now, attemptNo) {
    // FR-STAFF-1: invitation tokens are hash-only and issued at send time.
    const t = await issueToken(trx, {
      type: 'staff_invitation',
      now,
      staffInvitationId: msg.request_ref!,
      eventId: msg.event_id!,
      via: 'email',
      outboxMessageId: msg.id,
      attemptNo,
    });
    return { invite: t };
  },
  async render(db, msg, tokens, origin) {
    const event = (await eventOf(db, msg.event_id!))!;
    return email(`You are invited to help with check-in: ${event.title}`, [
      `You have been invited to check in participants at "${event.title}" on ${localTime(event.starts_at, event.time_zone)}.`,
      'Open the link on the device you will use at the entrance and press "Accept". Opening the link alone does not give access.',
      { label: 'Open the invitation', link: `${origin}/invite#t=${tokens.invite}` },
      'The link works once and expires 7 days after it was sent. Whoever accepts it first gets check-in access, so do not forward it. Access ends when the check-in window closes or the organizer revokes it.',
    ]);
  },
};

const ticketResend: MessageHandler = {
  // §4.9 "Ticket resend": still CONFIRMED, event not cancelled; management and share links issued at send time.
  ...registrationMessage('CONFIRMED', true),
  async render(db, msg, tokens, origin) {
    const event = (await eventOf(db, msg.event_id!))!;
    const code = await ticketCodeOf(db, msg.registration_id!);
    return email(`Your ticket (resent): ${event.title}`, [
      `As requested, here is your ticket for "${event.title}" on ${localTime(event.starts_at, event.time_zone)}.`,
      `Ticket code: ${code ?? '(unavailable)'}`,
      TRANSFER,
      { label: 'Manage or cancel your registration', link: `${origin}/manage#t=${tokens.manage}` },
      FORWARD_WARNING,
      { label: 'Share ticket', link: `${origin}/ticket#t=${tokens.share}` },
      SHARE_HINT,
    ]);
  },
};

const managementLinkReplaced: MessageHandler = {
  // §4.9 "Management link replaced" (FR-ROT-5, FR-NTF-13): registration still active, event not cancelled.
  // Its management link is issued at send time, after the rotation, so it is valid (FR-ROT-3).
  ...registrationMessage('ACTIVE', false),
  async render(db, msg, tokens, origin) {
    const event = (await eventOf(db, msg.event_id!))!;
    return email(`Your management link was replaced: ${event.title}`, [
      `The management link for your registration for "${event.title}" on ${localTime(event.starts_at, event.time_zone)} was replaced. Earlier management links no longer work.`,
      { label: 'Your new management link', link: `${origin}/manage#t=${tokens.manage}` },
      FORWARD_WARNING,
      'If you did not do this, someone else may have had your link. Open the new link and replace it again. If you receive several of these emails, use the most recent one.',
    ]);
  },
};

const eventCancellation: MessageHandler = {
  // §4.9 "Event cancellation" (BR-16): no send-time check (the catalogue lists none), no links.
  // Created only by TX-E05, once per registration (logical key), so it can't become stale.
  async freshness() {
    return { fresh: true };
  },
  async issueTokens() {
    return {};
  },
  async render(db, msg) {
    const event = (await eventOf(db, msg.event_id!))!;
    const wasConfirmed = msg.payload.previousState === 'CONFIRMED';
    return email(`Event cancelled: ${event.title}`, [
      `The organizer has cancelled "${event.title}", which was planned for ${localTime(event.starts_at, event.time_zone)}.`,
      wasConfirmed
        ? 'Your registration is cancelled and your ticket is no longer valid. Please do not come to the event.'
        : 'Your registration is cancelled, and you are no longer on the waiting list.',
      'You do not need to do anything. Links in earlier emails about this event no longer work.',
    ]);
  },
};

const registrationCancelled: MessageHandler = {
  // A required notice: no freshness check, never dropped (BR-23, CK-69).
  async freshness() {
    return { fresh: true };
  },
  async issueTokens() {
    return {};
  },
  async render(db, msg) {
    const event = (await eventOf(db, msg.event_id!))!;
    const wasConfirmed = msg.payload.previousState === 'CONFIRMED';
    return email(`Registration cancelled: ${event.title}`, [
      `Your registration for "${event.title}" on ${localTime(event.starts_at, event.time_zone)} has been cancelled.`,
      wasConfirmed ? 'Your ticket is no longer valid.' : 'You have left the waiting list.',
      'If you did not cancel this registration, someone else may have had your management link.',
    ]);
  },
};

const waitlistRemoved: MessageHandler = {
  // FR-NTF-14: a required notice (BR-23, CK-69): no freshness check, never dropped, also after a
  // later event cancellation. No management or share link, no ticket wording.
  async freshness() {
    return { fresh: true };
  },
  async issueTokens() {
    return {};
  },
  async render(db, msg) {
    const event = (await eventOf(db, msg.event_id!))!;
    return email(`Removed from the waiting list: ${event.title}`, [
      `The organizer of "${event.title}" on ${localTime(event.starts_at, event.time_zone)} has removed you from the waiting list.`,
      'You are no longer on the waiting list for this event, and you will not be offered a place.',
    ]);
  },
};

const organizerCancellation: MessageHandler = {
  // K-703 (PD-83): a required notice (CK-69): no freshness check, never dropped, also after a later
  // event cancellation. No management or share link and no ticket code.
  async freshness() {
    return { fresh: true };
  },
  async issueTokens() {
    return {};
  },
  async render(db, msg) {
    const event = (await eventOf(db, msg.event_id!))!;
    return email(`Registration cancelled by the organizer: ${event.title}`, [
      `Your registration for "${event.title}" has been cancelled by the organizer.`,
      `The event: "${event.title}", ${localTime(event.starts_at, event.time_zone)}.`,
      'Your ticket is no longer valid, and links in earlier emails about this registration no longer work. Please do not come to the event with this ticket.',
      'If you have questions, please contact the organizer.',
    ]);
  },
};

/** K-709: links bound to an account request (verification, password reset), issued at send time. */
function accountLink(
  type: 'account_verification' | 'password_reset',
): Pick<MessageHandler, 'freshness' | 'issueTokens'> {
  return {
    async freshness(trx, msg, now) {
      const request = await trx
        .selectFrom('app.sign_in_requests')
        .select(['status', 'expires_at'])
        .where('id', '=', msg.sign_in_request_id!)
        .forShare()
        .executeTakeFirst();
      if (!request || request.status !== 'active') return { fresh: false, reason: 'request_replaced' };
      if (now.getTime() + 2 * 60_000 > request.expires_at.getTime())
        return { fresh: false, reason: 'link_expiry' };
      return { fresh: true };
    },
    async issueTokens(trx, msg, now, attemptNo) {
      const t = await issueToken(trx, {
        type,
        now,
        signInRequestId: msg.sign_in_request_id!,
        via: 'email',
        outboxMessageId: msg.id,
        attemptNo,
      });
      return { link: t };
    },
  };
}

const accountVerification: MessageHandler = {
  ...accountLink('account_verification'),
  async render(_db, _msg, tokens, origin) {
    return email('Confirm your email address: Event Registration', [
      'Thank you for registering your organization. Confirm your email address to send the registration for approval.',
      { label: 'Confirm my email address', link: `${origin}/verify-account#t=${tokens.link}` },
      'The link works once and expires 15 minutes after it was sent. For a new one, use “Forgot your password?” on the sign-in page: setting a password also confirms the address.',
      'If you did not register, you can ignore this email.',
    ]);
  },
};

const passwordReset: MessageHandler = {
  ...accountLink('password_reset'),
  async render(_db, _msg, tokens, origin) {
    return email('Set a new password: Event Registration', [
      'Use this link to set a new password for your organizer account.',
      { label: 'Set a new password', link: `${origin}/reset-password#t=${tokens.link}` },
      'The link works once and expires 15 minutes after it was sent. Setting a new password signs out every device that is signed in to your account.',
      'If you did not ask for this, you can ignore this email; your password stays as it is.',
    ]);
  },
};

const accountExistsNotice: MessageHandler = {
  // K-709: a registration was attempted with an address that already has an account (no link).
  async freshness() {
    return { fresh: true };
  },
  async issueTokens() {
    return {};
  },
  async render(_db, _msg, _tokens, origin) {
    return email('Your organizer account: Event Registration', [
      'Someone tried to register an organization with this email address, which already has an organizer account.',
      `If it was you, sign in at ${origin}/organizer, or reset your password from the sign-in page.`,
      'If it was not you, you can ignore this email; nothing was changed.',
    ]);
  },
};

export const HANDLERS: Record<string, MessageHandler> = {
  account_verification: accountVerification,
  password_reset: passwordReset,
  account_exists_notice: accountExistsNotice,
  sign_in: signIn,
  verification,
  ticket_confirmation: ticketConfirmation,
  waitlist_confirmation: waitlistConfirmation,
  existing_access: existingAccess,
  promotion,
  reminder,
  event_change: eventChange,
  waitlist_closed: waitlistClosed,
  registration_cancelled: registrationCancelled,
  waitlist_removed: waitlistRemoved,
  organizer_cancellation: organizerCancellation,
  event_cancellation: eventCancellation,
  ticket_resend: ticketResend,
  staff_invitation: staffInvitation,
  management_link_replaced: managementLinkReplaced,
};
