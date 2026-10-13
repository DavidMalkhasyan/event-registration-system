// Kysely table types for migration 0001 (docs/database/DATABASE_DESIGN.md §5).
// Kept by hand for now; generated types with a drift check are planned (K-206).
import type { ColumnType, Generated } from 'kysely';

type Timestamp = ColumnType<Date, Date | string, Date | string>;
type Json = ColumnType<
  Record<string, unknown>,
  string | Record<string, unknown>,
  string | Record<string, unknown>
>;

export interface AccountsTable {
  id: Generated<string>;
  email: string;
  created_at: Timestamp;
  email_changed_at: Timestamp | null;
  /** Migration 0010 (K-709). */
  display_name: string | null;
  password_hash: string | null;
  password_changed_at: Timestamp | null;
  email_verified_at: Timestamp | null;
}

export interface SignInRequestsTable {
  id: Generated<string>;
  email: string;
  account_id: string | null;
  purpose: 'sign_in' | 'reauth' | 'verify_email' | 'reset_password';
  reauth_session_id: string | null;
  status: Generated<'active' | 'used' | 'replaced' | 'revoked'>;
  created_at: Timestamp;
  expires_at: Timestamp;
  used_at: Timestamp | null;
  ended_at: Timestamp | null;
}

export interface OrganizerSessionsTable {
  id: Generated<string>;
  account_id: string;
  session_hash: Buffer;
  hash_alg: Generated<number>;
  created_from_request_id: string | null;
  auth_method: Generated<'email_link' | 'password'>;
  created_at: Timestamp;
  authenticated_at: Timestamp;
  last_seen_at: Timestamp;
  absolute_expires_at: Timestamp;
  revoked_at: Timestamp | null;
  revoke_reason: string | null;
}

export type OrganizationStatus =
  'pending_verification' | 'pending_approval' | 'active' | 'rejected' | 'suspended';
export type OrganizationRole = 'owner' | 'admin' | 'member';

/** Migration 0009 (K-708). */
export interface OrganizationsTable {
  id: Generated<string>;
  name: string;
  description: string | null;
  status: OrganizationStatus;
  created_at: Timestamp;
  updated_at: Timestamp;
  email_verified_at: Timestamp | null;
  submitted_at: Timestamp | null;
  decided_at: Timestamp | null;
  migrated_from_account_id: string | null;
  /** Migration 0011 (K-710). */
  decided_by_admin_id: string | null;
  decision_reason: string | null;
}

/** Migration 0014 (K-716). */
export interface OrganizationInvitationsTable {
  id: Generated<string>;
  organization_id: string;
  email: string;
  role: 'admin' | 'member';
  invited_by_account_id: string;
  created_at: Timestamp;
  expires_at: Timestamp;
  status: Generated<'pending' | 'accepted' | 'declined' | 'revoked'>;
  decided_at: Timestamp | null;
}

/** Migration 0013 (K-712): event image metadata; the files are in the media storage. */
export interface EventImagesTable {
  id: Generated<string>;
  event_id: string;
  role: 'cover' | 'gallery';
  position: number;
  storage_key: string;
  width: number;
  height: number;
  byte_size: number;
  thumb_byte_size: number;
  alt_text: string | null;
  created_at: Timestamp;
  created_by_account_id: string;
}

/** Migration 0011 (K-710): Super Admins, separate from organizer accounts. */
export interface PlatformAdminsTable {
  id: Generated<string>;
  email: string;
  display_name: string;
  password_hash: string;
  created_at: Timestamp;
  password_changed_at: Timestamp;
  disabled_at: Timestamp | null;
}

export interface PlatformAdminSessionsTable {
  id: Generated<string>;
  admin_id: string;
  session_hash: Buffer;
  created_at: Timestamp;
  last_seen_at: Timestamp;
  absolute_expires_at: Timestamp;
  revoked_at: Timestamp | null;
  revoke_reason: 'sign_out' | 'admin_disabled' | null;
}

export interface OrganizationMembershipsTable {
  organization_id: string;
  account_id: string;
  role: OrganizationRole;
  created_at: Timestamp;
}

export type EventStatus = 'SCHEDULED' | 'CANCELLED';
export interface EventsTable {
  id: Generated<string>;
  /** The account that created the event (history, D-17); access goes through organization_id (K-708). */
  owner_account_id: string;
  organization_id: string;
  creation_request_id: string;
  creation_fingerprint: Buffer;
  public_id: string;
  title: string;
  description: string | null;
  starts_at: Timestamp;
  time_zone: string;
  capacity: number;
  confirmed_count: Generated<number>;
  status: Generated<EventStatus>;
  schedule_version: Generated<number>;
  next_waitlist_seq: Generated<number>;
  created_at: Timestamp;
  updated_at: Timestamp;
  cancelled_at: Timestamp | null;
  /** Migration 0012 (K-711): the venue; all address fields are set together or not at all. */
  venue_name: string | null;
  street_address: string | null;
  city: string | null;
  region: string | null;
  postal_code: string | null;
  country: string | null;
  arrival_instructions: string | null;
  /** numeric: read as strings. */
  latitude: string | null;
  longitude: string | null;
  location_version: Generated<number>;
}

