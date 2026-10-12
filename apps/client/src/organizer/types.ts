export interface Session {
  accountId: string;
  email: string;
  csrfToken: string;
  /** Display only; the server decides inside the protected operation's transaction (FR-ORG-5). */
  recentAuthUntil: string;
}

export interface EventItem {
  id: string;
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
  position?: number;
  checkedInAt?: string;
  checkInId?: string;
  emailIssues: { messageType: string; label: string }[];
}

export type Notice = { kind: 'success' | 'error'; text: string };
