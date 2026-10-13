export interface Session {
  accountId: string;
  email: string;
  csrfToken: string;
  /** Display only; the server decides inside the protected operation's transaction (FR-ORG-5). */
  recentAuthUntil: string;
  /** The account's organizations (K-708); events belong to an organization. */
  organizations: Membership[];
}

export interface Membership {
  organizationId: string;
  name: string;
  role: 'owner' | 'admin' | 'member';
  status: 'pending_verification' | 'pending_approval' | 'active' | 'rejected' | 'suspended';
}

export const ROLE_LABEL: Record<Membership['role'], string> = {
  owner: 'Owner',
  admin: 'Admin',
  member: 'Member',
};

/** The active organizations the account can create and manage events in. */
export const activeOrganizations = (session: Session) =>
  session.organizations.filter((o) => o.status === 'active');

export interface EventItem {
  id: string;
  publicId: string;
  publicUrl: string;
  title: string;
  description: string | null;
  startsAt: string;
  timeZone: string;
  capacity: number;
  confirmedCount: number;
  status: string;
  phase: string;
  scheduleVersion: number;
  checkInOpensAt: string;
  checkInClosesAt: string;
  cancelledAt: string | null;
}

/** An item of GET /api/events, with the per-event counts of PD-67. */
export interface EventListItem extends EventItem {
  waitlistedCount: number;
  checkedInCount: number;
}

export interface Counts {
  confirmed: number;
  waitlisted: number;
  checkedIn: number;
}

export interface Participant {
  registrationId: string;
  email: string;
  state: string;
  /** Why an ended registration ended (participant_cancelled, cancelled_by_organizer, …). */
  endReason?: string;
  position?: number;
  checkedInAt?: string;
  checkInId?: string;
  emailIssues: { messageType: string; label: string }[];
}

export type Notice = { kind: 'success' | 'error'; text: string };