export type RegistrationState = 'PENDING_VERIFICATION' | 'CONFIRMED' | 'WAITLISTED' | 'CANCELLED' | 'EXPIRED';
export interface RegistrationsTable {
  id: Generated<string>;
  event_id: string;
  email: string;
  state: Generated<RegistrationState>;
  verification_generation: Generated<number>;
  waitlist_seq: number | null;
  created_at: Timestamp;
  verified_at: Timestamp | null;
  waitlisted_at: Timestamp | null;
  confirmed_at: Timestamp | null;
  ended_at: Timestamp | null;
  end_reason: string | null;
  removal_reason: string | null;
  updated_at: Timestamp;
}

export interface TicketsTable {
  id: Generated<string>;
  registration_id: string;
  event_id: string;
  code: string;
  issued_at: Timestamp;
}

export interface CheckInsTable {
  id: Generated<string>;
  ticket_id: string;
  event_id: string;
  checked_in_at: Timestamp;
  actor_kind: 'owner' | 'staff';
  actor_account_id: string | null;
  actor_staff_session_id: string | null;
  undone_at: Timestamp | null;
  undone_by_account_id: string | null;
  undo_reason: string | null;
}

export type CheckInOutcome =
  | 'CHECKED_IN'
  | 'ALREADY_CHECKED_IN'
  | 'INVALID_CODE'
  | 'WRONG_EVENT'
  | 'TICKET_CANCELLED'
  | 'EVENT_CANCELLED'
  | 'OUTSIDE_CHECK_IN_WINDOW';
export interface CheckInRequestsTable {
  event_id: string;
  request_id: string;
  principal_kind: 'owner' | 'staff';
  principal_id: string;
  ticket_id: string | null;
  outcome: CheckInOutcome;
  first_checked_in_at: Timestamp | null;
  created_at: Timestamp;
}

export type TokenType =
  | 'verification'
  | 'management'
  | 'share'
  | 'staff_invitation'
  | 'sign_in'
  | 'email_change'
  | 'account_verification'
  | 'password_reset';
export interface AccessTokensTable {
  id: Generated<string>;
  token_type: TokenType;
  token_hash: Buffer;
  hash_alg: Generated<number>;
  registration_id: string | null;
  sign_in_request_id: string | null;
  staff_invitation_id: Generated<string | null>;
  event_id: string | null;
  issued_at: Timestamp;
  issued_via: 'page' | 'email';
  outbox_message_id: string | null;
  attempt_no: number | null;
  expires_at: Timestamp | null;
  revoked_at: Timestamp | null;
  revoke_reason: string | null;
}

export type SendStatus =
  | 'QUEUED'
  | 'SENDING'
  | 'WAITING_RETRY'
  | 'AWAITING_EVIDENCE'
  | 'ACCEPTED'
  | 'FAILED'
  | 'UNCONFIRMED'
  | 'DROPPED';
export interface OutboxMessagesTable {
  id: Generated<string>;
  logical_key: string;
  message_type: string;
  lane: 'priority' | 'bulk';
  regen_class: 'A' | 'B' | 'C';
  is_required_notice: boolean;
  event_id: string | null;
  registration_id: string | null;
  account_id: string | null;
  sign_in_request_id: string | null;
  schedule_version: number | null;
  verification_generation: number | null;
  request_ref: string | null;
  recipient_email: string;
  payload: Json;
  status: Generated<SendStatus>;
  possibly_accepted: Generated<boolean>;
  current_generation: Generated<number>;
  attempt_no: Generated<number>;
  preclaim_failures: Generated<number>;
  lease_expires_at: Timestamp | null;
  next_attempt_at: Timestamp;
  horizon_at: Timestamp;
  awaiting_evidence_since: Timestamp | null;
  created_at: Timestamp;
  settled_at: Timestamp | null;
  settle_reason: string | null;
  last_error_code: string | null;
  evidence_anomaly_at: Timestamp | null;
  correlation_id: string;
}

export interface OutboxGenerationsTable {
  outbox_id: string;
  generation: number;
  provider_key: string;
  created_at: Timestamp;
  regen_reason: string | null;
  provider_message_id: string | null;
  accepted_at: Timestamp | null;
  delivered_at: Timestamp | null;
  bounced_at: Timestamp | null;
  failed_at: Timestamp | null;
  suppressed_at: Timestamp | null;
  complained_at: Timestamp | null;
  last_delayed_at: Timestamp | null;
  failure_reason: string | null;
  facts_updated_at: Timestamp | null;
}

