// ADR-017: RFC 9457 Problem Details with stable codes, plus the generic link-error contract.

export type ProblemCode =
  | 'bad_request'
  | 'validation_failed'
  | 'unauthenticated'
  | 'reauthentication_required'
  | 'csrf_failed'
  | 'origin_check_failed'
  | 'forbidden'
  | 'not_found'
  | 'registration_closed'
  | 'event_not_scheduled'
  | 'event_started'
  | 'capacity_decrease_not_allowed'
  | 'organization_not_active'
  | 'invalid_credentials'
  | 'email_verification_required'
  | 'organization_required'
  | 'invalid_transition'
  | 'cancelled_event_not_deletable'
  | 'deletion_blocked'
  | 'notifications_pending'
  | 'preview_invalid'
  | 'not_confirmed'
  | 'request_already_processed'
  | 'rotation_not_available'
  | 'rotation_not_applied'
  | 'resend_limit'
  | 'rotation_limit'
  | 'invitation_not_pending'
  | 'check_in_window_ended'
  | 'check_in_already_undone'
  | 'not_waitlisted'
  | 'registration_not_confirmed'
  | 'schedule_version_mismatch'
  | 'location_version_mismatch'
  | 'image_rejected'
  | 'image_too_large'
  | 'cover_exists'
  | 'gallery_full'
  | 'gallery_changed'
  | 'unsupported_media_type'
  | 'already_member'
  | 'last_owner'
  | 'map_tile_unavailable'
  | 'nonexistent_local_time'
  | 'ambiguous_local_time'
  | 'start_not_in_future'
  | 'request_id_reused'
  | 'cancellation_closed'
  | 'ticket_checked_in'
  | 'request_id_conflict'
  | 'rate_limited'
  | 'internal_error'
  | 'service_unavailable';

const TITLES: Record<ProblemCode, string> = {
  bad_request: 'Bad request',
  validation_failed: 'Validation failed',
  unauthenticated: 'Sign-in required',
  reauthentication_required: 'Recent sign-in required',
  csrf_failed: 'Request could not be verified',
  origin_check_failed: 'Request origin not allowed',
  forbidden: 'Not allowed',
  not_found: 'Not found',
  registration_closed: 'Registration is closed',
  event_not_scheduled: 'The event is not scheduled',
  event_started: 'The event has started',
  capacity_decrease_not_allowed: 'Capacity can only be increased',
  organization_not_active: 'Your organization is not active',
  invalid_credentials: 'The email address or password is not correct',
  email_verification_required: 'Confirm your email address first',
  organization_required: 'Choose the organization for this event',
  invalid_transition: 'This decision is not possible in the organization’s current state',
  cancelled_event_not_deletable: "Cancelled events can't be deleted",
  deletion_blocked: 'The event cannot be deleted yet',
  notifications_pending: 'Notifications are still being sent; try again later',
  preview_invalid: 'The deletion preview is no longer valid; review it again',
  not_confirmed: 'This registration has no ticket',
  request_already_processed: 'This request was already processed. Please start again.',
  rotation_not_available: 'This link cannot be replaced for this registration',
  rotation_not_applied: 'Your link was not changed. Your current link still works. Please try again.',
  resend_limit: 'Too many ticket emails were requested. Please try again later.',
  rotation_limit: 'Too many link replacements. Please try again later.',
  invitation_not_pending: 'This invitation is no longer pending',
  check_in_window_ended: 'The check-in window of this event has ended',
  check_in_already_undone: 'This check-in was already undone',
  not_waitlisted: 'This registration is no longer on the waiting list',
  registration_not_confirmed: 'This registration is no longer confirmed',
  schedule_version_mismatch: 'The event was changed by another request; reload and try again',
  location_version_mismatch: 'The location was changed in the meantime; reload and try again',
  image_rejected: 'This file is not a JPEG, PNG or WebP image of at least 200 × 200 pixels',
  image_too_large: 'Images can be at most 10 MB',
  cover_exists: 'The event already has a cover image; replace it instead',
  gallery_full: 'The gallery already has 8 images',
  gallery_changed: 'The gallery was changed in the meantime; reload and try again',
  unsupported_media_type: 'Send the image file itself as the request body',
  already_member: 'This person is already a member of the organization',
  last_owner: 'An organization needs at least one owner',
  map_tile_unavailable: 'The map could not be loaded right now',
  nonexistent_local_time: 'This local time does not exist in the time zone',
  ambiguous_local_time: 'This local time is ambiguous in the time zone',
  start_not_in_future: 'The start must be in the future',
  request_id_reused: 'This request ID was already used for different data',
  cancellation_closed: 'Cancellation is no longer possible',
  ticket_checked_in: 'A checked-in ticket cannot be cancelled',
  request_id_conflict: 'This request ID belongs to another session',
  rate_limited: 'Too many requests',
  internal_error: 'Internal error',
  service_unavailable: 'Service unavailable',
};

export class AppError extends Error {
  constructor(
    readonly status: number,
    readonly code: ProblemCode,
    readonly extras: Record<string, unknown> = {},
    readonly detail?: string,
  ) {
    super(code);
  }
}

export const problems = {
  notFound: () => new AppError(404, 'not_found'),
  unauthenticated: () => new AppError(401, 'unauthenticated'),
  forbidden: () => new AppError(403, 'forbidden'),
  conflict: (code: ProblemCode, extras: Record<string, unknown> = {}) => new AppError(409, code, extras),
  validation: (errors: { field: string; code: string }[]) =>
    new AppError(422, 'validation_failed', { errors }),
  rateLimited: (retryAfterSeconds: number) => new AppError(429, 'rate_limited', { retryAfterSeconds }),
};

/** Thrown for every unusable link token; rendered as the fixed generic body (FR-LNK-7). */
export class InvalidLinkError extends Error {
  constructor(readonly rateLimited = false) {
    super('invalid_link');
  }
}

export const GENERIC_INVALID_LINK_BODY =
  '{"code":"invalid_link","message":"This link is not valid or has expired.","hint":"If you were trying to register, please start again from the event page."}';

export function problemBody(error: AppError, correlationId: string): Record<string, unknown> {
  const { retryAfterSeconds: _retry, ...extras } = error.extras;
  return {
    type: 'about:blank',
    title: TITLES[error.code],
    status: error.status,
    code: error.code,
    ...(error.detail ? { detail: error.detail } : {}),
    ...extras,
    correlationId,
  };
}

export function serverProblem(status: 500 | 503, correlationId: string): Record<string, unknown> {
  return {
    type: 'about:blank',
    title: status === 503 ? 'Service unavailable' : 'Internal error',
    status,
    code: status === 503 ? 'service_unavailable' : 'internal_error',
    correlationId,
  };
}
