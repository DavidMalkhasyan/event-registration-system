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
  | 'capacity_below_confirmed'
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
  | 'schedule_version_mismatch'
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
  capacity_below_confirmed: 'Capacity is below the number of confirmed participants',
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
  schedule_version_mismatch: 'The event was changed by another request; reload and try again',
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