export interface OutboxAttemptsTable {
  id: Generated<string>;
  outbox_id: string;
  generation: number;
  attempt_no: number;
  worker_id: string;
  claimed_at: Timestamp;
  lease_expires_at: Timestamp;
  send_started_at: Timestamp | null;
  lease_expired_at: Timestamp | null;
  result_at: Timestamp | null;
  result_category: string | null;
  http_status: number | null;
  provider_message_id: string | null;
  possibly_accepted: boolean | null;
  stale: Generated<boolean>;
  error_code: string | null;
  latency_ms: number | null;
}

export interface AuditRecordsTable {
  id: Generated<string>;
  occurred_at: Timestamp;
  action: string;
  actor_kind: 'owner' | 'staff' | 'participant_link' | 'system' | 'account' | 'platform_admin';
  actor_account_id: string | null;
  /** Migration 0011 (K-710). */
  actor_admin_id: Generated<string | null>;
  actor_staff_session_id: string | null;
  event_id: string | null;
  registration_id: string | null;
  ticket_id: string | null;
  subject_id: string | null;
  outcome: string;
  details: Json;
}

export interface RateLimitCountersTable {
  scope: string;
  key_id: number;
  key_hash: Buffer;
  window_start: Timestamp;
  count: number;
  expires_at: Timestamp;
}

export interface SchemaMigrationsTable {
  version: number;
  name: string;
  checksum: Buffer;
  applied_at: Timestamp;
  applied_by: string;
  duration_ms: number;
}

export interface ReminderSlotsTable {
  registration_id: string;
  schedule_version: number;
  event_id: string;
  outbox_message_id: string;
  filled_by: 'reminder' | 'ticket' | 'promotion' | 'event_change';
  created_at: Timestamp;
}

export interface StaffInvitationsTable {
  id: Generated<string>;
  event_id: string;
  invited_email: string;
  status: Generated<'pending' | 'accepted' | 'revoked' | 'replaced'>;
  created_at: Timestamp;
  expires_at: Timestamp;
  accepted_at: Timestamp | null;
  ended_at: Timestamp | null;
}

export interface StaffSessionsTable {
  id: Generated<string>;
  event_id: string;
  invitation_id: string;
  session_hash: Buffer;
  hash_alg: Generated<number>;
  created_at: Timestamp;
  last_seen_at: Timestamp;
  absolute_expires_at: Timestamp;
  revoked_at: Timestamp | null;
  revoke_reason: 'owner_revoked' | null;
}

export interface RotationRequestsTable {
  id: Generated<string>;
  registration_id: string;
  event_id: string;
  request_id: string;
  link_type: 'management' | 'share';
  authorizing_token_id: string;
  new_token_id: string;
  decided_at: Timestamp;
  outbox_message_id: string | null;
}

export interface DeletionMarkersTable {
  event_id: string;
  owner_account_id: string;
  scheduled_start: Timestamp;
  time_zone: string;
  deleted_at: Timestamp;
  deleted_by_account_id: string;
  registrations_deleted: number;
  failed_required_notices: number;
  unconfirmed_required_notices: number;
}

export interface ScheduledTasksTable {
  id: Generated<string>;
  kind: 'reminder_fanout' | 'cutoff_processing';
  event_id: string;
  schedule_version: number;
  due_at: Timestamp;
  status: Generated<'PENDING' | 'RUNNING' | 'DONE' | 'SKIPPED' | 'FAILED'>;
  attempt_no: Generated<number>;
  lease_expires_at: Timestamp | null;
  cursor_registration_id: string | null;
  params: Json;
  last_error_code: string | null;
  created_at: Timestamp;
  finished_at: Timestamp | null;
}

export interface DB {
  'app.accounts': AccountsTable;
  'app.sign_in_requests': SignInRequestsTable;
  'app.organizer_sessions': OrganizerSessionsTable;
  'app.events': EventsTable;
  'app.registrations': RegistrationsTable;
  'app.tickets': TicketsTable;
  'app.check_ins': CheckInsTable;
  'app.check_in_requests': CheckInRequestsTable;
  'app.access_tokens': AccessTokensTable;
  'app.outbox_messages': OutboxMessagesTable;
  'app.outbox_generations': OutboxGenerationsTable;
  'app.outbox_attempts': OutboxAttemptsTable;
  'app.audit_records': AuditRecordsTable;
  'app.rate_limit_counters': RateLimitCountersTable;
  'app.schema_migrations': SchemaMigrationsTable;
  'app.reminder_slots': ReminderSlotsTable;
  'app.scheduled_tasks': ScheduledTasksTable;
  'app.deletion_markers': DeletionMarkersTable;
  'app.rotation_requests': RotationRequestsTable;
  'app.staff_invitations': StaffInvitationsTable;
  'app.staff_sessions': StaffSessionsTable;
  'app.organizations': OrganizationsTable;
  'app.organization_memberships': OrganizationMembershipsTable;
  'app.platform_admins': PlatformAdminsTable;
  'app.platform_admin_sessions': PlatformAdminSessionsTable;
  'app.event_images': EventImagesTable;
  'app.organization_invitations': OrganizationInvitationsTable;
}
